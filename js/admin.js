// Каталог услуг — общий, в js/services.js (подключается до этого файла).
// Здесь он нужен только форме «Записать клиента»; карточки записей
// показывают название, цену и длительность из самой брони — то, что было
// выбрано в момент записи, даже если прайс с тех пор поменялся.

// Различаем "Классический массаж" тела (60/90 мин) и лица (30 мин) —
// в каталоге имя специально одинаковое, отличаем по длительности.
function disambiguateServiceName(name, duration){
  if (name !== 'Классический массаж') return name;
  return duration === 30 ? 'Классический массаж (лицо)' : 'Классический массаж (тело)';
}
// ============================================================
// Примечание: уведомления в Telegram теперь отправляются на стороне
// Cloud Function (внутри createBooking/deleteBooking), а не из браузера.
// Это решает проблему блокировки api.telegram.org у части клиентов —
// сервер не подчиняется тем же сетевым ограничениям, что у конечного
// пользователя без VPN.
// ============================================================

// ============================================================
// ОБЩИЕ УТИЛИТЫ ДАТЫ/ВРЕМЕНИ
// ============================================================

function pad(n){ return n.toString().padStart(2,'0'); }
function dateKeyFromParts(y,m,d){ return `${y}-${pad(m+1)}-${pad(d)}`; }
function dateKeyFromDate(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function todayKey(){ const t = new Date(); return dateKeyFromParts(t.getFullYear(), t.getMonth(), t.getDate()); }
function timeToMinutes(t){ const [h,m] = t.split(':').map(Number); return h*60+m; }
function minutesToTime(mins){ const h = Math.floor(mins/60); const m = mins%60; return `${pad(h)}:${pad(m)}`; }

// Экранируем спецсимволы перед вставкой данных клиента в innerHTML.
// Это критично именно здесь: пароль админа лежит в sessionStorage этой
// страницы, и без экранирования вредоносное имя/комментарий в брони
// могли бы выполнить скрипт прямо в сессии Дарьи и увести пароль.
// Бэкенд теперь тоже режет угловые скобки на входе — это резервный слой.
function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ============================================================
// СТРОКА «КЛИЕНТ · ТЕЛЕФОН» + КНОПКА КОПИРОВАНИЯ
// ============================================================

// В буфер кладём номер без скобок и пробелов (+79001234567) — такой формат
// без правки вставляется в звонилку, WhatsApp и поиск по контактам.
function phoneForCopy(phone){
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return String(phone ?? '');
  return '+7' + digits.slice(-10);
}

// Общая разметка строки с клиентом. name можно не передавать (заявки на абонемент).
function clientLine(name, phone){
  const label = name ? `${escapeHtml(name)} · ${escapeHtml(phone)}` : escapeHtml(phone);
  return `
    <div class="booking-client">
      <span>${label}</span>
      <button class="copy-phone-btn" type="button" data-phone="${escapeHtml(phoneForCopy(phone))}" title="Скопировать телефон" aria-label="Скопировать телефон">📋</button>
    </div>
  `;
}

async function copyToClipboard(text){
  // Основной путь — Clipboard API (сайт на https, работает во всех свежих браузерах)
  try{
    if (navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch(e){ /* падаем в запасной вариант ниже */ }

  // Запасной вариант для старых браузеров и небезопасного контекста
  try{
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }catch(e){ return false; }
}

// Один обработчик на весь документ — работает в любой карточке (записи,
// «ждут отметки», история, заявки), в том числе в перерисованных списках.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy-phone-btn');
  if (!btn) return;
  e.stopPropagation();

  const ok = await copyToClipboard(btn.dataset.phone || '');
  btn.textContent = ok ? '✓' : '✕';
  btn.classList.toggle('copied', ok);
  setTimeout(() => {
    btn.textContent = '📋';
    btn.classList.remove('copied');
  }, 1200);
});

// ============================================================
// ОБЩЕЕ ХРАНИЛИЩЕ (используется и клиентом, и мастером)
// ============================================================

// ============================================================
// НАСТРОЙКИ YANDEX CLOUD FUNCTION (заменяет Supabase)
// ============================================================
const API_URL = 'https://api.rai-krd.ru';

let currentAdminPassword = '';

async function callApi(action, extra){
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, adminPassword: currentAdminPassword, ...extra })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok){
    throw new Error('api-error: ' + (data.error || res.status));
  }
  return data;
}

const Store = {
  schedule: {},
  bookings: [],
  lastSeenAt: null,

  async loadSchedule(){
    try{
      const data = await callApi('getSchedule');
      this.schedule = data.schedule || {};
    }catch(e){
      console.error('loadSchedule error:', e);
      this.schedule = {};
    }
  },

  async loadBookings(){
    try{
      const data = await callApi('getBookings');
      this.bookings = data.bookings || [];
      this.lastSeenAt = data.lastSeenAt || null;
    }catch(e){
      console.error('loadBookings error:', e);
      this.bookings = [];
    }
  },

  async markBookingsSeen(){
    await callApi('markBookingsSeen');
    this.lastSeenAt = new Date().toISOString();
  },

  // Persist the full in-memory schedule in one call — the function overwrites
  // schedule.json entirely, so removed days are dropped automatically.
  async saveSchedule(){
    await callApi('saveSchedule', { schedule: this.schedule });
  },

  async deleteScheduleDay(dateKey){
    // Already handled by saveSchedule() overwriting the whole object —
    // kept as a no-op for compatibility with existing call sites.
  },

  // Не через callApi: на 409 сервер присылает список пересечений, и он нужен
  // форме целиком, а callApi оставляет от ответа только код ошибки.
  async createMasterBooking(payload){
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'createMasterBooking', adminPassword: currentAdminPassword, ...payload })
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  },

  async deleteBooking(bookingId, options){
    await callApi('deleteBooking', { bookingId, notifyCancellation: !!(options && options.notifyCancellation) });
  },

  async updateBooking(bookingId, { date, start, end }){
    await callApi('updateBookingTime', { bookingId, date, start, end });
  },

  async markBooking(bookingId, status, actual){
    await callApi('markBooking', { bookingId, status, ...(actual ? { actual } : {}) });
  },

  async editHistoryEntry(bookingId, status, actual){
    await callApi('editHistoryEntry', { bookingId, status, ...(actual ? { actual } : {}) });
  },

  async getCourses(){
    const data = await callApi('getCourses');
    return data.courses || [];
  },

  async saveCourse(course){
    const data = await callApi('saveCourse', { course });
    return data.course;
  },

  async deleteCourse(courseId){
    await callApi('deleteCourse', { courseId });
  },

  async getHistory(){
    const data = await callApi('getHistory');
    return data.history || [];
  },

  async getClients(){
    const data = await callApi('getClients');
    return data.clients || {};
  },

  async saveClientNote(phone, notes){
    await callApi('saveClientNote', { phone, notes });
  },

  async getPackageLeads(){
    const data = await callApi('getPackageLeads');
    return data.leads || [];
  },

  async markPackageLeadDone(leadId){
    await callApi('markPackageLeadDone', { leadId });
  },

  async exportHistoryCsv(){
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'exportHistory', adminPassword: currentAdminPassword })
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rai-history.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
};

function withTimeout(promise, ms){
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
  return Promise.race([promise, timeout]);
}

// ============================================================



// ============================================================
// ===================   ADMIN-SIDE LOGIC   ===================
// ============================================================

const DOW_FULL = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
const MONTH_SHORT = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

const adminState = { weekOffset: 0 };

function getMondayOfWeek(offset){
  const now = new Date();
  now.setHours(0,0,0,0);
  const dow = now.getDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday + offset*7);
  return monday;
}

function renderWeek(){
  const monday = getMondayOfWeek(adminState.weekOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate()+6);

  document.getElementById('weekLabel').textContent =
    `${monday.getDate()} ${MONTH_SHORT[monday.getMonth()]} – ${sunday.getDate()} ${MONTH_SHORT[sunday.getMonth()]}`;

  document.getElementById('prevWeek').disabled = adminState.weekOffset <= 0;

  const list = document.getElementById('daysList');
  list.innerHTML = '';

  for (let i=0; i<7; i++){
    const d = new Date(monday);
    d.setDate(monday.getDate()+i);
    const key = dateKeyFromDate(d);
    const existingIntervals = Array.isArray(Store.schedule[key]) ? Store.schedule[key] : [];
    const isOn = existingIntervals.length > 0;

    const row = document.createElement('div');
    row.className = 'day-row';
    row.dataset.key = key;

    const intervalsHtml = isOn
      ? existingIntervals.map((iv, idx) => renderIntervalRow(key, idx, iv)).join('')
      : renderIntervalRow(key, 0, { start: '10:00', end: '19:00' });

    row.innerHTML = `
      <div class="day-info-row">
        <div class="day-info">
          <div class="day-name">${DOW_FULL[i]}</div>
          <div class="day-date">${d.getDate()} ${MONTH_SHORT[d.getMonth()]}</div>
        </div>
        <div class="toggle ${isOn?'on':''}" data-key="${key}"></div>
        <span class="day-off-label" data-off-label="${key}" style="display:${isOn?'none':'inline'};">выходной</span>
      </div>
      <div class="intervals-wrap" data-intervals-for="${key}" style="display:${isOn?'block':'none'};">
        <div class="intervals-list" data-list-for="${key}">${intervalsHtml}</div>
        <button class="add-interval-btn" data-add-for="${key}" type="button">+ добавить интервал</button>
      </div>
    `;
    list.appendChild(row);
  }

  wireUpDayRows(list);
}

function renderIntervalRow(dayKey, idx, interval){
  return `
    <div class="interval-row" data-day="${dayKey}" data-idx="${idx}">
      <input type="time" class="time-input start-time" value="${interval.start}">
      <span class="time-sep">—</span>
      <input type="time" class="time-input end-time" value="${interval.end}">
      <button class="remove-interval-btn" data-remove-day="${dayKey}" data-remove-idx="${idx}" type="button" aria-label="Удалить интервал">✕</button>
    </div>
  `;
}

function wireUpDayRows(list){
  // Day on/off toggle
  list.querySelectorAll('.toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const key = toggle.dataset.key;
      const isNowOn = !toggle.classList.contains('on');
      toggle.classList.toggle('on');
      const wrap = list.querySelector(`.intervals-wrap[data-intervals-for="${key}"]`);
      const offLabel = list.querySelector(`[data-off-label="${key}"]`);
      wrap.style.display = isNowOn ? 'block' : 'none';
      offLabel.style.display = isNowOn ? 'none' : 'inline';

      // If turning on a day that has no interval rows yet, add a default one
      if (isNowOn){
        const intervalsList = list.querySelector(`.intervals-list[data-list-for="${key}"]`);
        if (intervalsList.children.length === 0){
          intervalsList.insertAdjacentHTML('beforeend', renderIntervalRow(key, 0, { start:'10:00', end:'19:00' }));
          wireUpRemoveButtons(list);
        }
      }
    });
  });

  // Add interval buttons
  list.querySelectorAll('.add-interval-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.addFor;
      const intervalsList = list.querySelector(`.intervals-list[data-list-for="${key}"]`);
      const nextIdx = intervalsList.children.length;
      intervalsList.insertAdjacentHTML('beforeend', renderIntervalRow(key, nextIdx, { start:'10:00', end:'19:00' }));
      wireUpRemoveButtons(list);
    });
  });

  wireUpRemoveButtons(list);
}

function wireUpRemoveButtons(list){
  list.querySelectorAll('.remove-interval-btn').forEach(btn => {
    // avoid double-binding
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const row = btn.closest('.interval-row');
      const intervalsList = row.parentElement;
      // Don't allow removing the last remaining interval row while the day is "on" —
      // instead, removing the last one turns the day off entirely.
      if (intervalsList.children.length === 1){
        const dayKey = btn.dataset.removeDay;
        const toggle = list.querySelector(`.toggle[data-key="${dayKey}"]`);
        const wrap = list.querySelector(`.intervals-wrap[data-intervals-for="${dayKey}"]`);
        const offLabel = list.querySelector(`[data-off-label="${dayKey}"]`);
        toggle.classList.remove('on');
        wrap.style.display = 'none';
        offLabel.style.display = 'inline';
        intervalsList.innerHTML = '';
      } else {
        row.remove();
      }
    });
  });
}

