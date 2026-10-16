// Каталога услуг здесь нет намеренно: админка показывает название, цену и
// длительность из самой брони — то, что клиент выбрал в момент записи.
// Единственный каталог — в js/booking.js. Раньше тут лежала его устаревшая
// копия, которая нигде не использовалась и расходилась с сайтом по ценам.

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

  async saveNewBooking(booking){
    await callApi('createBooking', { booking });
  },

  async deleteBooking(bookingId, options){
    await callApi('deleteBooking', { bookingId, notifyCancellation: !!(options && options.notifyCancellation) });
  },

  async updateBooking(bookingId, { date, start, end }){
    await callApi('updateBookingTime', { bookingId, date, start, end });
  },

  async markBooking(bookingId, status){
    await callApi('markBooking', { bookingId, status });
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

    const card = document.createElement('div');
    card.className = 'booking-card' + (isNew(b) ? ' booking-new' : '');
    card.innerHTML = `
      <div class="booking-top">
        <span class="booking-date">${dateStr}${isNew(b) ? ' <span class="new-badge">НОВАЯ</span>' : ''}${isChanged(b) ? ' <span class="changed-badge">ИЗМЕНЕНА</span>' : ''}</span>
        <span class="booking-time">${escapeHtml(b.start)}–${escapeHtml(b.end)}</span>
      </div>
      <div class="booking-service">${escapeHtml(disambiguateServiceName(b.serviceName, b.serviceDuration))} · ${b.servicePrice.toLocaleString('ru-RU')} ₽</div>
      ${clientLine(b.clientName, b.clientPhone)}
      ${b.comment ? `<div class="booking-comment">💬 ${escapeHtml(b.comment)}</div>` : ''}
      ${b.clientNotes ? `<div class="booking-comment client-note">📌 ${escapeHtml(b.clientNotes)}</div>` : ''}
      <div class="booking-actions">
        <button class="edit-booking-btn" data-booking-id="${escapeHtml(b.id)}">Изменить время</button>
        <button class="cancel-booking-btn" data-booking-id="${escapeHtml(b.id)}">Отменить запись</button>
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
  try{ history = await Store.getHistory(); }
  catch(e){ container.innerHTML = '<div class="empty-state">Ошибка загрузки</div>'; return; }

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
  card.innerHTML = `
    <div class="booking-top">
      <span class="booking-date">${dateStr}</span>
      <span class="booking-time">${escapeHtml(b.start)}–${escapeHtml(b.end)}</span>
    </div>
    <div class="booking-service">${escapeHtml(disambiguateServiceName(b.serviceName, b.serviceDuration))} · ${b.servicePrice.toLocaleString('ru-RU')} ₽</div>
    ${clientLine(b.clientName, b.clientPhone)}
    <div class="mark-actions">
      <button class="mark-btn mark-completed" data-id="${escapeHtml(b.id)}">✅ Пришёл</button>
      <button class="mark-btn mark-noshow" data-id="${escapeHtml(b.id)}">❌ Не пришёл</button>
    </div>
  `;
  card.querySelector('.mark-completed').addEventListener('click', () => markBooking(b.id, 'completed', card));
  card.querySelector('.mark-noshow').addEventListener('click', () => markBooking(b.id, 'no_show', card));
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
  card.innerHTML = `
    <div class="booking-top">
      <span class="booking-date">${dateStr}</span>
      <span class="booking-time">${escapeHtml(h.start)}–${escapeHtml(h.end)}</span>
    </div>
    <div class="booking-service">${escapeHtml(disambiguateServiceName(h.serviceName, h.serviceDuration))} · ${h.servicePrice.toLocaleString('ru-RU')} ₽</div>
    ${clientLine(h.clientName, h.clientPhone)}
    ${statusBadge}
  `;
  return card;
}

async function markBooking(bookingId, status, card){
  const btns = card.querySelectorAll('.mark-btn');
  btns.forEach(b => b.disabled = true);
  try{
    await withTimeout(Store.markBooking(bookingId, status), 10000);
    // обновить список записей в памяти
    const idx = Store.bookings.findIndex(b => b.id === bookingId);
    if (idx !== -1) Store.bookings.splice(idx, 1);
    renderHistoryTab();
  }catch(e){
    alert('Не удалось сохранить отметку. Попробуйте снова.');
    btns.forEach(b => b.disabled = false);
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
    // Историю берём тем же action, что и вкладка «История» — бэкенд не трогаем.
    [clients, history] = await Promise.all([Store.getClients(), Store.getHistory()]);
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
    const service = disambiguateServiceName(h.serviceName, h.serviceDuration);
    const price = isNoShow
      ? '<span class="visit-noshow-tag">не пришёл</span>'
      : `${(h.servicePrice||0).toLocaleString('ru-RU')} ₽`;
    return `
      <div class="visit-row${isNoShow ? ' noshow' : ''}">
        <div class="visit-when">${escapeHtml(dateStr)}<small>${escapeHtml(dow)}, ${escapeHtml(h.start||'')}</small></div>
        <div class="visit-what"><b>${escapeHtml(service)}</b><br>${price}</div>
      </div>`;
  }).join('');
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
  try{ history = await Store.getHistory(); }
  catch(e){ container.innerHTML = '<div class="empty-state">Ошибка загрузки</div>'; return; }

  const completed = history.filter(h => h.status === 'completed');
  const noshow    = history.filter(h => h.status === 'no_show');

  // Считаем по месяцам
  const byMonth = {};
  completed.forEach(h => {
    const month = h.date.slice(0,7); // YYYY-MM
    if (!byMonth[month]) byMonth[month] = { visits:0, revenue:0, minutes:0 };
    byMonth[month].visits++;
    byMonth[month].revenue += h.servicePrice || 0;
    byMonth[month].minutes += h.serviceDuration || 0;
  });

  const totalRevenue = completed.reduce((s,h)=>s+(h.servicePrice||0), 0);
  const totalMinutes = completed.reduce((s,h)=>s+(h.serviceDuration||0), 0);
  const uniqueClients = new Set(completed.map(h => h.clientPhone.replace(/\D/g,''))).size;

  const months = Object.keys(byMonth).sort().reverse();
  const MONTH_NAMES = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];

  container.innerHTML = `
    <div class="analytics-summary">
      <div class="analytics-card">
        <div class="analytics-num">${completed.length}</div>
        <div class="analytics-label">Выполнено визитов</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-num">${noshow.length}</div>
        <div class="analytics-label">Не пришли</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-num">${uniqueClients}</div>
        <div class="analytics-label">Уникальных клиентов</div>
      </div>
      <div class="analytics-card">
        <div class="analytics-num">${Math.floor(totalMinutes/60)} ч ${totalMinutes%60} мин</div>
        <div class="analytics-label">Всего рабочего времени</div>
      </div>
      <div class="analytics-card analytics-card-wide">
        <div class="analytics-num">${totalRevenue.toLocaleString('ru-RU')} ₽</div>
        <div class="analytics-label">Всего заработано</div>
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


