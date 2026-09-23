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
const nav = [['today','Обзор','home'],['checkin','Опрос','path'],['progress','Динамика','chart'],['insights','Закономерности','target'],['coach','Тренер','team']];
let mode = 'personal', authView = 'login', signupRole = 'player', refreshTask = null, firstLogin = false;
let page = 'today', current = null, health = {}, selected = sessionStorage.getItem('rg_player') || 'alex';
let account = null;
let routeVersion = 0, toastTimer;
const fmtDate = value => new Date(value+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

// Тема — личное предпочтение устройства. Кнопка есть даже до входа в аккаунт.
function syncThemeButton(){
  const light=document.documentElement.dataset.theme==='light';
  const button=$('.theme-toggle');
  button.innerHTML=`${icon(light?'moon':'sun')}<span>${light?'Тёмная тема':'Светлая тема'}</span>`;
  button.setAttribute('aria-label',light?'Включить тёмную тему':'Включить светлую тему');
  button.setAttribute('aria-pressed',String(light));
  $('meta[name="theme-color"]').content=light?'#f6f8f5':'#0d1110';
}
syncThemeButton();

async function api(path, data, method, retried = false) {
  // Личный режим обращается только к /me: идентификатор владельца задаёт сервер.
  if(mode === 'personal') {
    path = path.replace(/^\/(state|checkins|trainings)\/[^/]+$/, '/me/$1');
    path = path.replace(/^\/trainings\/[^/]+\/([^/]+)\/reflection$/, '/me/trainings/$1/reflection');
    if(path === '/export') path = '/me/export';
  }
  const response = await fetch('/api'+path,{method:method || (data === undefined ? 'GET':'POST'),
    headers:data === undefined ? {} : {'Content-Type':'application/json'},body:data === undefined ? undefined : JSON.stringify(data)});
  if(response.status === 401 && (path.startsWith('/me/') || path.startsWith('/coach/')) && !retried) {
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
  const items=mode==='coach'?[['coach','Моя группа','team'],['settings','Профиль','settings'],['about','О проекте','ball']]:mode==='demo'?[...nav,['settings','Профиль','settings']]:[...nav.slice(0,4),['settings','Профиль','settings']];
  $('#desktop-nav').innerHTML=items.map(([id,name,i])=>`<a class="nav-link ${page===id?'active':''}" href="#${id}" ${page===id?'aria-current="page"':''}>${icon(i)}${name}</a>`).join('');
  $('#mobile-nav').innerHTML=items.slice(0,4).map(([id,name,i])=>`<a class="nav-link ${page===id?'active':''}" href="#${id}" ${page===id?'aria-current="page"':''}>${icon(i)}${name}</a>`).join('');
  $('#breadcrumb').textContent=nav.find(n=>n[0]===page)?.[1] || 'RallyGuard';
}

function weeklyChart(checks) {
  const values=checks.slice(-7);
  if(!values.length)return '<p class="empty">График появится после первого чек-ина.</p>';
  const pts=values.map((x,i)=>[20+i*(220/Math.max(1,values.length-1)),150-(x.energy-1)*30]);
  return `<svg class="chart" viewBox="0 0 260 175" role="img" aria-label="Энергия за последние ${values.length} отчётов: ${values.map(x=>x.energy).join(', ')} из 5">${[30,60,90,120,150].map(y=>`<path d="M20 ${y}H245" class="chart-grid" stroke-width="1"/>`).join('')}<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" class="chart-line" stroke-width="2"/>${pts.map(([x,y],i)=>`${i===pts.length-1?`<circle cx="${x}" cy="${y}" r="10" class="chart-halo"/>`:''}<circle cx="${x}" cy="${y}" r="3.5" class="chart-dot"/>`).join('')}</svg><div class="chart-labels">${values.map(x=>`<span>${fmtDate(x.date)}</span>`).join('')}</div><div class="legend"><i></i> Энергия · самооценка от 1 до 5</div>`;
}

// Главный сценарий MVP: сначала ответы игрока, затем понятный разбор каждого сигнала.
function insightCards(items) {
  return items.map(item=>`<article class="insight-card"><div class="insight-top"><span>${esc(item.area)}</span><strong>${esc(item.value)}</strong></div><p>${esc(item.observation)}</p><div class="insight-action"><span>Что сделать</span><p>${esc(item.action)}</p></div></article>`).join('');
}
// Кольцо показывает долю шкалы. Источник всех значений — опрос, а не браслет.
function ring(label,value,display,color='sage',large=false){
  const normalized=Math.max(0,Math.min(100,Math.round(value||0)));
  return `<div class="ring-wrap ${large?'ring-large':''}"><div class="ring ${color}" role="img" aria-label="${esc(label)}: ${esc(display)}" data-value="${normalized}"><div class="ring-core"><strong>${esc(display)}</strong><span>${esc(label)}</span></div></div></div>`;
}
function baselineBlock(a){
  const baseline=a.baseline||{};
  if(!baseline.ready)return `<section class="panel"><h2>Твоя обычная динамика</h2><p>${esc(baseline.message||'Заполни первый опрос, чтобы начать личную историю.')}</p><small>${baseline.sample_size||0} предыдущих ответов · сравнение появится после 5</small></section>`;
  return `<section class="panel"><div class="panel-head"><h2>Что изменилось сегодня</h2><small>Твоя история · ${baseline.sample_size} ответов</small></div><div class="baseline-list">${baseline.changes.map(x=>`<div><strong>${esc(x.label)}</strong><span>${esc(x.value)} · обычно ${esc(x.baseline)}</span><b class="${x.direction==='близко к обычному'?'neutral':''}">${esc(x.direction)}</b></div>`).join('')}</div><p class="score-explainer">${esc(baseline.message)}</p></section>`;
}
function explainScore(a){
  const details=a.score_details;
  if(!details)return '';
  const labels={energy:'Энергия',fatigue:'Усталость',stress:'Стресс',discomfort:'Дискомфорт'};
  return `<details class="score-detail"><summary>Как получился индекс ${details.score}/100</summary><p>Стартуем со 100 баллов и вычитаем баллы за ответы в последнем опросе.</p><div class="baseline-list">${Object.entries(details.deductions).map(([key,value])=>`<div><strong>${labels[key]}</strong><span>−${value}</span></div>`).join('')}</div><p>${a.score_change===null?'Пока нет предыдущего индекса для сравнения.':`Изменение к предыдущему опросу: ${a.score_change>0?'+':''}${a.score_change} баллов.`}</p><p class="score-explainer">${esc(details.note)} Индекс описывает ответы, но не определяет медицинскую готовность к игре.</p></details>`;
}
function matchBlock(){
  const match=current.context?.next_match;
  if(!match)return '';
  const days=Math.ceil((new Date(match+'T12:00:00')-new Date(today()+'T12:00:00'))/86400000);
  if(days<0)return '';
  return `<div class="notice"><strong>${days===0?'Матч сегодня':`Матч через ${days} дн.`}</strong><br>Посмотри последние ответы и при заметных изменениях обсуди план занятия с тренером. Приложение не определяет готовность к матчу.</div>`;
}
function adviceCacheKey(){
  const source=JSON.stringify([account.email,current.context,current.checkins.at(-1),current.checkins.length,current.trainings.at(-1),current.trainings.length]);
  let hash=2166136261;
  for(let i=0;i<source.length;i++)hash=Math.imul(hash^source.charCodeAt(i),16777619);
  return 'rg_advice_'+(hash>>>0).toString(16);
}
async function loadAdvice(force=false){
  const target=$('#daily-advice');
  if(!target||mode!=='personal')return;
  const cacheKey=adviceCacheKey();
  if(!force){try{const cached=JSON.parse(sessionStorage.getItem(cacheKey)||'null');if(cached&&Date.now()-cached.time<30*60*1000){target.textContent=cached.text;$('#advice-source').textContent=cached.source;return;}}catch{/* Кэш необязателен. */}}
  const revision=routeVersion;
  // Gemini иногда отвечает десятки секунд: базовый совет остаётся видимым.
  target.textContent=current.assessment.summary;
  $('#advice-source').textContent='Уточняем совет через Gemini…';
  try{
    const result=await api('/me/advice');
    if(revision!==routeVersion||!$('#daily-advice'))return;
    $('#daily-advice').textContent=result.text;
    $('#advice-source').textContent=result.source==='gemini'?'Сводка Gemini по твоей истории · без диагноза':'По рассчитанным сигналам · Gemini пока недоступен';
    try{sessionStorage.setItem(cacheKey,JSON.stringify({text:result.text,source:$('#advice-source').textContent,time:Date.now()}));}catch{/* Совет остаётся видимым без кэша. */}
  }catch{
    if(revision===routeVersion&&$('#daily-advice')){
      $('#daily-advice').textContent=current.assessment.summary;
      $('#advice-source').textContent='По рассчитанным сигналам · Gemini пока недоступен';
    }
  }
}
function overview(){
  const a=current.assessment, last=current.checkins.at(-1);
  return header(`Привет, ${current.player.name}`, 'Твой обзор за сегодня', `<button class="btn lime" data-page="checkin">${last?.date===today()?'Обновить опрос':'Заполнить опрос'} →</button>`)+`
    ${matchBlock()}${current.context_tip?`<div class="notice">${esc(current.context_tip)}</div>`:''}
    <section class="panel overview-hero"><div><span class="eyebrow">ПЕРЕД КОРТОМ · ПО ТВОИМ ОТВЕТАМ</span><h2>${esc(a.label)}</h2><p>${esc(a.summary)}</p><button class="btn secondary" data-page="checkin">Ответить на вопросы →</button></div>${ring('индекс состояния',a.score,a.score??'—','sage',true)}</section>
    <section class="panel ai-advice"><span class="eyebrow">СОВЕТ RALLYGUARD</span><p id="daily-advice">${esc(a.summary)}</p><small id="advice-source">По рассчитанным сигналам · без диагноза</small>${mode==='personal'?'<div class="ai-permission"><p>Для сводки Gemini получит теннисный профиль, общие итоги истории, последние 7 опросов и 5 тренировок с короткими заметками. Имя, email и пароль не передаются.</p><button class="btn secondary small" data-action="ai-advice">Получить совет ИИ</button></div>':''}</section>
    <div class="page-grid overview-bottom">${baselineBlock(a)}<section class="panel"><h2>Почему такой индекс</h2>${explainScore(a)||'<p>После первого опроса появится объяснение.</p>'}</section></div>
    <div class="metric-grid">${[
      ['Сон',last?Math.round(last.sleep/8*100):0,last?`${last.sleep} ч`:'—','cyan'],
      ['Энергия',last?last.energy*20:0,last?`${last.energy}/5`:'—','lime'],
      ['Усталость',last?last.fatigue*20:0,last?`${last.fatigue}/5`:'—','orange'],
      ['Стресс',last?last.stress*20:0,last?`${last.stress}/5`:'—','pink']
    ].map(([name,value,display,color])=>`<div class="metric">${ring(name,value,display,color)}<small>${name==='Усталость'||name==='Стресс'?'Меньше — лучше':'По последнему опросу'}</small></div>`).join('')}</div>
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
  <section class="panel wide"><h2>История занятий</h2><p class="score-explainer">RPE — твоя оценка тяжести занятия от 1 до 10. <button class="text-button" data-action="explain-rpe">Что это?</button></p>${current.trainings.length?`<div class="table-wrap history-table"><table><thead><tr><th scope="col">Дата</th><th scope="col">Занятие</th><th scope="col">Минуты</th><th scope="col">Тяжесть</th><th scope="col">Оценка после</th><th scope="col">Действие</th></tr></thead><tbody>${[...current.trainings].reverse().slice(0,20).map(s=>`<tr><td data-label="Дата">${fmtDate(s.date)}</td><td data-label="Занятие">${{court:'Корт',match:'Матч',fitness:'ОФП'}[s.kind]}</td><td data-label="Минуты">${s.minutes}</td><td data-label="Тяжесть">${s.rpe}/10</td><td data-label="Оценка после">${s.after?`${s.after.quality}/10`:'—'}</td><td data-label="Действие">${s.after?'Заполнено':`<button class="text-button" data-reflect="${esc(s.id)}">Как прошло?</button>`}</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">Занятий пока нет.</p>'}<button class="text-button" data-action="training">+ Записать занятие</button></section></div>`;}

function insightsPage(){
  const patterns=current.assessment.patterns||{sample_size:0,observations:[]};
  const recent=[...current.trainings].reverse().find(s=>s.after);
  const count=patterns.sample_size, word=count%10===1&&count%100!==11?'занятие':count%10>=2&&count%10<=4&&(count%100<12||count%100>14)?'занятия':'занятий';
  return header('Личные закономерности','Связь состояния до занятия, нагрузки и твоей оценки после него.')+`<div class="page-grid"><section class="panel"><h2>До → занятие → после</h2>${recent?`<div class="journey"><div><small>До</small><strong>${recent.before?`Энергия ${recent.before.energy}/5 · стресс ${recent.before.stress}/5`:'Опрос перед занятием не заполнен'}</strong></div><div><small>Занятие</small><strong>${recent.minutes} мин · тяжесть ${recent.rpe}/10</strong></div><div><small>После</small><strong>Качество ${recent.after.quality}/10 · энергия ${recent.after.energy_after}/10</strong></div></div><p class="score-explainer">RPE — личная оценка того, насколько тяжёлым было занятие. <button class="text-button" data-action="explain-rpe">Подробнее</button></p>`:'<p>Запиши тренировку и ответь на три вопроса после неё. Тогда появится первая связанная история.</p>'}</section><section class="panel"><h2>Что повторяется</h2><p>${count} ${word} с ответами до и после.</p>${patterns.stage==='collecting'?'<div class="notice">Для наблюдений нужно минимум 5 связанных занятий. Каждая новая запись делает картину точнее.</div>':`<ul class="factor-list">${patterns.observations.map(item=>`<li>${esc(item)}</li>`).join('')}</ul><p class="score-explainer">Это совпадения в твоих записях, а не доказательство причины.</p>`}<button class="btn secondary" data-action="training">Добавить занятие →</button></section></div>`;
}

async function coach(){
  const data=await api('/team');
  const order={attention:0,caution:1,unknown:2,steady:3};
  return header('Обзор тренера','Кому сегодня стоит уделить внимание?')+`<div class="notice">Демо-роль тренера: только три вымышленных игрока в твоей изолированной сессии. Подключение настоящего тренера и Telegram пока не настроены.</div><section class="panel"><div class="panel-head"><h2>Моя группа</h2><small>3 игрока · демо</small></div>${data.players.sort((a,b)=>order[a.assessment.level]-order[b.assessment.level]).map(s=>`<div class="coach-row"><span class="avatar">${s.player.initials}</span><div class="info"><strong>${s.player.name}</strong><small>${s.player.goal}</small><small>Чек-ин: ${s.checkins.at(-1)?fmtDate(s.checkins.at(-1).date):'нет'} · ${s.assessment.reported_days}/7 дней</small></div>${status(s.assessment)}<button class="btn outline small" data-coach="${s.player.id}">Посмотреть →</button></div>`).join('')}</section>`;
}

function demoSettings(){return header('Профиль и демо','Управление данными и сценариями для проверки MVP.')+`<div class="page-grid"><section class="panel"><div class="settings-block"><h3>Демонстрационный игрок</h3><p>Переключение не даёт доступ к данным других посетителей.</p><label class="field">Игрок<select id="player-select">${[['alex','Алекс'],['mira','Мира'],['timur','Тимур']].map(([id,n])=>`<option value="${id}" ${id===selected?'selected':''}>${n}</option>`).join('')}</select></label></div><div class="settings-block"><h3>Три сценария состояния</h3><p>Заменяют сегодняшний опрос выбранного демо-игрока. Остальная история сохраняется.</p><div class="split-actions"><button class="btn secondary small" data-scenario="steady">Обычный ритм</button><button class="btn secondary small" data-scenario="tired">Усталость</button><button class="btn secondary small" data-scenario="attention">Нужен разговор</button></div></div><div class="settings-block"><h3>Импорт показателей</h3><p>JSON с массивом checkins, максимум 90 записей и 100 КБ. Только вымышленные данные для демо.</p><label class="field">Файл JSON<input id="import-file" type="file" accept=".json,application/json"></label><button class="text-button" data-action="sample">Скачать пример JSON</button></div></section><section class="panel"><h3>Хранение и анализ</h3><p>${health.database==='supabase'?'Supabase · PostgreSQL':'SQLite · '+(health.ephemeral?'временное облачное хранение':'локальное хранение')}</p>${health.ephemeral?'<div class="notice">История может исчезнуть или отличаться между экземплярами Vercel. Для постоянного демо подключите Supabase.</div>':''}<p>Разбор по ответам работает без внешнего AI API: правила и причины видны в обзоре.</p><p class="score-explainer">Это изолированная песочница с вымышленными профилями. Не вводи персональные данные о здоровье.</p><div class="split-actions"><a class="btn outline" href="/api/export" download>Экспортировать данные</a><button class="btn danger" data-action="delete">Удалить мою демо-сессию</button></div><hr style="border:0;border-top:1px solid var(--line);margin:24px 0"><button class="btn secondary" data-page="coach">Открыть обзор тренера →</button><button class="text-button" data-page="progress">Моя динамика →</button></section></div>`;}

function about(){return header('Что такое RallyGuard','Сайт для теннисистов, который помогает заметить изменения в самочувствии до тренировки.')+`<div class="page-grid"><section class="panel wide"><span class="eyebrow">КОНЦЕПЦИЯ</span><h2>Игрок сначала рассказывает о себе, потом получает понятный следующий шаг</h2><p>RallyGuard не пытается заменить тренера или носимое устройство. Игрок каждый день отвечает на короткие вопросы о сне, энергии, усталости, стрессе, дискомфорте и тренировке. Приложение сравнивает ответы с его собственной историей и объясняет, что изменилось.</p><div class="intro-list"><div>${icon('path')}<strong>Опрос за минуту</strong><p>Все основные показатели на одном экране, без длинной анкеты.</p></div><div>${icon('chart')}<strong>Разбор по сигналам</strong><p>Сон, энергия, усталость и стресс получают отдельное наблюдение и действие.</p></div><div>${icon('team')}<strong>Связь с тренером</strong><p>Игрок сам решает, кому открыть краткую сводку, и может отозвать доступ.</p></div></div></section><section class="panel"><h2>Что есть в приложении</h2><ol class="plan-steps"><li>Личный аккаунт игрока с сохранением истории в Supabase.</li><li>Круговой индекс состояния и шкалы по последнему опросу.</li><li>История энергии и тренировочной нагрузки.</li><li>Теннисный профиль: уровень, цель, обычная частота занятий и ближайший матч.</li><li>Понятные рекомендации без медицинских диагнозов.</li><li>Отдельная регистрация тренера и группа игроков с их согласием.</li><li>Подготовленная Telegram-связка для коротких отчётов тренера.</li></ol></section><section class="panel"><h2>Как проходит день игрока</h2><div class="steps-timer"><div class="focus-orb">1–2<br><small>мин</small></div></div><ol class="plan-steps"><li>Игрок заполняет чек-ин.</li><li>Система показывает индекс и причины изменения.</li><li>Игрок записывает тренировку или отмечает ближайший матч.</li><li>При необходимости он открывает тренеру сводку за последние 30 дней.</li></ol><button class="btn lime" data-page="checkin">Попробовать опрос →</button></section><section class="panel"><h2>Что видит тренер</h2><p>Тренер получает не весь дневник игрока, а короткий рабочий контекст: последний чек-ин, общую оценку состояния, число тренировок, цель и дату ближайшего матча. Личные заметки, пульс и HRV в отчёт не входят.</p><p>Доступ появляется только после двух действий игрока: он вводит код тренера и отмечает согласие. Кнопка отзыва находится в его профиле.</p><h3>Telegram</h3><p>После привязки тренер сможет запросить список подключённых игроков и краткую сводку командой в боте. Это дополнительный канал, а не отдельный кабинет с правами администратора.</p></section><section class="panel wide"><h2>Почему это подходит BioTech-треку</h2><p>Проект работает с данными о состоянии и нагрузке спортсмена и переводит их в понятное решение для следующего занятия. Сейчас анализ прозрачен: Python рассчитывает описательный индекс, сравнивает показатели с личной медианой и показывает причины. Позже можно подключить AI для объяснения уже рассчитанных сигналов, не отдавая модели весь дневник без согласия.</p><div class="metric-grid concept-metrics"><div class="metric"><strong>Игрок</strong><small>сам вводит данные и контролирует доступ</small></div><div class="metric"><strong>Тренер</strong><small>получает короткий контекст для разговора</small></div><div class="metric"><strong>Система</strong><small>объясняет, откуда взялся сигнал</small></div><div class="metric"><strong>Команда</strong><small>может использовать Telegram-отчёты</small></div></div></section><section class="panel"><h2>Границы MVP</h2><p>Индекс в прототипе не является вероятностью травмы, медицинским допуском или диагнозом. При боли или ограничении движения приложение предлагает обратиться к тренеру или специалисту.</p><p class="score-explainer">Для хакатона используются синтетические демо-данные. В продакшене понадобятся согласия, политика хранения, SMTP, проверка модели на данных и отдельная оценка специалистами.</p></section><section class="panel"><h2>Технологии</h2><p>FastAPI и Python отвечают за API и объяснимый расчёт. Supabase хранит аккаунты и личную историю с RLS. Vercel публикует сайт. Клиентская часть сделана без тяжёлого сборщика: адаптивный HTML, CSS и JavaScript с сохранением темы и плавными кольцевыми шкалами.</p></section></div>`;}

// Вход является основным сценарием; демо запускается только отдельной кнопкой.
function onboarding(){
  navRender(); $('#sidebar-name').textContent='Твой аккаунт';
  $('.demo-label').textContent='Личный дневник';
  const signup=authView==='signup';
  const reset=authView==='reset', recover=authView==='recover';
  $('#main').innerHTML=`<div class="onboarding"><section class="hero"><div class="hero-content"><span class="eyebrow">ТЕННИС В ТВОЁМ ТЕМПЕ</span><h2>Твоя игра.<br>Твоё состояние.</h2><p>Записывай сон, стресс и нагрузку. Замечай изменения и приходи на корт с понятным планом.</p></div></section><section class="panel auth-panel"><span class="eyebrow">RALLYGUARD</span><h2>${reset?'Новый пароль':recover?'Восстановление доступа':signup?'Создать аккаунт':'С возвращением'}</h2><p>${reset?'Укажи новый пароль для аккаунта.':recover?'Пришлём ссылку для смены пароля, когда будет подключена почта.':signup?'Выбери свою роль. Позже изменить её сможет только администратор.':'Войди, чтобы продолжить свою историю.'}</p><form id="auth-form">${signup?`<div class="role-picker" role="group" aria-label="Роль при регистрации"><button type="button" class="role-option ${signupRole==='player'?'active':''}" data-role="player">Я игрок<small>Опрос и личная динамика</small></button><button type="button" class="role-option ${signupRole==='coach'?'active':''}" data-role="coach">Я тренер<small>Сводки игроков с их согласия</small></button></div><label class="field">Как тебя зовут<input name="name" autocomplete="name" maxlength="60" required></label>`:''}${reset?'':`<label class="field">Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label>`}${recover?'':`<label class="field">${reset?'Новый пароль':'Пароль'}<input name="password" type="password" autocomplete="${signup||reset?'new-password':'current-password'}" minlength="8" maxlength="128" required><small>Минимум 8 символов</small></label>`}${signup&&signupRole==='player'?'<label class="check-field"><input type="checkbox" required>Согласен сохранять ответы о самочувствии в своём аккаунте Supabase. Могу удалить историю в профиле.</label>':''}<p class="form-error" role="alert"></p><p id="auth-message" role="status"></p><button class="btn lime" type="submit">${reset?'Сменить пароль':recover?'Отправить ссылку':signup?'Зарегистрироваться':'Войти'} →</button></form><button class="text-button" data-action="auth-toggle">${signup||recover?'Вернуться ко входу':'Нет аккаунта? Зарегистрироваться'}</button>${authView==='login'?'<button class="text-button" data-action="auth-recover">Забыл пароль?</button>':''}<div class="settings-block"><button class="text-button" data-action="start">Посмотреть пример без регистрации →</button></div></section></div>`;
  $('#auth-form').addEventListener('submit', async e=>{
    e.preventDefault(); const form=e.target, button=$('[type=submit]',form), f=new FormData(form);
    button.disabled=true; $('.form-error',form).textContent=''; $('#auth-message').textContent='';
    try {
      if(recover){await api('/auth/recover',{email:f.get('email')});$('#auth-message').textContent='Если адрес зарегистрирован, письмо отправлено.';return;}
      if(reset){await api('/auth/password',{password:f.get('password')});form.elements.password.value='';authView='login';account=null;current=null;await api('/auth/logout',{});onboarding();toast('Пароль изменён. Войди с новым паролем.');return;}
      const result=await api('/auth/'+(signup?'signup':'login'), {email:f.get('email'),password:f.get('password'),name:f.get('name')||'Игрок',role:signupRole});
      form.elements.password.value='';
      if(result.confirmation_required){$('#auth-message').textContent='Проверь почту и подтверди email по ссылке. После подтверждения войди с паролем.'; return;}
      firstLogin=signup; await loadAccount(); location.hash=mode==='coach'?'coach':'today'; await render(); if(firstLogin&&mode==='personal'){firstLogin=false;welcomeProfile();}
    } catch(error){$('.form-error',form).textContent=error.message;}
    finally{button.disabled=false;}
  });
}

// Настоящий тренер видит только игроков, которые ввели его код и дали согласие.
async function coachDashboard(){
  const data=await api('/coach/players');
  return header('Моя группа','Что стоит знать перед разговором с игроком?')+`<div class="notice">Данные появятся только после согласия игрока. Личные заметки, пульс и HRV тренеру не передаются.</div><section class="panel"><div class="panel-head"><h2>Игроки</h2><small>${data.players.length} подключено</small></div>${data.players.length?data.players.map(p=>`<div class="coach-row"><span class="avatar">${esc(p.name.slice(0,2).toUpperCase())}</span><div class="info"><strong>${esc(p.name)}</strong><small>${p.assessment.baseline?.ready?p.assessment.baseline.changes.filter(x=>x.direction!=='близко к обычному').slice(0,2).map(x=>`${esc(x.label)} ${esc(x.direction)}`).join(' · ')||'Близко к обычному':'Накопление личной истории'}</small><small>Последний опрос: ${p.last_checkin?fmtDate(p.last_checkin.date):'пока нет'} · занятий за 30 дней: ${p.training_count}</small>${p.last_training?`<small>Последнее занятие: ${p.last_training.minutes} мин · тяжесть ${p.last_training.rpe}/10${p.last_training.quality?` · качество ${p.last_training.quality}/10`:''}</small>`:''}${p.context?.next_match?`<small>Матч: ${fmtDate(p.context.next_match)}</small>`:''}</div>${status(p.assessment)}<button class="btn outline small" data-live-report="${esc(p.player_id)}">Профиль →</button></div>`).join(''):'<p class="empty">Пока нет подключённых игроков. Скопируй свой код в профиле и передай его игроку.</p>'}</section><p class="score-explainer">Тяжесть занятия (RPE) — личная оценка игрока от 1 до 10, а не измерение устройства.</p>`;
}

// Роль всегда читаем из базы, а не из выбранной кнопки регистрации.
async function loadAccount(){
  account=await api('/me/profile');
  mode=account.role==='coach'?'coach':'personal';
  current=mode==='coach'?{player:{name:account.name,initials:account.name.slice(0,2).toUpperCase()}}:await api('/me/state');
}

function settings(){
  if(mode==='demo')return demoSettings()+`<section class="panel"><h2>Начни свою историю</h2><p>В личном аккаунте ответы сохраняются в Supabase.</p><button class="btn lime" data-action="account">Перейти ко входу →</button></section>`;
  if(mode==='coach')return header('Профиль тренера','Управляй приглашениями и уведомлениями.')+`<div class="page-grid"><section class="panel"><h2>${esc(account.name)}</h2><p>${esc(account.email)}</p><p>Твой код для игроков:</p><div class="code-box"><code>${esc(account.coach_code)}</code><button class="btn secondary small" data-action="copy-code">Скопировать</button></div><p class="score-explainer">Игрок вводит код в своём профиле и отдельно подтверждает доступ. Без этого отчёт недоступен.</p><button class="btn outline" data-action="logout">Выйти</button></section><section class="panel"><h2>Telegram-бот</h2><p>Краткие отчёты по команде в Telegram. Бот не получает личные заметки игрока.</p>${account.telegram_available?'<button class="btn lime" data-action="telegram-link">Привязать Telegram →</button>':'<div class="notice">Бот будет доступен после добавления токена BotFather в настройки сервера.</div>'}<p class="score-explainer">Привязка доступна только аккаунту тренера.</p></section></div>`;
  const c=current.context||{};
  return header('Твой профиль','Личная история сохраняется между устройствами.')+`<div class="page-grid"><section class="panel"><h2>${esc(current.player.name)}</h2><p>${esc(current.email)}</p><p>Ответы и тренировки хранятся в твоём аккаунте. Другие игроки не имеют к ним доступа.</p><button class="btn outline" data-action="logout">Выйти из аккаунта</button></section><section class="panel"><h2>Теннисный профиль</h2><p>Эти данные помогают учитывать твой игровой контекст.</p><form id="context-form"><label class="field">Уровень<select name="level">${[['beginner','Начинаю'],['intermediate','Играю регулярно'],['advanced','Опытный игрок']].map(([v,l])=>`<option value="${v}" ${c.level===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="field">Цель<input name="goal" maxlength="120" value="${esc(c.goal||'')}" placeholder="Например, увереннее играть матч"></label><label class="field">Занятий в обычную неделю<input type="number" name="sessions_per_week" min="0" max="14" value="${c.sessions_per_week??2}" required></label><label class="field">Ближайший матч · необязательно<input type="date" name="next_match" min="${today()}" value="${esc(c.next_match||'')}"></label><p class="form-error" role="alert"></p><button class="btn secondary" type="submit">Сохранить профиль</button></form></section><section class="panel"><h2>Связь с тренером</h2>${account?.coach_connected?'<p>Тренер видит краткую сводку твоего состояния за последние 30 дней и теннисный профиль.</p><button class="btn danger" data-action="disconnect-coach">Отозвать доступ</button>':'<form id="coach-connect-form"><label class="field">Код тренера<input name="code" pattern="[a-fA-F0-9]{32}" maxlength="32" autocomplete="off" required></label><label class="check-field"><input name="consent" type="checkbox" required>Разрешаю тренеру видеть краткую сводку моих опросов и тренировок за 30 дней и теннисный профиль. Личные заметки, пульс и HRV не передаются. Могу отозвать доступ здесь.</label><p class="form-error" role="alert"></p><button class="btn secondary" type="submit">Подключить тренера</button></form>'}</section><section class="panel"><h2>Твои данные</h2><p>Можешь скачать историю или удалить все записи. Удаление истории не удаляет аккаунт.</p><div class="split-actions"><button class="btn secondary" data-action="export-personal">Скачать историю</button><button class="text-button" data-action="clear-personal">Удалить историю</button></div><p class="score-explainer">Анализ выполняется правилами на Python. Отправки твоих показателей внешней AI-модели сейчас нет.</p></section></div>`;
}

async function render(){
  const revision=++routeVersion; page=location.hash.slice(1)||'today';navRender();
  if(!current)return onboarding();
  if(mode==='coach'&&!['coach','settings','about'].includes(page)){page='coach';history.replaceState(null,'','#coach');navRender();}
  const views={today:overview,checkin:checkinPage,progress,insights:insightsPage,coach:mode==='demo'?coach:coachDashboard,settings,about};
  const html=await (views[page]||(mode==='coach'?coachDashboard:overview))();
  if(revision!==routeVersion)return;
  $('#main').innerHTML=html; $('#sidebar-name').textContent=current.player.name; $('.avatar').textContent=current.player.initials; $('.demo-label').textContent=mode==='demo'?'Демо · вымышленные данные':'Личный дневник · Supabase';
  if(page==='today'&&mode==='personal'&&localStorage.getItem('rg_ai_consent_'+account.email)==='yes')void loadAdvice();
  requestAnimationFrame(()=>$('#main').querySelectorAll('.ring').forEach(el=>el.style.setProperty('--value',el.dataset.value)));
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

  $('#coach-connect-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.target,button=$('button[type=submit]',form);button.disabled=true;
    try{const data=await api('/me/coach',{code:new FormData(form).get('code')});account=await api('/me/profile');await render();toast(`Тренер ${data.coach_name} подключён`);}
    catch(error){$('.form-error',form).textContent=error.message;button.disabled=false;}
  });
  // До ввода кода игрок видит точный состав сводки, которую получит тренер.
  $('#coach-connect-form')?.insertAdjacentHTML('afterbegin',`<div class="consent-preview"><strong>Тренер увидит</strong><p>Статус сегодня, энергию, усталость, стресс, занятия и их субъективную тяжесть, оценку после занятия, цель и ближайший матч.</p><strong>Тренер не увидит</strong><p>Личные заметки, пульс, HRV, email и исходные данные устройств.</p></div>`);
  $('#context-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const form=e.target,button=$('button[type=submit]',form),f=new FormData(form);button.disabled=true;
    try{await api('/me/context',{level:f.get('level'),goal:f.get('goal'),sessions_per_week:+f.get('sessions_per_week'),next_match:f.get('next_match')||null},'PUT');current=await api('/me/state');await render();toast('Теннисный профиль сохранён');}
    catch(error){$('.form-error',form).textContent=error.message;button.disabled=false;}
  });

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
    try{const result=await api(path,convert(new FormData(form)),path.endsWith('/reflection')?'PUT':undefined);await onSuccess(result);}
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
  modal('Запиши занятие',`<p>Сначала сохраним нагрузку, затем за 20 секунд отметим, как прошла тренировка.</p><form id="modal-form"><div class="form-grid">${selectField('kind','Тип занятия',[['court','Тренировка на корте'],['match','Матч'],['fitness','ОФП']],'court')}<label class="field">Дата<input type="date" name="date" value="${today()}" max="${today()}" required></label><label class="field">Длительность, минут<input name="minutes" type="number" min="1" max="360" value="60" required></label><label class="field">Насколько тяжёлой была тренировка?<input name="rpe" type="number" min="1" max="10" value="5" required><small>RPE · 1 — очень легко, 5 — умеренно, 8 — очень тяжело, 10 — максимум. <button type="button" class="text-button" data-action="explain-rpe">Что такое RPE?</button></small></label>${selectField('focus','Удавалось сохранять концентрацию?',scale('редко','часто'),3)}<label class="field full">Личная заметка · необязательно<textarea name="note" maxlength="500" placeholder="Что хочется запомнить? Тренер эту заметку не увидит."></textarea></label></div><p class="form-error" role="alert"></p><div class="form-actions"><button type="submit" class="btn lime">Сохранить занятие →</button></div></form>`);
  const previous=new Set(current.trainings.map(s=>s.id));
  formBind('/trainings/'+selected,f=>({date:f.get('date'),kind:f.get('kind'),minutes:+f.get('minutes'),rpe:+f.get('rpe'),focus:+f.get('focus'),note:f.get('note')}),async result=>{current=result;const added=current.trainings.find(s=>!previous.has(s.id));$('#modal').close();await render();if(added)reflectionDialog(added.id);else toast('Занятие сохранено');});
}
function reflectionDialog(id){
  modal('Как прошло занятие?',`<p>Три коротких ответа помогут связать состояние до тренировки с тем, как она прошла.</p><form id="modal-form"><div class="form-grid"><label class="field">Как прошло занятие в целом?<input name="quality" type="number" min="1" max="10" value="7" required><small>1 — не получилось, 10 — отлично</small></label><label class="field">Сколько энергии осталось после?<input name="energy_after" type="number" min="1" max="10" value="6" required></label>${selectField('discomfort_after','Дискомфорт после занятия',[['none','Не было'],['lower','Меньше'],['same','Без изменений'],['increased','Усилился']],'none')}<label class="field full">Что стоит запомнить? · необязательно<textarea name="note" maxlength="500" placeholder="Личная заметка, тренер её не видит"></textarea></label></div><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn lime" type="submit">Сохранить ответ →</button></div></form>`);
  formBind('/trainings/'+selected+'/'+id+'/reflection',f=>({quality:+f.get('quality'),energy_after:+f.get('energy_after'),discomfort_after:f.get('discomfort_after'),note:f.get('note')}),async result=>{current=result;$('#modal').close();await render();toast('Ответ после занятия сохранён');});
}
function explainRpe(){
  const help=`<p>RPE — твоя собственная оценка того, насколько тяжёлым ощущалось занятие. Это не показатель часов и не медицинское измерение.</p><ol class="plan-steps"><li>1–2 — очень легко</li><li>3–4 — легко</li><li>5–6 — умеренно</li><li>7 — тяжело</li><li>8 — очень тяжело</li><li>9 — почти максимум</li><li>10 — максимум</li></ol><p>Пример: 90 минут тенниса и RPE 8/10 означают, что занятие ощущалось очень тяжёлым, но не предельным.</p>`;
  const form=$('#modal-form');
  if(form){if(!$('#rpe-help',form))form.insertAdjacentHTML('beforeend',`<div id="rpe-help" class="notice">${help}</div>`);return;}
  modal('Что такое RPE?',help);
}
async function coachDialog(id){
  const s=await api('/state/'+id),a=s.assessment;
  modal('Игрок: '+s.player.name,`${status(a)}<ul class="factor-list">${a.factors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p class="score-explainer">${esc(a.quality)}. Это вымышленный профиль в демо-режиме.</p><form id="modal-form"><div class="form-grid">${selectField('action','Действие',[['discuss','Обсудить самочувствие'],['lighter','Предложить снизить объём'],['rest','Предложить день без физической практики']],'discuss')}<label class="field full">Комментарий игроку<textarea name="note" minlength="1" maxlength="500" required placeholder="Что предлагаете обсудить или изменить?"></textarea></label></div><p class="form-error" role="alert"></p><div class="form-actions"><button class="btn lime" type="submit">Сохранить предложение →</button></div></form>`);
  formBind('/decisions/'+id,f=>({action:f.get('action'),note:f.get('note')}),async()=>{current=await api('/state/'+selected);$('#modal').close();await render();toast('Предложение доступно в карточке игрока');});
}

async function liveReport(id){
  const p=await api('/coach/players/'+id),a=p.assessment, context=p.context||{};
  modal('Профиль игрока: '+p.name,`${status(a)}<div class="metric-grid"><div class="metric"><strong>${a.score??'—'}</strong><small>индекс состояния</small></div><div class="metric"><strong>${p.training_count}</strong><small>занятий за 30 дней</small></div><div class="metric"><strong>${a.reported_days}/7</strong><small>дней с опросом</small></div></div><h3>Контекст игрока</h3><p>Уровень: ${esc({beginner:'начинаю',intermediate:'играю регулярно',advanced:'опытный игрок'}[context.level]||'не указан')} · занятий в неделю: ${context.sessions_per_week??'—'}</p>${context.goal?`<p>Цель: ${esc(context.goal)}</p>`:'<p class="score-explainer">Цель пока не заполнена.</p>'}${context.next_match?`<p>Ближайший матч: ${fmtDate(context.next_match)}</p>`:''}<h3>Что заметила система</h3><p>${esc(a.summary)}</p><ul class="factor-list">${a.factors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>${p.last_checkin?`<h3>Последний опрос · ${fmtDate(p.last_checkin.date)}</h3><div class="table-wrap"><table><tbody><tr><th>Сон</th><td>${p.last_checkin.sleep} ч</td><th>Энергия</th><td>${p.last_checkin.energy}/5</td></tr><tr><th>Стресс</th><td>${p.last_checkin.stress}/5</td><th>Усталость</th><td>${p.last_checkin.fatigue}/5</td></tr><tr><th>Дискомфорт</th><td>${p.last_checkin.discomfort}/10</td><th>Ограничение</th><td>${p.last_checkin.limitation?'да':'нет'}</td></tr></tbody></table></div>`:''}<p class="score-explainer">Данные доступны только после согласия игрока. Это описательная сводка, не диагноз и не медицинский допуск.</p>`);
  if(p.last_training)$('#modal-content .modal-inner').insertAdjacentHTML('beforeend',`<h3>Последнее занятие</h3><p>${esc(p.last_training.minutes)} мин · тяжесть ${esc(p.last_training.rpe)}/10${p.last_training.quality?` · качество ${esc(p.last_training.quality)}/10`:''}</p><p class="score-explainer">RPE — личная оценка игрока, насколько тяжёлой была тренировка.</p>`);
}

// После регистрации игроку показываем короткое знакомство с профилем. Данные можно пропустить и заполнить позже.
function welcomeProfile(){
  modal('Расскажи о себе',`<p>Это займёт минуту. Ответы помогают сравнивать тебя с твоей обычной нагрузкой.</p><form id="welcome-profile-form"><div class="form-grid"><label class="field">Уровень<select name="level"><option value="beginner">Начинаю</option><option value="intermediate">Играю регулярно</option><option value="advanced">Опытный игрок</option></select></label><label class="field">Главная цель<input name="goal" maxlength="120" placeholder="Например, увереннее играть матч"></label><label class="field">Сколько тренировок обычно в неделю<input name="sessions_per_week" type="number" min="0" max="14" value="2" required></label><label class="field">Ближайший матч · необязательно<input name="next_match" type="date" min="${today()}"></label></div><p class="form-error" role="alert"></p><div class="form-actions"><button type="button" class="btn secondary" data-close>Заполню позже</button><button type="submit" class="btn lime">Сохранить профиль →</button></div></form>`);
  $('#welcome-profile-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.target, f=new FormData(form), button=$('[type=submit]',form);button.disabled=true;$('.form-error',form).textContent='';try{await api('/me/context',{level:f.get('level'),goal:f.get('goal'),sessions_per_week:+f.get('sessions_per_week'),next_match:f.get('next_match')||null},'PUT');current=await api('/me/state');$('#modal').close();await render();toast('Профиль сохранён');}catch(error){$('.form-error',form).textContent=error.message;}finally{button.disabled=false;}});
}

// Делегирование событий не требует повторного навешивания после каждой отрисовки.
document.addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button)return;
  if(button.hasAttribute('data-close'))return $('#modal').close();
  if(button.dataset.page){location.hash=button.dataset.page;return;}
  if(button.dataset.checkin)return checkinDialog(button.dataset.checkin);
  if(button.dataset.coach)return safely(()=>coachDialog(button.dataset.coach));
  if(button.dataset.liveReport)return safely(()=>liveReport(button.dataset.liveReport));
  if(button.dataset.reflect)return reflectionDialog(button.dataset.reflect);
  if(button.dataset.role){signupRole=button.dataset.role;return onboarding();}
  if(button.dataset.scenario)return safely(async()=>{button.disabled=true;try{current=await api('/scenario/'+selected,{name:button.dataset.scenario});await render();toast('Демо-сценарий применён');}finally{button.disabled=false;}});
  const action=button.dataset.action;
  if(action==='ai-advice')return safely(async()=>{localStorage.setItem('rg_ai_consent_'+account.email,'yes');button.disabled=true;await loadAdvice(true);button.disabled=false;});
  if(action==='explain-rpe')return explainRpe();
  if(action==='theme-toggle'){
    const next=document.documentElement.dataset.theme==='dark'?'light':'dark';
    document.documentElement.dataset.theme=next;
    try{localStorage.setItem('rg_theme',next);}catch{/* В приватном режиме тема действует до закрытия вкладки. */}
    syncThemeButton();return;
  }
  if(action==='start')return safely(async()=>{button.disabled=true;try{mode='demo';await api('/demo',{});current=await api('/state/'+selected);await render();}finally{button.disabled=false;}});
  if(action==='auth-toggle'){authView=authView==='login'?'signup':'login';return onboarding();}
  if(action==='auth-recover'){authView='recover';return onboarding();}
  if(action==='account'){mode='personal';current=null;authView='login';return onboarding();}
  if(action==='logout')return safely(async()=>{await api('/auth/logout',{});current=null;account=null;mode='personal';authView='login';onboarding();toast('Ты вышел из аккаунта');});
  if(action==='copy-code')return safely(async()=>{await navigator.clipboard.writeText(account.coach_code);toast('Код скопирован');});
  if(action==='telegram-link')return safely(async()=>{const result=await api('/coach/telegram-link');modal('Подключить Telegram',`<p>Открой бота и нажми Start. Ссылка действует 10 минут.</p><a class="btn lime" href="${esc(result.url)}" target="_blank" rel="noopener">Открыть бота →</a>`);});
  if(action==='disconnect-coach')return safely(async()=>{await api('/me/coach',undefined,'DELETE');account=await api('/me/profile');await render();toast('Доступ тренера отозван');});
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
  const recovering=fragment.get('type')==='recovery';
  if(fragment.has('access_token')){
    const tokens={access_token:fragment.get('access_token'),refresh_token:fragment.get('refresh_token')};
    history.replaceState(null,'',location.pathname+'#today');
    await api('/auth/session',tokens);
  }
  if(recovering){authView='reset';current=null;onboarding();return;}
  try{await loadAccount();}catch(error){if(error.status!==401)throw error;current=null;account=null;}
  await render();
});