function collectScheduleFromForm(){
  const monday = getMondayOfWeek(adminState.weekOffset);
  const list = document.getElementById('daysList');
  const daysToDelete = [];

  for (let i=0; i<7; i++){
    const d = new Date(monday);
    d.setDate(monday.getDate()+i);
    const key = dateKeyFromDate(d);

    const toggle = list.querySelector(`.toggle[data-key="${key}"]`);
    const isOn = toggle.classList.contains('on');

    if (isOn){
      const intervalsList = list.querySelector(`.intervals-list[data-list-for="${key}"]`);
      const rows = intervalsList.querySelectorAll('.interval-row');
      const intervals = [];
      rows.forEach(row => {
        const start = row.querySelector('.start-time').value;
        const end = row.querySelector('.end-time').value;
        if (start && end && start < end){
          intervals.push({ start, end });
        }
      });
      if (intervals.length > 0){
        Store.schedule[key] = intervals;
      } else {
        delete Store.schedule[key];
        daysToDelete.push(key);
      }
    } else {
      if (Store.schedule[key]) daysToDelete.push(key);
      delete Store.schedule[key];
    }
  }

  return daysToDelete;
}

async function saveScheduleHandler(){
  const daysToDelete = collectScheduleFromForm();

  // Soft validation: warn if intervals overlap within the same day
  const overlapDays = [];
  Object.entries(Store.schedule).forEach(([key, intervals]) => {
    if (!Array.isArray(intervals) || intervals.length < 2) return;
    const sorted = [...intervals].sort((a,b) => a.start.localeCompare(b.start));
    for (let i=0; i<sorted.length-1; i++){
      if (sorted[i].end > sorted[i+1].start){
        overlapDays.push(key);
        break;
      }
    }
  });

  if (overlapDays.length > 0){
    const proceed = confirm(
      `На некоторые дни интервалы пересекаются по времени (${overlapDays.join(', ')}). Сохранить как есть?`
    );
    if (!proceed) return;
  }

  const btn = document.getElementById('saveSchedule');
  const status = document.getElementById('saveStatus');
  btn.disabled = true;
  btn.textContent = 'Сохраняем...';
  status.style.color = 'var(--good)';
  status.textContent = '';

  try{
    // saveSchedule() перезаписывает весь schedule.json целиком, поэтому
    // удалённые дни (daysToDelete) уже не попадут в сохранённые данные —
    // отдельного вызова на удаление не требуется.
    await withTimeout(Store.saveSchedule(), 8000);
    status.textContent = '✓ Расписание сохранено';
    setTimeout(()=>{ status.textContent=''; }, 2500);
  }catch(e){
    console.error('Save schedule error:', e);
    const detail = (e && e.message) ? e.message : String(e);
    if (detail === 'timeout'){
      status.textContent = 'Сервер не отвечает — попробуйте снова';
    } else {
      status.textContent = 'Ошибка: ' + detail;
    }
    status.style.color = '#B07E7E';
  }
  btn.disabled = false;
  btn.textContent = 'Сохранить расписание';
}

function renderBookingsList(){
  const list = document.getElementById('bookingsList');
  const today = todayKey();

  const upcoming = Store.bookings
    .filter(b => b.date >= today)
    .sort((a,b) => (a.date+a.start).localeCompare(b.date+b.start));

  if (upcoming.length === 0){
    document.getElementById('bookingsCount').textContent = '';
    list.innerHTML = `<div class="empty-state">Пока нет предстоящих записей</div>`;
    return;
  }

  // Запись считается новой, если создана позже последнего просмотра.
  // Если мастер ещё ни разу не отмечал просмотр (lastSeenAt === null),
  // новыми считаются все записи.
  const lastSeen = Store.lastSeenAt ? new Date(Store.lastSeenAt).getTime() : 0;
  const isNew = (b) => {
    if (!b.createdAt) return false;
    if (b.source === 'master') return false; // свою же запись Дарья уже видела
    return new Date(b.createdAt).getTime() > lastSeen;
  };
  // Запись считается изменённой (перенесённой клиентом), если перенос
  // случился позже последнего просмотра — и она уже не «новая» (иначе
  // на свежесозданной брони дублировались бы сразу две плашки).
  const isChanged = (b) => {
    if (!b.rescheduledAt || isNew(b)) return false;
    return new Date(b.rescheduledAt).getTime() > lastSeen;
  };

  const newCount = upcoming.filter(isNew).length;

  document.getElementById('bookingsCount').textContent = `(${upcoming.length})`;

  list.innerHTML = '';

  // Панель со счётчиком новых записей + кнопкой «отметить просмотренными»
  if (newCount > 0){
    const banner = document.createElement('div');
    banner.className = 'new-bookings-banner';
    banner.innerHTML = `
      <span class="new-bookings-count">🔔 Новых записей: ${newCount}</span>
      <button class="mark-seen-btn" id="markSeenBtn">Отметить все как просмотренные</button>
    `;
    list.appendChild(banner);
    banner.querySelector('#markSeenBtn').addEventListener('click', async () => {
      const btn = banner.querySelector('#markSeenBtn');
      btn.disabled = true;
      btn.textContent = 'Отмечаем...';
      try{
        await withTimeout(Store.markBookingsSeen(), 8000);
        renderBookingsList();
      }catch(e){
        btn.disabled = false;
        btn.textContent = 'Отметить все как просмотренные';
        alert('Не удалось сохранить. Попробуйте снова.');
      }
    });
  }

  upcoming.forEach(b => {
    const d = new Date(b.date + 'T00:00:00');
    const dateStr = d.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'short' });

    const isReserve = b.kind === 'reserve';
    const badges =
      (isNew(b) ? ' <span class="new-badge">НОВАЯ</span>' : '') +
      (isChanged(b) ? ' <span class="changed-badge">ИЗМЕНЕНА</span>' : '') +
      (b.source === 'master' && !isReserve ? ' <span class="master-badge">САМА</span>' : '') +
      (isOutsideSchedule(b.date, b.start, b.end) ? ' <span class="offschedule-badge">ВНЕ ГРАФИКА</span>' : '');

    const card = document.createElement('div');
    card.className = 'booking-card' + (isNew(b) ? ' booking-new' : '') + (isReserve ? ' booking-reserve' : '');
    card.innerHTML = `
      <div class="booking-top">
        <span class="booking-date">${dateStr}${badges}</span>
        <span class="booking-time">${escapeHtml(b.start)}–${escapeHtml(b.end)}</span>
      </div>
      ${isReserve
        ? `<div class="booking-service">🔒 Резерв — время занято</div>`
        : `<div class="booking-service">${escapeHtml(disambiguateServiceName(b.serviceName, b.serviceDuration))} · ${b.servicePrice.toLocaleString('ru-RU')} ₽${b.courseId ? ' <span class="pay-tag">🎟 по курсу</span>' : ''}</div>
      ${b.courseId ? `<div class="course-line">🎟 «${escapeHtml(b.courseName || '')}»${b.servicePrice ? ` · доплата ${b.servicePrice.toLocaleString('ru-RU')} ₽` : ' · оплачено курсом'}</div>` : ''}
      ${clientLine(b.clientName, b.clientPhone)}`}
      ${b.comment ? `<div class="booking-comment">💬 ${escapeHtml(b.comment)}</div>` : ''}
      ${b.clientNotes ? `<div class="booking-comment client-note">📌 ${escapeHtml(b.clientNotes)}</div>` : ''}
      <div class="booking-actions">
        <button class="edit-booking-btn" data-booking-id="${escapeHtml(b.id)}">Изменить время</button>
        <button class="cancel-booking-btn" data-booking-id="${escapeHtml(b.id)}">${isReserve ? 'Снять резерв' : 'Отменить запись'}</button>
      </div>
      <div class="edit-form hidden" data-edit-for="${escapeHtml(b.id)}">
        <div class="edit-row">
          <input type="date" class="edit-date" value="${escapeHtml(b.date)}">
          <input type="time" class="edit-time" value="${escapeHtml(b.start)}">
        </div>
        <div class="edit-row">
          <button class="btn btn-primary edit-save-btn" data-booking-id="${escapeHtml(b.id)}" style="padding:10px; font-size:13px;">Сохранить</button>
          <button class="btn btn-ghost edit-cancel-btn" data-booking-id="${b.id}" style="padding:10px; font-size:13px;">Отмена</button>
        </div>
        <div class="save-status edit-status" data-status-for="${b.id}"></div>
      </div>
    `;
    list.appendChild(card);
  });

  list.querySelectorAll('.edit-booking-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.bookingId;
      list.querySelector(`.edit-form[data-edit-for="${id}"]`).classList.toggle('hidden');
    });
  });

  list.querySelectorAll('.edit-cancel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.bookingId;
      list.querySelector(`.edit-form[data-edit-for="${id}"]`).classList.add('hidden');
    });
  });

  list.querySelectorAll('.edit-save-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.bookingId;
      const form = list.querySelector(`.edit-form[data-edit-for="${id}"]`);
      const status = list.querySelector(`.edit-status[data-status-for="${id}"]`);
      const newDate = form.querySelector('.edit-date').value;
      const newStart = form.querySelector('.edit-time').value;

      if (!newDate || !newStart){
        status.textContent = 'Укажите дату и время';
        status.style.color = '#B07E7E';
        return;
      }

      const booking = Store.bookings.find(b => b.id === id);
      if (!booking) return;

      const newStartMinutes = timeToMinutes(newStart);
      const newEnd = minutesToTime(newStartMinutes + booking.serviceDuration);

      btn.disabled = true;
      btn.textContent = 'Сохраняем...';

      try{
        await withTimeout(Store.updateBooking(id, { date: newDate, start: newStart, end: newEnd }), 8000);
        booking.date = newDate;
        booking.start = newStart;
        booking.end = newEnd;
        renderBookingsList();
      }catch(e){
        status.textContent = 'Не удалось сохранить — проблема с подключением';
        status.style.color = '#B07E7E';
        btn.disabled = false;
        btn.textContent = 'Сохранить';
      }
    });
  });

  list.querySelectorAll('.cancel-booking-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.bookingId;
      const confirmed = confirm('Отменить эту запись? Время снова станет свободным для клиентов.');
      if (!confirmed) return;

      btn.disabled = true;
      btn.textContent = 'Отменяем...';

      const idx = Store.bookings.findIndex(b => b.id === id);
      if (idx === -1) return;

      try{
        await withTimeout(Store.deleteBooking(id), 8000);
        Store.bookings.splice(idx, 1);
        renderBookingsList();
      }catch(e){
        alert('Не удалось отменить запись — проблема с подключением. Попробуйте снова.');
        btn.disabled = false;
        btn.textContent = 'Отменить запись';
      }
    });
  });
}

function setupAdminTabs(){
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      ['scheduleTab','bookingsTab','historyTab','clientsTab','leadsTab','analyticsTab'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
      const activeEl = document.getElementById(target + 'Tab');
      if (activeEl) activeEl.classList.remove('hidden');

      if (target === 'bookings') renderBookingsList();
      if (target === 'history')  renderHistoryTab();
      if (target === 'clients')  renderClientsTab();
      if (target === 'leads')    renderLeadsTab();
      if (target === 'analytics') renderAnalyticsTab();
    });
  });
}

// ============================================================
// ИСТОРИЯ ПОСЕЩЕНИЙ
// ============================================================

const MONTH_FULL_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

let historyMonthOffset = 0; // 0 = текущий месяц, -1 = предыдущий, и т.д.
let historyCache = [];      // последняя загруженная история — для остатков по курсам
let coursesCache = [];      // курсы из courses.json — грузятся вместе с историей

