"""Сквозные проверки данных и границ доступа. Внешние сервисы не вызываются."""
from datetime import date, timedelta
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.analytics import assess, demo_records


@pytest.fixture
def client(monkeypatch,tmp_path):
    monkeypatch.setenv('DATABASE_MODE','sqlite')
    monkeypatch.setenv('SQLITE_PATH',str(tmp_path/'test.db'))
    monkeypatch.delenv('GROQ_API_KEY',raising=False)
    with TestClient(app) as client:
        yield client


def test_isolated_sessions_and_full_flow(client):
    assert client.get('/api/state/alex').status_code==401
    assert client.post('/api/demo',json={}).status_code==200
    original=client.get('/api/state/alex').json()
    cookie=client.cookies.get('rg_session')
    assert original['assessment']['level']=='steady'
    checks,_=demo_records('attention')
    assert client.post('/api/checkins/alex',json=checks[-1]).json()['assessment']['level']=='attention'
    attention=client.get('/api/state/alex').json()['assessment']
    assert attention['insights'][0]['area']=='Дискомфорт'
    assert any(item['area']=='Сон' for item in attention['insights'])
    assert client.post('/api/decisions/alex',json={'action':'discuss','note':'Обсудим самочувствие перед занятием.'}).status_code==200
    assert len(client.get('/api/state/alex').json()['decisions'])==1
    # Другой посетитель не видит ни изменения чек-ина, ни комментарий тренера.
    client.cookies.clear()
    client.post('/api/demo',json={})
    second=client.get('/api/state/alex').json()
    assert second['assessment']['level']=='steady'
    assert second['decisions']==[]
    assert client.get('/api/state/unknown').status_code==404
    client.cookies.clear()
    client.cookies.set('rg_session',cookie)
    assert client.get('/api/state/alex').json()['assessment']['level']=='attention'
    assert client.delete('/api/demo').status_code==200
    assert client.get('/api/state/alex').status_code==401


def test_quiz_validation_import_and_missing_ai(client):
    client.post('/api/demo',json={})
    public=client.get('/api/lessons').json()
    assert all('answer' not in l for l in public)
    assert not client.post('/api/lessons/focus/alex',json={'choice':0}).json()['correct']
    assert client.get('/api/state/alex').json()['completed']==[]
    assert client.post('/api/lessons/focus/alex',json={'choice':1}).json()['correct']
    assert client.get('/api/state/alex').json()['completed']==['focus']
    assert client.post('/api/chat',json={'text':'Как вернуть фокус?'}).status_code==503
    assert client.post('/api/trainings/alex',json={'minutes':-2,'rpe':5,'focus':3}).status_code==422
    checks,_=demo_records()
    assert client.post('/api/import/alex',json={'checkins':[checks[-1]]}).status_code==200
    bad={**checks[-1],'date':(date.today()+timedelta(days=1)).isoformat()}
    assert client.post('/api/import/alex',json={'checkins':[bad]}).status_code==422
    assert client.post('/api/checkins/alex',json=checks[-1],headers={'Origin':'https://evil.example'}).status_code==403
    assert client.get('/api/export').headers['content-disposition'].startswith('attachment')


def test_analytics_limits_and_missing_history():
    assert assess([],[])['score'] is None
    for scenario,level in [('steady','steady'),('tired','caution'),('attention','attention')]:
        checks,sessions=demo_records(scenario)
        result=assess(checks,sessions)
        assert result['level']==level
        assert 0<=result['score']<=100
    checks,sessions=demo_records('attention')
    assert assess(checks[:-2],sessions)['level']=='unknown'
    result=assess([checks[-1]],[])
    assert 'Мало истории' in result['quality']
    assert result['level']=='attention'
    assert result['insights'][0]['priority']==0


def test_assets(client):
    for path in ['/','/static/app.js','/static/styles.css','/static/hero.png','/static/fonts/manrope-cyrillic.woff2']:
        assert client.get(path).status_code==200
