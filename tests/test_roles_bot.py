"""Проверяем разделение ролей и что бот отвергает неподписанный webhook."""
from uuid import uuid4

from fastapi.testclient import TestClient

from backend.main import app
from backend import accounts
from backend.telegram_bot import signed_code, verify_code


def test_link_code_expires_and_cannot_be_forged():
    coach_id = str(uuid4())
    code = signed_code(coach_id, 'local-test-secret')
    assert verify_code(code, 'local-test-secret') == coach_id
    assert verify_code(code, 'different-secret') is None
    assert verify_code(code[:-1] + ('A' if code[-1] != 'A' else 'B'), 'local-test-secret') is None


def test_coach_cannot_use_player_endpoints(monkeypatch, tmp_path):
    monkeypatch.setenv('DATABASE_MODE', 'sqlite')
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path/'demo.db'))
    coach_id = str(uuid4())
    def remote(method, path, token=None, **kwargs):
        if path == '/auth/v1/token':
            return {'access_token':'coach-token','refresh_token':'coach-refresh','expires_in':3600}
        if path == '/auth/v1/user':
            return {'id':coach_id,'email':'coach@example.test'}
        if path == '/rest/v1/rg_profiles':
            return [{'user_id':coach_id,'role':'coach','display_name':'Тренер','coach_code':'a'*32}]
        raise AssertionError(f'Unexpected access: {path}')
    monkeypatch.setattr(accounts, 'remote', remote)
    with TestClient(app) as client:
        client.post('/api/auth/login', json={'email':'coach@example.test','password':'Test-password-892!'})
        assert client.get('/api/me/profile').json()['role'] == 'coach'
        assert client.get('/api/me/state').status_code == 403
        assert client.post('/api/me/checkins',json={'sleep':8,'energy':4,'fatigue':2,'stress':2,'discomfort':0}).status_code == 403
        assert client.post('/api/me/coach',json={'code':'a'*32}).status_code == 403


def test_telegram_rejects_unverified_requests(monkeypatch, tmp_path):
    monkeypatch.setenv('DATABASE_MODE', 'sqlite')
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path/'demo.db'))
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN', 'dummy-token')
    monkeypatch.setenv('TELEGRAM_WEBHOOK_SECRET', 'dummy-secret')
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', 'dummy-service-key')
    with TestClient(app) as client:
        assert client.post('/api/telegram/webhook',json={'message':{'text':'/players'}}).status_code == 403


def test_player_cannot_view_coach_reports(monkeypatch, tmp_path):
    monkeypatch.setenv('DATABASE_MODE', 'sqlite')
    monkeypatch.setenv('SQLITE_PATH', str(tmp_path/'demo.db'))
    player_id = str(uuid4())
    def remote(method, path, token=None, **kwargs):
        if path == '/auth/v1/token':
            return {'access_token':'player-token','refresh_token':'player-refresh','expires_in':3600}
        if path == '/auth/v1/user':
            return {'id':player_id,'email':'player@example.test'}
        if path == '/rest/v1/rg_profiles':
            return [{'user_id':player_id,'role':'player','display_name':'Игрок','coach_code':None}]
        raise AssertionError(f'Unexpected access: {path}')
    monkeypatch.setattr(accounts, 'remote', remote)
    with TestClient(app) as client:
        client.post('/api/auth/login', json={'email':'player@example.test','password':'Test-password-892!'})
        assert client.get('/api/coach/players').status_code == 403
        assert client.get('/api/coach/players/'+str(uuid4())).status_code == 403
        assert client.get('/api/coach/telegram-link').status_code == 403