// ============================================================
// ВИЗИТ ПО ФАКТУ И КУРСЫ
// ============================================================
// В истории рядом с записью может лежать actual — как визит прошёл на самом
// деле (подробности — в index.js у validateVisitActual). Всё, что считает
// деньги и время, читает визит через эти функции, а не напрямую.
//
// Курсы — отдельные записи (courses.json), визиты и брони ссылаются на них
// через courseId. Остаток не хранится, а считается здесь так же, как на
// сервере (courseLeft в index.js): всего − использовано до учёта −
// выполненные визиты по курсу − предстоящие записи по курсу.

function visitPaid(h){
  if (h.status !== 'completed') return 0;
  return h.actual ? (h.actual.paid || 0) : (h.servicePrice || 0);
}
function visitServiceName(h){
  return h.actual ? h.actual.serviceName : disambiguateServiceName(h.serviceName, h.serviceDuration);
}
function visitDuration(h){
  return h.actual ? (h.actual.serviceDuration || 0) : (h.serviceDuration || 0);
}
function visitCourseId(h){
  return h.actual ? (h.actual.courseId || null) : (h.courseId || null);
}

// excludeId — визит или бронь, которую сейчас отмечают или правят: её саму
// в расход не считаем, иначе курс выглядел бы на один сеанс «использованнее».
function courseUsage(course, excludeId){
  const done = historyCache.filter(h => h.id !== excludeId && h.status === 'completed' && visitCourseId(h) === course.id).length;
  const booked = Store.bookings.filter(b => b.id !== excludeId && b.courseId === course.id).length;
  const left = course.closedAt ? 0 : course.sessions - (course.usedBefore || 0) - done - booked;
  return { done, booked, left };
}

function coursesOfClient(phone){
  const tail = phoneTail10(phone);
  return coursesCache.filter(c => phoneTail10(c.phone) === tail)
    .sort((a, b) => (a.paidAt || '').localeCompare(b.paidAt || ''));
}

function activeCoursesFor(phone, excludeId){
  return coursesOfClient(phone).filter(c => courseUsage(c, excludeId).left > 0);
}

function courseById(id){
  return coursesCache.find(c => c.id === id) || null;
}

function courseLeftLabel(course, excludeId){
  return `осталось ${Math.max(0, courseUsage(course, excludeId).left)} из ${course.sessions}`;
}

// Курс, под который подходит бронь без courseId: старая запись или курс
// заведён уже после записи. Сверяем по id услуг, а для записей без них —
// по названию из каталога.
function matchCourseForBooking(b){
  const ids = (b.serviceItems || []).map(it => it.id);
  const names = String(b.serviceName || '').split(', ');
  return activeCoursesFor(b.clientPhone, b.id).find(c => {
    if (!c.serviceId) return false;
    if (ids.length) return ids.includes(c.serviceId);
    const svc = getServiceById(c.serviceId);
    return svc && names.includes(svc.name) && (names.length > 1 || svc.duration === b.serviceDuration);
  }) || null;
}

// Сколько из цены брони приходится на услугу курса — остальное доплата.
function coursePartOfBooking(b, course){
  const item = (b.serviceItems || []).find(it => it.id === course.serviceId);
  if (item) return item.price;
  const svc = getServiceById(course.serviceId);
  return svc ? Math.min(svc.price, b.servicePrice || 0) : (b.servicePrice || 0);
}

function getHistoryMonthKey(offset){
  const d = new Date();
  d.setDate(1); // избегаем проблем с разным числом дней в месяцах
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

async function renderHistoryTab(){
  const container = document.getElementById('historyList');
  container.innerHTML = '<div class="empty-state">Загружаем...</div>';

  let history = [];
  try{ [history, coursesCache] = await Promise.all([Store.getHistory(), Store.getCourses()]); }
  catch(e){ container.innerHTML = '<div class="empty-state">Ошибка загрузки</div>'; return; }
  historyCache = history;

  // Записи, которые ждут отметки — показываем всегда, вне зависимости от
  // выбранного месяца, так как это требует действия прямо сейчас.
  const nowKey = todayKey();
  const nowTime = new Date().getHours()*60 + new Date().getMinutes();

  const waiting = Store.bookings.filter(b => {
    if (b.date > nowKey) return false;
    if (b.date === nowKey){
      const endMins = timeToMinutes(b.end);
      return endMins <= nowTime;
    }
    return true;
  });

  // Фильтруем историю по выбранному месяцу
  const monthKey = getHistoryMonthKey(historyMonthOffset);
  const monthHistory = history.filter(h => h.date.startsWith(monthKey));

  container.innerHTML = '';

  // Навигация по месяцам
  const [y, m] = monthKey.split('-');
  const monthNav = document.createElement('div');
  monthNav.className = 'week-nav';
  monthNav.innerHTML = `
    <button id="prevHistoryMonth">‹</button>
    <div class="week-label">${MONTH_FULL_RU[Number(m)-1]} ${y}</div>
    <button id="nextHistoryMonth" ${historyMonthOffset >= 0 ? 'disabled' : ''}>›</button>
  `;
  container.appendChild(monthNav);
  monthNav.querySelector('#prevHistoryMonth').addEventListener('click', () => {
    historyMonthOffset--;
    renderHistoryTab();
  });
  monthNav.querySelector('#nextHistoryMonth').addEventListener('click', () => {
    if (historyMonthOffset < 0){ historyMonthOffset++; renderHistoryTab(); }
  });

  if (waiting.length > 0){
    const section = document.createElement('div');
    section.innerHTML = '<div class="history-section-title">⏳ Ждут отметки</div>';
    waiting.sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start)).forEach(b => {
      section.appendChild(buildWaitingCard(b));
    });
    container.appendChild(section);
  }

  if (monthHistory.length > 0){
    const section = document.createElement('div');
    section.innerHTML = `<div class="history-section-title">📋 История · ${MONTH_FULL_RU[Number(m)-1]}</div>`;
    monthHistory.slice().reverse().forEach(h => {
      section.appendChild(buildHistoryCard(h));
    });
    container.appendChild(section);
  } else if (waiting.length === 0){
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = `За ${MONTH_FULL_RU[Number(m)-1].toLowerCase()} ${y} записей нет`;
    container.appendChild(empty);
  }
}

function buildWaitingCard(b){
  const d = new Date(b.date + 'T00:00:00');
  const dateStr = d.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'short' });
  const card = document.createElement('div');
  card.className = 'booking-card waiting-card';

  // Прошедший резерв — не визит: «пришёл/не пришёл» к нему не относится,
  // а в истории он считался бы визитом на 0 ₽. Просто убираем.
  if (b.kind === 'reserve'){
    card.classList.add('booking-reserve');
    card.innerHTML = `
      <div class="booking-top">
        <span class="booking-date">${dateStr}</span>
        <span class="booking-time">${escapeHtml(b.start)}–${escapeHtml(b.end)}</span>
      </div>
      <div class="booking-service">🔒 Резерв — время занято</div>
      ${b.comment ? `<div class="booking-comment">💬 ${escapeHtml(b.comment)}</div>` : ''}
      <div class="mark-actions">
        <button class="mark-btn remove-reserve-btn">Убрать резерв</button>
      </div>
    `;
    const btn = card.querySelector('.remove-reserve-btn');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try{
        await withTimeout(Store.deleteBooking(b.id), 8000);
        const idx = Store.bookings.findIndex(x => x.id === b.id);
        if (idx !== -1) Store.bookings.splice(idx, 1);
        renderHistoryTab();
      }catch(e){
        alert('Не удалось убрать резерв. Попробуйте снова.');
        btn.disabled = false;
      }
    });
    return card;
  }

  // Бронь по курсу (сервер привязал её при записи) — «Пришла» и так значит
  // «по курсу». Бронь без курса, но у клиентки есть подходящий — кнопка
  // «По курсу» в одно касание. В остальных случаях — обычная цена.
  const bookedCourse = b.courseId ? courseById(b.courseId) : null;
  const suggested = !b.courseId ? matchCourseForBooking(b) : null;
  let courseLine = '';
  if (bookedCourse){
    courseLine = `<div class="course-line">🎟 По курсу «${escapeHtml(bookedCourse.name)}» — после визита ${courseLeftLabel(bookedCourse)}${b.servicePrice ? ` · доплата ${b.servicePrice.toLocaleString('ru-RU')} ₽` : ''}</div>`;
  } else if (b.courseId){
    courseLine = `<div class="course-line">🎟 По курсу «${escapeHtml(b.courseName || '')}»</div>`;
  } else if (suggested){
    courseLine = `<div class="course-line">🎟 Есть курс «${escapeHtml(suggested.name)}» — ${courseLeftLabel(suggested, b.id)}</div>`;
  }

  card.innerHTML = `
    <div class="booking-top">
      <span class="booking-date">${dateStr}</span>
      <span class="booking-time">${escapeHtml(b.start)}–${escapeHtml(b.end)}</span>
    </div>
    <div class="booking-service">${escapeHtml(disambiguateServiceName(b.serviceName, b.serviceDuration))} · ${b.servicePrice.toLocaleString('ru-RU')} ₽</div>
    ${clientLine(b.clientName, b.clientPhone)}
    ${courseLine}
    <div class="mark-actions">
      <button class="mark-btn mark-completed">${b.courseId ? '✅ Пришёл по курсу' : '✅ Пришёл'}</button>
      <button class="mark-btn mark-noshow">❌ Не пришёл</button>
    </div>
    <div class="mark-actions">
      ${suggested ? '<button class="mark-btn mark-course">🎟 По курсу</button>' : ''}
      <button class="mark-btn mark-edit">✏️ Пришёл, с правками</button>
    </div>
  `;
  card.querySelector('.mark-completed').addEventListener('click', () => markBooking(b.id, 'completed', card));
  card.querySelector('.mark-noshow').addEventListener('click', () => markBooking(b.id, 'no_show', card));
  card.querySelector('.mark-edit').addEventListener('click', () => toggleVisitForm(card, b, 'mark'));
  if (suggested){
    card.querySelector('.mark-course').addEventListener('click', () => markBooking(b.id, 'completed', card, {
      serviceName: b.serviceName,
      serviceDuration: b.serviceDuration,
      paid: Math.max(0, (b.servicePrice || 0) - coursePartOfBooking(b, suggested)),
      payType: 'course_visit',
      courseId: suggested.id,
      note: '',
    }));
  }
  return card;
}

function buildHistoryCard(h){
  const d = new Date(h.date + 'T00:00:00');
  const dateStr = d.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'short' });
  const card = document.createElement('div');
  card.className = 'booking-card history-card';
  const statusBadge = h.status === 'completed'
    ? '<span class="status-badge status-done">✅ Выполнено</span>'
    : '<span class="status-badge status-noshow">❌ Не пришёл</span>';

  const a = h.status === 'completed' ? h.actual : null;
  const courseId = h.status === 'completed' ? visitCourseId(h) : null;
  const course = courseId ? courseById(courseId) : null;
  const payTag = courseId
    ? `<span class="pay-tag">🎟 по курсу${course ? ` «${escapeHtml(course.name)}»` : ''}</span>`
    : '';
  const bookedLabel = `${escapeHtml(disambiguateServiceName(h.serviceName, h.serviceDuration))} · ${(h.servicePrice||0).toLocaleString('ru-RU')} ₽`;
  let factHtml = `<div class="booking-service">${bookedLabel} ${payTag}</div>`;
  if (a){
    factHtml = `
      <div class="booking-service">${escapeHtml(a.serviceName)} · ${a.paid.toLocaleString('ru-RU')} ₽ ${payTag}</div>
      <div class="booked-was">по записи: ${bookedLabel}${h.courseId ? ' (по курсу)' : ''}</div>
      ${a.note ? `<div class="booking-comment">📝 ${escapeHtml(a.note)}</div>` : ''}`;
  }

  card.innerHTML = `
    <div class="booking-top">
      <span class="booking-date">${dateStr}</span>
      <span class="booking-time">${escapeHtml(h.start)}–${escapeHtml(h.end)}</span>
    </div>
    ${factHtml}
    ${clientLine(h.clientName, h.clientPhone)}
    <div class="history-card-foot">
      ${statusBadge}
      <button class="edit-visit-btn" type="button">✏️ Изменить</button>
    </div>
  `;
  card.querySelector('.edit-visit-btn').addEventListener('click', () => toggleVisitForm(card, h, 'edit'));
  return card;
}

