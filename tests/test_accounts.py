"""Проверяем границы личного API без отправки паролей и анкет во внешнюю сеть."""
from datetime import date
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
        return [r for (owner,_,_),r in stored.items() if owner==token]
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
    assert c.post('/api/me/trainings',json={'minutes':45,'rpe':3,'focus':4}).status_code==200
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
