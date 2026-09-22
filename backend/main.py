"""Один сервер обслуживает сайт и API. Все демо-данные изолированы cookie-сессией."""
import csv
import io
import json
import os
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, HTTPException, Depends
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from backend.analytics import assess, demo_records
from backend.content import LESSONS, public_lessons
from backend.schemas import Checkin, Training, Decision, Message, Answer, ImportData, Scenario
from backend.storage import Storage

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT/'.env')
PLAYERS = [{'id': 'alex', 'name': 'Алекс', 'initials': 'АЛ', 'goal': 'Вернуть концентрацию'},
           {'id': 'mira', 'name': 'Мира', 'initials': 'МИ', 'goal': 'Подготовиться к матчу'},
           {'id': 'timur', 'name': 'Тимур', 'initials': 'ТИ', 'goal': 'Замечать усталость'}]


@asynccontextmanager
async def lifespan(app):
    app.state.storage = Storage()
    yield


app = FastAPI(title='RallyGuard API', version='1.0.0', lifespan=lifespan)
app.mount('/static', StaticFiles(directory=ROOT/'frontend'), name='static')


@app.middleware('http')
async def boundaries(request, call_next):
    # same-origin mutations + HttpOnly SameSite cookie защищают демонстрационную сессию.
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        origin = request.headers.get('origin')
        if origin and urlparse(origin).netloc != request.headers.get('host'):
            return JSONResponse({'detail': 'Запрос с другого сайта запрещён'}, status_code=403)
        if int(request.headers.get('content-length', '0')) > 100_000:
            return JSONResponse({'detail': 'Максимум 100 КБ'}, status_code=413)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'same-origin'
    response.headers['X-Frame-Options'] = 'DENY'
    if request.url.path.startswith('/api'): response.headers['Cache-Control'] = 'no-store'
    return response


@app.exception_handler(httpx.HTTPError)
async def external_error(request, exc):
    return JSONResponse({'detail': 'Внешний сервис недоступен. Проверьте настройки подключения и повторите.'}, status_code=503)


@app.get('/')
def index(): return FileResponse(ROOT/'frontend/index.html')


@app.get('/api/health')
def health():
    return {'status': 'ready', 'database': app.state.storage.mode, 'ephemeral': app.state.storage.ephemeral,
            'ai_available': bool(os.getenv('GROQ_API_KEY')), 'demo_only': True}


def workspace(request: Request):
    token = request.cookies.get('rg_session', '')
    ws = app.state.storage.workspace(token) if token else None
    if not ws: raise HTTPException(401, 'Откройте новую демо-сессию')
    return ws


def player_id(player: str):
    if player not in {p['id'] for p in PLAYERS}: raise HTTPException(404, 'Игрок не найден')
    return player


@app.post('/api/demo')
def create_demo(request: Request, response: Response):
    existing = request.cookies.get('rg_session', '')
    if existing and app.state.storage.workspace(existing): return {'created': False}
    token = secrets.token_urlsafe(48)
    ws = app.state.storage.create(token)
    for player, scenario in zip(PLAYERS, ('steady', 'tired', 'attention')):
        checks, sessions = demo_records(scenario)
        app.state.storage.add_many(ws, player['id'], [('checkin',c) for c in checks]+[('training',s) for s in sessions])
    response.set_cookie('rg_session', token, httponly=True, samesite='strict',
                        secure=request.url.scheme == 'https', max_age=60*60*24*7)
    return {'created': True}


def state(ws, player):
    records = app.state.storage.records(ws, player)
    # Последний чек-ин за дату заменяет предыдущий для расчёта; аудит сохраняется.
    by_date = {}
    for r in records:
        if r['kind'] == 'checkin': by_date[r['payload']['date']] = r['payload']
    checks = sorted(by_date.values(), key=lambda c: c['date'])
    sessions = [r['payload'] for r in records if r['kind']=='training']
    return {'player': next(p for p in PLAYERS if p['id']==player), 'checkins': checks,
            'trainings': sessions, 'assessment': assess(checks,sessions),
            'completed': sorted({r['payload']['lesson'] for r in records if r['kind']=='lesson'}),
            'decisions': [{**r['payload'], 'created_at': r['created_at']} for r in records if r['kind']=='decision']}


