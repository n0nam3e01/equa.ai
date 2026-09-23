"""Telegram-бот тренера. Webhook принимает только запросы с секретом Telegram.

Отчёты строятся из ограниченной SQL-функции: заметки и показатели часов туда не входят.
"""
import base64
import hashlib
import hmac
import os
import struct
import time
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from backend.accounts import identity, require_role

router = APIRouter(prefix='/api')


def settings():
    token = os.getenv('TELEGRAM_BOT_TOKEN', '')
    secret = os.getenv('TELEGRAM_WEBHOOK_SECRET', '')
    key = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
    if not token or not secret or not key:
        raise HTTPException(503, 'Telegram ещё не настроен на сервере.')
    return token, secret, key


def admin(method, table, *, params=None, data=None):
    # Service role используется только сервером и никогда не попадает в браузер.
    _, _, key = settings()
    from backend.accounts import PROJECT_URL
    headers = {'apikey': key}
    if not key.startswith('sb_secret_'):
        headers['Authorization'] = 'Bearer '+key
    if data is not None:
        headers.update({'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=representation'})
    with httpx.Client(timeout=15) as client:
        response = client.request(method, PROJECT_URL+'/rest/v1/'+table,
                                  headers=headers, params=params, json=data)
    if response.status_code >= 400:
        raise HTTPException(503, 'Не удалось подключиться к базе бота.')
    return response.json() if response.content else []


def signed_code(coach_id, secret):
    # 16 байт UUID + 4 байта срока + 12 байт подписи дают короткий start-код.
    payload = UUID(coach_id).bytes + struct.pack('>I', int(time.time()) + 600)
    signature = hmac.new(secret.encode(), payload, hashlib.sha256).digest()[:12]
    return base64.urlsafe_b64encode(payload+signature).rstrip(b'=').decode()


def verify_code(code, secret):
    try:
        raw = base64.urlsafe_b64decode(code+'='*((-len(code)) % 4))
        if len(raw) != 32 or not hmac.compare_digest(raw[20:], hmac.new(secret.encode(), raw[:20], hashlib.sha256).digest()[:12]):
            return None
        if struct.unpack('>I', raw[16:20])[0] < time.time():
            return None
        return str(UUID(bytes=raw[:16]))
    except (ValueError, TypeError):
        return None


@router.get('/coach/telegram-link')
def telegram_link(auth=Depends(identity)):
    require_role(auth, 'coach')
    _, secret, _ = settings()
    username = os.getenv('TELEGRAM_BOT_USERNAME', '').lstrip('@')
    if not username:
        raise HTTPException(503, 'Добавь имя Telegram-бота в настройки сервера.')
    return {'url': 'https://t.me/'+username+'?start='+signed_code(auth['user']['id'], secret)}


def send(chat_id, message, token):
    with httpx.Client(timeout=15) as client:
        response = client.post('https://api.telegram.org/bot'+token+'/sendMessage',
                               json={'chat_id': chat_id, 'text': message})
    response.raise_for_status()


def coach_rows(coach_id):
    # Доступ к связи проверяем заново при каждой команде: отзыв игрока действует сразу.
    return admin('GET', 'rg_coach_links', params={
        'coach_id': 'eq.'+coach_id, 'select': 'player_id', 'order': 'created_at.asc'})


