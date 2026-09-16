"""FastAPI соединяет браузер, Python-модель и SQL-хранилище; запуск: python run.py."""

from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path
from typing import Literal
from uuid import UUID
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from backend.engine import FraudEngine
from backend.schemas import ChallengeRequest, Policy, ScoreRequest
from backend.storage import Storage

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
logger = logging.getLogger("equa")


@asynccontextmanager
async def lifespan(app):
    # Обучение выполняется один раз при запуске, а не на каждом HTTP-запросе.
    app.state.engine = FraudEngine()
    app.state.storage = Storage()
    yield


app = FastAPI(title="equa.ai local MVP", version="0.1.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=ROOT / "frontend"), name="static")


@app.get("/")
def index():
    return FileResponse(ROOT / "frontend/index.html")


@app.get("/api/health")
def health():
    # Показывает выбранный адаптер. Это не проверка доступности облачного проекта.
    return {"status": "ready", "database": app.state.storage.mode, "data_source": "synthetic",
            "environment": "vercel" if os.getenv("VERCEL") == "1" else "local",
            "ephemeral_history": getattr(app.state.storage, "ephemeral", False)}


@app.post("/api/report")
def report(policy: Policy):
    return app.state.engine.report(policy)


@app.post("/api/transactions")
def transactions(policy: Policy, page: int = Query(1, ge=1, le=10000),
                 action: Literal["all", "approve", "challenge", "block"] = "all",
                 query: str = Query("", max_length=100)):
    return app.state.engine.transactions(page, action, query, policy)


@app.post("/api/score")
def score(request: ScoreRequest):
    result = app.state.engine.score(request.transaction, request.policy)
    try:
        saved = app.state.storage.save(request.transaction.model_dump(), request.policy.model_dump(), result)
    except Exception:
        logger.exception("Не удалось сохранить решение")
        raise HTTPException(503, "База недоступна. Решение не сохранено; проверьте подключение.")
    return {**result, "id": saved["id"], "transaction": request.transaction.model_dump()}


@app.get("/api/history")
def history():
    try:
        return {"items": app.state.storage.history()}
    except Exception:
        logger.exception("Не удалось прочитать историю")
        raise HTTPException(503, "Не удалось загрузить историю из базы.")


@app.post("/api/decisions/{identifier}/challenge")
def challenge(identifier: UUID, request: ChallengeRequest):
    try:
        updated = app.state.storage.challenge(str(identifier), request.outcome)
    except Exception:
        logger.exception("Не удалось сохранить проверку")
        raise HTTPException(503, "Не удалось сохранить результат проверки.")
    if not updated:
        raise HTTPException(409, "Проверка уже завершена, не требуется или решение не найдено.")
    return {"outcome": request.outcome, "demo_only": True}
