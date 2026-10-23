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

// Экранируем спецсимволы перед вставкой данных клиента в innerHTML —
// без этого имя/комментарий со скриптом внутри могли бы выполниться
// в чужом браузере (XSS). Бэкенд теперь тоже режет угловые скобки на
// входе, но это резервный слой на случай старых записей или будущих багов.
function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ============================================================
// ОБЩЕЕ ХРАНИЛИЩЕ (используется и клиентом, и мастером)
// ============================================================

// ============================================================
// НАСТРОЙКИ YANDEX CLOUD FUNCTION (заменяет Supabase)
// ============================================================
const API_URL = 'https://api.rai-krd.ru';

async function callApi(action, extra){
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok){
    throw new Error('api-error: ' + (data.error || res.status));
  }
  return data;
}

const Store = {
  schedule: {},
  bookedSlots: [], // только {date, start, end} — без личных данных клиентов

  async loadSchedule(){
    try{
      const data = await callApi('getSchedule');
      this.schedule = data.schedule || {};
    }catch(e){
      console.error('loadSchedule error:', e);
      this.schedule = {};
    }
  },

  async loadBookedSlots(){
    try{
      const data = await callApi('getBookedSlots');
      this.bookedSlots = data.slots || [];
    }catch(e){
      console.error('loadBookedSlots error:', e);
      this.bookedSlots = [];
    }
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
    // Сервер сам генерирует cancelCode и createdAt и validated-версию
    // остальных полей — возвращаем это клиенту, чтобы показать именно
    // то, что реально сохранено (а не то, что клиент отправил).
    const data = await callApi('createBooking', { booking });
    return data.booking;
  },

  // Проверка телефона и поиск/отмена/перенос теперь целиком на сервере —
  // клиент только показывает то, что сервер разрешил (см. index.js).
  async findByPhone(phone, hp){
    const data = await callApi('getBookingsByPhone', { phone, hp });
    return data.bookings || [];
  },

  async cancelByPhone(phone, id){
    return await callApi('cancelBookingByPhone', { phone, id });
  },

  async rescheduleByPhone(phone, id, newStart){
    return await callApi('rescheduleBookingByPhone', { phone, id, newStart });
  },

};

function withTimeout(promise, ms){
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
  return Promise.race([promise, timeout]);
}

// ============================================================



// ============================================================
// ===================  CLIENT-SIDE LOGIC  ====================
// ============================================================

const DOW_LABELS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const MONTH_LABELS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

const MAX_SELECTED_SERVICES = 3;

const clientState = {
  selectedServiceIds: [], // массив id выбранных услуг, порядок = порядок выбора
  calendarMonth: new Date().getMonth(),
  calendarYear: new Date().getFullYear(),
  selectedDate: null,
  selectedSlot: null,
};

// Возвращает выбранные услуги как массив объектов (в порядке выбора)
function getSelectedServices(){
  return clientState.selectedServiceIds.map(id => getServiceById(id)).filter(Boolean);
}

function getSelectedTotalDuration(){
  return getSelectedServices().reduce((sum, s) => sum + s.duration, 0);
}

function getSelectedTotalPrice(){
  return getSelectedServices().reduce((sum, s) => sum + s.price, 0);
}

function getSelectedCombinedName(){
  return getSelectedServices().map(s => s.name).join(', ');
}

function buildServiceCardElement(svc){
  const el = document.createElement('div');
  el.className = 'service';
  el.dataset.id = svc.id;

  const hasDetails = Array.isArray(svc.includes) && svc.includes.length > 0;

  let detailsHtml = '';
  if (hasDetails){
    const photoHtml = svc.photo
      ? `<img class="spa-photo" src="${svc.photo}" alt="${svc.name}" loading="lazy">`
      : '';
    const listItems = svc.includes.map(item => `<li>${item}</li>`).join('');
    detailsHtml = `
      <button class="spa-toggle" data-toggle="${svc.id}">
        <span>Что входит в программу</span>
        <span class="spa-chev" data-chev="${svc.id}">▾</span>
      </button>
      <div class="spa-details hidden" data-details="${svc.id}">
        ${photoHtml}
        <ul class="spa-list">${listItems}</ul>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="service-main">
      <div class="service-row">
        <div>
          <div class="service-name">${svc.name}</div>
          <div class="service-meta">${formatDuration(svc.duration)}</div>
        </div>
        <div class="service-price">${svc.price.toLocaleString('ru-RU')} ₽</div>
      </div>
      ${detailsHtml}
    </div>
  `;

  // Клик по строке услуги — выбор для записи
  el.querySelector('.service-row').addEventListener('click', () => toggleService(svc.id));

  // Клик по «Что входит» — раскрытие описания, без выбора услуги
  if (hasDetails){
    const toggleBtn = el.querySelector(`[data-toggle="${svc.id}"]`);
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const details = el.querySelector(`[data-details="${svc.id}"]`);
      const chev = el.querySelector(`[data-chev="${svc.id}"]`);
      const nowHidden = details.classList.toggle('hidden');
      chev.classList.toggle('open', !nowHidden);
    });
  }

  return el;
}

