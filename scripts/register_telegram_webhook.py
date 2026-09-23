"""Однократная регистрация webhook после добавления секретов в локальный .env.

Скрипт не печатает токен и не сохраняет его в репозитории.
"""
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')
token = os.getenv('TELEGRAM_BOT_TOKEN')
secret = os.getenv('TELEGRAM_WEBHOOK_SECRET')
site = os.getenv('RALLYGUARD_SITE_URL', 'https://rallyguard.vercel.app').rstrip('/')

if not token or not secret:
    raise SystemExit('Укажи TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET в локальном .env.')

result = httpx.post('https://api.telegram.org/bot'+token+'/setWebhook', timeout=15, json={
    'url': site+'/api/telegram/webhook',
    'secret_token': secret,
    'allowed_updates': ['message'],
})
result.raise_for_status()
if not result.json().get('ok'):
    raise SystemExit('Telegram не принял webhook. Проверь адрес сайта и настройки бота.')
print('Webhook Telegram подключён к RallyGuard.')