async function markBooking(bookingId, status, card, actual){
  const btns = card.querySelectorAll('.mark-btn');
  btns.forEach(b => b.disabled = true);
  try{
    await withTimeout(Store.markBooking(bookingId, status, actual), 10000);
    // обновить список записей в памяти
    const idx = Store.bookings.findIndex(b => b.id === bookingId);
    if (idx !== -1) Store.bookings.splice(idx, 1);
    renderHistoryTab();
    return true;
  }catch(e){
    alert('Не удалось сохранить отметку. Попробуйте снова.');
    btns.forEach(b => b.disabled = false);
    return false;
  }
}

// ---------- Форма «как прошёл визит» ----------
// mode 'mark' — отметка из «ждут отметки» (визит точно состоялся);
// mode 'edit' — правка визита из истории, можно поменять и статус.
// Форма раскрывается прямо под карточкой, повторный клик её закрывает.
function toggleVisitForm(card, entry, mode){
  const existing = card.querySelector('.visit-form');
  if (existing){ existing.remove(); return; }
  card.appendChild(buildVisitForm(entry, mode, card));
}

// Услуга каталога для брони: из serviceItems, а для старых записей — по
// названию и длительности. Нужна, чтобы подставить её в «Купила курс».
function catalogIdOfBooking(b){
  if (b.serviceItems && b.serviceItems.length === 1) return b.serviceItems[0].id;
  for (const cat of SERVICE_CATEGORIES){
    const svc = cat.services.find(s => s.name === b.serviceName && s.duration === b.serviceDuration);
    if (svc) return svc.id;
  }
  return '';
}

function courseServiceOptionsHtml(){
  return serviceOptionsHtml()
    .replace('<option value="">Выберите услугу</option>', '<option value="">Без привязки к услуге</option>')
    .replace('<option value="custom">Другое — указать вручную</option>', '');
}

function buildVisitForm(entry, mode, card){
  const a = entry.actual || null;
  const fullPrice = (entry.servicePrice || 0) + (entry.coursePrice || 0);
  const suggested = mode === 'mark' && !entry.courseId ? matchCourseForBooking(entry) : null;

  // Курсы для выбора: активные у клиентки плюс тот, по которому визит уже
  // числится (даже если он с этим визитом закончился).
  const currentCourseId = a ? a.courseId : entry.courseId;
  const courses = activeCoursesFor(entry.clientPhone, entry.id);
  const current = currentCourseId ? courseById(currentCourseId) : null;
  if (current && !courses.includes(current)) courses.unshift(current);
  const defaultCourse = current || suggested || courses[0] || null;
  // Доплата по курсу: всё, что в брони сверх услуги курса.
  const extraFor = (course) => !course ? 0
    : entry.courseId === course.id ? (entry.servicePrice || 0)
    : Math.max(0, fullPrice - coursePartOfBooking(entry, course));

  const form = document.createElement('div');
  form.className = 'master-form visit-form';
  form.innerHTML = `
    ${mode === 'edit' ? `
    <div class="segmented vf-status">
      <button type="button" data-status="completed">Пришёл</button>
      <button type="button" data-status="no_show">Не пришёл</button>
    </div>` : ''}
    <div class="vf-completed">
      <div class="field">
        <label>Что сделали</label>
        <input class="vf-service" maxlength="200">
      </div>
      <div class="field">
        <label>Подставить из каталога</label>
        <select class="vf-catalog">${serviceOptionsHtml().replace('<option value="custom">Другое — указать вручную</option>', '')}</select>
      </div>
      <div class="segmented vf-pay">
        <button type="button" data-pay="single">Разово</button>
        <button type="button" data-pay="course_visit">По курсу</button>
        <button type="button" data-pay="new_course">Купила курс</button>
      </div>
      <div class="vf-cvisit hidden">
        ${courses.length ? `
        <div class="field">
          <label>Курс</label>
          <select class="vf-course">
            ${courses.map(c => `<option value="${escapeHtml(c.id)}">«${escapeHtml(c.name)}» — ${courseLeftLabel(c, entry.id)}</option>`).join('')}
          </select>
        </div>` : `
        <div class="mf-note vf-hint">У клиентки нет курса с остатком. Если купила сейчас — «Купила курс»; если раньше — добавьте курс в её карточке.</div>`}
      </div>
      <div class="vf-newcourse hidden">
        <div class="field">
          <label>Услуга курса</label>
          <select class="vf-course-service">${courseServiceOptionsHtml()}</select>
        </div>
        <div class="mf-row">
          <div class="field"><label>Название курса</label><input class="vf-course-name" maxlength="200"></div>
          <div class="field"><label>Сеансов</label><input class="vf-course-sessions" type="number" min="1" max="100" inputmode="numeric" value="10"></div>
        </div>
        <div class="field"><label>Оплачено за курс, ₽</label><input class="vf-course-paid" type="number" min="0" max="500000" step="50" inputmode="numeric"></div>
        <div class="mf-note vf-hint">Этот визит засчитается первым сеансом курса.</div>
      </div>
      <div class="mf-row">
        <div class="field"><label class="vf-paid-label">Оплачено, ₽</label><input class="vf-paid" type="number" min="0" max="100000" step="50" inputmode="numeric"></div>
        <div class="field"><label>Длительность, мин</label><input class="vf-duration" type="number" min="5" max="600" step="5" inputmode="numeric"></div>
      </div>
      <div class="field"><label>Комментарий</label><input class="vf-note" maxlength="500" placeholder="Скидка, подарок, что добавили…"></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary vf-save" type="button">Сохранить</button>
      <button class="btn btn-ghost vf-cancel" type="button">Отмена</button>
    </div>
    <div class="save-status vf-status-msg"></div>
  `;

  const q = (sel) => form.querySelector(sel);
  const initialPay = a ? a.payType : (entry.courseId || suggested ? 'course_visit' : 'single');
  const state = { status: entry.status === 'no_show' && mode === 'edit' ? 'no_show' : 'completed', pay: initialPay };

  q('.vf-service').value = a ? a.serviceName : entry.serviceName;
  q('.vf-duration').value = a ? a.serviceDuration : entry.serviceDuration;
  q('.vf-paid').value = a ? a.paid : (initialPay === 'course_visit' ? extraFor(defaultCourse) : fullPrice);
  q('.vf-note').value = a ? a.note : '';
  if (q('.vf-course') && defaultCourse) q('.vf-course').value = defaultCourse.id;
  q('.vf-course-service').value = catalogIdOfBooking(entry);
  q('.vf-course-name').value = entry.serviceName;
  q('.vf-course-paid').value = '';

  const PAID_LABELS = { single: 'Оплачено, ₽', course_visit: 'Доплата за визит, ₽', new_course: 'Доплата за визит, ₽' };
  const render = () => {
    form.querySelectorAll('.vf-status button').forEach(b => b.classList.toggle('active', b.dataset.status === state.status));
    q('.vf-completed').classList.toggle('hidden', state.status !== 'completed');
    form.querySelectorAll('.vf-pay button').forEach(b => b.classList.toggle('active', b.dataset.pay === state.pay));
    q('.vf-cvisit').classList.toggle('hidden', state.pay !== 'course_visit');
    q('.vf-newcourse').classList.toggle('hidden', state.pay !== 'new_course');
    q('.vf-paid-label').textContent = PAID_LABELS[state.pay];
  };

  form.querySelectorAll('.vf-status button').forEach(b => b.addEventListener('click', () => {
    state.status = b.dataset.status; render();
  }));
  form.querySelectorAll('.vf-pay button').forEach(b => b.addEventListener('click', () => {
    if (state.pay === b.dataset.pay) return;
    state.pay = b.dataset.pay;
    // Сумму за визит подставляем под тип оплаты: разово — полная цена,
    // по курсу — только то, что сверх курса, при покупке курса — 0.
    q('.vf-paid').value = state.pay === 'single' ? fullPrice
      : state.pay === 'course_visit' ? extraFor(q('.vf-course') ? courseById(q('.vf-course').value) : null)
      : 0;
    render();
  }));
  if (q('.vf-course')) q('.vf-course').addEventListener('change', () => {
    q('.vf-paid').value = extraFor(courseById(q('.vf-course').value));
  });
  q('.vf-course-service').addEventListener('change', () => {
    const svc = getServiceById(q('.vf-course-service').value);
    if (svc) q('.vf-course-name').value = svc.name;
  });
  q('.vf-catalog').addEventListener('change', () => {
    const svc = getServiceById(q('.vf-catalog').value);
    if (!svc) return;
    q('.vf-service').value = svc.name;
    q('.vf-duration').value = svc.duration;
    if (state.pay === 'single') q('.vf-paid').value = svc.price;
  });
  q('.vf-cancel').addEventListener('click', () => form.remove());
  q('.vf-save').addEventListener('click', () => saveVisitForm(form, entry, mode, state));

  render();
  return form;
}

const VISIT_FIELD_ERRORS = {
  serviceName: 'Укажите, что сделали',
  serviceDuration: 'Длительность — от 5 до 600 минут',
  paid: 'Проверьте сумму',
  courseName: 'Укажите название курса',
  courseSessions: 'Сеансов в курсе — от 1 до 100',
  coursePaid: 'Укажите, сколько заплатили за курс (0 — если ещё не платила)',
  courseId: 'Выберите курс',
};

async function saveVisitForm(form, entry, mode, state){
  const q = (sel) => form.querySelector(sel);
  const msg = q('.vf-status-msg');
  const btn = q('.vf-save');
  const fail = (text) => { msg.textContent = text; msg.style.color = '#B07E7E'; };
  msg.textContent = '';

  let actual = null;
  if (state.status === 'completed'){
    const paidRaw = q('.vf-paid').value.trim();
    actual = {
      serviceName: q('.vf-service').value.trim(),
      serviceDuration: Number(q('.vf-duration').value),
      paid: paidRaw === '' ? 0 : Number(paidRaw),
      payType: state.pay === 'single' ? 'single' : 'course_visit',
      note: q('.vf-note').value.trim(),
    };
    if (!actual.serviceName) return fail(VISIT_FIELD_ERRORS.serviceName);
    if (!Number.isInteger(actual.serviceDuration) || actual.serviceDuration < 5) return fail(VISIT_FIELD_ERRORS.serviceDuration);
    if (!Number.isFinite(actual.paid) || actual.paid < 0) return fail(VISIT_FIELD_ERRORS.paid);

    if (state.pay === 'course_visit'){
      if (!q('.vf-course')) return fail(VISIT_FIELD_ERRORS.courseId);
      actual.courseId = q('.vf-course').value;
    } else if (state.pay === 'new_course'){
      const coursePaidRaw = q('.vf-course-paid').value.trim();
      actual.newCourse = {
        name: q('.vf-course-name').value.trim(),
        serviceId: q('.vf-course-service').value || null,
        sessions: Number(q('.vf-course-sessions').value),
        usedBefore: 0,
        paid: Number(coursePaidRaw),
        note: '',
      };
      if (!actual.newCourse.name) return fail(VISIT_FIELD_ERRORS.courseName);
      if (!Number.isInteger(actual.newCourse.sessions) || actual.newCourse.sessions < 1 || actual.newCourse.sessions > 100) return fail(VISIT_FIELD_ERRORS.courseSessions);
      if (coursePaidRaw === '' || !Number.isFinite(actual.newCourse.paid) || actual.newCourse.paid < 0) return fail(VISIT_FIELD_ERRORS.coursePaid);
    }
  }

  btn.disabled = true;
  btn.textContent = 'Сохраняем...';
  try{
    if (mode === 'mark'){
      await withTimeout(Store.markBooking(entry.id, 'completed', actual), 10000);
      const idx = Store.bookings.findIndex(b => b.id === entry.id);
      if (idx !== -1) Store.bookings.splice(idx, 1);
    } else {
      await withTimeout(Store.editHistoryEntry(entry.id, state.status, actual), 10000);
    }
    renderHistoryTab();
  }catch(e){
    btn.disabled = false;
    btn.textContent = 'Сохранить';
    const m = String(e && e.message);
    if (m.includes('invalid-actual')) return fail('Проверьте поля формы');
    if (m.includes('unauthorized')) return fail('Сессия истекла — обновите страницу и войдите снова');
    fail('Не удалось сохранить. Попробуйте снова.');
  }
}

