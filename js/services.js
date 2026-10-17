// Общий каталог услуг: подключается и на странице записи (js/booking.js),
// и в панели мастера (js/admin.js) — там из него заполняется форма
// «Записать клиента». Один список на обе страницы, чтобы цены не разъезжались,
// как это уже случилось однажды с копией каталога в админке.
//
// ============================================================
// УСЛУГИ САЛОНА "РАЙ"
// Чтобы изменить цену, длительность или добавить/убрать услугу —
// просто отредактируйте этот список.
// ============================================================

const SERVICE_CATEGORIES = [
  {
    category: "Массаж тела",
    note: "При покупке курса от 10 сеансов любого массажа тела — скидка 10% на стоимость",
    services: [
      { id: "body_classic_60", name: "Классический массаж", duration: 60, price: 2200 },
      { id: "body_classic_90", name: "Классический массаж", duration: 90, price: 2800 },
      { id: "body_relax", name: "Расслабляющий массаж", duration: 60, price: 2200 },
      { id: "body_lymph", name: "Лимфодренажный массаж", duration: 70, price: 2200 },
      { id: "back_neck", name: "Массаж спины и ШВЗ", duration: 40, price: 1500 },
      { id: "neck_only", name: "Массаж зоны ШВЗ", duration: 20, price: 1000 },
      { id: "anticellulite", name: "Антицеллюлитный массаж (разовое посещение)", duration: 60, price: 2500 },
      { id: "anticellulite_90", name: "Антицеллюлитный массаж (разовое посещение)", duration: 90, price: 3200 },
    ]
  },
  {
    category: "Массаж лица",
    services: [
      { id: "face_classic", name: "Классический массаж", duration: 30, price: 1200 },
      { id: "face_plastic", name: "Пластический массаж", duration: 60, price: 2000,
        includes: ["Миофасциальная обработка мышц шеи, верхней части спины, апоневроза головы и зоны декольте", "Буккальный массаж", "Классический массаж"] },
      { id: "face_alginate", name: "Альгинатная маска", duration: 20, price: 300 },
    ]
  },
  {
    category: "SPA-программы",
    services: [
      { id: "spa_relax", name: "SPA-программа «Релакс»", duration: 120, price: 4000,
        photo: "spa-relaks.jpg",
        includes: ["Распаривание в кедровой бочке", "Расслабляющий массаж с лавандовым маслом", "Классический массаж лица и головы", "Чаепитие с сухофруктами"] },
      { id: "spa_bounty", name: "SPA-программа «Баунти»", duration: 140, price: 4300,
        photo: "spa-baunti.jpg",
        includes: ["Распаривание в кедровой бочке", "Общий массаж тела по скрабу кокос и лайм", "Классический массаж лица", "Альгинатная маска", "Чаепитие с сухофруктами"] },
      { id: "spa_paradise", name: "SPA-программа «Райское наслаждение»", duration: 160, price: 5000,
        photo: "spa-raiskoe.jpg",
        includes: ["Распаривание в кедровой бочке", "Скрабирование тела скрабом цитрус", "Общий массаж тела с маслом цитрус", "Классический массаж лица", "Альгинатная маска", "Чаепитие с сухофруктами"] },
      { id: "spa_detox", name: "SPA-программа «Детокс»", duration: 190, price: 5700,
        photo: "spa-detoks.jpg",
        includes: ["Распаривание в кедровой бочке", "Скрабирование тела скрабом Ламинария", "Общий массаж тела (усиленный)", "Обёртывание Ламинария", "Лимфодренажный массаж лица", "Альгинатная маска", "Чаепитие с сухофруктами"] },
    ]
  },
  {
    category: "Аппаратный массаж",
    services: [
      { id: "sphere_vibro", name: "Вибро-компрессионный массаж сферами", duration: 75, price: 2800 },
      { id: "microcurrent_face", name: "Микротоки по лицу", duration: 30, price: 1500 },
      { id: "rf_face", name: "RF лифтинг по лицу", duration: 30, price: 1000 },
      { id: "rf_body", name: "RF лифтинг по телу (1 зона)", duration: 30, price: 1000 },
      { id: "vacuum", name: "Вакуумный массаж (1 зона)", duration: 30, price: 1000 },
      { id: "vibro", name: "Турбо-вибрационный массаж", duration: 30, price: 1000 },
      { id: "presso", name: "Прессотерапия", duration: 30, price: 700 },
      { id: "spider", name: "Лимфодренажный аппарат с вакуумом «Паук»", duration: 30, price: 700 },
      { id: "myostim", name: "Миостимуляция", duration: 30, price: 700 },
      { id: "cedar_barrel", name: "Кедровая бочка", duration: 15, price: 700 },
    ]
  },
  {
    // hidden: не попадает в обычный каталог (renderServices её фильтрует),
    // но остаётся в SERVICE_CATEGORIES — иначе getServiceById не найдёт эти
    // услуги при подсчёте суммы/длительности и оформлении брони.
    category: "Спецпредложения",
    hidden: true,
    services: [
      { id: "combo_face_1", name: "Комплекс для лица №1", duration: 90, price: 2700,
        includes: ["Классический массаж лица", "Микротоки по лицу", "Альгинатная маска"] },
      { id: "combo_face_2", name: "Комплекс для лица №2", duration: 120, price: 3500,
        includes: ["Пластический массаж лица", "Микротоки по лицу", "Альгинатная маска"] },
      { id: "combo_body_renew", name: "Комплекс «Обновление тела»", duration: 120, price: 3500,
        includes: ["Кедровая бочка", "Классический массаж тела (90 мин)", "Скрабирование тела"] },
    ]
  }
];

function getServiceById(id) {
  for (const cat of SERVICE_CATEGORIES) {
    const found = cat.services.find(s => s.id === id);
    if (found) return found;
  }
  return null;
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}
