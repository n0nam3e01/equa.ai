// Небольшой клиент без сборщика: все расчёты и запись выполняются Python API.
const $ = (s, root = document) => root.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
  home:'M3 10 12 3l9 7v11h-6v-7H9v7H3Z', path:'M4 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm16-14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6 17l5-9 5 5 3-8',
  play:'m8 4 12 8-12 8Z', chart:'M4 20V11h3v9Zm7 0V4h3v16Zm7 0v-7h3v7Z',
  chat:'M21 11a9 9 0 0 1-9 9H4l-2 2v-11a9 9 0 0 1 19 0Z',
  sun:'M12 3V1m0 22v-2M3 12H1m22 0h-2M5 5 3 3m18 18-2-2M5 19l-2 2M21 3l-2 2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
  neutral:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM8 9h.01M16 9h.01M8 15h8',
  moon:'M20 16A9 9 0 0 1 8 4a9 9 0 1 0 12 12Z', target:'M20 10a8 8 0 1 1-6-6M16 10a4 4 0 1 1-6-2m2 4L22 2m-5 0h5v5',
  mind:'M8 21v-4H5v-5H2l3-6a8 8 0 1 1 13 8v7', ball:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM5 6c8-2 6 14 14 12',
  team:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-3a7 7 0 0 1 14 0v3m2-17a4 4 0 0 1 0 8m2 3a6 6 0 0 1 2 5',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 1v4m0 14v4M1 12h4m14 0h4M4 4l3 3m10 10 3 3M4 20l3-3M17 7l3-3'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.ball}"/></svg>`;
