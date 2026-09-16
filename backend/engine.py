"""Воспроизводимая синтетика, обучаемый ML и отдельная экономика решений.

Здесь нет банковских данных. Метки сэмплируются из вероятностей, поэтому
генератор не даёт идеальной классификации. Результаты относятся только к нему.
"""

from collections import deque
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss
from backend.schemas import Policy, Transaction

FEATURE_NAMES = [
    "Отклонение суммы от истории", "Другая страна", "Новое устройство",
    "Частота за 10 минут", "Категория: переводы", "Страна + новое устройство",
]
ACTIONS = np.array(["approve", "challenge", "block"])
MODEL_VERSION = "synthetic-logit-v1"


def features(amount, average, foreign, new_device, frequency, transfer):
    """Одна и та же функция признаков используется при обучении и через API."""
    return np.column_stack([
        np.log1p(np.asarray(amount) / np.asarray(average)), foreign, new_device,
        np.log1p(np.asarray(frequency) - 1), transfer,
        np.asarray(foreign) * np.asarray(new_device),
    ]).astype(float)


def action_costs(probability, amounts, policy: Policy):
    """Ожидаемые потери для трёх действий; вероятность не равна вердикту.

Для проверки отдельно считаем остаточный фрод и отказ честного покупателя.
Предположение: блокировка полностью предотвращает текущую операцию.
"""
    p = np.asarray(probability)
    amount = np.asarray(amounts)
    return np.column_stack([
        p * amount,
        policy.challenge_cost + (1 - p) * policy.abandonment * policy.block_cost
        + p * (1 - policy.effectiveness) * amount,
        (1 - p) * policy.block_cost,
    ])


def evaluate(actions, labels, amounts, policy):
    """Backtest по известным меткам, но результат Challenge — математическое ожидание."""
    fraud = labels == 1
    honest = ~fraud
    approve, challenge, block = (actions == action for action in ACTIONS)
    fraud_loss = float(amounts[fraud & approve].sum()
                       + amounts[fraud & challenge].sum() * (1 - policy.effectiveness))
    inconvenience = float((honest & block).sum() * policy.block_cost
                          + (honest & challenge).sum() * policy.abandonment * policy.block_cost
                          + challenge.sum() * policy.challenge_cost)
    flagged = ~approve
    return {
        "fraud_loss": round(fraud_loss, 2), "inconvenience": round(inconvenience, 2),
        "total_cost": round(fraud_loss + inconvenience, 2),
        "false_blocks": int((honest & block).sum()),
        "fpr": float((honest & block).sum() / max(honest.sum(), 1)),
        "challenges": int(challenge.sum()), "blocks": int(block.sum()),
        "approvals": int(approve.sum()),
        "precision": float((fraud & flagged).sum() / max(flagged.sum(), 1)),
        "recall": float((fraud & flagged).sum() / max(fraud.sum(), 1)),
        "saved": round(float(amounts[fraud].sum()) - fraud_loss, 2),
    }


