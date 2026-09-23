"""Supabase Auth + личные записи. Все SQL-запросы идут с JWT пользователя и RLS.

Публичный ключ идентифицирует приложение, но не обходит права доступа.
Пароли не сохраняются нашим сервером, токены доступны только HttpOnly cookies.
"""
import os
from uuid import uuid4
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import Field
from backend.schemas import Strict, Checkin, Training
from backend.analytics import assess

router = APIRouter(prefix='/api')
PROJECT_URL = 'https://oitbqygljigiqrczqzdd.supabase.co'
# Publishable key предназначен для публичного приложения; это не service_role.
PUBLIC_KEY = 'sb_publishable_XNB9h8qWeQeqkqUOLmzg2A_YqW46dUO'


class Credentials(Strict):
    email: str = Field(min_length=3, max_length=254, pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(default='Игрок', min_length=1, max_length=60)


class Session(Strict):
    access_token: str = Field(min_length=20, max_length=8192)
    refresh_token: str = Field(min_length=10, max_length=8192)


def remote(method, path, token=None, **kwargs):
    headers = {'apikey': os.getenv('SUPABASE_PUBLISHABLE_KEY', PUBLIC_KEY)}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    headers.update(kwargs.pop('headers', {}))
    url = os.getenv('SUPABASE_AUTH_URL', PROJECT_URL).rstrip('/')
    with httpx.Client(timeout=20) as client:
        result = client.request(method, url + path, headers=headers, **kwargs)
    if result.status_code >= 400:
        code = result.json().get('error_code', '') if 'json' in result.headers.get('content-type', '') else ''
        if result.status_code == 429:
            raise HTTPException(429, 'Слишком много попыток. Подожди немного и повтори.')
        if path.startswith('/auth/'):
            message = {'email_not_confirmed': 'Подтверди email по ссылке из письма.',
                       'email_address_not_authorized': 'Отправка писем пока ограничена настройками Supabase.',
                       'user_already_exists': 'Аккаунт уже существует. Используй вход.',
                       'weak_password': 'Выбери более сложный пароль.'}.get(code, 'Не удалось войти. Проверь email и пароль или войди заново.')
            raise HTTPException(401 if result.status_code < 500 else 503, message)
        raise HTTPException(503, 'Не удалось сохранить или загрузить историю. Повтори попытку.')
    return result.json() if result.content else None


def cookies(response, request, session):
    for name, value, age, path in (
        ('rg_access', session['access_token'], session.get('expires_in', 3600), '/api'),
        ('rg_refresh', session['refresh_token'], 60*60*24*30, '/api/auth')):
        response.set_cookie(name, value, max_age=age, path=path, httponly=True,
                            secure=request.url.scheme == 'https', samesite='strict')


def identity(request: Request):
    token = request.cookies.get('rg_access')
    if not token:
        raise HTTPException(401, 'Войди в свой аккаунт.')
    # Проверяем подпись/срок/пользователя через Auth, не доверяем декодированному JWT.
    user = remote('GET', '/auth/v1/user', token)
    return {'user': user, 'token': token}


@router.post('/auth/signup')
def signup(body: Credentials, request: Request, response: Response):
    result = remote('POST', '/auth/v1/signup', json={
        'email': body.email.strip().lower(), 'password': body.password,
        'data': {'name': body.name.strip() or 'Игрок'}})
    if result.get('access_token'):
        cookies(response, request, result)
    return {'confirmation_required': not bool(result.get('access_token'))}


@router.post('/auth/login')
def login(body: Credentials, request: Request, response: Response):
    result = remote('POST', '/auth/v1/token', params={'grant_type': 'password'},
                    json={'email': body.email.strip().lower(), 'password': body.password})
    cookies(response, request, result)
    return {'signed_in': True}


@router.post('/auth/refresh')
def refresh(request: Request, response: Response):
    token = request.cookies.get('rg_refresh')
    if not token:
        raise HTTPException(401, 'Войди в свой аккаунт.')
    result = remote('POST', '/auth/v1/token', params={'grant_type': 'refresh_token'}, json={'refresh_token': token})
    cookies(response, request, result)
    return {'signed_in': True}


@router.post('/auth/session')
def confirm(body: Session, request: Request, response: Response):
    # Обмен после перехода из письма: Supabase подтверждает обе части сессии.
    user = remote('GET', '/auth/v1/user', body.access_token)
    result = remote('POST', '/auth/v1/token', params={'grant_type': 'refresh_token'}, json={'refresh_token': body.refresh_token})
    if result['user']['id'] != user['id']:
        raise HTTPException(401, 'Недействительная сессия.')
    cookies(response, request, result)
    return {'signed_in': True}


@router.post('/auth/logout')
def logout(request: Request, response: Response):
    token = request.cookies.get('rg_access')
    if token:
        try:
            remote('POST', '/auth/v1/logout', token, params={'scope': 'local'})
        except HTTPException as exc:
            if exc.status_code != 401:
                raise
    response.delete_cookie('rg_access', path='/api')
    response.delete_cookie('rg_refresh', path='/api/auth')
    return {'signed_out': True}


def records(auth):
    rows, offset = [], 0
    while True:
        batch = remote('GET', '/rest/v1/rg_personal_records', auth['token'], params={
            'user_id': 'eq.'+auth['user']['id'], 'select': 'kind,payload,created_at',
            'order': 'created_at.asc,id.asc', 'limit': 500, 'offset': offset})
        rows.extend(batch)
        if len(batch) < 500:
            return rows
        offset += 500


def personal_state(auth):
    rows = records(auth)
    checks = sorted([r['payload'] for r in rows if r['kind']=='checkin'], key=lambda x:x['date'])
    trainings = sorted([r['payload'] for r in rows if r['kind']=='training'], key=lambda x:x['date'])
    name = auth['user'].get('user_metadata', {}).get('name') or 'Игрок'
    return {'mode': 'personal', 'player': {'id':'me', 'name':name, 'initials':name[:2].upper()},
            'email':auth['user']['email'], 'checkins':checks, 'trainings':trainings,
            'assessment':{**assess(checks, trainings), 'synthetic':False}, 'completed':[], 'decisions':[]}


@router.get('/me/state')
def get_state(auth=Depends(identity)):
    return personal_state(auth)


def save(auth, kind, payload):
    # Один опрос на дату: повторная отправка обновляет запись атомарно в PostgreSQL.
    entry = payload['date'] if kind == 'checkin' else str(uuid4())
    remote('POST', '/rest/v1/rg_personal_records', auth['token'],
           params={'on_conflict':'user_id,kind,entry_key'},
           headers={'Prefer':'resolution=merge-duplicates,return=minimal'},
           json={'user_id':auth['user']['id'], 'kind':kind, 'entry_key':entry, 'payload':payload})


@router.post('/me/checkins')
def checkin(body: Checkin, auth=Depends(identity)):
    save(auth, 'checkin', body.model_dump(mode='json'))
    return personal_state(auth)


@router.post('/me/trainings')
def training(body: Training, auth=Depends(identity)):
    save(auth, 'training', body.model_dump(mode='json'))
    return personal_state(auth)


@router.get('/me/export')
def export(response: Response, auth=Depends(identity)):
    response.headers['Content-Disposition'] = 'attachment; filename="rallyguard-history.json"'
    return personal_state(auth)


@router.delete('/me/history')
def clear_history(auth=Depends(identity)):
    remote('DELETE', '/rest/v1/rg_personal_records', auth['token'], params={'user_id':'eq.'+auth['user']['id']})
    return {'deleted':True}
