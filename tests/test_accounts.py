"""Проверяем границы личного API без отправки паролей и анкет во внешнюю сеть."""
from datetime import date
import json
import httpx
import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from backend.main import app
from backend import accounts


@pytest.fixture
def personal(monkeypatch, tmp_path):
    monkeypatch.setenv('DATABASE_MODE', 'sqlite')
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path/'demo.db'))
    stored = {}
    def remote(method, path, token=None, **kwargs):
        if path == '/auth/v1/token':
            if kwargs['params']['grant_type'] == 'refresh_token':
                uid=kwargs['json']['refresh_token']
            else:
                uid=kwargs['json']['email'].split('@')[0]
            return {'access_token':uid, 'refresh_token':uid, 'expires_in':3600}
        if path == '/auth/v1/logout':
            return None
        if path == '/auth/v1/user':
            if token not in ('alice','bob'):
                raise HTTPException(401, 'Invalid token')
            return {'id':token,'email':token+'@example.test','user_metadata':{'name':token}}
        if path == '/rest/v1/rg_profiles':
            return [{'user_id':token,'role':'player','display_name':token,'coach_code':None}]
        if path == '/rest/v1/rg_coach_links':
            return []
        if path == '/rest/v1/rg_player_context':
            return []
        assert path == '/rest/v1/rg_personal_records'
        if method == 'POST':
            row=kwargs['json']
            assert row['user_id']==token
            stored[(token,row['kind'],row['entry_key'])]={**row,'created_at':'2026-09-23'}
            return None
        assert kwargs['params']['user_id']=='eq.'+token
        if method == 'DELETE':
            for key in list(stored):
                if key[0]==token: del stored[key]
            return None
        if method == 'PATCH':
            key=(token,'training',kwargs['params']['entry_key'][3:])
            stored[key]['payload']=kwargs['json']['payload']
            return None
        return [r for (owner,kind,entry),r in stored.items() if owner==token
                and ('kind' not in kwargs['params'] or kwargs['params']['kind']=='eq.'+kind)
                and ('entry_key' not in kwargs['params'] or kwargs['params']['entry_key']=='eq.'+entry)]
    monkeypatch.setattr(accounts,'remote',remote)
    with TestClient(app) as client:
        yield client


def login(client, who):
    return client.post('/api/auth/login',json={'email':who+'@example.test','password':'Test-password-892!'})


def test_personal_lifecycle_and_isolation(personal):
    c=personal
    assert c.get('/api/me/state').status_code==401
    response=login(c,'alice')
    assert 'HttpOnly' in response.headers['set-cookie']
    assert c.get('/api/me/state').json()['checkins']==[]
    payload={'date':date.today().isoformat(),'sleep':6,'energy':2,'fatigue':4,'stress':4,'discomfort':0}
    result=c.post('/api/me/checkins',json=payload).json()
    assert result['mode']=='personal' and result['assessment']['synthetic'] is False
    assert len(result['checkins'])==1
    assert c.post('/api/me/checkins',json={**payload,'sleep':8}).json()['checkins'][0]['sleep']==8
    session=c.post('/api/me/trainings',json={'minutes':45,'rpe':3,'focus':4}).json()['trainings'][0]
    assert session['before']['energy']==2
    reflected=c.put('/api/me/trainings/'+session['id']+'/reflection',json={
        'quality':7,'energy_after':5,'discomfort_after':'same','note':'Только для меня'})
    assert reflected.status_code==200
    assert reflected.json()['trainings'][0]['after']['note']=='Только для меня'
    assert c.post('/api/me/checkins',json={**payload,'user_id':'bob'}).status_code==422
    assert c.post('/api/me/checkins',json=payload,headers={'Origin':'https://other.test'}).status_code==403
    c.post('/api/auth/logout')
    assert c.get('/api/me/state').status_code==401
    login(c,'bob')
    assert c.get('/api/me/state').json()['checkins']==[]
    c.delete('/api/me/history')
    login(c,'alice')
    assert len(c.get('/api/me/state').json()['checkins'])==1
    assert len(c.get('/api/me/export').json()['trainings'])==1
    c.cookies.delete('rg_access')
    assert c.post('/api/auth/refresh').status_code==200
    assert len(c.get('/api/me/state').json()['checkins'])==1
    c.delete('/api/me/history')
    assert c.get('/api/me/state').json()['checkins']==[]


