"""Два SQL-адаптера с одинаковым интерфейсом, без молчаливого fallback из облака."""
import hashlib
import json
import os
import sqlite3
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
import httpx

ROOT = Path(__file__).resolve().parents[1]


class Storage:
    def __init__(self):
        self.mode = os.getenv('DATABASE_MODE', 'sqlite')
        self.ephemeral = self.mode == 'sqlite' and os.getenv('VERCEL') == '1'
        if self.mode == 'sqlite':
            default = Path(tempfile.gettempdir()) / 'rallyguard/demo.db' if self.ephemeral else ROOT/'data/rallyguard.db'
            self.path = Path(os.getenv('SQLITE_PATH', str(default)))
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.db() as db:
                db.executescript((ROOT/'sql/local.sql').read_text(encoding='utf-8'))
        elif self.mode == 'supabase':
            self.url = os.environ['SUPABASE_URL'].rstrip('/')+'/rest/v1/'
            key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
            if not self.url.startswith('https://') or not key: raise ValueError('Supabase не настроен')
            self.headers = {'apikey': key, 'Prefer': 'return=representation'}
            if not key.startswith('sb_secret_'): self.headers['Authorization'] = 'Bearer '+key
        else:
            raise ValueError('DATABASE_MODE должен быть sqlite или supabase')

    @contextmanager
    def db(self):
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute('PRAGMA foreign_keys=ON')
        try:
            with connection: yield connection
        finally: connection.close()

    def rest(self, method, table, **kwargs):
        with httpx.Client(timeout=20) as client:
            response = client.request(method, self.url+table, headers=self.headers, **kwargs)
            response.raise_for_status()
            return response.json() if response.content else []

    def workspace(self, token):
        digest = hashlib.sha256(token.encode()).hexdigest()
        if self.mode == 'supabase':
            rows = self.rest('GET', 'rg_workspaces', params={'token_hash': 'eq.'+digest, 'select': 'id', 'limit': 1})
        else:
            with self.db() as db: rows = db.execute('SELECT id FROM rg_workspaces WHERE token_hash=?', (digest,)).fetchall()
        return rows[0]['id'] if rows else None

    def create(self, token):
        row = {'id': str(uuid4()), 'token_hash': hashlib.sha256(token.encode()).hexdigest(),
               'created_at': datetime.now(timezone.utc).isoformat()}
        if self.mode == 'supabase': self.rest('POST', 'rg_workspaces', json=row)
        else:
            with self.db() as db: db.execute('INSERT INTO rg_workspaces VALUES (:id,:token_hash,:created_at)', row)
        return row['id']

    def records(self, workspace, player):
        if self.mode == 'supabase':
            # Пагинация исключает обрезание истории стандартным лимитом PostgREST.
            rows, offset = [], 0
            while True:
                batch = self.rest('GET', 'rg_records', params={'workspace_id': 'eq.'+workspace,
                    'player_id': 'eq.'+player, 'order': 'created_at.asc,id.asc', 'limit': 500, 'offset': offset})
                rows.extend(batch)
                if len(batch) < 500: return rows
                offset += 500
        with self.db() as db:
            rows = [dict(r) for r in db.execute('SELECT * FROM rg_records WHERE workspace_id=? AND player_id=? ORDER BY created_at,id', (workspace,player))]
        for row in rows: row['payload'] = json.loads(row['payload'])
        return rows

    def add_many(self, workspace, player, items):
        now = datetime.now(timezone.utc).isoformat()
        rows = [{'id': str(uuid4()), 'workspace_id': workspace, 'player_id': player,
                 'kind': kind, 'payload': payload, 'created_at': now} for kind,payload in items]
        if not rows: return
        if self.mode == 'supabase': self.rest('POST', 'rg_records', json=rows)
        else:
            with self.db() as db:
                db.executemany('INSERT INTO rg_records VALUES (:id,:workspace_id,:player_id,:kind,:payload,:created_at)',
                    [{**r, 'payload': json.dumps(r['payload'], ensure_ascii=False)} for r in rows])

    def delete(self, workspace):
        if self.mode == 'supabase': self.rest('DELETE', 'rg_workspaces', params={'id': 'eq.'+workspace})
        else:
            with self.db() as db: db.execute('DELETE FROM rg_workspaces WHERE id=?', (workspace,))
