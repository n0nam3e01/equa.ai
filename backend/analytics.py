"""Описательная модель v1. Пороги демонстрационные, не клинические.

Нет вероятности травмы и универсального безопасного ACWR. Все факторы возвращаются
в API. Недостаток истории и устаревшие отчёты видны пользователю отдельно от индекса.
"""
from datetime import date, timedelta
from statistics import median


def assess(checkins, sessions):
    today = date.today()
    dated = sorted(checkins, key=lambda x: x['date'])
    latest = dated[-1] if dated else None
    history = dated[-29:-1]
    recent = [s for s in sessions if 0 <= (today - date.fromisoformat(s['date'])).days < 7]
    previous = [s for s in sessions if 7 <= (today - date.fromisoformat(s['date'])).days < 14]
    load = sum(s['minutes'] * s['rpe'] for s in recent)
    prev_load = sum(s['minutes'] * s['rpe'] for s in previous)
    base = {'version': 'descriptive-v1', 'load': load, 'previous_load': prev_load,
            'reported_days': len({c['date'] for c in dated if 0 <= (today-date.fromisoformat(c['date'])).days < 7}),
            'history_days': len(history), 'synthetic': True}
    if not latest:
        return {**base, 'score': None, 'level': 'unknown', 'label': 'Нужен чек-ин',
                'factors': ['Добавь первый отчёт о состоянии.'], 'quality': 'Нет данных',
                'plan': plan('unknown'), 'insights': [], 'summary': 'Заполни опрос, чтобы увидеть разбор.'}
    # Относительный учебный индекс: диапазон 0–100, а не вероятность или допуск к игре.
    score = round(max(0, min(100, 100 - (5-latest['energy'])*7 - (latest['fatigue']-1)*6
                          - (latest['stress']-1)*5 - latest['discomfort']*3)))
    factors = []
    if latest['fatigue'] >= 4: factors.append('Выраженная усталость в последнем отчёте.')
    if latest['stress'] >= 4: factors.append('Высокая субъективная оценка стресса.')
    if latest['discomfort'] > 0: factors.append(f"Указан дискомфорт {latest['discomfort']}/10.")
    if latest['limitation']: factors.append('Игрок отметил, что дискомфорт мешает движению.')
    if len(history) >= 5:
        if latest['sleep'] < median(c['sleep'] for c in history) - 1:
            factors.append('Сон короче личной медианы более чем на час.')
        for field, title, delta in [('resting_hr', 'Пульс покоя выше личной медианы.', 10), ('hrv', 'HRV ниже личной медианы.', -15)]:
            values = [c[field] for c in history if c.get(field) is not None]
            current = latest.get(field)
            if current is not None and len(values) >= 5:
                diff = current - median(values)
                if (delta > 0 and diff > delta) or (delta < 0 and diff < delta): factors.append(title)
    if prev_load and load > prev_load * 1.4:
        factors.append('За последние 7 дней записано заметно больше нагрузки, чем за предыдущие 7.')
    level = 'attention' if latest['limitation'] or latest['discomfort'] >= 5 else ('caution' if score < 65 or len(factors) >= 2 else 'steady')
    age = (today-date.fromisoformat(latest['date'])).days
    if age > 1:
        level = 'unknown'
        factors.insert(0, 'Отчёт устарел: обнови состояние перед новым занятием.')
    quality = 'Личная история накоплена' if len(history) >= 7 else 'Мало истории: личная норма ещё не определена'
    insights = build_insights(latest, history, load, prev_load, age)
    return {**base, 'score': score if age <= 1 else None, 'level': level,
            'label': {'steady': 'Обычный ритм', 'caution': 'Стоит пересмотреть план', 'attention': 'Нужно внимание', 'unknown': 'Обнови чек-ин'}[level],
            'quality': quality, 'factors': factors or ['В последнем отчёте нет выраженных сигналов по правилам прототипа. Это не подтверждение безопасности нагрузки.'],
            'plan': plan(level), 'insights': insights,
            'summary': insights[0]['action'] if insights else 'Показатели близки к твоему обычному уровню. Продолжай отмечать изменения.'}


