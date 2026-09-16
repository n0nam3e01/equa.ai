/* Браузер отвечает только за интерфейс. ML, выбор действия и SQL выполняет Python. */
import {enhanceMetrics, clearMetrics, enhanceInsight, clearInsight} from './dist/enhancements.js';
const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 0}).format(value) + ' ₸';
const number = (value) => new Intl.NumberFormat('ru-RU', {maximumFractionDigits: 0}).format(value);
const percent = (value) => new Intl.NumberFormat('ru-RU', {style: 'percent', maximumFractionDigits: 1}).format(value);
const names = {approve: 'Разрешить', challenge: 'Проверить', block: 'Блокировать'};
const strategies = {rules: 'Правила', fixed: 'Фиксированный порог', equa: 'equa'};
const defaults = {block_cost: 2500, challenge_cost: 25, abandonment: .05, effectiveness: .9};
let policy = {...defaults};
let page = 1;
let transactionRows = [];
let transactionRequest = 0;
let activeDecision = null;
let ready = false;
let keyboardInteraction = false;
document.addEventListener('keydown', () => {keyboardInteraction = true;});
document.addEventListener('pointerdown', () => {keyboardInteraction = false;});

// Компактные суммы не ломают сетку на ноутбуке; точное число остаётся в title.
const compactMoney = (value) => value >= 1_000_000
  ? new Intl.NumberFormat('ru-RU', {maximumFractionDigits:2}).format(value / 1_000_000) + ' млн ₸'
  : money(value);

// Экранируем строки из API перед вставкой в HTML, в том числе содержимое SQL-истории.
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const badge = (action) => `<span class="status ${Object.hasOwn(names, action) ? action : ''}">${escapeHtml(names[action] || action)}</span>`;

