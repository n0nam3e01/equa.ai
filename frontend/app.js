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
const nav = [['today','Сегодня','home'],['learn','Мой путь','path'],['practice','Практики','play'],['progress','Моя динамика','chart'],['assistant','AI-помощник','chat'],['coach','Обзор тренера','team']];
let page = 'today', current = null, catalog = [], health = {}, selected = sessionStorage.getItem('rg_player') || 'alex';
let routeVersion = 0, toastTimer;
const fmtDate = value => new Date(value+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

async function api(path, data, method) {
  const response = await fetch('/api'+path,{method:method || (data === undefined ? 'GET':'POST'),
    headers:data === undefined ? {} : {'Content-Type':'application/json'},body:data === undefined ? undefined : JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) {
    const details = typeof result.detail === 'string' ? result.detail : 'Проверь поля формы: значения не прошли проверку.';
    throw new Error(details);
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
function lessonIcon(id){return {focus:'target',reset:'mind',serve:'ball',ritual:'play'}[id];}
function navRender(){
  $('#desktop-nav').innerHTML=nav.map(([id,name,i])=>`<a class="nav-link ${page===id?'active':''}" href="#${id}" ${page===id?'aria-current="page"':''}>${icon(i)}${name}</a>`).join('');
  $('#mobile-nav').innerHTML=[...nav.slice(0,3),['settings','Профиль','settings']].map(([id,name,i])=>`<a class="nav-link ${page===id?'active':''}" href="#${id}" ${page===id?'aria-current="page"':''}>${icon(i)}${name}</a>`).join('');
  $('#breadcrumb').textContent=nav.find(n=>n[0]===page)?.[1] || 'RallyGuard';
}

function weeklyChart(checks) {
  const values=checks.slice(-7);
  if(!values.length)return '<p class="empty">График появится после первого чек-ина.</p>';
  const pts=values.map((x,i)=>[20+i*(220/Math.max(1,values.length-1)),150-(x.energy-1)*30]);
  return `<svg class="chart" viewBox="0 0 260 175" role="img" aria-label="Энергия за последние ${values.length} отчётов: ${values.map(x=>x.energy).join(', ')} из 5">${[30,60,90,120,150].map(y=>`<path d="M20 ${y}H245" stroke="#e8ece3" stroke-width="1"/>`).join('')}<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#285e48" stroke-width="2"/>${pts.map(([x,y],i)=>`${i===pts.length-1?`<circle cx="${x}" cy="${y}" r="10" fill="#e1ed89"/>`:''}<circle cx="${x}" cy="${y}" r="3.5" fill="#173f35"/>`).join('')}</svg><div class="chart-labels">${values.map(x=>`<span>${fmtDate(x.date)}</span>`).join('')}</div><div class="legend"><i></i> Энергия · самооценка от 1 до 5</div>`;
}

function home(){
  const a=current.assessment;
  return header(`Привет, ${current.player.name}`, 'Твой следующий шаг на корте',`<div class="date-label">${new Date().toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long'})}<br>В своём темпе</div>`)+`
  <div class="dashboard"><div class="main-column">
    <section class="hero"><div class="hero-content"><span class="eyebrow">ПЕРЕД МАТЧЕМ</span><h2>В игру —<br>с ясной головой</h2><p>Короткая практика, чтобы настроиться на следующий мяч.</p><button class="btn lime" data-action="prepare">Подготовиться к матчу <span>→</span></button></div></section>
    <section class="panel"><div class="panel-head"><h2>Как ты сегодня?</h2><small>30 секунд</small></div><p>Небольшая проверка, чтобы лучше понять своё состояние.</p><div class="mood-options">${[['sun','Полон сил','good'],['neutral','Немного устал','tired'],['moon','Хочу передохнуть','rest']].map(([i,t,v])=>`<button class="mood" data-checkin="${v}">${icon(i)}<span>${t}</span></button>`).join('')}</div></section>
    <section class="panel"><div class="panel-head"><h2>Мой путь</h2><small>${current.completed.length} из ${catalog.length} уроков</small></div><p>Учись понимать игру. Один небольшой шаг за раз.</p><div class="lesson-grid">${catalog.slice(0,3).map((l,i)=>`<button class="lesson-card ${i===0?'featured':''} ${current.completed.includes(l.id)?'completed':''}" data-lesson="${l.id}"><span class="number">${current.completed.includes(l.id)?'✓':i+1}</span>${icon(lessonIcon(l.id))}<strong>${esc(l.title)}</strong><small>${l.minutes} мин · ${current.completed.includes(l.id)?'Пройдено':'Мини-урок'}</small></button>`).join('')}</div><div class="progress-track" aria-label="Пройдено ${current.completed.length} из ${catalog.length}">${catalog.map(l=>`<span class="${current.completed.includes(l.id)?'done':''}"></span>`).join('')}</div></section>
    <section class="panel"><div class="panel-head"><h2>Твой следующий шаг</h2>${status(a)}</div><h3 style="margin-top:18px">${esc(a.plan.title)}</h3><p>${esc(a.plan.description)}</p><div class="split-actions"><button class="btn secondary" data-page="practice">Открыть предложение →</button><button class="text-button" data-action="training">Как прошло занятие?</button></div>${current.decisions.length?`<div class="decision"><small>Предложение тренера</small>${esc(current.decisions.at(-1).note)}</div>`:''}</section>
  </div><aside class="right-column">
    <section class="panel weekly-panel"><div class="panel-head"><h2>На этой неделе</h2><button class="text-button" data-page="progress" aria-label="Открыть динамику">↗</button></div>${weeklyChart(current.checkins)}</section>
    <section class="panel"><h2>Что мешает игре?</h2><p>Выбери то, что сейчас актуально.</p><button class="prompt-button" data-lesson="ritual">${icon('mind')}<span>Волнуюсь перед матчем</span><span>›</span></button><button class="prompt-button" data-lesson="reset">${icon('target')}<span>Злюсь после ошибок</span><span>›</span></button><p class="side-caption">Навык можно тренировать<br>и за пределами корта.</p></section>
    <section class="panel"><span class="eyebrow">ТВОЁ СОСТОЯНИЕ</span><div style="margin:14px 0">${status(a)}</div><p>${esc(a.factors[0])}</p><button class="text-button" data-page="progress">Посмотреть причины →</button></section>
  </aside></div>`;
}

function learn(){return header('Мой путь','Небольшие уроки. Больше уверенности в своей игре.')+`<div class="notice">Прогресс сохраняется за обучение, а не за ежедневную физическую нагрузку. Все уроки можно проходить в своём темпе.</div><div class="cards">${catalog.map((l,i)=>`<section class="panel course-card"><div class="course-art">${icon(lessonIcon(l.id))}</div><span class="eyebrow" style="margin-top:20px">${l.tag} · ${l.minutes} МИН</span><h2>${i+1}. ${esc(l.title)}</h2><p>${esc(l.intro)}</p><button class="btn ${current.completed.includes(l.id)?'secondary':'lime'}" data-lesson="${l.id}">${current.completed.includes(l.id)?'Повторить урок ✓':'Начать урок →'}</button></section>`).join('')}</div>`;}

function practice(){const a=current.assessment;return header('Практики','Один понятный акцент на следующее занятие.')+`<div class="page-grid"><section class="panel">${status(a)}<h2 style="font-size:28px;margin-top:22px">${esc(a.plan.title)}</h2><p>${esc(a.plan.description)}</p><ol class="plan-steps">${a.plan.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol><button class="btn lime" data-lesson="${a.plan.lesson}">Открыть подходящий урок →</button><div class="notice">Это предложение прототипа, не индивидуальное назначение физической нагрузки. При недостатке данных план не означает допуск к тренировке.</div></section><section class="panel"><h2>Почему этот вариант?</h2><ul class="factor-list">${a.factors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p class="score-explainer">${esc(a.quality)}</p><button class="btn outline" data-checkin="good">Обновить чек-ин</button></section><section class="panel wide"><div class="panel-head"><h2>После занятия</h2><span class="eyebrow">ОБРАТНАЯ СВЯЗЬ</span></div><p>Запиши длительность, ощущение нагрузки и концентрацию. Это дополнит картину твоей недели.</p><button class="btn" data-action="training">Добавить тренировку →</button>${current.decisions.map(d=>`<div class="decision"><small>Тренер · ${esc(new Date(d.created_at).toLocaleDateString('ru-RU'))}</small>${esc(d.note)}</div>`).join('')}</section></div>`;}

function progress(){const a=current.assessment;return header('Моя динамика','Сравнивай себя с собой. Замечай изменения.',`<button class="btn secondary" data-checkin="good">+ Чек-ин</button>`)+`
  <div class="stat-row"><div class="stat"><small>Индекс состояния</small><strong>${a.score??'—'}<small>${a.score===null?'':' / 100'}</small></strong>${status(a)}</div><div class="stat"><small>Нагрузка за 7 дней</small><strong>${a.load}</strong><small>минуты × RPE · усл. ед.</small></div><div class="stat"><small>Полнота недели</small><strong>${a.reported_days}<small> / 7 дней</small></strong><small>Дни с чек-ином</small></div></div>
  <div class="page-grid"><section class="panel"><h2>Энергия по последним отчётам</h2>${weeklyChart(current.checkins)}<div class="notice">Демонстрационная история, не результаты реального пилота.</div></section><section class="panel"><h2>Что повлияло на оценку</h2><ul class="factor-list">${a.factors.map(f=>`<li>${esc(f)}</li>`).join('')}</ul><p class="score-explainer">${esc(a.quality)}. Индекс — описательная формула, не вероятность травмы или выгорания.</p><details><summary>Как считается индекс</summary><p class="score-explainer">100 − (5 − энергия) × 7 − (усталость − 1) × 6 − (стресс − 1) × 5 − дискомфорт × 3. Результат ограничен 0–100. При ограничении движения сигнал внимания имеет приоритет. Пороги демонстрационные и требуют проверки специалистом.</p></details></section>
  <section class="panel wide"><h2>История занятий</h2>${current.trainings.length?`<div class="table-wrap"><table><thead><tr><th>Дата</th><th>Занятие</th><th>Минуты</th><th>RPE</th><th>Нагрузка</th><th>Фокус</th></tr></thead><tbody>${[...current.trainings].reverse().slice(0,20).map(s=>`<tr><td>${fmtDate(s.date)}</td><td>${{court:'Корт',match:'Матч',fitness:'ОФП'}[s.kind]}</td><td>${s.minutes}</td><td>${s.rpe}/10</td><td>${s.minutes*s.rpe}</td><td>${s.focus}/5</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">Занятий пока нет.</p>'}<button class="text-button" data-action="training">+ Записать занятие</button></section></div>`;}

function assistant(){return header('AI-помощник','Поможет разобраться в учебных материалах RallyGuard.')+`<section class="panel"><div class="panel-head"><h2>Обсудим твою игру</h2><span class="status ${health.ai_available?'steady':'unknown'}">${health.ai_available?'Groq подключён':'Ключ API не добавлен'}</span></div><div class="notice">${health.ai_available?'Отправляя вопрос, ты передаёшь его в Groq. Профиль и показатели автоматически не передаются. Не включай личные медицинские сведения.':'AI-ответы появятся после настройки серверного GROQ_API_KEY. Сейчас доступны настоящие уроки, формы и расчёты — ответы модели не имитируются.'}</div><div class="split-actions"><button class="btn outline" data-lesson="reset">Урок «После ошибки»</button><button class="btn outline" data-lesson="ritual">Подготовка к матчу</button></div><div class="chat-log" id="chat-log" aria-live="polite"><div class="bubble">Выбери материал выше или задай вопрос о концентрации и правилах игры. Помощник не ставит диагнозы.</div></div><form id="chat-form" class="chat-form"><label class="skip" for="chat-text">Твой вопрос</label><input id="chat-text" name="text" placeholder="Как переключиться после неудачного розыгрыша?" minlength="2" maxlength="2000" required ${health.ai_available?'':'disabled'}><button class="btn" ${health.ai_available?'':'disabled'}>Отправить →</button></form></section>`;}

async function coach(){
  const data=await api('/team');
  const order={attention:0,caution:1,unknown:2,steady:3};
  return header('Обзор тренера','Кому сегодня стоит уделить внимание?')+`<div class="notice">Демо-роль тренера: только три вымышленных игрока в твоей изолированной сессии. Подключение настоящего тренера и Telegram пока не настроены.</div><section class="panel"><div class="panel-head"><h2>Моя группа</h2><small>3 игрока · демо</small></div>${data.players.sort((a,b)=>order[a.assessment.level]-order[b.assessment.level]).map(s=>`<div class="coach-row"><span class="avatar">${s.player.initials}</span><div class="info"><strong>${s.player.name}</strong><small>${s.player.goal}</small><small>Чек-ин: ${s.checkins.at(-1)?fmtDate(s.checkins.at(-1).date):'нет'} · ${s.assessment.reported_days}/7 дней</small></div>${status(s.assessment)}<button class="btn outline small" data-coach="${s.player.id}">Посмотреть →</button></div>`).join('')}</section>`;
}

function settings(){return header('Профиль и демо','Управление данными и сценариями для проверки MVP.')+`<div class="page-grid"><section class="panel"><div class="settings-block"><h3>Демонстрационный игрок</h3><p>Переключение не даёт доступ к данным других посетителей.</p><label class="field">Игрок<select id="player-select">${[['alex','Алекс'],['mira','Мира'],['timur','Тимур']].map(([id,n])=>`<option value="${id}" ${id===selected?'selected':''}>${n}</option>`).join('')}</select></label></div><div class="settings-block"><h3>Три сценария состояния</h3><p>Заменяют сегодняшний чек-ин выбранного демо-игрока. Остальная история сохраняется.</p><div class="split-actions"><button class="btn secondary small" data-scenario="steady">Обычный ритм</button><button class="btn secondary small" data-scenario="tired">Усталость</button><button class="btn secondary small" data-scenario="attention">Нужен разговор</button></div></div><div class="settings-block"><h3>Импорт показателей</h3><p>JSON с массивом checkins, максимум 90 записей и 100 КБ. Только вымышленные данные для демо.</p><label class="field">Файл JSON<input id="import-file" type="file" accept=".json,application/json"></label><button class="text-button" data-action="sample">Скачать пример JSON</button></div></section><section class="panel"><h3>Хранение и AI</h3><p>${health.database==='supabase'?'Supabase · PostgreSQL':'SQLite · '+(health.ephemeral?'временное облачное хранение':'локальное хранение')}</p>${health.ephemeral?'<div class="notice">История может исчезнуть или отличаться между экземплярами Vercel. Для постоянного демо подключите Supabase.</div>':''}<p>AI: ${health.ai_available?'Groq подключён':'не настроен; основной сценарий доступен'}</p><p class="score-explainer">Сессия хранится в защищённой cookie до 7 дней. Это изолированная песочница, а не регистрация реальных спортсменов. Не вводи персональные данные о здоровье.</p><div class="split-actions"><a class="btn outline" href="/api/export" download>Экспортировать данные</a><button class="btn danger" data-action="delete">Удалить мою демо-сессию</button></div><hr style="border:0;border-top:1px solid var(--line);margin:24px 0"><button class="btn secondary" data-page="coach">Открыть обзор тренера →</button><button class="text-button" data-page="progress">Моя динамика →</button><br><button class="text-button" data-page="assistant">AI-помощник →</button></section></div>`;}

function about(){return header('О RallyGuard','Рабочий прототип для Overclock Hackathon · BioTech')+`<div class="page-grid"><section class="panel"><h2>Игрок в центре</h2><p>Приложение для любителя: короткий чек-ин, учебный путь, предложение на следующее занятие и обратная связь. Тренер видит сигналы и может предложить изменение плана.</p><h3>Что можно проверить</h3><ol class="plan-steps"><li>Сохранить чек-ин и посмотреть объяснение.</li><li>Пройти урок с вопросом.</li><li>Записать тренировку и увидеть нагрузку.</li><li>Предложить изменение в обзоре тренера.</li><li>Проверить три сценария в профиле.</li></ol><button class="btn lime" data-page="today">Вернуться на корт →</button></section><section class="panel"><h2>Честные границы</h2><p>Все стартовые профили вымышлены. Пороги индекса — демонстрационные правила; клиническая точность и снижение травматизма не исследованы.</p><p>Приложение не определяет причину боли, не диагностирует выгорание и не выдаёт медицинский допуск к нагрузке. Предложения по физической части требуют обсуждения с тренером или специалистом.</p><h3>Источники уроков</h3>${catalog.map(l=>`<p><a href="${esc(l.source)}" target="_blank" rel="noopener noreferrer">${esc(l.source_name)} ↗</a></p>`).join('')}<p class="score-explainer">Краткие авторские пересказы. Видео и статьи открываются у оригинального издателя. Изображение корта создано AI для оформления.</p></section></div>`;}

function onboarding(){navRender();$('#main').innerHTML=`<div class="onboarding"><section class="hero"><div class="hero-content"><span class="eyebrow">ТЕННИС В ТВОЁМ ТЕМПЕ</span><h2>Больше ясности.<br>Больше игры.</h2><p>Концентрация, маленькие уроки и внимание к своему состоянию.</p><button class="btn lime" data-action="start">Попробовать демо →</button></div></section><section class="panel"><h2>Твой следующий шаг на корте</h2><div class="intro-list"><div>${icon('sun')}<strong>Замечай состояние</strong><p>Короткий чек-ин и понятная история нагрузки.</p></div><div>${icon('target')}<strong>Учись по чуть-чуть</strong><p>Рутина между розыгрышами, фокус и правила.</p></div><div>${icon('team')}<strong>Обсуждай изменения</strong><p>Предложения тренера и обратная связь игрока.</p></div></div><div class="notice">Это демо хакатона с вымышленными игроками. Создадим отдельную сессию в cookie для сохранения твоих действий. Не вводи реальные сведения о здоровье. Индекс не является медицинской оценкой.</div></section></div>`;}

async function render(){
  const revision=++routeVersion; page=location.hash.slice(1)||'today';navRender();
  if(!current)return onboarding();
  const views={today:home,learn,practice,progress,assistant,coach,settings,about};
  const html=await (views[page]||home)();
  if(revision!==routeVersion)return;
  $('#main').innerHTML=html; $('#sidebar-name').textContent=current.player.name;
  $('#player-select')?.addEventListener('change',e=>safely(async()=>{selected=e.target.value;sessionStorage.setItem('rg_player',selected);current=await api('/state/'+selected);await render();}));
  $('#import-file')?.addEventListener('change',e=>safely(async()=>{
    const f=e.target.files[0];if(!f)return;if(f.size>100000)throw Error('Файл больше 100 КБ');
    let body;try{body=JSON.parse(await f.text());}catch{throw Error('Не удалось прочитать JSON. Используй файл-пример.');}
    current=await api('/import/'+selected,body);await render();toast('Показатели импортированы');
  }));
  $('#chat-form')?.addEventListener('submit',async e=>{
    e.preventDefault();const input=$('#chat-text'),text=input.value.trim();if(!text)return;
    const button=$('button',e.target);button.disabled=true;
    $('#chat-log').insertAdjacentHTML('beforeend',`<div class="bubble user">${esc(text)}</div>`);input.value='';
    try{const result=await api('/chat',{text});$('#chat-log').insertAdjacentHTML('beforeend',`<div class="bubble">${esc(result.answer)}</div>`);}
    catch(err){$('#chat-log').insertAdjacentHTML('beforeend',`<div class="bubble">${esc(err.message)}</div>`);}
    finally{button.disabled=false;$('#chat-log').scrollTop=$('#chat-log').scrollHeight;}
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
function lessonDialog(id){
  const l=catalog.find(l=>l.id===id);if(!l)return;
  modal(l.title,`<span class="eyebrow">${l.tag} · ${l.minutes} МИН</span><p style="margin-top:16px">${esc(l.intro)}</p><ol class="lesson-steps">${l.steps.map(s=>`<li>${esc(s)}</li>`).join('')}</ol><form id="modal-form" class="quiz"><h3>${esc(l.question)}</h3>${l.options.map((o,i)=>`<label><input type="radio" name="choice" value="${i}" required>${esc(o)}</label>`).join('')}<p class="form-error" role="alert"></p><div id="quiz-result" role="status"></div><div class="form-actions"><button type="submit" class="btn lime">Проверить ответ →</button></div></form><a class="source" href="${esc(l.source)}" target="_blank" rel="noopener noreferrer">Материал: ${esc(l.source_name)} ↗</a>`);
  formBind(`/lessons/${id}/${selected}`,f=>({choice:+f.get('choice')}),async result=>{
    $('#quiz-result').innerHTML=`<div class="notice">${result.correct?'✓ ':''}${esc(result.explanation)}</div>`;
    if(result.correct){current=await api('/state/'+selected);await render();$('button[type=submit]',$('#modal-form')).textContent='Пройдено ✓';toast('Ещё один шаг в твоём пути');}
  });
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
  if(button.dataset.lesson)return lessonDialog(button.dataset.lesson);
  if(button.dataset.coach)return safely(()=>coachDialog(button.dataset.coach));
  if(button.dataset.scenario)return safely(async()=>{button.disabled=true;try{current=await api('/scenario/'+selected,{name:button.dataset.scenario});await render();toast('Демо-сценарий применён');}finally{button.disabled=false;}});
  const action=button.dataset.action;
  if(action==='start')return safely(async()=>{button.disabled=true;try{await api('/demo',{});current=await api('/state/'+selected);await render();}finally{button.disabled=false;}});
  if(action==='training')return trainingDialog();
  if(action==='prepare')return lessonDialog('ritual');
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
  [health,catalog]=await Promise.all([api('/health'),api('/lessons')]);
  try{current=await api('/state/'+selected);}catch{current=null;}
  await render();
});
