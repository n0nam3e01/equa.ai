"""Проверяем облачный путь SQL и маршруты приложения без доступа к Vercel."""

from fastapi.testclient import TestClient
from backend.main import app
from backend.storage import Storage


def test_vercel_sqlite_uses_temporary_directory(monkeypatch, tmp_path):
    # Даже скопированный локальный SQLITE_PATH не должен писать в код функции.
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("SQLITE_PATH", "read-only/equa.db")
    monkeypatch.setattr("backend.storage.tempfile.gettempdir", lambda: str(tmp_path))
    storage = Storage(mode="sqlite")
    assert storage.path == tmp_path / "equa/equa.db"
    assert storage.ephemeral
    row = storage.save({}, {}, {"action": "challenge"})
    assert storage.history()[0]["id"] == row["id"]
    assert storage.challenge(row["id"], "passed")
    assert not storage.challenge(row["id"], "failed")


def test_vercel_app_serves_frontend_and_api(monkeypatch, tmp_path):
    # Настоящий lifespan обучает модель; проверка покрывает старт и рабочий API.
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setenv("DATABASE_MODE", "sqlite")
    monkeypatch.setattr("backend.storage.tempfile.gettempdir", lambda: str(tmp_path))
    with TestClient(app) as client:
        health = client.get("/api/health").json()
        assert health["environment"] == "vercel"
        assert health["ephemeral_history"] is True
        for url in ("/", "/static/app.js", "/static/dark.css", "/static/dist/enhancements.js"):
            assert client.get(url).status_code == 200
        assert client.post("/api/report", json={}).status_code == 200
        assert client.get("/api/history").json() == {"items": []}
