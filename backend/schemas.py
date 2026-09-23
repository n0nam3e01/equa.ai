"""Валидация выполняется сервером, даже если браузер проверил форму."""
from datetime import date as Date
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Checkin(Strict):
    date: Date = Field(default_factory=Date.today)
    sleep: float = Field(ge=0, le=14)
    energy: int = Field(ge=1, le=5)
    stress: int = Field(ge=1, le=5)
    fatigue: int = Field(ge=1, le=5)
    discomfort: int = Field(ge=0, le=10)
    limitation: bool = False
    resting_hr: int | None = Field(default=None, ge=30, le=220)
    hrv: float | None = Field(default=None, gt=0, le=300)

    @model_validator(mode='after')
    def no_future(self):
        if self.date > Date.today():
            raise ValueError('Дата не может быть в будущем')
        return self


class Training(Strict):
    date: Date = Field(default_factory=Date.today)
    minutes: int = Field(ge=1, le=360)
    rpe: int = Field(ge=1, le=10)
    kind: Literal['court', 'match', 'fitness'] = 'court'
    note: str = Field(default='', max_length=500)
    focus: int = Field(ge=1, le=5)

    @model_validator(mode='after')
    def no_future(self):
        if self.date > Date.today():
            raise ValueError('Дата не может быть в будущем')
        return self


class Reflection(Strict):
    # Ответ после занятия хранится рядом с самой тренировкой.
    quality: int = Field(ge=1, le=10)
    energy_after: int = Field(ge=1, le=10)
    discomfort_after: Literal['none', 'lower', 'same', 'increased']
    note: str = Field(default='', max_length=500)


class Decision(Strict):
    action: Literal['discuss', 'lighter', 'rest']
    note: str = Field(min_length=1, max_length=500)


class Message(Strict):
    text: str = Field(min_length=2, max_length=2000)


class Answer(Strict):
    choice: int = Field(ge=0, le=3)


class ImportData(Strict):
    checkins: list[Checkin] = Field(min_length=1, max_length=90)


class Scenario(Strict):
    name: Literal['steady', 'tired', 'attention']
