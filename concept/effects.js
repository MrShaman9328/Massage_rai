// Концепт оформления (стили — concept/effects.css): фон по прокрутке
// становится «вечерним», линия-свуш в боковых полях рисуется вслед за
// прокруткой, у SPA-программ свой аромат — цвет и плывущие веточки/дольки,
// как на афишах. Аромат включается только по нажатию на программу.
// Без библиотек и внешних запросов: ничего не грузится с CDN, которые у части
// клиентов не открываются на мобильном интернете.
(function(){
  // «Уменьшить движение» в системе (класс fx-still) убирает только блик и
  // параллакс шапки. Линия, цвета и плывущие рисунки остаются: эту настройку
  // сами сообщают Windows с выключенными эффектами и Android в
  // энергосбережении, и без этого такие клиентки не видели бы ничего.
  // ?motion=1 в адресе включает всё принудительно — для показа концепта.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches && !/[?&]motion=1/.test(location.search);
  const root = document.documentElement;
  root.classList.add('fx', reduced ? 'fx-still' : 'fx-motion');

  const AROMAS = { spa_relax:'lavender', spa_bounty:'lime', spa_paradise:'citrus', spa_wine:'wine', spa_detox:'sea' };
  const AROMA_INK = { lavender:'#8C7DB8', lime:'#7FA35E', citrus:'#D9A23A', wine:'#8E3B52', sea:'#5E8C6A' };

  // Рисунки — одной линией, как графика на афишах салона.
  const SPRITES = {
    lavender: '<path d="M20 38C20 28 21 18 20 4" stroke-width="1.4"/>' +
      [[20,7],[17,11],[23,11],[17,16],[23,16],[18,21],[22,21],[19,26]].map(([x,y], i) =>
        `<ellipse cx="${x}" cy="${y}" rx="2.1" ry="3.1" transform="rotate(${i % 2 ? 25 : -25} ${x} ${y})" fill="currentColor" fill-opacity=".55"/>`).join(''),
    lime: '<circle cx="20" cy="20" r="16"/><circle cx="20" cy="20" r="12.5" stroke-opacity=".6"/>' +
      [0,45,90,135].map(a => `<path d="M20 20L${20 + 12 * Math.cos(a * Math.PI / 180)} ${20 + 12 * Math.sin(a * Math.PI / 180)}M20 20L${20 - 12 * Math.cos(a * Math.PI / 180)} ${20 - 12 * Math.sin(a * Math.PI / 180)}" stroke-opacity=".6"/>`).join(''),
    citrus: '<path d="M6 22C6 13 14 9 21 9s14 5 14 13-7 11-14 11S6 31 6 22z" fill="currentColor" fill-opacity=".18"/>' +
      '<path d="M21 9c1-4 4-6 8-6-1 4-4 6-8 6z" fill="currentColor" fill-opacity=".4"/><path d="M13 20c2-3 5-4 8-4" stroke-opacity=".6"/>',
    wine: [[14,12],[22,12],[30,12],[18,19],[26,19],[22,26],[22,33]].map(([x,y]) =>
        `<circle cx="${x}" cy="${y}" r="4" fill="currentColor" fill-opacity=".22"/>`).join('') +
      '<path d="M22 8C22 5 24 3 27 2"/><path d="M24 6c3-3 8-3 10 0-3 2-7 2-10 0z" fill="currentColor" fill-opacity=".35"/>',
    sea: '<path d="M12 39C8 31 16 25 12 17S14 7 11 2"/><path d="M20 39C24 29 16 23 20 13S22 5 24 1"/><path d="M28 39C32 31 24 25 28 17S27 9 30 5"/>',
  };

  // ---------- Слои фона ----------
  const amb = document.createElement('div');
  amb.className = 'ambient';
  amb.setAttribute('aria-hidden', 'true');
  amb.innerHTML = `
    <div class="amb amb-evening"></div>
    ${Object.values(AROMAS).map(a => `<div class="amb amb-aroma amb-${a}" data-aroma="${a}"></div>`).join('')}
    <svg class="flow">
      <path class="flow-thin"/>
      <path class="flow-main"/>
    </svg>
    <div class="flow-spark"></div>
    <div class="flow-spark flow-spark-thin"></div>
    <div class="petals"></div>
  `;
  document.body.prepend(amb);

  const evening = amb.querySelector('.amb-evening');
  const flowSvg = amb.querySelector('.flow');
  const mainPath = amb.querySelector('.flow-main');
  const thinPath = amb.querySelector('.flow-thin');
  const spark = amb.querySelector('.flow-spark');
  const sparkThin = amb.querySelector('.flow-spark-thin');

  // Линия идёт волной в боковых полях — справа основная с огоньком, слева
  // тонкая. За панелями её не видно, а поля свободны всегда: на телефоне
  // это полосы по 20px у краёв, на компьютере — широкие поля вокруг колонки.
  // Путь строится в пикселях под размер окна: растягивать SVG нельзя —
  // линия стала бы разной толщины, а non-scaling-stroke ломает пунктир,
  // на котором держится «рисование».
  const WRAP_MAX = 560, WRAP_PAD = 20;
  let mainLen = 0, thinLen = 0;
  function wave(xA, xB, waves){
    const top = -20, step = (innerHeight + 40) / waves;
    let d = `M${xA.toFixed(1)} ${top}`;
    for (let i = 1; i <= waves; i++){
      const y = top + step * i;
      const x = i % 2 ? xB : xA;
      // Вертикальные касательные в каждой точке — волна без изломов.
      d += i === 1
        ? ` C${xA.toFixed(1)} ${(top + step / 2).toFixed(1)} ${x.toFixed(1)} ${(y - step / 2).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`
        : ` S${x.toFixed(1)} ${(y - step / 2).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  }
  function layoutFlow(){
    const margin = Math.max(0, (innerWidth - WRAP_MAX) / 2) + WRAP_PAD;
    // Размах волны: в узком поле — почти всё поле, в широком — до 160px по центру.
    const swing = Math.min(margin * 0.6, 160);
    const lo = (margin - swing) / 2, hi = lo + swing;
    const waves = innerWidth < 600 ? 5 : 4;
    flowSvg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    mainPath.setAttribute('d', wave(innerWidth - hi, innerWidth - lo, waves));
    thinPath.setAttribute('d', wave(lo, hi, waves + 1));
    // Пунктир — в настоящей длине пути, той же, по которой ставится огонёк.
    // С pathLength браузер пересчитывает длину с погрешностью, и на длинной
    // линии огонёк уезжал от кончика на несколько пикселей.
    mainLen = mainPath.getTotalLength();
    thinLen = thinPath.getTotalLength();
    mainPath.style.strokeDasharray = mainLen.toFixed(1);
    thinPath.style.strokeDasharray = thinLen.toFixed(1);
  }
  layoutFlow();

  // ---------- Прокрутка ----------
  // Цель берём из scrollY, а рисуем с небольшим догоном — линия и огонёк
  // двигаются плавно даже при рывках прокрутки пальцем.
  let target = 0, current = 0, rafId = 0;
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const ease = (t) => t * t * (3 - 2 * t);

  function readScroll(){
    const max = document.documentElement.scrollHeight - innerHeight;
    target = max > 0 ? clamp(scrollY / max) : 0;
    root.style.setProperty('--hero-shift', Math.min(scrollY, 520).toFixed(0));
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function drawLine(path, len, p, sparkEl){
    path.style.strokeDashoffset = (len * (1 - p)).toFixed(1);
    const pt = path.getPointAtLength(len * p);
    sparkEl.style.transform = `translate3d(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px, 0)`;
    sparkEl.style.opacity = p > 0.01 && p < 0.995 ? '1' : '0';
  }

  function frame(){
    rafId = 0;
    const d = target - current;
    current = reduced || Math.abs(d) < 0.0005 ? target : current + d * 0.12;

    evening.style.opacity = ease(current).toFixed(3);
    drawLine(mainPath, mainLen, current, spark);
    // Левая линия чуть обгоняет правую — так они не движутся зеркально.
    drawLine(thinPath, thinLen, clamp(current * 1.15 - 0.08), sparkThin);
    flowSvg.classList.add('ready');
    if (current !== target) rafId = requestAnimationFrame(frame);
  }

  addEventListener('scroll', readScroll, { passive: true });
  addEventListener('resize', () => { layoutFlow(); readScroll(); });
  readScroll();

  // ---------- Ароматы SPA ----------
  // Лепестки — внутри панели услуг: так на телефоне они видны в просветах
  // между карточками, а не прячутся за панелью во всю ширину экрана.
  const petals = amb.querySelector('.petals');
  const servicesPanel = document.getElementById('step1');
  if (servicesPanel) servicesPanel.prepend(petals);
  const spriteSvg = (aroma) => `<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">${SPRITES[aroma]}</svg>`;
  let activeAroma = null;

  function spawnPetals(aroma){
    petals.classList.add('fade');
    setTimeout(() => {
      petals.innerHTML = '';
      petals.classList.remove('fade');
      if (!aroma) return;
      // На телефоне меньше — фон за карточками виден только в просветах.
      const count = innerWidth < 600 ? 6 : 10;
      for (let i = 0; i < count; i++){
        const el = document.createElement('div');
        el.className = 'petal';
        const dur = 16 + Math.random() * 10;
        el.style.cssText = `--x:${(Math.random() * 96).toFixed(1)}%; --size:${(24 + Math.random() * 22).toFixed(0)}px;` +
          `--dur:${dur.toFixed(1)}s; --delay:${(-Math.random() * dur).toFixed(1)}s;` +
          `--rot:${(Math.random() * 160 - 80).toFixed(0)}deg; --alpha:${(0.35 + Math.random() * 0.3).toFixed(2)};` +
          `--ink:${AROMA_INK[aroma]};`;
        el.innerHTML = spriteSvg(aroma);
        petals.appendChild(el);
      }
    }, activeAroma ? 600 : 0);
  }

  function setAroma(aroma, card){
    document.querySelectorAll('.service.aroma-on').forEach(el => { if (el !== card) el.classList.remove('aroma-on'); });
    if (card) card.classList.add('aroma-on');
    if (aroma === activeAroma) return;
    if (aroma) root.dataset.aroma = aroma; else delete root.dataset.aroma;
    amb.querySelectorAll('.amb-aroma').forEach(el => el.classList.toggle('on', el.dataset.aroma === aroma));
    spawnPetals(aroma);
    activeAroma = aroma;
  }

  // Карточки рисует js/booking.js и перерисовывает при возврате к шагу 1 —
  // поэтому следим за списком и дорисовываем рисунок в новые карточки.
  const decorateCards = () => {
    document.querySelectorAll('.service').forEach(el => {
      const aroma = AROMAS[el.dataset.id];
      if (aroma && !el.dataset.fx){
        el.dataset.fx = '1';
        el.style.setProperty('--aroma-ink', AROMA_INK[aroma]);
        el.insertAdjacentHTML('beforeend', `<span class="aroma-mark" aria-hidden="true">${spriteSvg(aroma)}</span>`);
      }
    });
  };
  const list = document.getElementById('servicesList');
  if (list){
    new MutationObserver(decorateCards).observe(list, { childList: true });
    decorateCards();
  }

  // Аромат — только по нажатию: выбрали программу или раскрыли «Что входит».
  // Сняли выбор и закрыли описание — аромат переходит к другой выбранной
  // SPA-программе или гаснет. Слушаем в фазе захвата: кнопка «Что входит»
  // останавливает всплытие (js/booking.js), а состояние карточки читаем
  // после того, как booking.js его поменяет.
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.service');
    if (!card || !AROMAS[card.dataset.id]) return;
    if (!e.target.closest('.spa-toggle, .service-row')) return;
    setTimeout(() => {
      if (isEngaged(card)){
        setAroma(AROMAS[card.dataset.id], card);
      } else if (card.classList.contains('aroma-on')){
        const spa = [...document.querySelectorAll('.service')].filter(el => el !== card && AROMAS[el.dataset.id]);
        const other = spa.find(el => el.classList.contains('selected')) || spa.find(isEngaged);
        setAroma(other ? AROMAS[other.dataset.id] : null, other || null);
      }
    }, 0);
  }, true);

  // Программа «в фокусе»: выбрана для записи или раскрыто её описание.
  function isEngaged(card){
    const details = card.querySelector('.spa-details');
    return card.classList.contains('selected') || (details && !details.classList.contains('hidden'));
  }

  // ---------- Появление блоков ----------
  const revealIo = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      revealIo.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('.review-card, .seo-about, footer').forEach(el => {
    el.classList.add('reveal');
    revealIo.observe(el);
  });

  // ?debug=1 — что браузер сообщает о телефоне: разобраться, почему у
  // кого-то эффекты не видны, не залезая в его настройки.
  if (/[?&]debug=1/.test(location.search)){
    const info = document.createElement('div');
    info.className = 'fx-debug';
    const update = () => {
      info.textContent = `Уменьшить движение: ${matchMedia('(prefers-reduced-motion: reduce)').matches ? 'ДА' : 'нет'}` +
        ` · режим: ${reduced ? 'статичный' : 'анимация'} · экран ${innerWidth}×${innerHeight}` +
        ` · ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 120)}`;
    };
    update();
    addEventListener('resize', update);
    document.body.appendChild(info);
  }
})();