// ============================================================
// БАЗА КЛИЕНТОВ
// ============================================================

// Ключ для сопоставления истории с карточкой — последние 10 цифр номера.
// Так «+7 (918)…», «8918…» и «7918…» считаются одним человеком, в том числе
// для старых записей истории, сделанных до перехода на clientKey().
function phoneTail10(phone){
  return String(phone ?? '').replace(/\D/g, '').slice(-10);
}

// Для поиска по имени: регистр и ё/е не важны.
function normName(str){
  return String(str ?? '').toLowerCase().replace(/ё/g, 'е').trim();
}

// Кэш вкладки: грузим клиентов и историю один раз при открытии вкладки,
// а поиск и раскрытие списков дальше работают без запросов к серверу.
const clientsView = {
  list: null,             // карточки клиентов (null — ещё не загружены)
  historyByPhone: {},     // tail10 → все записи истории этого номера (новые сверху)
  query: '',
  openedVisits: new Set(), // у кого список посещений раскрыт — переживает фильтрацию
  noteDrafts: new Map(),   // несохранённые заметки — чтобы поиск их не стирал
};

async function renderClientsTab(){
  const container = document.getElementById('clientsList');
  container.innerHTML = '<div class="empty-state">Загружаем...</div>';
  document.getElementById('clientsSearchCount').textContent = '';

  let clients = {};
  let history = [];
  try{
    [clients, history, coursesCache] = await Promise.all([Store.getClients(), Store.getHistory(), Store.getCourses()]);
    historyCache = history;
  }catch(e){
    container.innerHTML = '<div class="empty-state">Ошибка загрузки</div>';
    return;
  }

  const byPhone = {};
  history.forEach(h => {
    const key = phoneTail10(h.clientPhone);
    if (!key) return;
    (byPhone[key] = byPhone[key] || []).push(h);
  });
  Object.values(byPhone).forEach(arr =>
    arr.sort((a,b) => ((b.date||'') + (b.start||'')).localeCompare((a.date||'') + (a.start||'')))
  );

  const list = Object.values(clients);
  list.sort((a,b) => (b.lastVisit||'').localeCompare(a.lastVisit||''));

  clientsView.list = list;
  clientsView.historyByPhone = byPhone;
  renderClientsList();
}

function clientMatchesQuery(client, query){
  const q = normName(query);
  if (!q) return true;
  if (normName(client.name).includes(q)) return true;

  // Телефон: сравниваем только цифры. Ищем и по полному номеру, и по «хвосту»
  // без кода страны — чтобы «8918…», «+7918…» и «918…» находили одно и то же.
  const qDigits = q.replace(/\D/g, '');
  if (qDigits.length < 2) return false;
  const full = String(client.phone ?? '').replace(/\D/g, '');
  const tail = phoneTail10(client.phone);
  if (full.includes(qDigits) || tail.includes(qDigits)) return true;
  if (/^[78]/.test(qDigits) && qDigits.length > 1 && tail.startsWith(qDigits.slice(1))) return true;
  return false;
}

function renderClientsList(){
  const container = document.getElementById('clientsList');
  const countEl = document.getElementById('clientsSearchCount');
  const all = clientsView.list;
  if (!all) return; // вкладка ещё не загружалась — искать не в чем

  if (all.length === 0){
    countEl.textContent = '';
    container.innerHTML = '<div class="empty-state">База клиентов пуста — она заполняется после первого выполненного визита</div>';
    return;
  }

  const filtered = all.filter(c => clientMatchesQuery(c, clientsView.query));
  countEl.textContent = clientsView.query.trim()
    ? `Найдено: ${filtered.length} из ${all.length}`
    : `Всего клиентов: ${all.length}`;

  if (filtered.length === 0){
    container.innerHTML = '<div class="empty-state">Никого не нашли — проверьте имя или номер</div>';
    return;
  }

  container.innerHTML = '';
  filtered.forEach(client => container.appendChild(buildClientCard(client)));
}

function buildVisitsListHtml(visits){
  if (visits.length === 0){
    return '<div class="empty-state" style="padding:12px 0;">В истории нет записей по этому номеру</div>';
  }
  return visits.map(h => {
    const d = new Date(h.date + 'T00:00:00');
    const dateStr = d.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
    const dow = d.toLocaleDateString('ru-RU', { weekday:'short' });
    const isNoShow = h.status === 'no_show';
    const service = isNoShow ? disambiguateServiceName(h.serviceName, h.serviceDuration) : visitServiceName(h);
    const price = isNoShow
      ? '<span class="visit-noshow-tag">не пришёл</span>'
      : `${visitPaid(h).toLocaleString('ru-RU')} ₽` + (visitCourseId(h) ? ' · 🎟 по курсу' : '');
    return `
      <div class="visit-row${isNoShow ? ' noshow' : ''}">
        <div class="visit-when">${escapeHtml(dateStr)}<small>${escapeHtml(dow)}, ${escapeHtml(h.start||'')}</small></div>
        <div class="visit-what"><b>${escapeHtml(service)}</b><br>${price}</div>
      </div>`;
  }).join('');
}

// ---------- Курсы в карточке клиентки ----------
// Курс можно завести без визита: оплатила переводом, купила до учёта.
// Дальше записи на услугу курса сервер сам помечает «по курсу».
function renderClientCourses(box, client){
  const courses = coursesOfClient(client.phone);
  const rows = courses.map(c => {
    const u = courseUsage(c);
    let state;
    if (c.closedAt) state = 'закрыт';
    else if (u.left <= 0 && u.booked) state = `свободных сеансов нет · записана ещё на ${u.booked}`;
    else if (u.left <= 0) state = `использован, ${c.sessions} из ${c.sessions}`;
    else state = `осталось ${u.left} из ${c.sessions}` + (u.booked ? ` · записана ещё на ${u.booked}` : '');
    const inactive = c.closedAt || u.left <= 0;
    return `
      <div class="course-row${inactive ? ' inactive' : ''}">
        <span>🎟 «${escapeHtml(c.name)}» — ${state}</span>
        <button type="button" class="course-edit-btn" data-id="${escapeHtml(c.id)}">✏️</button>
      </div>`;
  }).join('');
  box.innerHTML = `
    ${rows}
    <button type="button" class="course-add-btn">＋ Добавить курс</button>
    <div class="course-form-slot"></div>
  `;
  const slot = box.querySelector('.course-form-slot');
  const open = (course) => {
    if (slot.firstChild && slot.firstChild.dataset.courseId === (course ? course.id : 'new')){
      slot.innerHTML = '';
      return;
    }
    slot.innerHTML = '';
    slot.appendChild(buildCourseForm(client, course));
  };
  box.querySelector('.course-add-btn').addEventListener('click', () => open(null));
  box.querySelectorAll('.course-edit-btn').forEach(btn =>
    btn.addEventListener('click', () => open(courseById(btn.dataset.id))));
}

function newCourseId(){
  const rnd = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return 'c_' + rnd;
}

function buildCourseForm(client, course){
  const form = document.createElement('div');
  form.className = 'master-form course-form';
  form.dataset.courseId = course ? course.id : 'new';
  // id нового курса создаём один раз на форму — повтор после сбоя сети
  // перезапишет тот же курс, а не заведёт второй.
  const id = course ? course.id : newCourseId();
  const usage = course ? courseUsage(course) : null;
  form.innerHTML = `
    <div class="field">
      <label>Услуга курса</label>
      <select class="cf-service">${courseServiceOptionsHtml()}</select>
    </div>
    <div class="field"><label>Название</label><input class="cf-name" maxlength="200"></div>
    <div class="mf-row">
      <div class="field"><label>Сеансов</label><input class="cf-sessions" type="number" min="1" max="100" inputmode="numeric"></div>
      <div class="field"><label>Использовано до учёта</label><input class="cf-used" type="number" min="0" max="99" inputmode="numeric"></div>
    </div>
    <div class="mf-row">
      <div class="field"><label>Оплачено, ₽</label><input class="cf-paid" type="number" min="0" max="500000" step="50" inputmode="numeric"></div>
      <div class="field"><label>Дата оплаты</label><input class="cf-paid-at" type="date"></div>
    </div>
    <div class="field"><label>Комментарий</label><input class="cf-note" maxlength="500" placeholder="Необязательно"></div>
    ${usage ? `<div class="mf-note vf-hint">По курсу уже ${usage.done} ${usage.done === 1 ? 'визит' : 'визитов'} в истории${usage.booked ? `, записей вперёд: ${usage.booked}` : ''}.</div>` : `
    <div class="mf-note vf-hint">Если деньги за курс пришли до учёта и уже есть в старой выручке — поставьте 0, чтобы не посчитать их дважды.</div>`}
    ${course ? '<label class="mf-check"><input type="checkbox" class="cf-closed"> Закрыть курс — больше не списывать сеансы</label>' : ''}
    <div class="btn-row">
      <button class="btn btn-primary cf-save" type="button">${course ? 'Сохранить' : 'Добавить курс'}</button>
      <button class="btn btn-ghost cf-cancel" type="button">Отмена</button>
    </div>
    ${course ? '<button class="cf-delete" type="button">Удалить курс (если завели по ошибке)</button>' : ''}
    <div class="save-status cf-status"></div>
  `;
  const q = (sel) => form.querySelector(sel);
  q('.cf-service').value = course ? (course.serviceId || '') : '';
  q('.cf-name').value = course ? course.name : '';
  q('.cf-sessions').value = course ? course.sessions : 10;
  q('.cf-used').value = course ? (course.usedBefore || 0) : 0;
  q('.cf-paid').value = course ? course.paid : '';
  q('.cf-paid-at').value = course ? course.paidAt : todayKey();
  q('.cf-note').value = course ? (course.note || '') : '';
  if (course) q('.cf-closed').checked = !!course.closedAt;

  q('.cf-service').addEventListener('change', () => {
    const svc = getServiceById(q('.cf-service').value);
    if (svc && (!q('.cf-name').value.trim() || !course)) q('.cf-name').value = svc.name;
  });
  q('.cf-cancel').addEventListener('click', () => form.remove());

  const status = q('.cf-status');
  const fail = (text) => { status.textContent = text; status.style.color = '#B07E7E'; };
  q('.cf-save').addEventListener('click', async () => {
    status.textContent = '';
    const payload = {
      id,
      clientPhone: client.phone,
      clientName: client.name,
      serviceId: q('.cf-service').value || null,
      name: q('.cf-name').value.trim(),
      sessions: Number(q('.cf-sessions').value),
      usedBefore: Number(q('.cf-used').value || 0),
      paid: q('.cf-paid').value.trim() === '' ? NaN : Number(q('.cf-paid').value),
      paidAt: q('.cf-paid-at').value,
      note: q('.cf-note').value.trim(),
      closed: course ? q('.cf-closed').checked : false,
    };
    if (!payload.name) return fail('Укажите название курса');
    if (!Number.isInteger(payload.sessions) || payload.sessions < 1 || payload.sessions > 100) return fail('Сеансов — от 1 до 100');
    if (!Number.isInteger(payload.usedBefore) || payload.usedBefore < 0 || payload.usedBefore >= payload.sessions) return fail('Использовано должно быть меньше, чем сеансов');
    if (!Number.isFinite(payload.paid) || payload.paid < 0) return fail('Укажите сумму (0 — если оплата была до учёта)');
    if (!payload.paidAt) return fail('Укажите дату оплаты');
    if (!payload.serviceId && !confirm('Курс без привязки к услуге не будет списываться автоматически при записи — только вручную. Сохранить так?')) return;

    const btn = q('.cf-save');
    btn.disabled = true;
    btn.textContent = 'Сохраняем...';
    try{
      await withTimeout(Store.saveCourse(payload), 10000);
      renderClientsTab();
    }catch(e){
      btn.disabled = false;
      btn.textContent = course ? 'Сохранить' : 'Добавить курс';
      const m = String(e && e.message);
      if (m.includes('invalid-course')) return fail('Проверьте поля. Сеансов не может быть меньше, чем уже использовано и записано.');
      if (m.includes('unauthorized')) return fail('Сессия истекла — обновите страницу и войдите снова');
      fail('Не удалось сохранить. Попробуйте снова.');
    }
  });

  if (course){
    q('.cf-delete').addEventListener('click', async () => {
      if (!confirm(`Удалить курс «${course.name}»? Это для курсов, заведённых по ошибке.`)) return;
      try{
        await withTimeout(Store.deleteCourse(course.id), 10000);
        renderClientsTab();
      }catch(e){
        const m = String(e && e.message);
        if (m.includes('course-in-use')) return fail('По курсу уже есть визиты или записи — его можно только закрыть (галочка выше).');
        fail('Не удалось удалить. Попробуйте снова.');
      }
    });
  }
  return form;
}