const nav = [['today','Обзор','home'],['checkin','Опрос','path'],['progress','Динамика','chart'],['coach','Тренер','team']];
let mode = 'personal', authView = 'login', refreshTask = null;
let page = 'today', current = null, health = {}, selected = sessionStorage.getItem('rg_player') || 'alex';
let routeVersion = 0, toastTimer;
const fmtDate = value => new Date(value+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

async function api(path, data, method, retried = false) {
  // Личный режим обращается только к /me: идентификатор владельца задаёт сервер.
  if(mode === 'personal') {
    path = path.replace(/^\/(state|checkins|trainings)\/[^/]+$/, '/me/$1');
    if(path === '/export') path = '/me/export';
  }
  const response = await fetch('/api'+path,{method:method || (data === undefined ? 'GET':'POST'),
    headers:data === undefined ? {} : {'Content-Type':'application/json'},body:data === undefined ? undefined : JSON.stringify(data)});
  if(response.status === 401 && path.startsWith('/me/') && !retried) {
    // Одна ротация refresh token для одновременно открытых запросов в этой вкладке.
    refreshTask ||= api('/auth/refresh', {}).finally(()=>{refreshTask=null;});
    await refreshTask;
    return api(path, data, method, true);
  }
  const result = await response.json();
  if (!response.ok) {
    const details = typeof result.detail === 'string' ? result.detail : 'Проверь поля формы: значения не прошли проверку.';
    const error = new Error(details); error.status = response.status; throw error;
  }
  return result;
}

function toast(text) {
  clearTimeout(toastTimer); $('#toast').textContent=text; $('#toast').hidden=false;
  toastTimer=setTimeout(()=>$('#toast').hidden=true,4000);
}
async function safely(action) {
  $('#error').hidden=true;
  try { await action(); } catch(e) { $('#error').textContent=e.message; $('#error').hidden=false; $('#error').scrollIntoView({block:'nearest'}); }
}
function status(a){return `<span class="status ${esc(a.level)}">${esc(a.label)}</span>`;}
function header(title,subtitle,action=''){return `<div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${action}</div>`;}
function navRender(){
  $('#desktop-nav').innerHTML=nav.filter(n=>mode==='demo'||n[0]!=='coach').map(([id,name,i])=>`<a class="nav-link ${page===id?'active':''}" href="#${id}" ${page===id?'aria-current="page"':''}>${icon(i)}${name}</a>`).join('');
  $('#mobile-nav').innerHTML=[...nav.slice(0,3),['settings','Профиль','settings']].map(([id,name,i])=>`<a class="nav-link ${page===id?'active':''}" href="#${id}" ${page===id?'aria-current="page"':''}>${icon(i)}${name}</a>`).join('');
  $('#breadcrumb').textContent=nav.find(n=>n[0]===page)?.[1] || 'RallyGuard';
}

function weeklyChart(checks) {
  const values=checks.slice(-7);
  if(!values.length)return '<p class="empty">График появится после первого чек-ина.</p>';
  const pts=values.map((x,i)=>[20+i*(220/Math.max(1,values.length-1)),150-(x.energy-1)*30]);
  return `<svg class="chart" viewBox="0 0 260 175" role="img" aria-label="Энергия за последние ${values.length} отчётов: ${values.map(x=>x.energy).join(', ')} из 5">${[30,60,90,120,150].map(y=>`<path d="M20 ${y}H245" stroke="#e8ece3" stroke-width="1"/>`).join('')}<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#285e48" stroke-width="2"/>${pts.map(([x,y],i)=>`${i===pts.length-1?`<circle cx="${x}" cy="${y}" r="10" fill="#e1ed89"/>`:''}<circle cx="${x}" cy="${y}" r="3.5" fill="#173f35"/>`).join('')}</svg><div class="chart-labels">${values.map(x=>`<span>${fmtDate(x.date)}</span>`).join('')}</div><div class="legend"><i></i> Энергия · самооценка от 1 до 5</div>`;
}

// Главный сценарий MVP: сначала ответы игрока, затем понятный разбор каждого сигнала.
function insightCards(items) {
  return items.map(item=>`<article class="insight-card"><div class="insight-top"><span>${esc(item.area)}</span><strong>${esc(item.value)}</strong></div><p>${esc(item.observation)}</p><div class="insight-action"><span>Что сделать</span><p>${esc(item.action)}</p></div></article>`).join('');
}
function overview(){
  const a=current.assessment, last=current.checkins.at(-1);
  return header(`Привет, ${current.player.name}`, 'Твой обзор за сегодня', `<button class="btn lime" data-page="checkin">${last?.date===today()?'Обновить опрос':'Заполнить опрос'} →</button>`)+`
    <section class="panel overview-hero"><div><span class="eyebrow">РАЗБОР СОСТОЯНИЯ</span><h2>${esc(a.label)}</h2><p>${esc(a.summary)}</p><button class="btn secondary" data-page="checkin">Ответить на вопросы →</button></div><div class="overview-score"><strong>${a.score??'—'}</strong><span>индекс самочувствия<br>из 100</span></div></section>
    <div class="metric-grid">${[
      ['Сон',last?`${last.sleep} ч`:'—'],['Энергия',last?`${last.energy}/5`:'—'],
      ['Усталость',last?`${last.fatigue}/5`:'—'],['Стресс',last?`${last.stress}/5`:'—']
    ].map(([name,value])=>`<div class="metric"><span>${name}</span><strong>${value}</strong></div>`).join('')}</div>
    <div class="section-title"><div><span class="eyebrow">ПО ТВОИМ ОТВЕТАМ</span><h2>На что обратить внимание</h2></div><small>${last?`Опрос от ${fmtDate(last.date)}`:'Нет ответов'}</small></div>
    <div class="insight-grid">${a.insights?.length?insightCards(a.insights):'<section class="panel"><p>После первого опроса здесь появятся наблюдения по каждому показателю.</p></section>'}</div>
    <div class="page-grid overview-bottom"><section class="panel"><div class="panel-head"><h2>Как менялась энергия</h2><button class="text-button" data-page="progress">Вся динамика →</button></div>${weeklyChart(current.checkins)}</section><section class="panel"><h2>Добавь контекст</h2><p>После занятия запиши длительность и ощущение нагрузки. Так разбор сможет учитывать не только самочувствие, но и последние тренировки.</p><button class="btn outline" data-action="training">Добавить занятие →</button><p class="score-explainer">Это описательный анализ по твоим ответам. Он не ставит диагноз и не определяет, можно ли тренироваться.</p></section></div>`;
}

function checkinPage(){
  const last=current.checkins.at(-1)||{};
  return header('Опрос состояния','Отметь, как ты себя чувствуешь сегодня.')+`
    <div class="page-grid"><section class="panel wide"><div class="panel-head"><h2>Твои показатели</h2><small>1–2 минуты</small></div><p>Заполни все основные поля. Можно обновить ответы за сегодняшний день.</p>
    <form id="checkin-form"><div class="form-grid"><label class="field">Сон, часов<input name="sleep" type="number" min="0" max="14" step="0.5" value="${last.sleep??8}" required></label>
    ${selectField('energy','Энергия',scale('мало','много'),last.energy??3)}
    ${selectField('fatigue','Усталость',scale('нет','сильная'),last.fatigue??3)}
    ${selectField('stress','Стресс',scale('спокойно','сильно'),last.stress??3)}
    <label class="field">Дискомфорт, 0–10<input name="discomfort" type="number" min="0" max="10" value="${last.discomfort??0}" required><small>0 — нет, 10 — очень сильный</small></label>
    <label class="field">Дата<input name="date" type="date" value="${today()}" max="${today()}" required></label>
    <label class="check-field full"><input name="limitation" type="checkbox" ${last.limitation?'checked':''}>Дискомфорт мешает двигаться или выполнять удар</label>
    <details class="wide"><summary>Данные часов · необязательно</summary><div class="form-grid"><label class="field">Пульс покоя, уд/мин<input name="resting_hr" type="number" min="30" max="220" placeholder="Не измерял"></label><label class="field">HRV, мс<input name="hrv" type="number" min="1" max="300" placeholder="Не измерял"></label></div></details></div>
    <p class="form-error" role="alert"></p><div class="form-actions"><button class="btn lime" type="submit">Сохранить и увидеть разбор →</button></div></form></section>
    <section class="panel"><h2>Что произойдёт после ответа</h2><ol class="plan-steps"><li>Сравним показатели с твоими предыдущими ответами, если истории достаточно.</li><li>Покажем, какие изменения заметили.</li><li>Предложим следующий шаг отдельно для каждого сигнала.</li></ol><div class="notice">Пороговые значения в прототипе демонстрационные. При боли или ограничении движения обсуди ситуацию со специалистом.</div></section></div>`;
}

function progress(){const a=current.assessment;return header('Моя динамика','Сравнивай себя с собой. Замечай изменения.',`<button class="btn secondary" data-checkin="good">+ Чек-ин</button>`)+`
  <div class="stat-row"><div class="stat"><small>Индекс состояния</small><strong>${a.score??'—'}<small>${a.score===null?'':' / 100'}</small></strong>${status(a)}</div><div class="stat"><small>Нагрузка за 7 дней</small><strong>${a.load}</strong><small>минуты × RPE · усл. ед.</small></div><div class="stat"><small>Полнота недели</small><strong>${a.reported_days}<small> / 7 дней</small></strong><small>Дни с чек-ином</small></div></div>
  <div class="page-grid"><section class="panel"><h2>Энергия по последним отчётам</h2>${weeklyChart(current.checkins)}<div class="notice">${mode==='demo'?'Демонстрационная история, не результаты реального пилота.':'Твоя сохранённая история. График дополняется с каждым опросом.'}</div></section><section class="panel"><h2>Что повлияло на оценку</h2><ul class="factor-list">${a.factors.map(f=>`<li>${esc(f)}</li>`).join('')}</ul><p class="score-explainer">${esc(a.quality)}. Индекс — описательная формула, не вероятность травмы или выгорания.</p><details><summary>Как считается индекс</summary><p class="score-explainer">100 − (5 − энергия) × 7 − (усталость − 1) × 6 − (стресс − 1) × 5 − дискомфорт × 3. Результат ограничен 0–100. При ограничении движения сигнал внимания имеет приоритет. Пороги демонстрационные и требуют проверки специалистом.</p></details></section>
  <section class="panel wide"><h2>История занятий</h2>${current.trainings.length?`<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Занятие</th><th>Минуты</th><th>RPE</th><th>Нагрузка</th><th>Фокус</th></tr></thead><tbody>${[...current.trainings].reverse().slice(0,20).map(s=>`<tr><td>${fmtDate(s.date)}</td><td>${{court:'Корт',match:'Матч',fitness:'ОФП'}[s.kind]}</td><td>${s.minutes}</td><td>${s.rpe}/10</td><td>${s.minutes*s.rpe}</td><td>${s.focus}/5</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">Занятий пока нет.</p>'}<button class="text-button" data-action="training">+ Записать занятие</button></section></div>`;}

async function coach(){
  const data=await api('/team');
  const order={attention:0,caution:1,unknown:2,steady:3};
  return header('Обзор тренера','Кому сегодня стоит уделить внимание?')+`<div class="notice">Демо-роль тренера: только три вымышленных игрока в твоей изолированной сессии. Подключение настоящего тренера и Telegram пока не настроены.</div><section class="panel"><div class="panel-head"><h2>Моя группа</h2><small>3 игрока · демо</small></div>${data.players.sort((a,b)=>order[a.assessment.level]-order[b.assessment.level]).map(s=>`<div class="coach-row"><span class="avatar">${s.player.initials}</span><div class="info"><strong>${s.player.name}</strong><small>${s.player.goal}</small><small>Чек-ин: ${s.checkins.at(-1)?fmtDate(s.checkins.at(-1).date):'нет'} · ${s.assessment.reported_days}/7 дней</small></div>${status(s.assessment)}<button class="btn outline small" data-coach="${s.player.id}">Посмотреть →</button></div>`).join('')}</section>`;
}

function demoSettings(){return header('Профиль и демо','Управление данными и сценариями для проверки MVP.')+`<div class="page-grid"><section class="panel"><div class="settings-block"><h3>Демонстрационный игрок</h3><p>Переключение не даёт доступ к данным других посетителей.</p><label class="field">Игрок<select id="player-select">${[['alex','Алекс'],['mira','Мира'],['timur','Тимур']].map(([id,n])=>`<option value="${id}" ${id===selected?'selected':''}>${n}</option>`).join('')}</select></label></div><div class="settings-block"><h3>Три сценария состояния</h3><p>Заменяют сегодняшний опрос выбранного демо-игрока. Остальная история сохраняется.</p><div class="split-actions"><button class="btn secondary small" data-scenario="steady">Обычный ритм</button><button class="btn secondary small" data-scenario="tired">Усталость</button><button class="btn secondary small" data-scenario="attention">Нужен разговор</button></div></div><div class="settings-block"><h3>Импорт показателей</h3><p>JSON с массивом checkins, максимум 90 записей и 100 КБ. Только вымышленные данные для демо.</p><label class="field">Файл JSON<input id="import-file" type="file" accept=".json,application/json"></label><button class="text-button" data-action="sample">Скачать пример JSON</button></div></section><section class="panel"><h3>Хранение и анализ</h3><p>${health.database==='supabase'?'Supabase · PostgreSQL':'SQLite · '+(health.ephemeral?'временное облачное хранение':'локальное хранение')}</p>${health.ephemeral?'<div class="notice">История может исчезнуть или отличаться между экземплярами Vercel. Для постоянного демо подключите Supabase.</div>':''}<p>Разбор по ответам работает без внешнего AI API: правила и причины видны в обзоре.</p><p class="score-explainer">Это изолированная песочница с вымышленными профилями. Не вводи персональные данные о здоровье.</p><div class="split-actions"><a class="btn outline" href="/api/export" download>Экспортировать данные</a><button class="btn danger" data-action="delete">Удалить мою демо-сессию</button></div><hr style="border:0;border-top:1px solid var(--line);margin:24px 0"><button class="btn secondary" data-page="coach">Открыть обзор тренера →</button><button class="text-button" data-page="progress">Моя динамика →</button></section></div>`;}

function about(){return header('О RallyGuard','Рабочий прототип для Overclock Hackathon · BioTech')+`<div class="page-grid"><section class="panel"><h2>Игрок в центре</h2><p>Короткий опрос превращает субъективные показатели в понятный обзор. Вместо одинакового урока для любой проблемы игрок видит, что изменилось и какой следующий шаг относится именно к его ответам.</p><h3>Что можно проверить</h3><ol class="plan-steps"><li>Заполнить опрос сна, энергии, усталости, стресса и дискомфорта.</li><li>Посмотреть отдельные наблюдения и действия по своим ответам.</li><li>Записать тренировку и увидеть динамику нагрузки.</li><li>Вернуться в аккаунт с другого устройства и продолжить историю.</li></ol><button class="btn lime" data-page="checkin">Перейти к опросу →</button></section><section class="panel"><h2>Границы прототипа</h2><p>В личном аккаунте сохраняются твои ответы. В режиме примера используются вымышленные профили. Пороги индекса — демонстрационные правила; клиническая точность и снижение травматизма не исследованы.</p><p>Приложение не определяет причину боли, не диагностирует выгорание и не выдаёт медицинский допуск к нагрузке. Предложения по физической части требуют обсуждения с тренером или специалистом.</p><p class="score-explainer">Разбор сейчас выполняют прозрачные правила Python. Генеративный AI можно добавить для объяснения уже рассчитанных сигналов после настройки API и проверки безопасности данных.</p></section></div>`;}

// Вход является основным сценарием; демо запускается только отдельной кнопкой.
function onboarding(){
  navRender(); $('#sidebar-name').textContent='Твой аккаунт';
  $('.demo-label').textContent='Личный дневник';
  const signup=authView==='signup';
  $('#main').innerHTML=`<div class="onboarding"><section class="hero"><div class="hero-content"><span class="eyebrow">ТЕННИС В ТВОЁМ ТЕМПЕ</span><h2>Твоя игра.<br>Твоё состояние.</h2><p>Записывай сон, стресс и нагрузку. Замечай изменения и приходи на корт с понятным планом.</p></div></section><section class="panel auth-panel"><span class="eyebrow">ЛИЧНЫЙ ДНЕВНИК</span><h2>${signup?'Создать аккаунт':'С возвращением'}</h2><p>${signup?'Начни с первого опроса. История будет только твоей.':'Войди, чтобы продолжить свою историю.'}</p><form id="auth-form">${signup?'<label class="field">Как тебя зовут<input name="name" autocomplete="given-name" maxlength="60" required></label>':''}<label class="field">Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label class="field">Пароль<input name="password" type="password" autocomplete="${signup?'new-password':'current-password'}" minlength="8" maxlength="128" required><small>Минимум 8 символов</small></label>${signup?'<label class="check-field"><input type="checkbox" required>Согласен сохранять ответы о самочувствии в своём аккаунте Supabase. Могу удалить историю в профиле.</label>':''}<p class="form-error" role="alert"></p><p id="auth-message" role="status"></p><button class="btn lime" type="submit">${signup?'Зарегистрироваться':'Войти'} →</button></form><button class="text-button" data-action="auth-toggle">${signup?'Уже есть аккаунт? Войти':'Нет аккаунта? Зарегистрироваться'}</button><div class="settings-block"><button class="text-button" data-action="start">Посмотреть пример без регистрации →</button></div></section></div>`;
  $('#auth-form').addEventListener('submit', async e=>{
    e.preventDefault(); const form=e.target, button=$('[type=submit]',form), f=new FormData(form);
    button.disabled=true; $('.form-error',form).textContent=''; $('#auth-message').textContent='';
    try {
      const result=await api('/auth/'+(signup?'signup':'login'), {email:f.get('email'),password:f.get('password'),name:f.get('name')||'Игрок'});
      form.elements.password.value='';
      if(result.confirmation_required){$('#auth-message').textContent='Проверь почту и подтверди email по ссылке. После подтверждения войди с паролем.'; return;}
      mode='personal'; current=await api('/me/state'); location.hash='today'; await render();
    } catch(error){$('.form-error',form).textContent=error.message;}
    finally{button.disabled=false;}
  });
}

function settings(){
  if(mode==='demo')return demoSettings()+`<section class="panel"><h2>Начни свою историю</h2><p>В личном аккаунте ответы сохраняются в Supabase.</p><button class="btn lime" data-action="account">Перейти ко входу →</button></section>`;
  return header('Твой профиль','Личная история сохраняется между устройствами.')+`<div class="page-grid"><section class="panel"><h2>${esc(current.player.name)}</h2><p>${esc(current.email)}</p><p>Ответы и тренировки хранятся в твоём аккаунте. Другие игроки не имеют к ним доступа.</p><button class="btn outline" data-action="logout">Выйти из аккаунта</button></section><section class="panel"><h2>Твои данные</h2><p>Можешь скачать историю или удалить все записи. Удаление истории не удаляет аккаунт.</p><div class="split-actions"><button class="btn secondary" data-action="export-personal">Скачать историю</button><button class="text-button" data-action="clear-personal">Удалить историю</button></div><p class="score-explainer">Анализ выполняется правилами на Python. Отправки твоих показателей внешней AI-модели сейчас нет.</p></section></div>`;
}

async function render(){
  const revision=++routeVersion; page=location.hash.slice(1)||'today';navRender();
  if(!current)return onboarding();
  const views={today:overview,checkin:checkinPage,progress,coach:mode==='demo'?coach:overview,settings,about};
  const html=await (views[page]||overview)();
  if(revision!==routeVersion)return;
  $('#main').innerHTML=html; $('#sidebar-name').textContent=current.player.name; $('.avatar').textContent=current.player.initials; $('.demo-label').textContent=mode==='demo'?'Демо · вымышленные данные':'Личный дневник · Supabase';
  $('#checkin-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.target,button=$('button[type=submit]',form);button.disabled=true;$('.form-error',form).textContent='';
    const f=new FormData(form);
    try{current=await api('/checkins/'+selected,{date:f.get('date'),sleep:+f.get('sleep'),energy:+f.get('energy'),stress:+f.get('stress'),fatigue:+f.get('fatigue'),discomfort:+f.get('discomfort'),limitation:f.has('limitation'),resting_hr:f.get('resting_hr')?+f.get('resting_hr'):null,hrv:f.get('hrv')?+f.get('hrv'):null});location.hash='today';await render();toast('Опрос сохранён. Разбор обновлён.');}
    catch(err){$('.form-error',form).textContent=err.message;button.disabled=false;}
  });
  $('#player-select')?.addEventListener('change',e=>safely(async()=>{selected=e.target.value;sessionStorage.setItem('rg_player',selected);current=await api('/state/'+selected);await render();}));
  $('#import-file')?.addEventListener('change',e=>safely(async()=>{
    const f=e.target.files[0];if(!f)return;if(f.size>100000)throw Error('Файл больше 100 КБ');
    let body;try{body=JSON.parse(await f.text());}catch{throw Error('Не удалось прочитать JSON. Используй файл-пример.');}
    current=await api('/import/'+selected,body);await render();toast('Показатели импортированы');
  }));

}

function modal(title,content){
  $('#modal-content').innerHTML=`<div class="modal-inner"><div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="close" aria-label="Закрыть диалог" data-close>×</button></div>${content}</div>`;
  if(!$('#modal').open)$('#modal').showModal();
}
function selectField(name,label,options,value){return `<label class="field">${label}<select name="${name}">${options.map(([v,l])=>`<option value="${v}" ${String(value)===String(v)?'selected':''}>${l}</option>`).join('')}</select></label>`;}
const scale = (low,high) => [[1,`1 · ${low}`],[2,'2'],[3,'3'],[4,'4'],[5,`5 · ${high}`]];
function formBind(path,convert,onSuccess){
  $('#modal-form').addEventListener('submit',async e=>{
    e.preventDefault();const form=e.target,button=$('button[type=submit]',form);button.disabled=true;$('.form-error',form).textContent='';
    try{const result=await api(path,convert(new FormData(form)));await onSuccess(result);}
    catch(err){$('.form-error',form).textContent=err.message;}
    finally{button.disabled=false;}
  });
}
function checkinDialog(mood='good'){
  const last=current.checkins.at(-1)||{}, preset=mood==='good'?{energy:4,fatigue:2,stress:2}:{energy:2,fatigue:4,stress:3};
  modal('Как ты сегодня?',`<p>Твоя субъективная оценка. Отчёт за сегодня можно обновить.</p><form id="modal-form"><div class="form-grid"><label class="field">Сон, часов<input name="sleep" type="number" min="0" max="14" step="0.5" value="${last.sleep??8}" required></label>${selectField('energy','Энергия',scale('мало','много'),preset.energy)}${selectField('stress','Стресс',scale('спокойно','сильно'),preset.stress)}${selectField('fatigue','Усталость',scale('нет','сильная'),preset.fatigue)}<label class="field">Дискомфорт, 0–10<input name="discomfort" type="number" min="0" max="10" value="${last.discomfort??0}" required></label><label class="field">Дата<input type="date" name="date" value="${today()}" max="${today()}" required></label><label class="check-field"><input name="limitation" type="checkbox" ${last.limitation?'checked':''}>Дискомфорт мешает двигаться или выполнять удар</label><details class="wide"><summary>Показатели часов · необязательно</summary><div class="form-grid"><label class="field">Пульс покоя, уд/мин<input name="resting_hr" type="number" min="30" max="220" placeholder="Не измерял"></label><label class="field">HRV, мс<input name="hrv" type="number" min="1" max="300" placeholder="Не измерял"></label></div></details></div><p class="form-error" role="alert"></p><div class="form-actions"><button type="submit" class="btn lime">Сохранить чек-ин →</button></div></form>`);
  formBind('/checkins/'+selected,f=>({date:f.get('date'),sleep:+f.get('sleep'),energy:+f.get('energy'),stress:+f.get('stress'),fatigue:+f.get('fatigue'),discomfort:+f.get('discomfort'),limitation:f.has('limitation'),resting_hr:f.get('resting_hr')?+f.get('resting_hr'):null,hrv:f.get('hrv')?+f.get('hrv'):null}),async result=>{current=result;$('#modal').close();await render();toast('Чек-ин сохранён. Предложение обновлено.');});
}
function trainingDialog(){
  modal('Как прошло занятие?',`<p>Оцени всё занятие, а не только самый тяжёлый момент.</p><form id="modal-form"><div class="form-grid">${selectField('kind','Тип занятия',[['court','Тренировка на корте'],['match','Матч'],['fitness','ОФП']],'court')}<label class="field">Дата<input type="date" name="date" value="${today()}" max="${today()}" required></label><label class="field">Длительность, минут<input name="minutes" type="number" min="1" max="360" value="60" required></label><label class="field">Тяжесть нагрузки RPE, 1–10<input name="rpe" type="number" min="1" max="10" value="5" required><small>1 — очень легко, 10 — максимально тяжело</small></label>${selectField('focus','Удерживал концентрацию',scale('редко','часто'),3)}<label class="field full">Что получилось?<textarea name="note" maxlength="500" placeholder="Например: возвращался к следующему мячу после ошибки"></textarea></label></div><p class="form-error" role="alert"></p><div class="form-actions"><button type="submit" class="btn lime">Сохранить занятие →</button></div></form>`);
  formBind('/trainings/'+selected,f=>({date:f.get('date'),kind:f.get('kind'),minutes:+f.get('minutes'),rpe:+f.get('rpe'),focus:+f.get('focus'),note:f.get('note')}),async result=>{current=result;$('#modal').close();await render();toast('Занятие добавлено в историю');});
}
async function coachDialog(id){
  const s=await api('/state/'+id),a=s.assessment;
  modal('Игрок: '+s.player.name,`${status(a)}<ul class="factor-list">${a.factors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p class="score-explainer">${esc(a.quality)}. Это вымышленный профиль в демо-режиме.</p><form id="modal-form"><div class="form-grid">${selectField('action','Действие',[['discuss','Обсудить самочувствие'],['lighter','Предложить снизить объём'],['rest','Предложить день без физической практики']],'discuss')}<label class="field full">Комментарий игроку<textarea name="note" minlength="1" maxlength="500" required placeholder="Что предлагаете обсудить или изменить?"></textarea></label></div><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn lime" type="submit">Сохранить предложение →</button></div></form>`);
  formBind('/decisions/'+id,f=>({action:f.get('action'),note:f.get('note')}),async()=>{current=await api('/state/'+selected);$('#modal').close();await render();toast('Предложение доступно в карточке игрока');});
}

// Делегирование событий не требует повторного навешивания после каждой отрисовки.
document.addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-close'))return $('#modal').close();
  if(button.dataset.page){location.hash=button.dataset.page;return;}
  if(button.dataset.checkin)return checkinDialog(button.dataset.checkin);
  if(button.dataset.coach)return safely(()=>coachDialog(button.dataset.coach));
  if(button.dataset.scenario)return safely(async()=>{button.disabled=true;try{current=await api('/scenario/'+selected,{name:button.dataset.scenario});await render();toast('Демо-сценарий применён');}finally{button.disabled=false;}});
  const action=button.dataset.action;
  if(action==='start')return safely(async()=>{button.disabled=true;try{mode='demo';await api('/demo',{});current=await api('/state/'+selected);await render();}finally{button.disabled=false;}});
  if(action==='auth-toggle'){authView=authView==='login'?'signup':'login';return onboarding();}
  if(action==='account'){mode='personal';current=null;authView='login';return onboarding();}
  if(action==='logout')return safely(async()=>{await api('/auth/logout',{});current=null;onboarding();toast('Ты вышел из аккаунта');});
  if(action==='export-personal')return safely(async()=>{
    const data=await api('/me/export'); const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='rallyguard-history.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  if(action==='clear-personal'){
    modal('Удалить свою историю?', '<p>Все твои опросы и занятия будут удалены из Supabase. Это действие нельзя отменить.</p><div class="form-actions"><button class="btn secondary" data-close>Отмена</button><button class="btn danger" id="clear-history">Удалить историю</button></div>');
    $('#clear-history').onclick=()=>safely(async()=>{await api('/me/history',undefined,'DELETE');current=await api('/me/state');$('#modal').close();await render();toast('История удалена');});return;
  }
  if(action==='training')return trainingDialog();
  if(action==='sample'){
    const sample={checkins:[{date:today(),sleep:7.5,energy:4,stress:2,fatigue:2,discomfort:0,limitation:false,resting_hr:62,hrv:55}]};
    const url=URL.createObjectURL(new Blob([JSON.stringify(sample,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='rallyguard-checkins.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  if(action==='delete'){
    modal('Удалить демо-сессию?',`<p>Удалятся только твои вымышленные профили, ответы и отчёты. Новая сессия начнётся с исходных сценариев.</p><div class="form-actions"><button class="btn secondary" data-close>Отмена</button><button class="btn danger" id="confirm-delete">Удалить</button></div>`);
    $('#confirm-delete').onclick=()=>safely(async()=>{await api('/demo',undefined,'DELETE');current=null;$('#modal').close();onboarding();toast('Демо-данные удалены');});
  }
});
window.addEventListener('hashchange',()=>safely(render));
safely(async()=>{
  health=await api('/health');
  // После подтверждения почты убираем токены из адреса и переносим в HttpOnly cookies.
  const fragment=new URLSearchParams(location.hash.slice(1));
  if(fragment.has('access_token')){
    const tokens={access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token')};
    history.replaceState(null,'',location.pathname+'#today');
    await api('/auth/session',tokens);
  }
  try{current=await api('/me/state');}catch(error){if(error.status!==401)throw error;current=null;}
  await render();
});