function renderServices(){
  const container = document.getElementById('servicesList');
  container.innerHTML = '';
  SERVICE_CATEGORIES.forEach(cat => {
    const label = document.createElement('div');
    label.className = 'category-label';
    label.textContent = cat.category;
    container.appendChild(label);

    if (cat.note){
      const note = document.createElement('div');
      note.className = 'category-note';
      note.textContent = cat.note;
      container.appendChild(note);
    }

    cat.services.forEach(svc => {
      container.appendChild(buildServiceCardElement(svc));
    });
  });
  updateServicesFooter();
}

function toggleService(id){
  const idx = clientState.selectedServiceIds.indexOf(id);
  if (idx !== -1){
    // уже выбрана — снимаем выбор
    clientState.selectedServiceIds.splice(idx, 1);
  } else {
    if (clientState.selectedServiceIds.length >= MAX_SELECTED_SERVICES){
      alert(`Можно выбрать не более ${MAX_SELECTED_SERVICES} услуг за одно посещение`);
      return;
    }
    clientState.selectedServiceIds.push(id);
  }

  document.querySelectorAll('.service').forEach(el=>{
    el.classList.toggle('selected', clientState.selectedServiceIds.includes(el.dataset.id));
  });

  updateServicesFooter();
}

function updateServicesFooter(){
  const count = clientState.selectedServiceIds.length;
  const totalDuration = getSelectedTotalDuration();
  const totalPrice = getSelectedTotalPrice();

  const footer = document.getElementById('servicesFooter');
  if (count === 0){
    footer.classList.add('hidden');
    return;
  }

  footer.classList.remove('hidden');
  document.getElementById('selectedServicesSummary').innerHTML = `
    <span>${count === 1 ? 'Выбрана 1 услуга' : `Выбрано услуг: ${count}`} · ${formatDuration(totalDuration)}</span>
    <span class="selected-total-price">${totalPrice.toLocaleString('ru-RU')} ₽</span>
  `;
  document.getElementById('toStep2').disabled = false;
}


// Те же пороги, что и на сервере (index.js) — держим в синхроне вручную,
// это просто предпросмотр для UX, финальное решение всегда за сервером.
// Считаем фактическое время услуг (end−start), 15-минутные буферы между
// визитами сюда не входят.
const DAILY_CLOSE_THRESHOLD_MIN = 5 * 60; // 300 — при достижении дня закрывается
const DAILY_HARD_CAP_MIN = 6 * 60;        // 360 — потолок, который нельзя пробить

function getDailyBookedMinutes(bookingsToday){
  return bookingsToday.reduce((sum, b) => sum + (timeToMinutes(b.end) - timeToMinutes(b.start)), 0);
}

// excludeSlot — необязательный {start, end}: при переносе времени уже
// существующей брони исключаем её собственный текущий слот из подсчёта,
// иначе бронь мешала бы сама себе и сдвиг даже на 15–30 минут был бы
// невозможен. Для обычной записи (excludeSlot не передан) поведение то же,
// что и раньше.
function getAvailableSlotsForDate(dateKeyStr, durationMinutes, excludeSlot){
  const intervals = Store.schedule[dateKeyStr];
  if (!intervals || !Array.isArray(intervals) || intervals.length === 0) return [];

  let bookingsToday = Store.bookedSlots.filter(b => b.date === dateKeyStr);
  if (excludeSlot){
    bookingsToday = bookingsToday.filter(b => !(b.start === excludeSlot.start && b.end === excludeSlot.end));
  }

  // «Мягкий» порог закрытия дня — это ограничение против переполнения
  // НОВЫМИ записями. При переносе клиент двигает свою же уже учтённую
  // бронь внутри того же дня, поэтому этот порог здесь не применяем —
  // только жёсткий потолок 6ч чуть ниже.
  const dailyMinutes = getDailyBookedMinutes(bookingsToday);
  if (!excludeSlot && dailyMinutes >= DAILY_CLOSE_THRESHOLD_MIN) return [];

  // Если суммы пока не хватает для закрытия дня, но именно ЭТА услуга
  // (например, длинная SPA-программа) пробила бы потолок 6ч — день
  // остаётся открытым для более коротких услуг, просто не для этой.
  if (dailyMinutes + durationMinutes > DAILY_HARD_CAP_MIN) return [];

  const slots = [];
  const STEP = 15;
  const BUFFER = 15; // минимальный промежуток между соседними записями

  intervals.forEach(interval => {
    if (!interval.start || !interval.end) return;
    const dayStart = timeToMinutes(interval.start);
    const dayEnd = timeToMinutes(interval.end);

    for (let t = dayStart; t + durationMinutes <= dayEnd; t += STEP) {
      const slotStart = t;
      const slotEnd = t + durationMinutes;

      if (dateKeyStr === todayKey()) {
        const now = new Date();
        const nowMinutes = now.getHours()*60 + now.getMinutes();
        if (slotStart <= nowMinutes + 30) continue;
      }

      // A slot conflicts if it falls within BUFFER minutes of any existing booking
      // on either side — this guarantees a 15-minute gap between consecutive appointments.
      const overlaps = bookingsToday.some(b => {
        const bStart = timeToMinutes(b.start) - BUFFER;
        const bEnd = timeToMinutes(b.end) + BUFFER;
        return slotStart < bEnd && slotEnd > bStart;
      });

      if (!overlaps) slots.push(minutesToTime(slotStart));
    }
  });

  // dedupe + sort, in case intervals overlap or produce the same slot twice
  return [...new Set(slots)].sort();
}