async function api(path, body) {
  const response = await fetch('/api' + path, body === undefined ? {} : {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(typeof problem.detail === 'string' ? problem.detail : 'Проверьте поля формы. Сервер отклонил запрос.');
  }
  return response.json();
}

function showError(error) {
  $('#error').textContent = error.message || 'Не удалось связаться с Python-сервером.';
  $('#error').hidden = false;
  $('#error').scrollIntoView({block:'nearest',behavior:'instant'});
}

// Общая обёртка показывает сетевые ошибки вместо молча неработающих кнопок.
async function safely(work) {
  $('#error').hidden = true;
  try { await work(); } catch (error) { showError(error); }
}

async function navigate(view) {
  if (!ready) return;
  if (!['overview','transactions','simulator','policy','history'].includes(view)) view = 'overview';
  document.querySelectorAll('.view').forEach((section) => section.hidden = section.id !== view);
  document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $('#breadcrumb').textContent = $(`[data-view="${view}"]`).textContent.replace(/0\d|[◫↔⊕≋↺]/g, '').trim();
  if (location.hash !== '#' + view) history.pushState(null, '', '#' + view);
  document.querySelectorAll('.nav-button').forEach((link) => {
    if (link.dataset.view === view) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  if (view === 'transactions') await loadTransactions();
  if (view === 'history') await loadHistory();
}
document.querySelectorAll('[data-view], [data-goto]').forEach((button) => {
  button.addEventListener('click', (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    safely(() => navigate(button.dataset.view || button.dataset.goto));
  });
});
window.addEventListener('popstate', () => {
  // Якорь skip-link не переключает экран — он только переводит фокус в main.
  if (location.hash !== '#main-content') safely(() => navigate(location.hash.slice(1) || 'overview'));
});

function renderReport(report) {
  const {metadata: meta, strategies: results} = report;
  const equa = results.equa;
  $('#test-count').textContent = number(meta.test_size) + ' операций';
  $('#model-label').textContent = 'Logistic regression · калиброванная вероятность';
  clearMetrics();
  $('#stats').innerHTML = [
    ['Предотвращённый фрод*', compactMoney(equa.saved), 'Оценка при текущей политике', '↗'],
    ['Общая стоимость*', compactMoney(equa.total_cost), 'Фрод + проверки + неудобство', '≋'],
    ['Ложные блокировки', percent(equa.fpr), number(equa.false_blocks) + ' честных операций', '⊘'],
    ['Доп. проверки', number(equa.challenges), percent(equa.challenges / meta.test_size) + ' тестовой выборки', '⊕'],
  ].map(([label, value, detail, icon]) => `<article class="stat"><div class="stat-label">${label}<span>${icon}</span></div><div class="stat-value">${value}</div><div class="stat-detail">${detail}</div></article>`).join('');
  enhanceMetrics(document.querySelectorAll('.stat-value'), [equa.saved, equa.total_cost, equa.fpr, equa.challenges], keyboardInteraction);
  const maximum = Math.max(...Object.values(results).map((value) => value.total_cost), 1);
  $('#cost-chart').innerHTML = Object.entries(results).map(([key, value]) => `<div class="cost-row"><div class="cost-row-label"><span>${strategies[key]}</span><strong>${money(value.total_cost)}</strong></div><div class="bar-track" role="img" aria-label="${strategies[key]}: фрод ${money(value.fraud_loss)}, неудобство ${money(value.inconvenience)}"><div class="bar-loss" style="width:${value.fraud_loss / maximum * 100}%"></div><div class="bar-friction" style="width:${value.inconvenience / maximum * 100}%"></div></div></div>`).join('');
  const shares = [equa.approvals, equa.challenges, equa.blocks].map(value => value / meta.test_size * 100);
  let offset = 0;
  const arcs = shares.map((share,index) => {
    const arc = `<circle cx="60" cy="60" r="48" fill="none" stroke="${['#a78bfa','#787188','#d4a35e'][index]}" stroke-width="17" pathLength="100" stroke-dasharray="${share} ${100-share}" stroke-dashoffset="${-offset}"/>`;
    offset += share; return arc;
  }).join('');
  $('#action-mix').innerHTML = `<div class="donut-wrap"><svg class="donut" viewBox="0 0 120 120" aria-hidden="true">${arcs}</svg><div class="donut-center"><strong>${percent(equa.approvals/meta.test_size)}</strong><span>разрешено</span></div></div>` + [['approve',equa.approvals],['challenge',equa.challenges],['block',equa.blocks]].map(([key,value]) => `<div class="mix-row"><span>${names[key]}</span><strong>${number(value)} · ${percent(value/meta.test_size)}</strong></div>`).join('');
  $('#model-stats').innerHTML = [
    [number(meta.dataset_size), 'Синтетических транзакций'],
    ['60 / 20 / 20', 'Обучение / калибровка / тест, %'],
    [meta.pr_auc.toFixed(3), 'PR-AUC (average precision)'],
    [percent(meta.fraud_rate), 'Доля фрода на тесте'],
  ].map(([value,label]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('');
  $('#policy-comparison').innerHTML = Object.entries(results).map(([key,value]) => `<tr><td>${strategies[key]}</td><td>${money(value.total_cost)}</td><td>${number(value.false_blocks)}</td><td>${number(value.challenges)}</td></tr>`).join('');
  $('#stress-chart').innerHTML = report.stress.map((scenario) => `<div class="stress-row"><span>Проверка останавливает ${percent(scenario.effectiveness)} фрода</span><div class="stress-values">${Object.entries(scenario.costs).map(([key,value]) => `<div>${key === 'rules' ? 'Правила' : key === 'fixed' ? 'Порог' : 'equa'}<strong>${money(value)}</strong></div>`).join('')}</div></div>`).join('');
  const wins = report.stress.filter((scenario) => scenario.costs.equa <= Math.min(scenario.costs.rules, scenario.costs.fixed)).length;
  $('#stress-verdict').textContent = `equa даёт минимальные потери в ${wins} из ${report.stress.length} сценариев. Это сравнение трёх конкретных стратегий, а не гарантия для реальных платежей.`;
}

async function loadTransactions() {
  // Номер запроса не позволяет медленному старому поиску перезаписать новый результат.
  const current = ++transactionRequest;
  const params = new URLSearchParams({page, action: $('#action-filter').value, query: $('#search').value});
  const result = await api('/transactions?' + params, policy);
  if (current !== transactionRequest) return;
  transactionRows = result.items;
  $('#transaction-body').innerHTML = result.items.map((row, index) => `<tr><td>${escapeHtml(row.id)}<small>${escapeHtml(row.customer)}</small></td><td>${money(row.amount)}</td><td>${escapeHtml(row.country)}</td><td>${percent(row.risk)}</td><td>${badge(row.action)}</td><td>${row.is_fraud ? 'Фрод' : 'Честная'}</td><td><button class="row-open" data-open="${index}" aria-label="Открыть ${escapeHtml(row.id)}">↗</button></td></tr>`).join('') || '<tr><td colspan="7">Операции не найдены. Попробуйте другой фильтр.</td></tr>';
  $('#page-description').textContent = `Страница ${page} из ${Math.max(1, Math.ceil(result.total / result.page_size))} · ${number(result.total)} операций`;
  $('#prev-page').disabled = page === 1;
  $('#next-page').disabled = page * result.page_size >= result.total;
  document.querySelectorAll('[data-open]').forEach((button) => button.onclick = () => safely(async () => {
    fillTransaction(transactionRows[Number(button.dataset.open)]);
    await navigate('simulator');
  }));
}

async function loadRecent() {
  const recent = await api('/transactions?page=1', policy);
  $('#recent-body').innerHTML = recent.items.slice(0,4).map(row => `<tr><td>${escapeHtml(row.id)}</td><td>${money(row.amount)}</td><td>${escapeHtml(row.country)}</td><td>${percent(row.risk)}</td><td>${badge(row.action)}</td></tr>`).join('');
}
let searchTimer;
$('#search').addEventListener('input', () => {clearTimeout(searchTimer); searchTimer = setTimeout(() => safely(async () => {page=1; await loadTransactions();}), 250);});
$('#action-filter').onchange = () => safely(async () => {page=1; await loadTransactions();});
$('#prev-page').onclick = () => safely(async () => {page--; await loadTransactions();});
$('#next-page').onclick = () => safely(async () => {page++; await loadTransactions();});

const presets = {
  normal: {amount:25000, average_amount:18000, country:'KZ', home_country:'KZ', frequency:1, new_device:false, merchant:'retail'},
  travel: {amount:180000, average_amount:35000, country:'TR', home_country:'KZ', frequency:1, new_device:false, merchant:'travel'},
  fraud: {amount:850000, average_amount:15000, country:'BR', home_country:'KZ', frequency:12, new_device:true, merchant:'transfer'},
};
function clearResult() {
  clearInsight();
  activeDecision = null;
  $('#score-result').innerHTML = '<div class="empty-state"><span class="empty-symbol">=</span><h2>Готово к проверке.</h2><p>Нажмите «Рассчитать решение», чтобы получить актуальный результат.</p></div>';
}
function fillTransaction(transaction) {
  for (const field of Object.keys(presets.normal)) {
    const element = $('#score-form').elements[field];
    if (element.type === 'checkbox') element.checked = transaction[field];
    else element.value = transaction[field];
  }
  document.querySelectorAll('.preset').forEach((button) => button.classList.remove('active'));
  clearResult();
}
document.querySelectorAll('[data-preset]').forEach((button) => button.onclick = () => {
  fillTransaction(presets[button.dataset.preset]); button.classList.add('active');
});
$('#score-form').addEventListener('input', () => {
  clearResult(); document.querySelectorAll('.preset').forEach((button) => button.classList.remove('active'));
});

function renderScore(result) {
  clearInsight();
  activeDecision = result.id;
  $('#score-result').innerHTML = `<div class="risk-top"><div class="risk-number">${percent(result.risk)}<small>Вероятность фрода · синтетическая модель</small></div>${badge(result.action)}</div><p class="result-summary">При текущих допущениях действие «${names[result.action]}» имеет наименьшие ожидаемые потери. Это решение модели, а не подтверждение факта мошенничества.</p><p class="eyebrow" style="margin-top:24px">ВКЛАД ПРИЗНАКОВ В РИСК</p>${result.explanations.slice(0, 3).map((item) => `<div class="explanation"><span>${escapeHtml(item.feature)}</span><span class="contribution ${item.contribution < 0 ? 'negative' : ''}">${item.contribution > 0 ? '+' : ''}${item.contribution.toFixed(2)}</span></div>`).join('')}<p class="footnote">Вклады в log-odds относительно среднего профиля обучения. «+» повышает оценку риска; это не проценты и не доказательство причины мошенничества.</p><div class="cost-options">${Object.entries(result.costs).map(([key,value]) => `<div class="cost-option ${key === result.action ? 'selected' : ''}">${names[key]}<strong>${money(value)}</strong></div>`).join('')}</div><p class="footnote">Ожидаемая стоимость каждого действия · сохранено в SQL.</p>${result.action === 'challenge' ? '<div class="challenge-box" id="challenge-box"><strong>Имитация дополнительной проверки</strong><br>Настоящий банк или 2FA не подключены. Выберите тестовый исход.<div class="challenge-buttons"><button class="secondary" data-outcome="passed">Пройдена</button><button class="secondary" data-outcome="failed">Не пройдена</button></div></div>' : ''}`;
  document.querySelectorAll('[data-outcome]').forEach((button) => button.onclick = () => safely(async () => {
    const buttons = [...document.querySelectorAll('[data-outcome]')];
    buttons.forEach((item) => item.disabled = true);
    try {
      await api(`/decisions/${activeDecision}/challenge`, {outcome:button.dataset.outcome});
      $('#challenge-box').textContent = button.dataset.outcome === 'passed' ? 'Демо: проверка пройдена. Платёж разрешён в симуляции. Результат сохранён.' : 'Демо: проверка не пройдена. Платёж отклонён в симуляции. Результат сохранён.';
    } finally {buttons.forEach((item) => item.disabled = false);}
  }));
  // Полоса риска и величина вкладов — реальные числа ответа, а не декоративные значения.
  $('.risk-top').insertAdjacentHTML('afterend', `<div class="risk-scale"><span style="width:${result.risk*100}%"></span></div><div class="risk-axis"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>`);
  const contributions = result.explanations.slice(0,3);
  const maximum = Math.max(...contributions.map(item => Math.abs(item.contribution)),.01);
  document.querySelectorAll('.explanation').forEach((element,index) => {
    const item = contributions[index];
    element.children[0].insertAdjacentHTML('afterend', `<div class="contribution-track ${item.contribution<0?'negative':''}" aria-hidden="true"><div style="width:${Math.abs(item.contribution)/maximum*100}%"></div></div>`);
  });
  const insight = document.createElement('div');
  insight.className = 'result-insight';
  $('.result-summary').after(insight);
  enhanceInsight(insight, result.transaction, keyboardInteraction);
}
$('#score-form').onsubmit = (event) => {
  event.preventDefault();
  safely(async () => {
    const form = event.currentTarget;
    const transaction = Object.fromEntries(new FormData(form));
    for (const field of ['amount','average_amount','frequency']) transaction[field] = Number(transaction[field]);
    transaction.new_device = form.elements.new_device.checked;
    const button = $('#score-button');
    button.disabled = true; button.textContent = 'Рассчитываем и сохраняем…';
    // Не даём поменять поля, пока рассчитывается именно этот снимок параметров.
    const controls = [...form.querySelectorAll('input, select'), ...document.querySelectorAll('.preset')];
    controls.forEach((control) => control.disabled = true);
    try {renderScore(await api('/score', {transaction, policy}));}
    finally {button.disabled = false; button.textContent = 'Рассчитать решение →'; controls.forEach((control) => control.disabled = false);}
  });
};

function policyDraft() {return Object.fromEntries(Object.keys(defaults).map((key) => [key, Number($('#policy-form').elements[key].value)]));}
function updatePolicyLabels() {
  const draft = policyDraft();
  $('#block-output').textContent = money(draft.block_cost);
  $('#challenge-output').textContent = money(draft.challenge_cost);
  $('#abandonment-output').textContent = percent(draft.abandonment);
  $('#effectiveness-output').textContent = percent(draft.effectiveness);
  $('#policy-state').textContent = JSON.stringify(draft) === JSON.stringify(policy) ? 'Применено' : 'Есть изменения';
}
$('#policy-form').addEventListener('input', updatePolicyLabels);
async function applyPolicy(next) {
  const button = $('#policy-button'); button.disabled = true; button.textContent = 'Пересчитываем…';
  try {
    const report = await api('/report', next);
    policy = next; page = 1; renderReport(report); updatePolicyLabels(); clearResult();
    await loadRecent();
  } finally {button.disabled = false; button.textContent = 'Пересчитать стратегии →';}
}
$('#policy-form').onsubmit = (event) => {event.preventDefault(); safely(() => applyPolicy(policyDraft()));};
$('#reset-policy').onclick = () => safely(async () => {
  for (const [key,value] of Object.entries(defaults)) $('#policy-form').elements[key].value = value;
  updatePolicyLabels(); await applyPolicy({...defaults});
});

async function loadHistory() {
  const result = await api('/history');
  $('#history-content').innerHTML = result.items.length ? `<div class="table-scroll"><table><thead><tr><th>Время</th><th>Сумма</th><th>Риск</th><th>Исходное решение</th><th>Демо-проверка</th></tr></thead><tbody>${result.items.map((row) => `<tr><td>${escapeHtml(new Date(row.created_at).toLocaleString('ru-RU'))}<small>${escapeHtml(row.id.slice(0,8))}</small></td><td>${money(row.transaction_data.amount)}</td><td>${percent(row.result_data.risk)}</td><td>${badge(row.action)}</td><td>${row.challenge_outcome === 'passed' ? 'Пройдена → разрешён' : row.challenge_outcome === 'failed' ? 'Не пройдена → отклонён' : row.action === 'challenge' ? 'Не завершена' : 'Не требуется'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><span class="empty-symbol">↺</span><h2>История пока пуста.</h2><p>Проверьте первый платёж в симуляторе — решение появится здесь.</p><button class="primary" id="history-start">Проверить платёж →</button></div>';
  if ($('#history-start')) $('#history-start').onclick = () => safely(() => navigate('simulator'));
}
$('#refresh-history').onclick = () => safely(loadHistory);

// Начальная загрузка: ожидаем ответ сервера до активации рабочих экранов.
updatePolicyLabels();
safely(async () => {
  const [health, report] = await Promise.all([api('/health'), api('/report', policy)]);
  $('#environment').textContent = health.database === 'sqlite' ? 'LOCALHOST · SQLite' : 'LOCALHOST · Supabase';
  renderReport(report); ready = true;
  await loadRecent();
  await navigate(location.hash.slice(1) || 'overview');
});