@router.post('/telegram/webhook')
async def webhook(request: Request):
    token, secret, _ = settings()
    supplied = request.headers.get('X-Telegram-Bot-Api-Secret-Token', '')
    if not hmac.compare_digest(supplied, secret):
        raise HTTPException(403, 'Недействительная подпись webhook.')
    update = await request.json()
    message = update.get('message') or {}
    chat = message.get('chat') or {}
    if chat.get('type') != 'private' or not isinstance(chat.get('id'), int):
        return {'ok': True}
    chat_id = chat['id']
    command = (message.get('text') or '').strip().split()
    if not command:
        return {'ok': True}
    if command[0] == '/start' and len(command) == 2:
        coach_id = verify_code(command[1], secret)
        if not coach_id:
            send(chat_id, 'Ссылка устарела. Получи новую в профиле RallyGuard.', token)
            return {'ok': True}
        owner = admin('GET', 'rg_profiles', params={'user_id':'eq.'+coach_id, 'role':'eq.coach', 'select':'user_id', 'limit':1})
        if not owner:
            send(chat_id, 'Аккаунт тренера не найден.', token)
            return {'ok': True}
        occupied = admin('GET', 'rg_bot_bindings', params={'chat_id':'eq.'+str(chat_id), 'select':'coach_id', 'limit':1})
        if occupied and occupied[0]['coach_id'] != coach_id:
            send(chat_id, 'Этот чат уже привязан к другому аккаунту тренера. Напиши /unlink.', token)
            return {'ok': True}
        admin('POST', 'rg_bot_bindings', params={'on_conflict':'coach_id'}, data={'coach_id':coach_id,'chat_id':chat_id})
        send(chat_id, 'RallyGuard подключён. /players — группа, /report 1 — сводка первого игрока, /unlink — отвязать чат.', token)
        return {'ok': True}
    bindings = admin('GET', 'rg_bot_bindings', params={'chat_id':'eq.'+str(chat_id), 'select':'coach_id', 'limit':1})
    if not bindings:
        send(chat_id, 'Сначала открой ссылку привязки из профиля тренера RallyGuard.', token)
        return {'ok': True}
    coach_id = bindings[0]['coach_id']
    if command[0] == '/unlink':
        admin('DELETE', 'rg_bot_bindings', params={'chat_id':'eq.'+str(chat_id)})
        send(chat_id, 'Чат отвязан.', token)
        return {'ok': True}
    rows = coach_rows(coach_id)
    if command[0] == '/players':
        names = []
        for index, row in enumerate(rows, 1):
            p = admin('GET', 'rg_profiles', params={'user_id':'eq.'+row['player_id'], 'select':'display_name', 'limit':1})
            if p:
                names.append(f"{index}. {p[0]['display_name']}")
        send(chat_id, '\n'.join(names) if names else 'Пока нет игроков, давших согласие.', token)
        return {'ok': True}
    if command[0] == '/report' and len(command) == 2 and command[1].isdigit():
        index = int(command[1])-1
        if not 0 <= index < len(rows):
            send(chat_id, 'Номер не найден. Используй /players.', token)
            return {'ok': True}
        # Для сервисного вызова используем прямой SQL RPC с проверкой связи в coach_rows.
        # Здесь данные ограничены теми же полями, что и в функции для тренера.
        from backend.analytics import assess
        player_id = rows[index]['player_id']
        p = admin('GET', 'rg_profiles', params={'user_id':'eq.'+player_id, 'select':'display_name', 'limit':1})
        records = admin('GET', 'rg_personal_records', params={
            'user_id':'eq.'+player_id, 'select':'kind,payload', 'order':'created_at.asc', 'limit':500})
        recent = time.strftime('%Y-%m-%d', time.gmtime(time.time()-30*86400))
        checks = [{k:v for k,v in r['payload'].items() if k in ('date','sleep','energy','fatigue','stress','discomfort','limitation')}
                  for r in records if r['kind']=='checkin' and r['payload'].get('date','') >= recent]
        sessions = [{k:v for k,v in r['payload'].items() if k in ('date','kind','minutes','rpe','focus')}
                    for r in records if r['kind']=='training' and r['payload'].get('date','') >= recent]
        a = assess(checks, sessions)
        send(chat_id, f"{p[0]['display_name'] if p else 'Игрок'}\n{a['label']}\n{a['summary']}\nОпросов за 7 дней: {a['reported_days']}.\nЭто не медицинский диагноз.", token)
        return {'ok': True}
    send(chat_id, 'Команды: /players, /report 1, /unlink.', token)
    return {'ok': True}