function dateHasAnySlots(dateKeyStr){
  if (clientState.selectedServiceIds.length === 0) return false;
  const intervals = Store.schedule[dateKeyStr];
  if (!intervals || !Array.isArray(intervals) || intervals.length === 0) return false;
  return getAvailableSlotsForDate(dateKeyStr, getSelectedTotalDuration()).length > 0;
}

function renderCalendar(){
  const y = clientState.calendarYear;
  const m = clientState.calendarMonth;

  document.getElementById('calMonthLabel').textContent = `${MONTH_LABELS[m]} ${y}`;

  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';

  DOW_LABELS.forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(y, m, 1);
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  const daysInMonth = new Date(y, m+1, 0).getDate();

  for (let i=0; i<startOffset; i++){
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    grid.appendChild(el);
  }

  const tKey = todayKey();

  for (let d=1; d<=daysInMonth; d++){
    const key = dateKeyFromParts(y,m,d);
    const el = document.createElement('div');
    el.textContent = d;
    el.classList.add('cal-day');

    const isPast = key < tKey;
    const hasSlots = !isPast && dateHasAnySlots(key);

    if (key === tKey) el.classList.add('today');
    if (isPast) {
      el.classList.add('past');
    } else if (hasSlots) {
      el.classList.add('available');
      el.addEventListener('click', () => selectDate(key));
    } else {
      el.classList.add('no-slots');
    }

    if (clientState.selectedDate === key) el.classList.add('selected');

    grid.appendChild(el);
  }

  const now = new Date();
  const prevBtn = document.getElementById('prevMonth');
  prevBtn.disabled = (y === now.getFullYear() && m === now.getMonth());
}

function selectDate(key){
  clientState.selectedDate = key;
  clientState.selectedSlot = null;
  pendingBooking = null; // параметры записи изменились — старая попытка больше не актуальна
  renderCalendar();
  renderSlots();
  document.getElementById('toStep3').disabled = true;
}

function renderSlots(){
  const section = document.getElementById('slotsSection');
  const grid = document.getElementById('slotsGrid');
  grid.innerHTML = '';

  if (!clientState.selectedDate){
    section.classList.add('hidden');
    return;
  }

  const slots = getAvailableSlotsForDate(clientState.selectedDate, getSelectedTotalDuration());

  if (slots.length === 0){
    section.classList.remove('hidden');
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">На этот день свободного времени не осталось. Попробуйте другой день.</div>`;
    return;
  }

  section.classList.remove('hidden');
  slots.forEach(s => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.textContent = s;
    if (clientState.selectedSlot === s) el.classList.add('selected');
    el.addEventListener('click', () => {
      clientState.selectedSlot = s;
      pendingBooking = null; // параметры записи изменились — старая попытка больше не актуальна
      document.querySelectorAll('.slot').forEach(x=>x.classList.remove('selected'));
      el.classList.add('selected');
      document.getElementById('toStep3').disabled = false;
    });
    grid.appendChild(el);
  });
}

function goToStep(n){
  [1,2,3,4].forEach(i => {
    document.getElementById('step'+i).classList.toggle('hidden', i !== n);
  });
  document.querySelectorAll('.step-dot').forEach(dot => {
    const s = Number(dot.dataset.step);
    dot.classList.toggle('active', s === n);
    dot.classList.toggle('done', s < n);
  });

  // Reviews are only relevant on the service-selection step; the cancel button stays visible on every step
  document.getElementById('reviewsPanel').classList.toggle('hidden', n !== 1);

  if (n === 2){
    document.getElementById('step2hint').textContent =
      `${getSelectedCombinedName()} · ${formatDuration(getSelectedTotalDuration())}`;
    renderCalendar();
    renderSlots();
  }
  if (n === 3){
    renderSummary();
  }
  window.scrollTo({top:0, behavior:'smooth'});
}