def test_auth_validation(personal):
    assert personal.post('/api/auth/login',json={'email':'invalid','password':'123'}).status_code==422
    assert personal.post('/api/auth/refresh').status_code==401
    assert personal.post('/api/auth/session',json={'access_token':'x','refresh_token':'x'}).status_code==422


def test_gemini_retries_transient_errors_with_short_backoff(monkeypatch):
    statuses = [503, 429, 200]
    requests, waits = [], []
    monkeypatch.setattr(accounts.time, 'sleep', waits.append)
    monkeypatch.setattr(accounts.random, 'uniform', lambda _a, _b: 0)

    def respond(request):
        requests.append(request)
        status = statuses[len(requests) - 1]
        if status == 200:
            return httpx.Response(200, json={'candidates': [{
                'finishReason': 'STOP', 'content': {'parts': [{'text': 'Короткий совет.'}]}}]})
        return httpx.Response(status, json={'error': {'message': 'temporary'}})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        answer = accounts._gemini_text(client, 'test-key', 'gemini-3.5-flash-lite', 'state')
    assert answer == 'Короткий совет.'
    assert len(requests) == 3
    assert waits == [0.8, 1.6]
    payload = json.loads(requests[0].content)
    assert payload['generationConfig']['thinkingConfig']['thinkingLevel'] == 'minimal'
    assert payload['generationConfig']['maxOutputTokens'] == 320


def test_gemini_does_not_retry_auth_error_or_truncated_answer(monkeypatch):
    monkeypatch.setattr(accounts.time, 'sleep', lambda _seconds: pytest.fail('Unexpected retry'))
    for status, body in ((403, {'error': {'message': 'invalid key'}}),
                         (200, {'candidates': [{'finishReason': 'MAX_TOKENS',
                                                'content': {'parts': [{'text': 'Обрезанный'}]}}]})):
        calls = []
        def respond(request):
            calls.append(request)
            return httpx.Response(status, json=body)
        with httpx.Client(transport=httpx.MockTransport(respond)) as client:
            assert accounts._gemini_text(client, 'test-key', 'gemini-3.5-flash-lite', 'state') is None
        assert len(calls) == 1


def test_gemini_does_not_repeat_a_slow_timeout(monkeypatch):
    monkeypatch.setattr(accounts.time, 'sleep', lambda _seconds: pytest.fail('Unexpected retry'))
    calls = []
    def respond(request):
        calls.append(request)
        raise httpx.ReadTimeout('slow model', request=request)
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert accounts._gemini_text(client, 'test-key', 'gemini-3.5-flash-lite', 'state') is None
    assert len(calls) == 1


def test_advice_sends_compact_history_without_identity(personal, monkeypatch):
    login(personal, 'alice')
    personal.post('/api/me/checkins', json={
        'date': date.today().isoformat(), 'sleep': 7, 'energy': 4,
        'fatigue': 2, 'stress': 3, 'discomfort': 0})
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key')

    def fake_gemini(_client, key, model, prompt):
        assert key == 'test-key' and model == 'gemini-3.5-flash-lite'
        assert 'alice@example.test' not in prompt
        compact = json.loads(prompt.split('JSON: ', 1)[1])
        assert compact['totals']['checkins'] == 1
        assert compact['recent_checkins'][0]['sleep'] == 7
        return 'Состояние стабильное. На следующем занятии сравни точность двух коротких серий ударов.'

    monkeypatch.setattr(accounts, '_gemini_text', fake_gemini)
    result = personal.get('/api/me/advice')
    assert result.status_code == 200
    assert result.json()['source'] == 'gemini'


def test_generic_gemini_advice_falls_back_to_concrete_step(personal, monkeypatch):
    login(personal, 'alice')
    personal.post('/api/me/checkins', json={
        'date': date.today().isoformat(), 'sleep': 8, 'energy': 4,
        'fatigue': 2, 'stress': 2, 'discomfort': 0})
    monkeypatch.setenv('GEMINI_API_KEY', 'test-key')
    monkeypatch.setattr(accounts, '_gemini_text', lambda *_: 'Всё хорошо. Продолжай отмечать сон и нагрузку.')

    result = personal.get('/api/me/advice').json()
    assert result['source'] == 'algorithm'
    assert 'точность двух коротких серий' in result['text']
