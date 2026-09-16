"""Единый интерфейс хранения: локальный SQL или PostgreSQL через Supabase REST.

В облачном режиме нет незаметного отката в SQLite: ошибка записи должна быть видна.
"""

import json
import os
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
import httpx

ROOT = Path(__file__).resolve().parents[1]


class Storage:
    def __init__(self, mode=None, path=None):
        self.mode = mode or os.getenv("DATABASE_MODE", "sqlite")
        if self.mode not in {"sqlite", "supabase"}:
            raise ValueError("DATABASE_MODE должен быть sqlite или supabase")
        if self.mode == "sqlite":
            # На Vercel файлы приложения недоступны для записи. /tmp — только
            # временная демо-история отдельного экземпляра, не постоянная база.
            self.ephemeral = os.getenv("VERCEL") == "1"
            default_path = (Path(tempfile.gettempdir()) / "equa/equa.db"
                            if self.ephemeral else ROOT / "data/equa.db")
            self.path = Path(path or (str(default_path) if self.ephemeral
                                     else os.getenv("SQLITE_PATH", str(default_path))))
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.connect() as db:
                db.executescript((ROOT / "sql/local.sql").read_text(encoding="utf-8"))
        else:
            url = os.getenv("SUPABASE_URL", "").rstrip("/")
            key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
            if not url.startswith("https://") or not key:
                raise ValueError("Заполните SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY в .env")
            self.url = url + "/rest/v1/decisions"
            # Legacy service_role JWT передаём и как Bearer; новые secret keys — через apikey.
            self.headers = {"apikey": key, "Prefer": "return=representation"}
            if not key.startswith("sb_secret_"):
                self.headers["Authorization"] = f"Bearer {key}"

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        return db

    def request(self, method, **kwargs):
        with httpx.Client(timeout=15) as client:
            response = client.request(method, self.url, headers=self.headers, **kwargs)
            response.raise_for_status()
            return response.json()

    def save(self, transaction, policy, result):
        row = {"id": str(uuid4()), "created_at": datetime.now(timezone.utc).isoformat(),
               "transaction_data": transaction, "policy_data": policy, "result_data": result,
               "action": result["action"], "challenge_outcome": None}
        if self.mode == "supabase":
            self.request("POST", json=row)
        else:
            # Значения всегда в placeholders: пользовательский ввод не становится SQL-кодом.
            with self.connect() as db:
                db.execute("INSERT INTO decisions VALUES (?, ?, ?, ?, ?, ?, ?)",
                           (row["id"], row["created_at"], json.dumps(transaction), json.dumps(policy),
                            json.dumps(result), row["action"], None))
        return row

    def history(self):
        if self.mode == "supabase":
            return self.request("GET", params={"select": "*", "order": "created_at.desc", "limit": "30"})
        with self.connect() as db:
            rows = [dict(r) for r in db.execute("SELECT * FROM decisions ORDER BY created_at DESC LIMIT 30")]
        for row in rows:
            for field in ["transaction_data", "policy_data", "result_data"]:
                row[field] = json.loads(row[field])
        return rows

    def challenge(self, identifier, outcome):
        # Условный UPDATE атомарен: повторно пройти или изменить проверку нельзя.
        if self.mode == "supabase":
            rows = self.request("PATCH", params={"id": f"eq.{identifier}", "action": "eq.challenge",
                                                 "challenge_outcome": "is.null"},
                                json={"challenge_outcome": outcome})
            return bool(rows)
        with self.connect() as db:
            cursor = db.execute("UPDATE decisions SET challenge_outcome=? WHERE id=? "
                                "AND action='challenge' AND challenge_outcome IS NULL", (outcome, identifier))
            return cursor.rowcount == 1