function renderSummary(){
  const services = getSelectedServices();
  const dateObj = new Date(clientState.selectedDate + 'T00:00:00');
  const dateStr = dateObj.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'long' });

  const servicesRows = services.map(s => `
    <div class="summary-row"><span class="label">${s.name}</span><span>${s.price.toLocaleString('ru-RU')} ₽</span></div>
  `).join('');

  document.getElementById('bookingSummary').innerHTML = `
    ${servicesRows}
    <div class="summary-row"><span class="label">Дата</span><span>${dateStr}</span></div>
    <div class="summary-row"><span class="label">Время</span><span>${clientState.selectedSlot}</span></div>
    <div class="summary-row total"><span class="label">К оплате</span><span>${getSelectedTotalPrice().toLocaleString('ru-RU')} ₽</span></div>
  `;
}

let pendingBooking = null; // переживает повторные клики на одну и ту же попытку записи

async function submitBooking(){
  const btn = document.getElementById('submitBooking');

  // Защита от двойного клика: если запрос уже в процессе — игнорируем повторное нажатие
  if (btn.dataset.submitting === '1') return;

  const name = document.getElementById('clientName').value.trim();
  const phone = document.getElementById('clientPhone').value.trim();
  const comment = document.getElementById('clientComment').value.trim();

  if (!name || !phone){
    alert('Пожалуйста, заполните имя и телефон');
    return;
  }

  if (!document.getElementById('consentPD').checked){
    alert('Пожалуйста, подтвердите согласие на обработку персональных данных');
    return;
  }

  // Мобильный РФ: 11 цифр, код страны 7 (принимаем и 8), код оператора — всегда
  // на 9. Проверка на 9 отсекает и «+7 (8xx)», и городские номера, по которым
  // Дарья потом не дозвонится.
  const digitsOnly = phone.replace(/\D/g, '');
  const phoneDigits = digitsOnly.startsWith('8') ? '7' + digitsOnly.slice(1) : digitsOnly;
  if (phoneDigits.length !== 11 || !/^79/.test(phoneDigits)){
    alert('Проверьте номер телефона: мобильный начинается с +7 9, например +7 900 000-00-00');
    return;
  }

  // Создаём объект записи только один раз — повторные попытки (после сбоя)
  // переиспользуют тот же id, чтобы upsert не создавал дубликаты.
  if (!pendingBooking){
    const services = getSelectedServices();
    const totalDuration = getSelectedTotalDuration();
    const totalPrice = getSelectedTotalPrice();
    const startMinutes = timeToMinutes(clientState.selectedSlot);
    const endTime = minutesToTime(startMinutes + totalDuration);

    pendingBooking = {
      id: 'bk_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      date: clientState.selectedDate,
      start: clientState.selectedSlot,
      end: endTime,
      serviceName: services.map(s => s.name).join(', '),
      serviceDuration: totalDuration,
      servicePrice: totalPrice,
      clientName: name,
      clientPhone: phone,
      comment: comment,
      createdAt: new Date().toISOString()
    };
  }

  const booking = pendingBooking;

  btn.dataset.submitting = '1';
  btn.disabled = true;
  btn.textContent = 'Отправляем...';

  try{
    // Более долгий таймаут — Yandex Cloud Function может "холодно" стартовать
    // после паузы в обращениях, первый запрос иногда занимает дольше обычного.
    // Уведомление в Telegram отправляется самой функцией на сервере — отдельного
    // вызова из браузера больше не требуется.
    const savedBooking = await withTimeout(Store.saveNewBooking(booking), 20000);
    if (!Store.bookedSlots.some(b => b.date === booking.date && b.start === booking.start && b.end === booking.end)){
      Store.bookedSlots.push({ date: booking.date, start: booking.start, end: booking.end });
    }
    pendingBooking = null;
    // savedBooking — это то, что реально записано на сервере (сервер сам
    // проставляет cancelCode/createdAt). На случай сбоя ответа подстрахуемся
    // локальным объектом, чтобы экран подтверждения не сломался совсем.
    showConfirmation(savedBooking || booking);
  }catch(e){
    console.error('Booking submission error:', e);

    // Особый случай: пока клиент оформлял запись, это время заняли —
    // сервер отклонил попытку. Нужно вернуть к выбору времени с актуальными данными.
    if (e && String(e.message).includes('slot-taken')){
      alert('Это время только что заняли. Пожалуйста, выберите другое.');
      pendingBooking = null;
      clientState.selectedSlot = null;
      btn.dataset.submitting = '0';
      btn.disabled = false;
      btn.textContent = 'Записаться';
      try{ await Store.loadBookedSlots(); }catch(err){ /* покажем что есть */ }
      goToStep(2);
      return;
    }

    // Похожий случай: пока клиент оформлял запись, набралось 5ч на этот
    // день и он закрылся для новых броней (например, кто-то другой успел
    // записаться первым). Тоже возвращаем к выбору даты/времени.
    if (e && String(e.message).includes('day-full')){
      alert('На этот день уже набралось достаточно записей. Пожалуйста, выберите другую дату.');
      pendingBooking = null;
      clientState.selectedDate = null;
      clientState.selectedSlot = null;
      btn.dataset.submitting = '0';
      btn.disabled = false;
      btn.textContent = 'Записаться';
      try{ await Store.loadBookedSlots(); }catch(err){ /* покажем что есть */ }
      goToStep(2);
      return;
    }

    let msg = 'Не удалось отправить запись. Попробуйте ещё раз.';
    if (e && e.message === 'timeout'){
      msg = 'Сервер долго не отвечает. Можно попробовать ещё раз — повторное нажатие не создаст вторую запись.';
    } else if (e && String(e.message).includes('api-error')){
      msg = 'Не удалось подключиться к серверу. Проверьте интернет и попробуйте снова.';
    }
    alert(msg);
    // pendingBooking НЕ сбрасываем — следующая попытка переиспользует тот же id
    btn.dataset.submitting = '0';
    btn.disabled = false;
    btn.textContent = 'Записаться';
  }
}

