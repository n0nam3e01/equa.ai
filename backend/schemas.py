"""Контракт API: Pydantic проверяет данные до выполнения модели или SQL."""

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    # Запрещаем неизвестные поля и NaN, чтобы ошибочный запрос не искажал расчёты.
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Transaction(StrictModel):
    amount: float = Field(default=25000, gt=0, le=10_000_000)
    average_amount: float = Field(default=18000, ge=100, le=10_000_000)
    country: Literal["KZ", "TR", "DE", "US", "BR"] = "KZ"
    home_country: Literal["KZ", "TR", "DE", "US", "BR"] = "KZ"
    new_device: bool = False
    frequency: int = Field(default=1, ge=1, le=100)
    merchant: Literal["retail", "travel", "digital", "transfer"] = "retail"


class Policy(StrictModel):
    # Все суммы в тенге. Эти параметры задаёт аналитик, модель их не «угадывает».
    block_cost: float = Field(default=2500, ge=0, le=100000)
    challenge_cost: float = Field(default=25, ge=0, le=10000)
    abandonment: float = Field(default=0.05, ge=0, le=1)
    effectiveness: float = Field(default=0.90, ge=0, le=1)


class ScoreRequest(StrictModel):
    transaction: Transaction
    policy: Policy = Field(default_factory=Policy)


class ChallengeRequest(StrictModel):
    # Это имитация результата проверки для демо, а не настоящая 2FA.
    outcome: Literal["passed", "failed"]