def build_insights(latest, history, load, prev_load, age):
    """Прозрачные подсказки по каждому сигналу; это не диагноз и не допуск к игре."""
    items = []
    def add(area, value, observation, action, priority):
        items.append({'area': area, 'value': value, 'observation': observation,
                      'action': action, 'priority': priority})
    if age > 1:
        add('Актуальность', f'{age} дн.', 'Последний опрос уже не отражает сегодняшний день.',
            'Обнови ответы перед тем, как делать выводы по динамике.', 0)
    if latest['limitation'] or latest['discomfort'] >= 5:
        add('Дискомфорт', f"{latest['discomfort']}/10", 'Дискомфорт заметный или мешает движению.',
            'Не ориентируйся на автоматический план нагрузки. Обсуди симптом с квалифицированным специалистом.', 0)
    elif latest['discomfort'] > 0:
        add('Дискомфорт', f"{latest['discomfort']}/10", 'Ты отметил дискомфорт.',
            'Заметь, когда он появляется и меняется ли при движении; при сохранении или усилении обратись к специалисту.', 1)
    sleep_base = median(c['sleep'] for c in history) if len(history) >= 5 else None
    if sleep_base is not None and latest['sleep'] < sleep_base - 1:
        add('Сон', f"{latest['sleep']:g} ч", f'Это более чем на час меньше твоей личной медианы ({sleep_base:g} ч).',
            'Отметь, повторится ли короткий сон, и обсуди объём ближайшего занятия с тренером.', 1)
    elif latest['sleep'] < 7:
        add('Сон', f"{latest['sleep']:g} ч", 'Сегодня ты сообщил о коротком сне.',
            'Понаблюдай за сном несколько дней и учитывай самочувствие при планировании занятия.', 2)
    if latest['fatigue'] >= 4:
        add('Усталость', f"{latest['fatigue']}/5", 'Ты оценил усталость как высокую.',
            'Проверь, как меняется состояние после отдыха; при планировании занятия обсуди нагрузку с тренером.', 1)
    if latest['stress'] >= 4:
        add('Стресс', f"{latest['stress']}/5", 'Ты отметил высокий уровень стресса.',
            'Перед игрой выбери один простой ориентир внимания и оцени состояние после занятия.', 2)
    if latest['energy'] <= 2:
        add('Энергия', f"{latest['energy']}/5", 'Энергии сегодня меньше обычного желаемого уровня.',
            'Сравни это с последними днями и не принимай решение о нагрузке только по одному числу.', 2)
    if prev_load and load > prev_load * 1.4:
        add('Нагрузка', str(load), 'Записанная нагрузка за неделю выросла более чем на 40% к прошлой неделе.',
            'Проверь записи занятий и обсуди изменение объёма с тренером.', 1)
    if len(history) >= 5:
        for field, title, delta, direction, suffix in [
            ('resting_hr', 'Пульс покоя', 10, 1, 'уд/мин'), ('hrv', 'HRV', 15, -1, 'мс')]:
            values = [c[field] for c in history if c.get(field) is not None]
            current = latest.get(field)
            if current is not None and len(values) >= 5:
                baseline = median(values)
                changed = current - baseline
                if (direction == 1 and changed > delta) or (direction == -1 and changed < -delta):
                    add(title, f'{current:g} {suffix}', f'Отличается от твоей личной медианы ({baseline:g} {suffix}).',
                        'Проверь измерение и смотри на повторяющуюся тенденцию, а не на одно значение.', 2)
    if not items:
        add('Общий обзор', 'Без сигнала', 'По демонстрационным правилам выраженных изменений нет.',
            'Продолжай короткие опросы: личная динамика становится понятнее со временем.', 3)
    return sorted(items, key=lambda item: item['priority'])


def plan(level):
    # Каталог предложений, не автоматически выданное медицинское назначение.
    if level == 'attention':
        return {'title': 'Сначала обсуди самочувствие', 'duration': '3 мин обучения', 'lesson': 'reset',
                'description': 'Не подбираем физическую нагрузку при мешающем движению дискомфорте. Обсуди его с квалифицированным специалистом.',
                'steps': ['Зафиксируй, что именно мешает.', 'Открой урок без физической практики.', 'Передай отчёт тренеру при необходимости.']}
    if level == 'caution':
        return {'title': 'Сфокусируйся на качестве', 'duration': '3 мин обучения', 'lesson': 'focus',
                'description': 'Есть повод пересмотреть запланированный объём с тренером. Пока можно разобрать один навык концентрации.',
                'steps': ['Пройди короткий урок.', 'Выбери один ориентир внимания.', 'Согласуй изменение физической части занятия.']}
    if level == 'unknown':
        return {'title': 'Начни с короткого чек-ина', 'duration': '30 секунд', 'lesson': 'focus',
                'description': 'Для подбора предложения на сегодня нужны свежие данные.',
                'steps': ['Отметь самочувствие.', 'Добавь последние занятия.', 'Вернись к предложению.']}
    return {'title': 'Один розыгрыш — один фокус', 'duration': '3 мин обучения', 'lesson': 'focus',
            'description': 'На следующем согласованном занятии попробуй один знакомый ориентир внимания. Физическую нагрузку выбирайте отдельно.',
            'steps': ['Посмотри мини-урок о концентрации.', 'Выбери фразу-ориентир перед розыгрышем.', 'После занятия оцени, удалось ли к ней возвращаться.']}


def demo_records(scenario='steady'):
    # Только вымышленные истории; генерация не выдаётся за результат реального пилота.
    checks, sessions = [], []
    for i in range(14, -1, -1):
        day = (date.today()-timedelta(days=i)).isoformat()
        checks.append({'date': day, 'sleep': [7.5, 8, 7, 8.5][i % 4], 'energy': 4,
                       'stress': 2, 'fatigue': 2, 'discomfort': 0, 'limitation': False,
                       'resting_hr': 62+i % 3, 'hrv': 55+i % 5})
        if i % 2 == 0:
            sessions.append({'date': day, 'minutes': 60, 'rpe': 5, 'kind': 'court', 'focus': 3, 'note': 'Демонстрационная тренировка'})
    if scenario != 'steady':
        checks[-1].update(sleep=5.5, energy=2, stress=4, fatigue=4)
    if scenario == 'attention':
        checks[-1].update(discomfort=6, limitation=True)
    return checks, sessions