function showConfirmation(booking){
  const dateObj = new Date(booking.date + 'T00:00:00');
  const dateStr = dateObj.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'long' });

  document.getElementById('confirmDetails').innerHTML = `
    <div class="row"><span>Услуга</span><span>${escapeHtml(booking.serviceName)}</span></div>
    <div class="row"><span>Дата</span><span>${escapeHtml(dateStr)}</span></div>
    <div class="row"><span>Время</span><span>${escapeHtml(booking.start)}–${escapeHtml(booking.end)}</span></div>
    <div class="row"><span>Имя</span><span>${escapeHtml(booking.clientName)}</span></div>
    <div class="row"><span>Телефон</span><span>${escapeHtml(booking.clientPhone)}</span></div>
  `;
  document.getElementById('telegramReminderBtn').href = `https://t.me/rai_massage_bot?start=${booking.id}`;
  // Ник бота MAX задаётся платформой и не меняется. Сверить с выводом
  // «node server.js job check-max» на сервере — он печатает точную ссылку.
  document.getElementById('maxReminderBtn').href = `https://max.ru/se14709110_bot?start=${booking.id}`;
  clientState.lastBookingId = booking.id;
  goToStep(4);
}

// ============================================================
// «ВАША ЗАПИСЬ» — поиск по телефону, отмена и перенос времени
// ============================================================
// Владение бронью подтверждается телефоном (тем же, что уже прошёл
// проверку в getBookingsByPhone) — взамен прежнего 6-значного кода.
// Все проверки задваиваются на сервере (index.js), это только UI.

const myBookingsState = {
  phone: null,        // как ввёл клиент — нужен для последующих cancel/reschedule
  bookings: [],        // последний результат поиска
  activeBooking: null,  // бронь, которую сейчас отменяют/переносят
  selectedNewStart: null,
};