@app.get('/api/state/{player}')
def get_state(player: str = Depends(player_id), ws: str = Depends(workspace)):
    return state(ws,player)


@app.get('/api/team')
def team(ws: str = Depends(workspace)):
    return {'players': [state(ws,p['id']) for p in PLAYERS]}


@app.get('/api/lessons')
def lessons(): return public_lessons()


@app.post('/api/checkins/{player}')
def checkin(body: Checkin, player: str = Depends(player_id), ws: str = Depends(workspace)):
    app.state.storage.add_many(ws, player, [('checkin',body.model_dump(mode='json'))])
    return state(ws,player)


@app.post('/api/trainings/{player}')
def training(body: Training, player: str = Depends(player_id), ws: str = Depends(workspace)):
    app.state.storage.add_many(ws, player, [('training',body.model_dump(mode='json'))])
    return state(ws,player)


@app.post('/api/import/{player}')
def import_data(body: ImportData, player: str = Depends(player_id), ws: str = Depends(workspace)):
    app.state.storage.add_many(ws, player, [('checkin',c.model_dump(mode='json')) for c in body.checkins])
    return state(ws,player)


@app.post('/api/scenario/{player}')
def scenario(body: Scenario, player: str = Depends(player_id), ws: str = Depends(workspace)):
    checks, _ = demo_records(body.name)
    app.state.storage.add_many(ws, player, [('checkin',checks[-1])])
    return state(ws,player)


@app.post('/api/lessons/{lesson}/{player}')
def answer(lesson: str, body: Answer, player: str = Depends(player_id), ws: str = Depends(workspace)):
    item = next((l for l in LESSONS if l['id']==lesson), None)
    if not item: raise HTTPException(404, 'Урок не найден')
    correct = body.choice == item['answer']
    if correct: app.state.storage.add_many(ws,player,[('lesson',{'lesson':lesson})])
    return {'correct': correct, 'explanation': item['explanation'] if correct else 'Попробуй ещё раз: перечитай короткий разбор выше.'}


@app.post('/api/decisions/{player}')
def decision(body: Decision, player: str = Depends(player_id), ws: str = Depends(workspace)):
    app.state.storage.add_many(ws,player,[('decision',{**body.model_dump(), 'assessment':state(ws,player)['assessment']})])
    return {'saved': True}


@app.get('/api/export')
def export(ws: str = Depends(workspace)):
    return JSONResponse({'demo_only': True, 'players': [state(ws,p['id']) for p in PLAYERS]},
                        headers={'Content-Disposition':'attachment; filename="rallyguard-export.json"'})


@app.delete('/api/demo')
def delete_demo(response: Response, ws: str = Depends(workspace)):
    app.state.storage.delete(ws)
    response.delete_cookie('rg_session')
    return {'deleted': True}


@app.post('/api/chat')
async def chat(body: Message, ws: str = Depends(workspace)):
    key = os.getenv('GROQ_API_KEY')
    if not key: raise HTTPException(503, 'AI ещё не подключён. Пока доступны уроки и практики из библиотеки.')
    # Только текущий вопрос и учебная база, без фоновой отправки профилей/биометрии.
    catalog = '\n'.join(f"{l['title']}: {' '.join(l['steps'])} Источник: {l['source']}" for l in LESSONS)
    async with httpx.AsyncClient(timeout=25) as client:
        result = await client.post('https://api.groq.com/openai/v1/chat/completions',
            headers={'Authorization':'Bearer '+key}, json={
                'model':os.getenv('GROQ_MODEL','openai/gpt-oss-20b'), 'max_tokens':600,
                'messages':[{'role':'system','content':'Ты учебный помощник RallyGuard для любителей тенниса. Отвечай коротко по-русски, опираясь на базу ниже. Не диагностируй, не назначай лечение и не оценивай медицинский риск. Если вопрос о боли или здоровье, объясни пределы и предложи обратиться к специалисту. Не выдумывай знания о пользователе. Вне базы честно скажи, что нет проверенного материала.\n'+catalog},
                            {'role':'user','content':body.text}]})
        if result.status_code == 429: raise HTTPException(429, 'Квота AI временно исчерпана. Уроки остаются доступны.')
        result.raise_for_status()
        return {'answer':result.json()['choices'][0]['message']['content'], 'provider':'Groq'}