function buildClientCard(client){
  const today = todayKey();
  const key = phoneTail10(client.phone);
  const visits = clientsView.historyByPhone[key] || [];
  const noShows = visits.filter(h => h.status === 'no_show').length;
  const isOpen = clientsView.openedVisits.has(key);

  const daysSince = Math.floor((new Date(today) - new Date(client.lastVisit + 'T00:00:00')) / 86400000);
  let statusLabel = '';
  if (client.visits >= 3) statusLabel = '<span class="client-badge badge-regular">Постоянный</span>';
  else if (client.visits === 1) statusLabel = '<span class="client-badge badge-new">Новый</span>';
  if (daysSince > 30) statusLabel += '<span class="client-badge badge-sleeping">Давно не был</span>';

  const noteValue = clientsView.noteDrafts.has(key) ? clientsView.noteDrafts.get(key) : (client.notes || '');
  const toggleLabel = `Все посещения (${visits.length})` + (noShows ? ` · неявок: ${noShows}` : '');

  const card = document.createElement('div');
  card.className = 'booking-card client-card';
  card.innerHTML = `
    <div class="booking-top">
      <span class="booking-date">${escapeHtml(client.name)}</span>
      <span>${statusLabel}</span>
    </div>
    ${clientLine(null, client.phone)}
    <div class="client-stats">
      <span>Визитов: <b>${client.visits}</b></span>
      <span>Потрачено: <b>${(client.totalSpent||0).toLocaleString('ru-RU')} ₽</b></span>
      <span>Последний: <b>${escapeHtml(client.lastVisit || '—')}</b></span>
    </div>
    <div class="client-courses"></div>
    <button type="button" class="visits-toggle">
      <span>${toggleLabel}</span>
      <span class="visits-chev${isOpen ? ' open' : ''}">▾</span>
    </button>
    <div class="visits-list${isOpen ? '' : ' hidden'}">${isOpen ? buildVisitsListHtml(visits) : ''}</div>
    <div class="notes-block">
      <textarea class="notes-input" placeholder="Заметки (особенности, предпочтения...)">${escapeHtml(noteValue)}</textarea>
      <button class="save-note-btn" type="button">Сохранить заметку</button>
      <div class="save-status note-status"></div>
    </div>
  `;

  renderClientCourses(card.querySelector('.client-courses'), client);

  // Раскрытие списка посещений. Разметку строим лениво — при первом открытии.
  const toggleBtn = card.querySelector('.visits-toggle');
  const listEl = card.querySelector('.visits-list');
  const chev = card.querySelector('.visits-chev');
  toggleBtn.addEventListener('click', () => {
    const nowOpen = listEl.classList.contains('hidden');
    if (nowOpen){
      if (!listEl.innerHTML.trim()) listEl.innerHTML = buildVisitsListHtml(visits);
      clientsView.openedVisits.add(key);
    } else {
      clientsView.openedVisits.delete(key);
    }
    listEl.classList.toggle('hidden', !nowOpen);
    chev.classList.toggle('open', nowOpen);
  });

  // Заметки: черновик держим в памяти, пока не сохранили — иначе ввод в поиск
  // перерисовал бы карточку и недописанная заметка пропала бы.
  const notesInput = card.querySelector('.notes-input');
  const saveBtn = card.querySelector('.save-note-btn');
  const status = card.querySelector('.note-status');
  notesInput.addEventListener('input', () => clientsView.noteDrafts.set(key, notesInput.value));

  saveBtn.addEventListener('click', async () => {
    const notes = notesInput.value;
    saveBtn.disabled = true;
    try{
      await withTimeout(Store.saveClientNote(client.phone, notes), 8000);
      client.notes = notes;               // обновляем кэш, чтобы после поиска была свежая версия
      clientsView.noteDrafts.delete(key);
      status.textContent = '✓ Сохранено';
      status.style.color = 'var(--good)';
      setTimeout(()=>{ status.textContent=''; }, 2000);
    }catch(err){
      status.textContent = 'Ошибка сохранения';
      status.style.color = '#B07E7E';
    }
    saveBtn.disabled = false;
  });

  return card;
}

// Поле поиска живёт в статичной разметке вкладки (не внутри списка), поэтому
// при фильтрации фокус и курсор не сбрасываются. Подключается один раз.
function setupClientsSearch(){
  const input = document.getElementById('clientsSearch');
  const clearBtn = document.getElementById('clientsSearchClear');
  let timer = null;

  const apply = () => {
    clientsView.query = input.value;
    clearBtn.classList.toggle('hidden', !input.value);
    renderClientsList();
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(apply, 150); // небольшая задержка — не перерисовываем на каждую букву
  });
  clearBtn.addEventListener('click', () => {
    input.value = '';
    apply();
    input.focus();
  });
}

const PACKAGE_TIER_LABELS = { '5': '5 сеансов', '10': '10 сеансов', '15': '15 сеансов' };

async function renderLeadsTab(){
  const container = document.getElementById('leadsList');
  container.innerHTML = '<div class="empty-state">Загружаем...</div>';

  let leads = [];
  try{ leads = await Store.getPackageLeads(); }
  catch(e){ container.innerHTML = '<div class="empty-state">Ошибка загрузки</div>'; return; }

  if (leads.length === 0){
    container.innerHTML = '<div class="empty-state">Пока нет заявок на абонемент</div>';
    return;
  }

  container.innerHTML = '';
  leads.forEach(lead => {
    const dateObj = new Date(lead.createdAt);
    const dateStr = dateObj.toLocaleDateString('ru-RU', { day:'numeric', month:'long' }) + ', ' +
      dateObj.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    const packageLabel = PACKAGE_TIER_LABELS[lead.packageTier] || lead.packageTier;

    const card = document.createElement('div');
    card.className = 'booking-card' + (lead.done ? ' lead-done' : '');
    card.innerHTML = `
      <div class="booking-top">
        <span class="booking-date">${escapeHtml(lead.clientName)}</span>
        <span class="booking-time">${escapeHtml(packageLabel)}</span>
      </div>
      ${clientLine(null, lead.clientPhone)}
      <div class="booking-service" style="color:var(--ink-soft); font-size:12px;">Заявка от ${escapeHtml(dateStr)}</div>
      ${lead.done
        ? `<div class="lead-done-badge">✓ Обработано</div>`
        : `<button class="mark-lead-done-btn" data-id="${escapeHtml(lead.id)}">Отметить обработанной</button>`}
    `;
    if (!lead.done){
      card.querySelector('.mark-lead-done-btn').addEventListener('click', async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Сохраняем...';
        try{
          await Store.markPackageLeadDone(lead.id);
          renderLeadsTab();
        }catch(err){
          e.target.disabled = false;
          e.target.textContent = 'Отметить обработанной';
        }
      });
    }
    container.appendChild(card);
  });
}

// ============================================================
// АНАЛИТИКА
// ============================================================

async function renderAnalyticsTab(){
  const container = document.getElementById('analyticsList');
  container.innerHTML = '<div class="empty-state">Загружаем...</div>';

  let history = [];
  try{ [history, coursesCache] = await Promise.all([Store.getHistory(), Store.getCourses()]); }
  catch(e){ container.innerHTML = '<div class="empty-state">Ошибка загрузки</div>'; return; }
  historyCache = history;

  const completed = history.filter(h => h.status === 'completed');
  const noshow    = history.filter(h => h.status === 'no_show');

  // Деньги и время — по факту визита (visitPaid/visitDuration): со скидками,
  // курсами и заменой процедуры. Курсы — по кассе: оплата курса идёт в
  // выручку целиком в месяц оплаты, визиты по нему — 0 ₽ (или доплата).
  const byMonth = {};
  const monthOf = (key) => byMonth[key] || (byMonth[key] = { visits:0, revenue:0, minutes:0, courseSales:0, courseVisits:0 });
  completed.forEach(h => {
    const m = monthOf(h.date.slice(0,7)); // YYYY-MM
    m.visits++;
    m.revenue += visitPaid(h);
    m.minutes += visitDuration(h);
    if (visitCourseId(h)) m.courseVisits++;
  });
  coursesCache.forEach(c => {
    if (!c.paid) return;
    const m = monthOf(c.paidAt.slice(0,7));
    m.revenue += c.paid;
    m.courseSales += c.paid;
  });

  const courseSalesSum = coursesCache.reduce((s,c)=>s+(c.paid||0), 0);
  const visitsRevenue = completed.reduce((s,h)=>s+visitPaid(h), 0);
  const totalRevenue = visitsRevenue + courseSalesSum;
  const totalMinutes = completed.reduce((s,h)=>s+visitDuration(h), 0);
  const uniqueClients = new Set(completed.map(h => phoneTail10(h.clientPhone))).size;
  const courseVisits = completed.filter(h => visitCourseId(h)).length;
  const perVisit = completed.length ? Math.round(totalRevenue / completed.length) : 0;
  const noshowRate = history.length ? Math.round(noshow.length / history.length * 100) : 0;
  // Предоплаченные сеансы — сколько визитов ещё «должны» по курсам
  // (записанные вперёд тоже сюда: они ещё не пришли).
  const activeCourses = coursesCache.filter(c => !c.closedAt).map(c => {
    const u = courseUsage(c);
    return { c, notYet: Math.max(0, u.left + u.booked) };
  }).filter(x => x.notYet > 0);
  const prepaidLeft = activeCourses.reduce((s,x)=>s+x.notYet, 0);

  const months = Object.keys(byMonth).sort().reverse();
  const MONTH_NAMES = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

  container.innerHTML = `
    <div class="analytics-summary">
      <div class="analytics-card analytics-card-wide">
        <div class="analytics-num">${totalRevenue.toLocaleString('ru-RU')} ₽</div>
        <div class="analytics-label">Всего заработано${courseSalesSum ? ` · из них продажи курсов ${courseSalesSum.toLocaleString('ru-RU')} ₽` : ''}</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-num">${completed.length}</div>
        <div class="analytics-label">Выполнено визитов${courseVisits ? `, по курсу ${courseVisits}` : ''}</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-num">${perVisit.toLocaleString('ru-RU')} ₽</div>
        <div class="analytics-label">Выручка на визит</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-num">${noshow.length}</div>
        <div class="analytics-label">Не пришли · ${noshowRate}% записей</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-num">${uniqueClients}</div>
        <div class="analytics-label">Уникальных клиентов</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-num">${Math.floor(totalMinutes/60)} ч ${totalMinutes%60} мин</div>
        <div class="analytics-label">Всего рабочего времени</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-num">${prepaidLeft}</div>
        <div class="analytics-label">Предоплачено сеансов по ${activeCourses.length} ${activeCourses.length === 1 ? 'курсу' : 'курсам'}</div>
      </div>
    </div>

    <div class="history-section-title" style="margin-top:20px;">По месяцам</div>
    <div id="monthlyTable"></div>

    <button class="btn btn-primary" id="exportCsvBtn" style="margin-top:18px;">
      📥 Скачать историю (CSV для Excel)
    </button>
  `;

  const table = document.getElementById('monthlyTable');
  if (months.length === 0){
    table.innerHTML = '<div class="empty-state">Пока нет данных</div>';
  } else {
    months.forEach(m => {
      const [y, mo] = m.split('-');
      const label = `${MONTH_NAMES[Number(mo)-1]} ${y}`;
      const row = document.createElement('div');
      row.className = 'monthly-row';
      row.innerHTML = `
        <div class="monthly-label">${label}</div>
        <div class="monthly-stats">
          <span>${byMonth[m].visits} визитов</span>
          <span>${Math.floor(byMonth[m].minutes/60)} ч ${byMonth[m].minutes%60} мин</span>
          <span>${byMonth[m].revenue.toLocaleString('ru-RU')} ₽</span>
        </div>
        ${byMonth[m].courseSales || byMonth[m].courseVisits ? `
        <div class="monthly-sub">
          ${byMonth[m].courseSales ? `курсы проданы на ${byMonth[m].courseSales.toLocaleString('ru-RU')} ₽` : ''}
          ${byMonth[m].courseSales && byMonth[m].courseVisits ? ' · ' : ''}
          ${byMonth[m].courseVisits ? `по курсу ${byMonth[m].courseVisits} виз.` : ''}
        </div>` : ''}
      `;
      table.appendChild(row);
    });
  }

  document.getElementById('exportCsvBtn').addEventListener('click', async () => {
    const btn = document.getElementById('exportCsvBtn');
    btn.disabled = true;
    btn.textContent = 'Формируем файл...';
    try{ await Store.exportHistoryCsv(); }
    catch(e){ alert('Не удалось скачать файл'); }
    btn.disabled = false;
    btn.textContent = '📥 Скачать историю (CSV для Excel)';
  });
}

