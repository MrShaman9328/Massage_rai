// Концепт оформления (стили — concept/effects.css): фон по прокрутке
// становится «вечерним», линия-свуш рисуется вслед за прокруткой, у SPA-
// программ свой аромат — цвет фона и плывущие веточки/дольки, как на афишах.
// Без библиотек и внешних запросов: ничего не грузится с CDN, которые у части
// клиентов не открываются на мобильном интернете.
(function(){
  // «Уменьшить движение» в системе — статичный вариант (класс fx-still).
  // ?motion=1 в адресе включает анимацию принудительно — для показа концепта.
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
      <path class="flow-thin" pathLength="1"/>
      <path class="flow-main" pathLength="1"/>
    </svg>
    <div class="flow-spark"></div>
    <div class="petals"></div>
  `;
  document.body.prepend(amb);

  const evening = amb.querySelector('.amb-evening');
  const flowSvg = amb.querySelector('.flow');
  const mainPath = amb.querySelector('.flow-main');
  const thinPath = amb.querySelector('.flow-thin');
  const spark = amb.querySelector('.flow-spark');

  // Кривые заданы в долях экрана (x — из 100, y — из 1000) и пересчитываются
  // в пиксели под размер окна. Растягивать SVG через preserveAspectRatio
  // нельзя: линия стала бы разной толщины, а non-scaling-stroke ломает
  // пунктир, на котором держится «рисование».
  const FLOW_MAIN = 'M88 -10C122 120 8 160 20 300S96 470 80 600 4 760 30 880 92 980 70 1015';
  const FLOW_THIN = 'M10 -10C-20 140 92 200 80 330S8 520 22 640 96 800 72 920 30 1000 40 1015';
  let mainLen = 0;
  function scaleFlow(d){
    let i = 0;
    return d.replace(/-?\d+(\.\d+)?/g, n => (i++ % 2 === 0 ? n / 100 * innerWidth : n / 1000 * innerHeight).toFixed(1));
  }
  function layoutFlow(){
    flowSvg.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    mainPath.setAttribute('d', scaleFlow(FLOW_MAIN));
    thinPath.setAttribute('d', scaleFlow(FLOW_THIN));
    mainLen = mainPath.getTotalLength();
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

  function frame(){
    rafId = 0;
    const d = target - current;
    current = reduced || Math.abs(d) < 0.0005 ? target : current + d * 0.12;

    evening.style.opacity = ease(current).toFixed(3);
    if (!reduced){
      mainPath.style.strokeDashoffset = (1 - current).toFixed(4);
      thinPath.style.strokeDashoffset = (1 - clamp(current * 1.15 - 0.08)).toFixed(4);
      const pt = mainPath.getPointAtLength(current * mainLen);
      spark.style.transform = `translate3d(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px, 0)`;
      spark.style.opacity = current > 0.01 && current < 0.995 ? '1' : '0';
    }
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
  let clearTimer = 0;

  function spawnPetals(aroma){
    petals.classList.add('fade');
    setTimeout(() => {
      petals.innerHTML = '';
      petals.classList.remove('fade');
      if (!aroma || reduced) return;
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
    clearTimeout(clearTimer);
    document.querySelectorAll('.service.aroma-on').forEach(el => { if (el !== card) el.classList.remove('aroma-on'); });
    if (card) card.classList.add('aroma-on');
    if (aroma === activeAroma) return;
    if (aroma) root.dataset.aroma = aroma; else delete root.dataset.aroma;
    amb.querySelectorAll('.amb-aroma').forEach(el => el.classList.toggle('on', el.dataset.aroma === aroma));
    spawnPetals(aroma);
    activeAroma = aroma;
  }

  // Аромат включается, когда SPA-карточка проходит через середину экрана,
  // и гаснет с задержкой, когда прокрутили мимо всех программ.
  const inBand = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting){
        inBand.add(e.target);
        setAroma(AROMAS[e.target.dataset.id], e.target);
      } else {
        inBand.delete(e.target);
        e.target.classList.remove('aroma-on');
      }
    });
    if (!inBand.size){
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => setAroma(null, null), 700);
    }
  }, { rootMargin: '-42% 0px -42% 0px' });

  // Карточки рисует js/booking.js и перерисовывает при возврате к шагу 1 —
  // поэтому следим за списком и подписываемся на новые карточки.
  const observeCards = () => {
    document.querySelectorAll('.service').forEach(el => {
      const aroma = AROMAS[el.dataset.id];
      if (aroma && !el.dataset.fx){
        el.dataset.fx = '1';
        el.style.setProperty('--aroma-ink', AROMA_INK[aroma]);
        el.insertAdjacentHTML('beforeend', `<span class="aroma-mark" aria-hidden="true">${spriteSvg(aroma)}</span>`);
        io.observe(el);
      }
    });
  };
  const list = document.getElementById('servicesList');
  if (list){
    new MutationObserver(observeCards).observe(list, { childList: true });
    observeCards();
  }

  // Раскрыли «Что входит в программу» — аромат этой программы сразу.
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest('.spa-toggle');
    if (!toggle) return;
    const aroma = AROMAS[toggle.dataset.toggle];
    if (aroma) setAroma(aroma, toggle.closest('.service'));
  });

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
})();