function showMyBookingsScreen(id){
  ['myBookingsPanel','myBookingsListPanel','cancelConfirmPanel','reschedulePanel'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function renderMyBookingsList(){
  const container = document.getElementById('myBookingsResults');
  container.innerHTML = myBookingsState.bookings.map(b => {
    const dateObj = new Date(b.date + 'T00:00:00');
    const dateStr = dateObj.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'short' });
    return `
      <div class="booking-card">
        <div class="booking-top"><span class="booking-date">${escapeHtml(dateStr)}</span><span class="booking-time">${escapeHtml(b.start)}–${escapeHtml(b.end)}</span></div>
        <div class="booking-service">${escapeHtml(b.serviceName)}</div>
        <div class="btn-row my-booking-actions" style="margin-top:8px;">
          <button class="btn reschedule-btn" data-id="${escapeHtml(b.id)}" style="font-size:12.5px; padding:8px;">Изменить время</button>
          <button class="btn cancel-btn" data-id="${escapeHtml(b.id)}" style="font-size:12.5px; padding:8px;">Отменить</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.cancel-btn').forEach(btn => {
    btn.addEventListener('click', () => openCancelConfirm(btn.dataset.id));
  });
  container.querySelectorAll('.reschedule-btn').forEach(btn => {
    btn.addEventListener('click', () => openReschedule(btn.dataset.id));
  });
}

function openCancelConfirm(bookingId){
  const booking = myBookingsState.bookings.find(b => b.id === bookingId);
  if (!booking) return;
  myBookingsState.activeBooking = booking;

  const dateObj = new Date(booking.date + 'T00:00:00');
  const dateStr = dateObj.toLocaleDateString('ru-RU', { day:'numeric', month:'long' });
  document.getElementById('cancelConfirmDetails').textContent =
    `${dateStr}, ${booking.start} · ${booking.serviceName}. Время снова станет доступно другим клиентам.`;
  document.getElementById('cancelConfirmStatus').textContent = '';
  document.getElementById('cancelConfirmYes').disabled = false;
  document.getElementById('cancelConfirmYes').textContent = 'Да, отменить';
  showMyBookingsScreen('cancelConfirmPanel');
}

function openReschedule(bookingId){
  const booking = myBookingsState.bookings.find(b => b.id === bookingId);
  if (!booking) return;
  myBookingsState.activeBooking = booking;
  myBookingsState.selectedNewStart = null;

  const dateObj = new Date(booking.date + 'T00:00:00');
  const dateStr = dateObj.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'long' });
  document.getElementById('rescheduleHint').textContent = `${dateStr} · свободное время в этот день`;
  document.getElementById('rescheduleStatus').textContent = '';
  document.getElementById('rescheduleConfirm').disabled = true;

  renderRescheduleSlots();
  showMyBookingsScreen('reschedulePanel');
}

function renderRescheduleSlots(){
  const booking = myBookingsState.activeBooking;
  const grid = document.getElementById('rescheduleSlotsGrid');
  const empty = document.getElementById('rescheduleEmpty');
  const duration = timeToMinutes(booking.end) - timeToMinutes(booking.start);

  const slots = getAvailableSlotsForDate(booking.date, duration, { start: booking.start, end: booking.end });

  if (slots.length === 0){
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  grid.classList.remove('hidden');
  empty.classList.add('hidden');
  grid.innerHTML = '';
  slots.forEach(s => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.textContent = s;
    if (myBookingsState.selectedNewStart === s) el.classList.add('selected');
    el.addEventListener('click', () => {
      myBookingsState.selectedNewStart = s;
      grid.querySelectorAll('.slot').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      document.getElementById('rescheduleConfirm').disabled = false;
    });
    grid.appendChild(el);
  });
}

function resetBooking(){
  clientState.selectedServiceIds = [];
  clientState.selectedDate = null;
  clientState.selectedSlot = null;
  pendingBooking = null;
  document.getElementById('clientName').value = '';
  document.getElementById('clientPhone').value = '';
  document.getElementById('clientComment').value = '';
  document.getElementById('submitBooking').disabled = false;
  document.getElementById('submitBooking').dataset.submitting = '0';
  document.getElementById('submitBooking').textContent = 'Записаться';
  document.querySelectorAll('.service').forEach(el=>el.classList.remove('selected'));
  updateServicesFooter();
  goToStep(1);
}

// ============================================================
// INIT — клиентская страница
// ============================================================
// ============================================================
// АВТОФОРМАТИРОВАНИЕ ТЕЛЕФОНА
// ============================================================
// При вводе автоматически подставляет +7 и форматирует как
// +7 (900) 000-00-00, чтобы все номера в базе были единообразны.

function setupPhoneAutoFormat(input){
  // Подсказка под полем — показываем, если код оператора не начинается с 9
  // (городской номер, опечатка). Создаём её из JS, чтобы не дублировать
  // разметку у всех трёх полей телефона на странице.
  const warn = document.createElement('div');
  warn.className = 'phone-warn';
  warn.textContent = 'Проверьте номер: мобильный начинается с +7 9…';
  input.insertAdjacentElement('afterend', warn);

  function updateWarn(){
    const digits = input.value.replace(/\D/g, '');
    const bad = digits.length >= 2 && digits.charAt(1) !== '9';
    warn.classList.toggle('visible', bad);
    input.classList.toggle('input-warn', bad);
  }

  function buildFormatted(rawDigits){
    let digits = rawDigits;
    if (digits.startsWith('8')) digits = '7' + digits.slice(1);
    if (!digits.startsWith('7') && digits.length > 0) digits = '7' + digits;
    // Частая ошибка: в поле уже стоит «+7», а человек по привычке набирает
    // номер с восьмёрки — получается +7 (8xx). Мобильных кодов на 8 не бывает,
    // поэтому лишнюю восьмёрку сразу после кода страны молча выбрасываем.
    while (digits.length > 1 && digits.charAt(1) === '8') digits = '7' + digits.slice(2);
    digits = digits.slice(0, 11);

    if (digits.length === 0) return '';

    let formatted = '+7';
    const rest = digits.slice(1);
    if (rest.length > 0) formatted += ' (' + rest.slice(0, 3);
    if (rest.length >= 3) formatted += ') ' + rest.slice(3, 6);
    if (rest.length >= 6) formatted += '-' + rest.slice(6, 8);
    if (rest.length >= 8) formatted += '-' + rest.slice(8, 10);
    return formatted;
  }

  // Возвращает позицию курсора в отформатированной строке сразу после N-й цифры
  function caretAfterDigit(formatted, digitCount){
    if (digitCount <= 0) return formatted.length > 0 ? 2 : 0; // после "+7"
    let count = 0;
    for (let i = 0; i < formatted.length; i++){
      if (/\d/.test(formatted[i])){
        count++;
        if (count === digitCount) return i + 1;
      }
    }
    return formatted.length;
  }

  // Backspace/Delete обрабатываем вручную: находим ближайшую реальную цифру
  // в направлении стирания и удаляем именно её, а не разделитель форматирования.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    if (input.selectionStart !== input.selectionEnd) return; // есть выделение — пусть браузер удаляет как обычно

    const value = input.value;
    const pos = input.selectionStart;
    let removeIndex;

    if (e.key === 'Backspace'){
      removeIndex = pos - 1;
      while (removeIndex >= 0 && !/\d/.test(value[removeIndex])) removeIndex--;
      if (removeIndex < 0){ e.preventDefault(); return; }
    } else {
      removeIndex = pos;
      while (removeIndex < value.length && !/\d/.test(value[removeIndex])) removeIndex++;
      if (removeIndex >= value.length){ e.preventDefault(); return; }
    }

    e.preventDefault();
    const digitsBeforeRemoved = (value.slice(0, removeIndex).match(/\d/g) || []).length;
    const newValue = value.slice(0, removeIndex) + value.slice(removeIndex + 1);
    const newDigits = newValue.replace(/\D/g, '');
    const formatted = buildFormatted(newDigits);

    input.value = formatted;
    const caret = caretAfterDigit(formatted, digitsBeforeRemoved);
    input.setSelectionRange(caret, caret);
    updateWarn();
  });

  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '');
    input.value = buildFormatted(digits);
    updateWarn();
  });

  // При фокусе на пустое поле сразу подставляем +7 — так пользователю
  // остаётся только дописать сами цифры номера.
  input.addEventListener('focus', () => {
    if (input.value.trim() === ''){
      input.value = '+7 ';
    }
  });
}

async function init(){
  if (!PRICES_RAISED) document.getElementById('priceNotice').classList.remove('hidden');
  renderServices();
  await Store.loadSchedule();
  await Store.loadBookedSlots();
  renderCalendar(); // refresh now that schedule/bookings are loaded

  setupPhoneAutoFormat(document.getElementById('clientPhone'));

  document.getElementById('prevMonth').addEventListener('click', () => {
    clientState.calendarMonth--;
    if (clientState.calendarMonth < 0){ clientState.calendarMonth = 11; clientState.calendarYear--; }
    clientState.selectedDate = null;
    clientState.selectedSlot = null;
    renderCalendar();
    renderSlots();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    clientState.calendarMonth++;
    if (clientState.calendarMonth > 11){ clientState.calendarMonth = 0; clientState.calendarYear++; }
    clientState.selectedDate = null;
    clientState.selectedSlot = null;
    renderCalendar();
    renderSlots();
  });
  document.getElementById('backTo1').addEventListener('click', () => goToStep(1));
  document.getElementById('toStep2').addEventListener('click', () => goToStep(2));
  document.getElementById('toStep3').addEventListener('click', () => goToStep(3));
  document.getElementById('backTo2').addEventListener('click', () => goToStep(2));
  document.getElementById('submitBooking').addEventListener('click', submitBooking);
  document.getElementById('newBooking').addEventListener('click', resetBooking);

  document.getElementById('openMyBookingsLink').addEventListener('click', () => {
    const screens = ['myBookingsPanel','myBookingsListPanel','cancelConfirmPanel','reschedulePanel'];
    const anyOpen = screens.some(id => !document.getElementById(id).classList.contains('hidden'));
    // Второй клик по ссылке закрывает весь блок целиком, из какого бы
    // экрана внутри него ни кликнули — так же, как раньше работал toggle.
    showMyBookingsScreen(anyOpen ? null : 'myBookingsPanel');
  });
  setupPhoneAutoFormat(document.getElementById('myBookingsPhone'));

  document.getElementById('findMyBookings').addEventListener('click', async () => {
    const phoneInput = document.getElementById('myBookingsPhone');
    const btn = document.getElementById('findMyBookings');
    const status = document.getElementById('myBookingsStatus');
    const honeypot = document.getElementById('myBookingsWebsite').value;

    const digits = phoneInput.value.replace(/\D/g, '');
    if (digits.length !== 11){
      status.textContent = 'Введите полный номер телефона';
      status.style.color = '#B07E7E';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Ищем...';
    status.textContent = '';

    let bookings;
    try{
      // Сервер сам ищет и отдаёт только совпадения — чужие записи
      // на этот номер телефона в браузер вообще не попадают.
      bookings = await withTimeout(Store.findByPhone(phoneInput.value, honeypot), 8000);
      bookings = bookings.slice().sort((a,b) => (a.date+a.start).localeCompare(b.date+b.start));
    }catch(e){
      btn.disabled = false;
      btn.textContent = 'Найти запись';
      if (e && String(e.message).includes('too-many-attempts')){
        status.textContent = 'Слишком много попыток подряд. Подождите немного и попробуйте снова.';
      } else {
        status.textContent = 'Не удалось выполнить поиск — проблема с подключением. Попробуйте снова.';
      }
      status.style.color = '#B07E7E';
      return;
    }

    btn.disabled = false;
    btn.textContent = 'Найти запись';

    if (bookings.length === 0){
      status.textContent = 'Записи с таким номером не найдены';
      status.style.color = '#B07E7E';
      return;
    }

    status.textContent = '';
    myBookingsState.phone = phoneInput.value;
    myBookingsState.bookings = bookings;
    renderMyBookingsList();
    showMyBookingsScreen('myBookingsListPanel');
  });

  document.getElementById('backToPhoneSearch').addEventListener('click', () => {
    document.getElementById('myBookingsStatus').textContent = '';
    showMyBookingsScreen('myBookingsPanel');
  });

  document.getElementById('cancelConfirmNo').addEventListener('click', () => {
    showMyBookingsScreen('myBookingsListPanel');
  });

  document.getElementById('cancelConfirmYes').addEventListener('click', async () => {
    const btn = document.getElementById('cancelConfirmYes');
    const status = document.getElementById('cancelConfirmStatus');
    const booking = myBookingsState.activeBooking;
    if (!booking) return;

    btn.disabled = true;
    btn.textContent = 'Отменяем...';
    status.textContent = '';

    try{
      await withTimeout(Store.cancelByPhone(myBookingsState.phone, booking.id), 8000);
      Store.bookedSlots = Store.bookedSlots.filter(b => !(b.date === booking.date && b.start === booking.start));
      myBookingsState.bookings = myBookingsState.bookings.filter(b => b.id !== booking.id);
      renderCalendar();
      status.textContent = 'Запись отменена. Дарья получит уведомление автоматически.';
      status.style.color = 'var(--good)';
      btn.textContent = 'Готово';
      btn.disabled = false;
      btn.onclick = () => {
        renderMyBookingsList();
        showMyBookingsScreen(myBookingsState.bookings.length ? 'myBookingsListPanel' : 'myBookingsPanel');
      };
    }catch(e){
      if (e && String(e.message).includes('too-many-attempts')){
        status.textContent = 'Слишком много попыток подряд. Подождите немного и попробуйте снова.';
      } else if (e && String(e.message).includes('booking-not-found')){
        status.textContent = 'Эта запись уже недоступна — возможно, уже отменена.';
      } else {
        status.textContent = 'Не удалось отменить — проблема с подключением. Попробуйте снова.';
      }
      status.style.color = '#B07E7E';
      btn.disabled = false;
      btn.textContent = 'Да, отменить';
    }
  });

  document.getElementById('rescheduleBack').addEventListener('click', () => {
    showMyBookingsScreen('myBookingsListPanel');
  });

  document.getElementById('rescheduleConfirm').addEventListener('click', async () => {
    const btn = document.getElementById('rescheduleConfirm');
    const status = document.getElementById('rescheduleStatus');
    const booking = myBookingsState.activeBooking;
    const newStart = myBookingsState.selectedNewStart;
    if (!booking || !newStart) return;

    btn.disabled = true;
    btn.textContent = 'Сохраняем...';
    status.textContent = '';

    try{
      const result = await withTimeout(Store.rescheduleByPhone(myBookingsState.phone, booking.id, newStart), 8000);
      Store.bookedSlots = Store.bookedSlots.filter(b => !(b.date === booking.date && b.start === booking.start));
      Store.bookedSlots.push({ date: result.date, start: result.start, end: result.end });
      const idx = myBookingsState.bookings.findIndex(b => b.id === booking.id);
      if (idx !== -1) myBookingsState.bookings[idx] = { ...myBookingsState.bookings[idx], start: result.start, end: result.end };
      renderCalendar();
      status.textContent = `Время изменено на ${result.start}.`;
      status.style.color = 'var(--good)';
      btn.textContent = 'Готово';
      btn.disabled = false;
      btn.onclick = () => {
        renderMyBookingsList();
        showMyBookingsScreen('myBookingsListPanel');
      };
    }catch(e){
      if (e && String(e.message).includes('too-many-attempts')){
        status.textContent = 'Слишком много попыток подряд. Подождите немного и попробуйте снова.';
      } else if (e && String(e.message).includes('slot-taken')){
        status.textContent = 'Это время только что заняли. Выберите другое.';
        renderRescheduleSlots();
      } else if (e && String(e.message).includes('day-full')){
        status.textContent = 'На этот день уже набралось достаточно записей.';
        renderRescheduleSlots();
      } else if (e && String(e.message).includes('booking-not-found')){
        status.textContent = 'Эта запись уже недоступна — возможно, уже отменена.';
      } else {
        status.textContent = 'Не удалось сохранить — проблема с подключением. Попробуйте снова.';
      }
      status.style.color = '#B07E7E';
      btn.disabled = false;
      btn.textContent = 'Подтвердить новое время';
    }
  });
}

document.addEventListener('DOMContentLoaded', init);