// ============================================================
// ПАРОЛЬНАЯ ЗАЩИТА (проверка на сервере)
// ============================================================
// Пароль сверяется в самой Cloud Function (переменная окружения
// ADMIN_PASSWORD) — в браузере он нигде не хранится в открытом виде,
// кроме как в sessionStorage на время активной сессии (нужно, чтобы
// не спрашивать пароль повторно при каждом клике и при обновлении страницы).
const SESSION_KEY = 'rai_admin_session';
const SESSION_PASS_KEY = 'rai_admin_pass';
const SESSION_DURATION_MS = 10 * 60 * 1000; // 10 минут

function startSession(password){
  sessionStorage.setItem(SESSION_KEY, String(Date.now()));
  sessionStorage.setItem(SESSION_PASS_KEY, password);
}

function hasValidSession(){
  const stamp = sessionStorage.getItem(SESSION_KEY);
  if (!stamp) return false;
  const elapsed = Date.now() - Number(stamp);
  return elapsed < SESSION_DURATION_MS;
}

function clearSession(){
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_PASS_KEY);
}

function showAdmin(){
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('adminContent').classList.remove('hidden');
  initAdminContent();
  scheduleAutoLogout();
}

function scheduleAutoLogout(){
  const stamp = Number(sessionStorage.getItem(SESSION_KEY));
  const remaining = SESSION_DURATION_MS - (Date.now() - stamp);
  setTimeout(() => {
    clearSession();
    location.reload();
  }, Math.max(remaining, 0));
}

async function checkPassword(){
  const input = document.getElementById('passwordInput');
  const error = document.getElementById('passwordError');
  const btn = document.getElementById('loginButton');
  const entered = input.value;

  btn.disabled = true;
  btn.textContent = 'Проверяем...';
  error.textContent = '';

  try{
    currentAdminPassword = entered; // нужно ДО вызова — callApi берёт его отсюда
    await withTimeout(callApi('adminLogin'), 8000);
    startSession(entered);
    showAdmin();
  }catch(e){
    currentAdminPassword = '';
    if (e && String(e.message).includes('too-many-attempts')){
      error.textContent = 'Слишком много попыток. Подождите немного и попробуйте снова.';
    } else {
      error.textContent = 'Неверный пароль';
    }
    input.value = '';
    input.focus();
  }finally{
    btn.disabled = false;
    btn.textContent = 'Войти';
  }
}

// ============================================================
// ЗАПИСЬ ОТ МАСТЕРА («Записать клиента / занять время»)
// ============================================================
// Дарья записывает постоянного клиента или просто занимает время — на любое
// время, в том числе закрытое в графике. Сервер график не проверяет, а сайт
// вычитает все брони из открытых часов: когда Дарья откроет этот день, время
// уже будет занято. Серверная сторона — createMasterBooking в index.js.

const SLOT_BUFFER_MIN = 15; // тот же зазор между визитами, что на сервере и сайте

// true — если время не лежит целиком внутри одного из открытых интервалов дня.
function isOutsideSchedule(date, start, end){
  const intervals = Store.schedule[date];
  if (!Array.isArray(intervals) || intervals.length === 0) return true;
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  return !intervals.some(i => i.start && i.end && timeToMinutes(i.start) <= s && e <= timeToMinutes(i.end));
}

function findLocalConflicts(date, start, end, excludeId){
  const s = timeToMinutes(start) - SLOT_BUFFER_MIN;
  const e = timeToMinutes(end) + SLOT_BUFFER_MIN;
  return Store.bookings.filter(b =>
    b.id !== excludeId && b.date === date && s < timeToMinutes(b.end) && e > timeToMinutes(b.start));
}

function describeConflict(c){
  const who = (c.kind === 'reserve' || c.clientName === 'Резерв') ? 'резерв' : (c.clientName || '');
  return `${c.start}–${c.end} ${who}`.trim();
}

// Телефон из любого вида ввода → 11 цифр с 7 впереди. Номер «918…» без кода
// страны тоже принимаем: Дарья набирает так, как привыкла.
function normalizePhoneInput(raw){
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10 && d[0] === '9') d = '7' + d;
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  return d;
}

function formatPhoneDisplay(d){
  return `+7 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7,9)}-${d.slice(9,11)}`;
}

const masterForm = {
  directory: null,   // [{ name, phone, tail, hasMessenger, when }] — для подсказок
  reserve: false,
  pendingId: null,   // id живёт до успеха: повтор после сбоя/подтверждения не создаст дубль
};

// Справочник для подсказок: карточки клиентов (все, кто хоть раз пришёл) +
// предстоящие брони (новенькие, у кого карточки ещё нет). По номеру
// оставляем самое свежее имя.
async function loadClientDirectory(){
  const byTail = new Map();
  const add = (name, phone, hasMessenger, when) => {
    const tail = phoneTail10(phone);
    if (tail.length !== 10 || !name) return;
    const prev = byTail.get(tail);
    if (!prev || String(when) > String(prev.when)){
      byTail.set(tail, { name, phone, tail, hasMessenger: hasMessenger || !!(prev && prev.hasMessenger), when });
    } else if (hasMessenger){
      prev.hasMessenger = true;
    }
  };

  let clients = {};
  try{ clients = await withTimeout(Store.getClients(), 8000); }
  catch(e){ console.error('loadClientDirectory:', e); }
  Object.values(clients).forEach(c => add(c.name, c.phone, !!(c.maxUserId || c.chatId), c.lastVisit || ''));
  Store.bookings.forEach(b => {
    if (b.kind === 'reserve') return;
    add(b.clientName, b.clientPhone, !!(b.clientMaxUserId || b.clientChatId), b.createdAt || b.date);
  });
  masterForm.directory = [...byTail.values()];
}

// Поиск: от трёх цифр — по телефону (с 7 или 8 впереди — неважно), от двух
// букв — по имени (регистр и ё/е не важны).
function searchDirectory(query){
  const list = masterForm.directory || [];
  const q = String(query || '').trim();
  const digits = q.replace(/\D/g, '');
  const letters = normName(q.replace(/[\d+()\-\s]+/g, ' '));
  let found = [];
  if (digits.length >= 3){
    found = list.filter(c => ('7' + c.tail).includes(digits) || ('8' + c.tail).includes(digits));
  } else if (letters.replace(/\s/g, '').length >= 2){
    found = list.filter(c => normName(c.name).includes(letters));
  }
  return found.sort((a, b) => String(b.when).localeCompare(String(a.when))).slice(0, 6);
}