class FraudEngine:
    def __init__(self, size=100_000):
        rng = np.random.default_rng(2026)
        # Время монотонно растёт. Средний чек и частота считаются ДО текущей операции.
        profiles = rng.lognormal(9.5, 0.65, 1200)
        totals = np.zeros(1200)
        counts = np.zeros(1200, dtype=int)
        windows = [deque() for _ in range(1200)]
        self.rows = []
        now, previous_user = 0.0, 0
        for index in range(size):
            now += float(rng.exponential(26))
            user = previous_user if rng.random() < 0.13 else int(rng.integers(1200))
            previous_user = user
            average = totals[user] / counts[user] if counts[user] else profiles[user]
            # Для нового клиента стартовый средний чек — синтетический профиль.
            amount = round(float(np.clip(profiles[user] * rng.lognormal(0, 0.8)
                                        * (6 if rng.random() < 0.06 else 1), 100, 2_000_000)), 2)
            while windows[user] and windows[user][0] < now - 600:
                windows[user].popleft()
            foreign = int(rng.random() < 0.12)
            new_device = int(rng.random() < 0.13)
            merchant = str(rng.choice(["retail", "travel", "digital", "transfer"], p=[.55, .12, .18, .15]))
            self.rows.append({
                "id": f"EQ-{index + 1:06}", "customer": f"C-{user:04}",
                "time_seconds": round(now), "amount": amount, "average_amount": round(float(average), 2),
                "country": str(rng.choice(["TR", "DE", "US", "BR"])) if foreign else "KZ",
                "home_country": "KZ", "new_device": bool(new_device),
                "frequency": len(windows[user]) + 1, "merchant": merchant,
            })
            totals[user] += amount
            counts[user] += 1
            windows[user].append(now)
        self.amounts = np.array([r["amount"] for r in self.rows])
        self.x = features(self.amounts, [r["average_amount"] for r in self.rows],
                          [int(r["country"] != "KZ") for r in self.rows],
                          [int(r["new_device"]) for r in self.rows],
                          [r["frequency"] for r in self.rows],
                          [int(r["merchant"] == "transfer") for r in self.rows])
        # Метка не попадает в признаки; случайность оставляет пересечение классов.
        latent = -6.4 + self.x @ np.array([1.1, .8, 1.25, 1.4, .65, 1.5])
        self.labels = rng.binomial(1, 1 / (1 + np.exp(-latent)))
        train_end, calibration_end = int(size * .6), int(size * .8)
        self.model = LogisticRegression(C=1, max_iter=400).fit(self.x[:train_end], self.labels[:train_end])
        # Калибратор обучается на следующем временном отрезке, отдельно от теста.
        self.calibrator = LogisticRegression(C=100, max_iter=200).fit(
            self.model.decision_function(self.x[train_end:calibration_end]).reshape(-1, 1),
            self.labels[train_end:calibration_end])
        self.test_start = calibration_end
        self.probabilities = self.predict(self.x[calibration_end:])
        self.test_y = self.labels[calibration_end:]
        self.test_amounts = self.amounts[calibration_end:]
        # Итоговая модель остаётся линейной в log-odds: вклады объяснения точные.
        self.weights = self.model.coef_[0] * self.calibrator.coef_[0, 0]
        self.intercept = float(self.model.intercept_[0] * self.calibrator.coef_[0, 0]
                               + self.calibrator.intercept_[0])
        self.reference = self.x[:train_end].mean(axis=0)
        self.metadata = {
            "version": MODEL_VERSION, "dataset_size": size, "train_size": train_end,
            "calibration_size": calibration_end - train_end, "test_size": size - calibration_end,
            "fraud_rate": float(self.test_y.mean()),
            "pr_auc": float(average_precision_score(self.test_y, self.probabilities)),
            "brier": float(brier_score_loss(self.test_y, self.probabilities)),
            "source": "synthetic", "model": "Logistic regression + Platt calibration",
        }

    def predict(self, x):
        return self.calibrator.predict_proba(self.model.decision_function(x).reshape(-1, 1))[:, 1]

    def score(self, transaction: Transaction, policy: Policy):
        x = features([transaction.amount], [transaction.average_amount],
                     [int(transaction.country != transaction.home_country)],
                     [int(transaction.new_device)], [transaction.frequency],
                     [int(transaction.merchant == "transfer")])
        probability = float(self.predict(x)[0])
        costs = action_costs([probability], [transaction.amount], policy)[0]
        contributions = (x[0] - self.reference) * self.weights
        ranking = np.argsort(-np.abs(contributions))
        return {
            "risk": probability, "action": str(ACTIONS[int(costs.argmin())]),
            "costs": {str(action): round(float(cost), 2) for action, cost in zip(ACTIONS, costs)},
            "explanations": [{"feature": FEATURE_NAMES[i], "contribution": round(float(contributions[i]), 4)}
                             for i in ranking],
            "baseline_log_odds": float(self.intercept + self.reference @ self.weights),
            "model_version": MODEL_VERSION,
        }

    def strategies(self, policy):
        x = self.x[self.test_start:]
        # Простой baseline намеренно фиксирован и описан в README; он не лидер рынка.
        rules = np.where(((x[:, 1] == 1) & (x[:, 2] == 1)) | (x[:, 0] > np.log1p(5)), "block",
                         np.where((x[:, 1] == 1) | (x[:, 2] == 1), "challenge", "approve"))
        fixed = np.where(self.probabilities >= .55, "block", np.where(self.probabilities >= .12, "challenge", "approve"))
        equa = ACTIONS[action_costs(self.probabilities, self.test_amounts, policy).argmin(axis=1)]
        return {"rules": rules, "fixed": fixed, "equa": equa}

    def report(self, policy):
        strategies = self.strategies(policy)
        metrics = {key: evaluate(actions, self.test_y, self.test_amounts, policy)
                   for key, actions in strategies.items()}
        stress = []
        # Фиксируем решения исходной политики: стресс-тест не переобучает её задним числом.
        for effectiveness in [.95, .75, .5]:
            scenario = policy.model_copy(update={"effectiveness": effectiveness})
            stress.append({"effectiveness": effectiveness, "costs": {
                key: evaluate(actions, self.test_y, self.test_amounts, scenario)["total_cost"]
                for key, actions in strategies.items()}})
        return {"metadata": self.metadata, "policy": policy.model_dump(), "strategies": metrics, "stress": stress}

    def transactions(self, page, action, query, policy):
        actions = self.strategies(policy)["equa"]
        # Поиск и пагинация на сервере: браузер не получает все 100 000 записей.
        matches = [i for i, row in enumerate(self.rows[self.test_start:])
                   if (action == "all" or actions[i] == action)
                   and (not query or query.lower() in (row["id"] + row["customer"]).lower())]
        result = []
        for i in matches[(page - 1) * 12:page * 12]:
            result.append({**self.rows[self.test_start + i], "risk": float(self.probabilities[i]),
                           "action": str(actions[i]), "is_fraud": bool(self.test_y[i])})
        return {"items": result, "total": len(matches), "page": page, "page_size": 12}