function serviceOptionsHtml(){
  const groups = SERVICE_CATEGORIES.map(cat => `
    <optgroup label="${escapeHtml(cat.category)}">
      ${cat.services.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} · ${formatDuration(s.duration)} · ${s.price.toLocaleString('ru-RU')} ₽</option>`).join('')}
    </optgroup>`).join('');
  return `<option value="">Выберите услугу</option>${groups}<option value="custom">Другое — указать вручную</option>`;
}

function renderMasterBookingForm(){
  const box = document.getElementById('masterBookingForm');
  box.innerHTML = `
    <div class="segmented">
      <button type="button" data-mode="client" class="active">Клиент</button>
      <button type="button" data-mode="reserve">Просто занять время</button>
    </div>

    <div class="mf-client-only">
      <div class="field mf-search-field">
        <label for="mfSearch">Найти в базе</label>
        <input type="search" id="mfSearch" placeholder="Несколько цифр телефона или имя" autocomplete="off">
        <div class="suggestions hidden" id="mfSuggestions"></div>
      </div>
      <div class="mf-row">
        <div class="field"><label for="mfName">Имя</label><input id="mfName" maxlength="100" autocomplete="off"></div>
        <div class="field"><label for="mfPhone">Телефон</label><input id="mfPhone" type="tel" placeholder="+7 900 000-00-00" autocomplete="off"></div>
      </div>
      <div class="field">
        <label for="mfService">Услуга</label>
        <select id="mfService">${serviceOptionsHtml()}</select>
      </div>
      <div class="field mf-custom hidden"><label for="mfServiceName">Название услуги</label><input id="mfServiceName" maxlength="200"></div>
      <div class="mf-row">
        <div class="field"><label for="mfDuration">Длительность, мин</label><input id="mfDuration" type="number" min="5" max="600" step="5" inputmode="numeric"></div>
        <div class="field"><label for="mfPrice">Цена, ₽</label><input id="mfPrice" type="number" min="0" max="100000" step="50" inputmode="numeric"></div>
      </div>
    </div>

    <div class="mf-row">
      <div class="field"><label for="mfDate">Дата</label><input id="mfDate" type="date" value="${todayKey()}"></div>
      <div class="field"><label for="mfStart">Начало</label><input id="mfStart" type="time" step="300"></div>
      <div class="field mf-reserve-only hidden"><label for="mfEnd">До</label><input id="mfEnd" type="time" step="300"></div>
    </div>

    <div class="field"><label for="mfComment">Комментарий</label><input id="mfComment" maxlength="500" placeholder="Необязательно"></div>

    <label class="mf-check mf-client-only"><input type="checkbox" id="mfNotify" checked> Сообщить клиенту в MAX / Telegram (если подключён)</label>

    <div class="mf-info" id="mfInfo"></div>

    <div class="btn-row">
      <button class="btn btn-primary" id="mfSubmit" type="button">Записать</button>
      <button class="btn btn-ghost" id="mfCancel" type="button">Отмена</button>
    </div>
    <div class="save-status" id="mfStatus"></div>
  `;

  const $ = (id) => document.getElementById(id);

  box.querySelectorAll('.segmented button').forEach(btn => {
    btn.addEventListener('click', () => {
      masterForm.reserve = btn.dataset.mode === 'reserve';
      box.querySelectorAll('.segmented button').forEach(b => b.classList.toggle('active', b === btn));
      box.querySelectorAll('.mf-client-only').forEach(el => el.classList.toggle('hidden', masterForm.reserve));
      box.querySelectorAll('.mf-reserve-only').forEach(el => el.classList.toggle('hidden', !masterForm.reserve));
      $('mfSubmit').textContent = masterForm.reserve ? 'Занять время' : 'Записать';
      updateMasterFormInfo();
    });
  });

  // Подсказки из базы
  const search = $('mfSearch');
  const sugg = $('mfSuggestions');
  const showSuggestions = () => {
    const found = searchDirectory(search.value);
    if (!found.length){
      sugg.innerHTML = search.value.trim().length >= 2 ? '<div class="suggestion-empty">В базе не нашлось — заполните имя и телефон ниже</div>' : '';
      sugg.classList.toggle('hidden', !sugg.innerHTML);
      return;
    }
    sugg.innerHTML = found.map((c, i) => `
      <button type="button" class="suggestion-item" data-idx="${i}">
        <span class="suggestion-name">${escapeHtml(c.name)}</span>
        <span class="suggestion-phone">${escapeHtml(c.phone)}${c.hasMessenger ? ' · 💬' : ''}</span>
      </button>`).join('');
    sugg.classList.remove('hidden');
    sugg.querySelectorAll('.suggestion-item').forEach(item => {
      // mousedown, а не click: иначе blur поля спрячет список раньше, чем сработает выбор
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const c = found[Number(item.dataset.idx)];
        $('mfName').value = c.name;
        $('mfPhone').value = c.phone;
        search.value = '';
        sugg.classList.add('hidden');
        updateMasterFormInfo();
      });
    });
  };
  search.addEventListener('input', showSuggestions);
  search.addEventListener('focus', showSuggestions);
  search.addEventListener('blur', () => setTimeout(() => sugg.classList.add('hidden'), 150));
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') sugg.classList.add('hidden'); });

  $('mfService').addEventListener('change', () => {
    const val = $('mfService').value;
    $('mfServiceName').closest('.field').classList.toggle('hidden', val !== 'custom');
    const svc = val && val !== 'custom' ? getServiceById(val) : null;
    if (svc){
      $('mfDuration').value = svc.duration;
      $('mfPrice').value = svc.price;
    }
    updateMasterFormInfo();
  });

  ['mfName', 'mfPhone', 'mfDuration', 'mfDate', 'mfStart', 'mfEnd'].forEach(id => {
    $(id).addEventListener('input', updateMasterFormInfo);
    $(id).addEventListener('change', updateMasterFormInfo);
  });

  $('mfSubmit').addEventListener('click', () => submitMasterBooking(false));
  $('mfCancel').addEventListener('click', closeMasterBookingForm);
}

// Время окончания из формы: у клиента — начало + длительность услуги,
// у резерва — поле «До». null — если данных пока не хватает.
function masterFormTimes(){
  const $ = (id) => document.getElementById(id);
  const date = $('mfDate').value;
  const start = $('mfStart').value;
  if (!date || !start) return null;
  let end;
  if (masterForm.reserve){
    end = $('mfEnd').value;
    if (!end || timeToMinutes(end) <= timeToMinutes(start)) return { date, start, end: null };
  } else {
    const dur = Number($('mfDuration').value);
    if (!Number.isFinite(dur) || dur < 5) return { date, start, end: null };
    const endMin = timeToMinutes(start) + dur;
    if (endMin >= 24 * 60) return { date, start, end: null };
    end = minutesToTime(endMin);
  }
  return { date, start, end };
}

// Живые подсказки под формой: до кнопки «Записать» Дарья видит, что будет.
function updateMasterFormInfo(){
  const info = document.getElementById('mfInfo');
  if (!info) return;
  const lines = [];
  const t = masterFormTimes();

  if (t && t.end){
    lines.push(`<div>🕐 ${escapeHtml(t.start)}–${escapeHtml(t.end)}</div>`);
    if (isOutsideSchedule(t.date, t.start, t.end)){
      lines.push(`<div class="mf-note">🔒 Время закрыто в графике — клиенты его не видят. Когда откроете этот день, оно уже будет занято.</div>`);
    }
    const conflicts = findLocalConflicts(t.date, t.start, t.end);
    if (conflicts.length){
      lines.push(`<div class="mf-warn">⚠️ Пересекается (с учётом 15 минут между визитами): ${conflicts.map(c => escapeHtml(describeConflict(c))).join(', ')}</div>`);
    }
    const startsAt = new Date(`${t.date}T${t.start}:00`);
    if (startsAt.getTime() < Date.now()){
      lines.push(`<div class="mf-warn">⚠️ Это время уже прошло</div>`);
    }
  }

  if (!masterForm.reserve){
    const phone = normalizePhoneInput(document.getElementById('mfPhone').value);
    if (phone.length === 11 && masterForm.directory){
      const known = masterForm.directory.find(c => c.tail === phone.slice(-10));
      if (known && known.hasMessenger){
        lines.push(`<div class="mf-note">💬 У клиента подключён MAX или Telegram — сообщение о записи и напоминание придут автоматически.</div>`);
      } else if (known){
        lines.push(`<div class="mf-note">У клиента не подключены MAX и Telegram — о записи и напоминании сообщите сами.</div>`);
      }
    }
  }

  info.innerHTML = lines.join('');
}

const MASTER_FIELD_NAMES = {
  clientName: 'имя', clientPhone: 'телефон', serviceName: 'услуга', servicePrice: 'цена',
  serviceDuration: 'длительность', date: 'дата', start: 'время начала', end: 'время окончания', comment: 'комментарий',
};

async function submitMasterBooking(force){
  const $ = (id) => document.getElementById(id);
  const status = $('mfStatus');
  const btn = $('mfSubmit');
  const fail = (msg) => { status.textContent = msg; status.style.color = '#B07E7E'; };
  status.textContent = '';

  // Услугу — раньше времени: длительность берётся из неё, и без услуги
  // ошибка «укажите длительность» сбивала бы с толку.
  if (!masterForm.reserve && !$('mfService').value) return fail('Выберите услугу');
  const t = masterFormTimes();
  if (!t) return fail('Укажите дату и время начала');
  if (!t.end) return fail(masterForm.reserve ? 'Укажите, до какого времени занять' : 'Укажите длительность (время не должно переходить за полночь)');

  const booking = {
    id: masterForm.pendingId || (masterForm.pendingId = (crypto.randomUUID ? crypto.randomUUID() : `m${Date.now()}${Math.random().toString(36).slice(2, 10)}`)),
    date: t.date, start: t.start, end: t.end,
    comment: $('mfComment').value.trim(),
  };

  if (!masterForm.reserve){
    const name = $('mfName').value.trim();
    const phone = normalizePhoneInput($('mfPhone').value);
    const svcId = $('mfService').value;
    const svc = svcId && svcId !== 'custom' ? getServiceById(svcId) : null;
    const serviceName = svcId === 'custom' ? $('mfServiceName').value.trim() : (svc ? svc.name : '');
    if (name.length < 2) return fail('Укажите имя клиента');
    if (phone.length !== 11 || phone[1] !== '9') return fail('Телефон — мобильный, 11 цифр (+7 9…)');
    if (!serviceName) return fail('Выберите услугу');
    Object.assign(booking, {
      clientName: name,
      clientPhone: formatPhoneDisplay(phone),
      serviceName,
      serviceDuration: Number($('mfDuration').value),
      servicePrice: Number($('mfPrice').value) || 0,
    });
    // id услуги из каталога — по нему сервер сам спишет запись с курса
    // клиентки, как и при записи с сайта.
    if (svc) booking.serviceItems = [{ id: svc.id, price: booking.servicePrice }];
  }

  const notifyClient = !masterForm.reserve && $('mfNotify').checked;
  btn.disabled = true;
  btn.textContent = 'Сохраняем...';
  const resetBtn = () => { btn.disabled = false; btn.textContent = masterForm.reserve ? 'Занять время' : 'Записать'; };

  let result;
  try{
    result = await withTimeout(Store.createMasterBooking({ booking, reserve: masterForm.reserve, force, notifyClient }), 12000);
  }catch(e){
    resetBtn();
    return fail('Сервер не отвечает — попробуйте ещё раз (повтор не создаст дубль)');
  }

  const { status: code, data } = result;
  if (code === 409 && data.conflicts){
    const list = data.conflicts.map(describeConflict).join('\n');
    resetBtn();
    if (confirm(`Время пересекается с другими записями (с учётом 15 минут между визитами):\n${list}\n\nЗаписать всё равно?`)){
      return submitMasterBooking(true);
    }
    return;
  }
  if (code === 401){
    resetBtn();
    return fail('Сессия истекла — обновите страницу и войдите снова');
  }
  if (code !== 200 || !data.booking){
    resetBtn();
    const field = data && data.field ? ` (${MASTER_FIELD_NAMES[data.field] || data.field})` : '';
    return fail(`Не удалось записать: проверьте поля${field}`);
  }

  // Успех
  if (!Store.bookings.some(b => b.id === data.booking.id)){
    Store.bookings.push({ ...data.booking, clientNotes: '' });
  }
  const parts = [masterForm.reserve ? '✓ Время занято' : '✓ Записано'];
  if (data.booking.courseId) parts.push(`🎟 по курсу «${data.booking.courseName}»`);
  if (!masterForm.reserve && notifyClient){
    if (data.clientNotified === 'max') parts.push('клиенту отправлено в MAX');
    else if (data.clientNotified === 'telegram') parts.push('клиенту отправлено в Telegram');
    else if (data.clientHasMessenger) parts.push('сообщение клиенту не дошло — сообщите сами');
    else parts.push('мессенджер у клиента не подключён — сообщите сами');
  }
  closeMasterBookingForm();
  const resultEl = $('masterBookingResult');
  resultEl.style.color = 'var(--good)';
  resultEl.textContent = parts.join(' · ');
  setTimeout(() => { if (resultEl.textContent === parts.join(' · ')) resultEl.textContent = ''; }, 10000);
  renderBookingsList();
}

async function openMasterBookingForm(){
  const box = document.getElementById('masterBookingForm');
  document.getElementById('masterBookingResult').textContent = '';
  masterForm.reserve = false;
  masterForm.pendingId = null;
  renderMasterBookingForm();
  box.classList.remove('hidden');
  document.getElementById('masterBookingOpen').classList.add('hidden');
  // Справочник грузим при каждом открытии: брони и карточки могли измениться.
  await loadClientDirectory();
  updateMasterFormInfo();
}

function closeMasterBookingForm(){
  const box = document.getElementById('masterBookingForm');
  box.classList.add('hidden');
  box.innerHTML = '';
  masterForm.pendingId = null;
  document.getElementById('masterBookingOpen').classList.remove('hidden');
}

function setupMasterBooking(){
  document.getElementById('masterBookingOpen').addEventListener('click', openMasterBookingForm);
}

// ============================================================
// INIT — админ-страница
// ============================================================
async function initAdminContent(){
  await Store.loadSchedule();
  await Store.loadBookings();
  renderWeek();

  document.getElementById('prevWeek').addEventListener('click', () => {
    if (adminState.weekOffset > 0){ adminState.weekOffset--; renderWeek(); }
  });
  document.getElementById('nextWeek').addEventListener('click', () => {
    adminState.weekOffset++; renderWeek();
  });
  document.getElementById('saveSchedule').addEventListener('click', saveScheduleHandler);
  setupAdminTabs();
  setupClientsSearch();
  setupMasterBooking();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginButton').addEventListener('click', checkPassword);
  document.getElementById('passwordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') checkPassword();
  });

  if (hasValidSession()){
    currentAdminPassword = sessionStorage.getItem(SESSION_PASS_KEY) || '';
    showAdmin();
  } else {
    clearSession();
    document.getElementById('passwordInput').focus();
  }
});


