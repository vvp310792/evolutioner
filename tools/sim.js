'use strict';
// Headless-порт нового ядра "Эволюционера": организм-центричная модель.
// Единица симуляции — ТЕЛО (организм), а не клетка. Тело имеет генетически
// заданную форму, общий пул энергии, общий возраст и умирает целиком.

const COLS = 46, ROWS = 92, N = COLS * ROWS;
const idx = (x, y) => y * COLS + x;
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

const PHOTO_GAIN = 3.0, MOVE_COST = 0.10, MACRO_MUT_CHANCE = 0.13;
const RELEASE = { photo: 2.2, herb: 2.8, pred: 4.2, sapro: 1.8 };
const SPORE_CAP = 1.0, SPORE_DEPOSIT = 0.06, SPORE_DECAY = 0.996,
      SPORE_THRESHOLD = 0.25, GERMINATE_CHANCE = 0.02;

// --- специализация клеток по положению в теле (п.4) ---
const BORDER_SYNTH = 0.75;      // барьерная клетка хуже синтезирует
const INTERIOR_SYNTH = 3.00;    // внутренняя — лучше
const BORDER_ARMOR_BONUS = 0.45;// барьерная лучше защищает
const INTERIOR_PROCESS = 0.35;
// Усвоение — всегда ДОЛЯ съеденного, строго меньше единицы: часть энергии жертвы
// теряется, как и положено при переходе на следующий трофический уровень.
// Раньше коэффициент был 0.8*effic*processing и при effic до 1.6 доходил до 1.73 —
// травоядное извлекало из растения БОЛЬШЕ, чем отнимало, энергия бралась из ничего,
// и отбор гнал effic к максимуму именно из-за этого.
const ASSIM_CAP = 0.9;
// Порядок величин как в природе: растительная масса усваивается хуже мяса,
// детрит — между ними. Все три строго меньше единицы.
const ASSIM_BASE = { herb: 0.70, pred: 0.88, sapro: 0.80 };
const GROWTH_COST_FRAC = 0.20;  // вырастить свою клетку много дешевле, чем снарядить потомка
const AGE_SCALE = Math.sqrt;
// ── ДВА КОМПРОМИССА, без которых гены упираются в край шкалы и эволюция по ним
// останавливается. Замерено: разброс lifespan падал вчетверо (3833 -> 892) при
// среднем 10600 из потолка 12000, а metab стоял на 0.17 при полу 0.15.
// SOMA — принцип одноразовой сомы: содержание долговечного тела стоит каждый час,
// пропорционально заявленному пределу жизни. Иначе долгожительство бесплатно.
const SOMA = parseFloat(process.env.SOMA || '0.000008');
// ── ПАРАЗИТЫ. Заражение — состояние тела, а не отдельная сущность на сетке: так
// дешевле и точнее по смыслу. У паразита свой генотип-«ключ»; у хозяина «замок»
// (immuneKey) и сила иммунитета. Ключ должен подойти к замку, иначе заражение
// маловероятно. Ключ мутирует при передаче и потому ДОГОНЯЕТ распространённый
// замок — отсюда отбор, зависящий от частоты: выгодно быть редким. Это
// единственный механизм, который ПОДДЕРЖИВАЕТ разброс генов, а не схлопывает его.
const PAR_VIR  = parseFloat(process.env.PVIR  || '1.0');   // общий множитель среды, не признак штамма
// ── ВИРУЛЕНТНОСТЬ ТЕПЕРЬ ПРИЗНАК ШТАММА и эволюционирует наравне с ключом.
// Компромисс — классический trade-off: свирепый штамм заразнее (заразность
// растёт как VIR_INF_LO + vir), но быстрее убивает хозяина и тем обрывает себе
// же срок заразности. Без этой связки вирулентность в модели бессмысленна:
// ползунок задаёт вред, а отбор паразита к нему не имеет отношения.
// Отдача от вирулентности НАСЫЩАЕТСЯ, а вред растёт линейно — иначе оптимум
// лежит на краю шкалы и признак мёртв (ровно то, что уже ловили с `metab`).
// Замерено на линейной версии: вирулентность уехала к 1.218 при потолке 1.6 и
// стояла там. С насыщением появляется внутренний оптимум — это и есть
// классический компромисс Андерсона–Мэя: заразность против срока заразности.
const VIR_INF_LO = 0.35;      // заразность при нулевой вирулентности
const VIR_K = parseFloat(process.env.VK || '0.5');        // полунасыщение отдачи
const VIR_MUT = parseFloat(process.env.VMUT || '0.06');   // шаг мутации при передаче
const VIR_RANGE = 1.6;        // потолок вирулентности штамма
const virInf = v => VIR_INF_LO + (1-VIR_INF_LO) * (v/(v+VIR_K));
const PAR_INF  = parseFloat(process.env.PINF  || '0.05');
const PAR_SEED = parseFloat(process.env.PSEED || '0.004');
const IMM_COST = parseFloat(process.env.ICOST || '0.06');
const PAR_DMG  = parseFloat(process.env.PDMG || '0.15');   // вред должен быть ощутим, иначе вирулентность бесплатна
const MATCH_W  = 0.15;
const keyDist = (a,b) => { const d = Math.abs(a-b); return d < 0.5 ? d : 1-d; };
// PACE — обмен веществ это СКОРОСТЬ, а не только расход: множитель на весь доход,
// и на свет, и на еду. Иначе низкий metab — чистый выигрыш без всякой цены.
// Зависимость НАСЫЩАЮЩАЯСЯ (как кинетика фермента), а не линейная: только так
// оптимум оказывается ВНУТРИ шкалы. Линейная давала бы край, то есть ту же
// остановку эволюции, которую мы и лечим. Нормирована на METAB_REF, чтобы при
// нынешнем обмене множитель равнялся единице и мир не обвалился от самой правки.
const PACE_K = parseFloat(process.env.PK || '0.30'), METAB_REF = 0.17;
const PACE_NORM = METAB_REF/(METAB_REF+PACE_K);
// Размах намеренно узкий: компромисс должен существовать, но не перестраивать мир.
// Без ограничения множитель доходил до 2.35, популяция раздувалась, и правка
// превращалась из «вернуть эволюцию» в «сделать другую симуляцию».
const PACE_LO = 0.90, PACE_HI = 1.30;
const paceOf = m => Math.min(PACE_HI, Math.max(PACE_LO, (m/(m+PACE_K))/PACE_NORM));
   // равномерная освещённость плоской плёнки
const GRAZE_LEFT = 0.12;   // от съеденного растения остаётся лишь остаток

// ── СЕМЕНА. Спора сапротрофа безымянна (поле плотности), семя НЕСЁТ ГЕНОМ и
// потому лежит отдельным списком, а не слоем сетки. Семя даёт то, чего у
// сидячего фототрофа нет: расселение (потомок не обязан помещаться вплотную к
// родителю) и покой (можно переждать ночь, тень и занятую клетку). Ставится
// только на ПОЛОВОЕ размножение — клональное деление остаётся вегетативным,
// вплотную. Так у пола появляется выгода, не сводящаяся к рекомбинации.
const SEED_RANGE = parseInt(process.env.SRANGE||'14',10);  // максимум разлёта при dispersal=1
const SEED_OVERHEAD = 0.35;   // оболочка семени — накладной расход сверх провизии
const SEED_FLIGHT = 0.30;     // цена дальнего разлёта, доля от цены потомка
const SEED_UPKEEP = parseFloat(process.env.SUPK||'0.012');  // семя дышит, запас тает
const SEED_GERM_LIGHT = parseFloat(process.env.SGL||'0.25'); // ниже этого не всходит, ждёт
// ── ПОКОЙ (bet-hedging). Раньше всхожесть была детерминированной: условия
// сошлись — зачаток взошёл. Это и делало банк семян бесполезным ровно там, где
// он нужен: в рушащемся мире свободных клеток сколько угодно, поэтому ВСЕ семена
// всходили разом, всходы съедались, и на момент гибели мира в почве лежало ноль
// семян, ноль спор, ноль икры (замерено на двух вымерших мирах). Страховки не
// было, потому что зачаток не умел ЖДАТЬ.
// Теперь ждать он умеет, и насколько — решает ген. Две стороны у одного гена:
//   всхожесть в час = 10^(-4*dormancy) — глубоко спящий всходит раз в тысячи часов;
//   расход в покое  = ×(1 - 0.95*dormancy) — спящий почти не дышит и живёт долго.
// Шкала именно такая глубокая не от балды: при первой версии (0.02^dormancy)
// даже максимальный покой давал ожидание в 22 часа, а провал популяции длится
// сотни — банк всё равно опустошался раньше, чем становился нужен.
// Вторая половина обязательна: покой в природе это ОСТАНОВЛЕННЫЙ обмен, а не
// упрямство. Без неё глубокий покой означал бы просто «сгнить, не взойдя».
// Цена покоя не выдумана: спящий уступает свободное место тем, кто всходит сразу.
// Здесь случайность — не шум поверх решения, а само решение: ставка вслепую на
// то, что нынешний час хуже будущего. Это тот самый случай, когда детерминизм
// (правило «поедание без броска кубика») был бы ошибкой.
const DORM_ON = process.env.DORM !== '0';   // выключатель для контрольного прогона
const germChance = g => DORM_ON ? Math.pow(10, -4*g.dormancy) : 1;
const dormUpkeep = g => DORM_ON ? 1 - 0.95*g.dormancy : 1;
const SEED_DRIFT = 0.02;      // ветер: семя сносит на клетку, само оно не ходит
const SEED_MAX = parseInt(process.env.SMAX||'3000',10);
// ── СПОРЫ СТАЛИ ТАКИМИ ЖЕ ЗАЧАТКАМИ, как семена, но с ЗЕРКАЛЬНОЙ экономикой.
// Семя дорогое, ближнее и с запасом; спора дешёвая, дальняя и почти без запаса,
// зато покой у неё почти даровой — спящая спора обменом веществ не занята.
// Всходит спора не на свет, а на субстрат: рядом должна быть падаль.
const SPORE_RANGE = parseInt(process.env.SPRANGE||'30',10);
const SPORE_UPKEEP = parseFloat(process.env.SPUPK||'0.0015');
const SPORE_PROV = 0.25, SPORE_OVERHEAD = 0.12, SPORE_FLIGHT = 0.10;
// ── ИКРА. Третий вид зачатка, для травоядных и хищников. Зверь не разбрасывает
// потомство по ветру и не ждёт субстрата: он ОТКЛАДЫВАЕТ кладку рядом с собой, и
// она развивается СВОЙ СРОК, а не до первого подходящего часа. Поэтому у икры
// условие всхода не внешнее (свет, падаль), а внутреннее — инкубация.
// Желток богаче семени: вылупиться должен не росток, а сразу подвижный зверь.
const EGG_RANGE = 4;                       // кладка рядом, а не за тридевять клеток
const EGG_UPKEEP = parseFloat(process.env.EUPK||'0.006');
const EGG_PROV = 1.0, EGG_OVERHEAD = 0.25, EGG_FLIGHT = 0.10;
const EGG_INCUB = 12, EGG_INCUB_PROV = 60;  // срок развития растёт с желтком
const EGGS_ON = process.env.EGGS !== '0';
// ── ГАМЕТА. Единственное гаплоидное, что есть в модели: одна порция генов,
// пущенная искать вторую. Взрослое тело диплоидно всегда, гаплоидность живёт
// ровно между мейозом и оплодотворением — как в соматике и положено.
// Гамета БЫСТРАЯ: три клетки в час против максимум двух у самого прыткого
// зверя — и это единственное, что вообще движется у сидячих ниш.
// И она ДЕШЁВАЯ, в отличие от зиготы, которую платит принимающая сторона:
// отсюда анизогамия — мелкая подвижная гамета против дорогого зачатка, — не
// объявленная правилом, а вытекшая из того, кто за что платит.
const GAMETE_SPEED = parseInt(process.env.GSPD||'3',10);
const GAMETE_LIFE = parseInt(process.env.GLIFE||'36',10);
const GAMETE_COST = 0.12;          // доля цены потомка
const GAMETE_MAX = 1200;
const GAMETES_ON = process.env.GAM !== '0';
// Старое поле плотности спор осталось отдельной, БЕСПОЛОЙ веткой: оно засевает
// нишу основательским геномом с нуля. Флаг нужен, чтобы проверить, не оно ли
// мешает сапротрофам эволюционировать — см. замеры.
const CONIDIA_ON = process.env.CONIDIA !== '0';
const SPORESEX_ON = process.env.SPORESEX !== '0';   // половые споры сапротрофа
// Замеренный и НЕ принятый вариант: конидия как клон грибницы. По умолчанию
// выключен — см. раздел про споры в CLAUDE.md. Включается CINH=1.
const CONIDIA_INHERIT = process.env.CINH === '1';
const SEEDS_ON = process.env.SEEDS !== '0';   // выключатель для контрольного прогона

const SAT = 1.0;   // насколько час кормёжки должен окупать расходы, чтобы остаться на месте
const HFRAC = 0.35, HCAP = 8, HMIN = 0.4;   // доля от энергии растения, потолок, абсолютный минимум укуса
    // старение растёт с размером тела, но не линейно  // вырастить свою клетку дешевле, чем породить организм  // внутренние перерабатывают добытое барьером

const GENES = ['metab','effic','thresh','costFrac','minN','maxN','aggression','armor',
               'photo','herb','sapro','cycleHours','moveSpeed','lifespan','broodSize',
               'shapeType','shapeA','shapeB','sexual','immunity','immuneKey',
               'dispersal','seedProv','dioecy','dormancy'];
const RANGE = {
  metab:[0.15,1.7], effic:[0.35,1.0], thresh:[4,40], costFrac:[0.2,0.9],
  minN:[0,4], maxN:[1,8], aggression:[0,1], armor:[0,1], photo:[0,1], herb:[0,1],
  sapro:[0,1], cycleHours:[4,1200], moveSpeed:[0.15,1], lifespan:[100,12000],
  broodSize:[1,4], shapeType:[0,3], shapeA:[1,10], shapeB:[1,10], sexual:[0,1], immunity:[0,1], immuneKey:[0,1],
  dispersal:[0,1], seedProv:[0,1], dioecy:[0,1], dormancy:[0,1],
};
const DRIFT = { metab:0.5, effic:0.5, thresh:7, costFrac:0.28, aggression:0.25, armor:0.25,
                photo:0.25, herb:0.25, sapro:0.25, cycleHours:20, moveSpeed:0.3, lifespan:150, sexual:0.25, immunity:0.25, immuneKey:0.15,
                dispersal:0.25, seedProv:0.25, dioecy:0.25, dormancy:0.25 };
const DISCRETE = ['minN','maxN','broodSize','shapeType','shapeA','shapeB'];

let state = new Uint8Array(N);        // 0 пусто, 1 живая клетка, 2 труп
let owner = new Int32Array(N);        // id тела, которому принадлежит клетка (0 = ничьё)
let corpseFood = new Float32Array(N);
let sporeDensity = new Float32Array(N);
let fertility = new Float32Array(N);
let vGrad = new Float32Array(ROWS);
const borderMark = new Uint8Array(N);   // переиспользуемый маркер границы (без аллокаций в горячем цикле)
let borderBuf = new Int32Array(4096); // переиспользуемый буфер барьерных клеток

let bodies = new Map();
let gametes = [];   // гаплоидные половые клетки в пути
let seeds = [];   // зачатки: {i, g, lineage, energy, kind} — 0 семя фототрофа, 1 спора сапротрофа
let nextBodyId = 1, nextLineageId = 1;
let hours = 0, phaseX = 0, phaseY = 0, dayFactor = 1;
const order = [];   // переиспользуемый буфер обхода тел
let params = { mutation: 0.12, decomp: 0.3, light: 0.62, predation: true, dayNight: true, sexReprod: true };
function freshStats(){ return { born:0, died:0, eaten:0, moves:0, germ:0, grow:0,
  dStarve:0, dAge:0, dPred:0, noRoom:0, noSpot:0, sexBirths:0, mateFail:0, parInfect:0, parCleared:0, parSeed:0, parHours:0,
  seedMade:0, seedGerm:0, seedRot:0, seedLost:0, seedWait:0,
  sporeMade:0, sporeGerm:0, sporeRot:0, conidiaKin:0, eggMade:0, eggHatch:0, eggRot:0,
  gamMade:0, gamHit:0, gamLost:0,
  bornBy:{photo:0,herb:0,pred:0,sapro:0}, diedBy:{photo:0,herb:0,pred:0,sapro:0},
  lifeBy:{photo:0,herb:0,pred:0,sapro:0}, fedBy:{photo:0,herb:0,pred:0,sapro:0} }; }
let stats = freshStats();
// поклассовый учёт экономики: uni = одноклеточные, multi = достроенные тела >1 клетки
let acct = { uni:{h:0,cells:0,inc:0,upk:0,kids:0}, multi:{h:0,cells:0,inc:0,upk:0,kids:0} };
let mv = {herb:{h:0,m:0,try:0},pred:{h:0,m:0,try:0}};
let gacct = {}; function gReset(){ gacct = {photo:{h:0,inc:0,upk:0,fed:0},herb:{h:0,inc:0,upk:0,fed:0},pred:{h:0,inc:0,upk:0,fed:0},sapro:{h:0,inc:0,upk:0,fed:0}}; } gReset();
function acctReset(){ acct = { uni:{h:0,cells:0,inc:0,upk:0,kids:0}, multi:{h:0,cells:0,inc:0,upk:0,kids:0} }; }

// ---------- шаблоны формы ----------
const tplCache = new Map();
function templateOf(type, a, b) {
  if (type >= 2) { a = Math.min(a, 5); b = Math.min(b, 5); }
  const key = type + ':' + a + ':' + b;
  if (tplCache.has(key)) return tplCache.get(key);
  let cells = [];
  if (type === 0) { for (let y = 0; y < a; y++) for (let x = 0; x < a; x++) cells.push([x, y]); }
  else if (type === 1) { for (let y = 0; y < b; y++) for (let x = 0; x < a; x++) cells.push([x, y]); }
  else if (type === 2) { const r = a - 0.5, d = 2 * a - 1, c = a - 1;
    for (let y = 0; y < d; y++) for (let x = 0; x < d; x++)
      if ((x-c)*(x-c) + (y-c)*(y-c) <= r*r + 0.01) cells.push([x, y]); }
  else { const w = 2*a-1, h = 2*b-1, cx = a-1, cy = b-1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      if (((x-cx)*(x-cx))/((a-0.5)*(a-0.5)) + ((y-cy)*(y-cy))/((b-0.5)*(b-0.5)) <= 1.01) cells.push([x, y]); }
  let mnx = Math.min(...cells.map(c=>c[0])), mny = Math.min(...cells.map(c=>c[1]));
  cells = cells.map(c => [c[0]-mnx, c[1]-mny]);
  const cx = (Math.max(...cells.map(c=>c[0]))) / 2, cy = (Math.max(...cells.map(c=>c[1]))) / 2;
  // порядок заполнения — от центра наружу: сначала формируется сердцевина
  cells.sort((p,q) => ((p[0]-cx)**2+(p[1]-cy)**2) - ((q[0]-cx)**2+(q[1]-cy)**2));
  tplCache.set(key, cells);
  return cells;
}

const noff = []; for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) if (dx||dy) noff.push([dx,dy]);
const noff2 = []; for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++) if (dx||dy) noff2.push([dx,dy]);
const noff4r = []; for (let dy=-4;dy<=4;dy++) for (let dx=-4;dx<=4;dx++) if ((dx||dy) && dx*dx+dy*dy<=16) noff4r.push([dx,dy]);

// Предпосчитанные таблицы соседей. Плоский Int32Array + счётчик на клетку: в горячем
// цикле исчезают модуло, деление и четыре проверки границ на каждого соседа.
function buildNb(offs){
  const k = offs.length;
  const tab = new Int32Array(N*k), cnt = new Uint8Array(N);
  for (let y=0;y<ROWS;y++) for (let x=0;x<COLS;x++){
    const i = idx(x,y); let c = 0;
    for (let o=0;o<k;o++){
      const nx = x+offs[o][0], ny = y+offs[o][1];
      if (nx<0||nx>=COLS||ny<0||ny>=ROWS) continue;
      tab[i*k + c++] = idx(nx,ny);
    }
    cnt[i] = c;
  }
  return { tab, cnt, k };
}
const NB8 = buildNb(noff), NB24 = buildNb(noff2), NB4R = buildNb(noff4r);
const NB4 = buildNb([[0,-1],[0,1],[-1,0],[1,0]]);

// Ниша клетки массивом: избавляет горячие проверки добычи от bodies.get() по Map.
const G_PHOTO=0, G_HERB=1, G_PRED=2, G_SAPRO=3, G_NONE=255;
const GCODE = { photo:G_PHOTO, herb:G_HERB, pred:G_PRED, sapro:G_SAPRO };
const cellGuild = new Uint8Array(N).fill(G_NONE);
const senseOffsets = [];
const SENSE_R = 12;
for (let dy=-SENSE_R;dy<=SENSE_R;dy++) for (let dx=-SENSE_R;dx<=SENSE_R;dx++) {
  if (!dx && !dy) continue; const d = Math.sqrt(dx*dx+dy*dy); if (d<=SENSE_R) senseOffsets.push([dx,dy,d]);
}
senseOffsets.sort((p,q)=>p[2]-q[2]);

// Кандидаты под якорь потомка: предпосчитанное кольцо смещений, отсортированное
// по расстоянию, + индекс начала каждого целого радиуса. Раньше на КАЖДУЮ попытку
// считались cos/sin и Math.random для 80 кандидатов — профиль показал 45% всего
// времени именно здесь, потому что в плотной решётке почти все попытки провальны.
const RING_MAX = 14;
const ringOff = [];
for (let dy=-RING_MAX; dy<=RING_MAX; dy++) for (let dx=-RING_MAX; dx<=RING_MAX; dx++) {
  if (!dx && !dy) continue;
  const d = Math.sqrt(dx*dx+dy*dy);
  if (d <= RING_MAX) ringOff.push([dx, dy, d]);
}
ringOff.sort((p,q)=>p[2]-q[2]);
const ringStart = new Int32Array(RING_MAX+2);
{ let r=0;
  for (let i=0;i<ringOff.length;i++){ while (r <= ringOff[i][2] && r <= RING_MAX+1) ringStart[r++] = i; }
  while (r <= RING_MAX+1) ringStart[r++] = ringOff.length; }

function computeFertility() {
  for (let y=0;y<ROWS;y++) for (let x=0;x<COLS;x++) {
    const n = 0.5 + 0.5*Math.sin(x*0.16+phaseX)*Math.cos(y*0.11+phaseY) + 0.2*Math.sin((x+y)*0.07+phaseX*0.5);
    fertility[idx(x,y)] = clamp(0.7 + 0.45*n, 0.45, 1.15);
  }
}

// Партнёр должен быть той же ниши и генетически близким. Отдельного поля «вид» нет:
// расхождение по пищевым генам само разводит линии на нескрещивающиеся группы.
const SPECIES_GAP = 0.30;
// Роли пола. Мужская особь НЕ носит зачаток вовсе — весь её вклад это гаметы;
// женская не тратится на гаметы и потому вынашивает дешевле; гермафродит умеет
// и то, и другое, но без скидок. Это и есть разделение труда, ради которого
// раздельнополость вообще существует: её цена — половина популяции, не носящая
// потомства, а выигрыш — специализация каждой половины.
const FEM_BEAR_DISCOUNT = 0.85;   // женская особь вынашивает дешевле гермафродита
const MALE_GAM_DISCOUNT = 0.5;    // мужская особь делает гаметы вдвое дешевле
const bears = b => b.sex !== 'm';         // носит зачатки: женская и гермафродит
const sheds = b => b.sex !== 'f';         // выпускает гаметы: мужская и гермафродит
const sexesFit = (a, b) => !(a.sex === b.sex && a.sex !== null);
const MATE_PATIENCE = parseInt(process.env.MP||'48',10);   // часов ожидания партнёра до клонирования
function compatible(a, b) {
  if (a.guild !== b.guild) return false;
  const x = a.g, y = b.g;
  return Math.abs(x.photo-y.photo) <= SPECIES_GAP && Math.abs(x.herb-y.herb) <= SPECIES_GAP
      && Math.abs(x.aggression-y.aggression) <= SPECIES_GAP && Math.abs(x.sapro-y.sapro) <= SPECIES_GAP;
}

function guildOfGenome(g) {
  let best = 'photo', bv = g.photo;
  if (g.herb > bv) { best = 'herb'; bv = g.herb; }
  if (g.aggression > bv) { best = 'pred'; bv = g.aggression; }
  if (g.sapro > bv) { best = 'sapro'; bv = g.sapro; }
  return best;
}

// ---------- организм ----------
function tryPlaceBody(g, lineage, anchorX, anchorY, energy, al) {
  const tpl = templateOf(g.shapeType, g.shapeA, g.shapeB);
  const [sdx, sdy] = tpl[0];                 // первая клетка шаблона — центр
  const ox = anchorX - sdx, oy = anchorY - sdy;
  const w = Math.max(...tpl.map(c=>c[0])) + 1, h = Math.max(...tpl.map(c=>c[1])) + 1;
  if (ox < 0 || oy < 0 || ox + w > COLS || oy + h > ROWS) return null;
  const i0 = idx(anchorX, anchorY);
  if (state[i0] !== 0) return null;
  // План формы — НАМЕРЕНИЕ, а не бронь. Тело строит из него то, что успеет занять,
  // и живёт недостроенным, если соседи забрали часть клеток. Требовать весь контур
  // свободным нельзя: в решётке, забитой одноклеточными, такого места не находится
  // никогда, и многоклеточность тогда не возникает в принципе (проверено прогонами:
  // вспышка на 2000-м часу и полное исчезновение к 10000-му).
  const foot = [];
  for (const [dx,dy] of tpl) foot.push(idx(ox+dx, oy+dy));
  const id = nextBodyId++;
  const guild0 = guildOfGenome(g);
  // ПОЛ. У зверя он есть всегда — раздельнополость у животных правило, а не
  // выбор. У фототрофа и сапротрофа решает ген `dioecy`: двудомная особь несёт
  // один пол, однодомная (гермафродит) — оба сразу, как большинство растений и
  // грибов. Пол разыгрывается при рождении 50/50 и потом не меняется.
  const dio = (guild0 === 'herb' || guild0 === 'pred') ? true : Math.random() < g.dioecy;
  const body = { id, g, al: al || { A: g, B: g }, lineage, guild: guild0, ox, oy, tpl,
                 sex: dio ? (Math.random() < 0.5 ? 'm' : 'f') : null,
                 cells: [i0], foot, energy, age: 0, cooldown: g.cycleHours };
  state[i0] = 1; owner[i0] = id; cellGuild[i0] = GCODE[body.guild];
  // зачаток сразу занимает небольшой комок плана — настолько, насколько есть место
  const want = Math.min(foot.length, 1 + Math.floor(foot.length/3));
  for (let k=0; k<foot.length && body.cells.length<want; k++) {
    const t = foot[k];
    if (state[t] === 0 && adjacentToBody(body, t)) { state[t]=1; owner[t]=id; cellGuild[t]=GCODE[body.guild]; body.cells.push(t); }
  }
  bodies.set(id, body);
  stats.born++; stats.bornBy[body.guild]++;
  return body;
}

function adjacentToBody(body, t) {
  const c = NB8.cnt[t], base = t*NB8.k, id = body.id;
  for (let o=0;o<c;o++){ const ni = NB8.tab[base+o];
    if (state[ni]===1 && owner[ni]===id) return true; }
  return false;
}

// Барьерной считается клетка, у которой хоть один ОРТОГОНАЛЬНЫЙ сосед не свой.
// Раньше проверялись все восемь: у правильного квадрата это верно, но после отказа
// от резервирования формы стали рваными, и клетки, окружённой своими со всех восьми
// сторон, не встречалось даже в теле из 11 — дифференцировка не включалась никогда.
// По диагонали контакт слабый, барьером он не является.
const noff4 = [[0,-1],[0,1],[-1,0],[1,0]];
function isBorder(body, i) {
  const x = i % COLS, y = (i / COLS) | 0;
  for (const [dx,dy] of noff4) {
    const nx = x+dx, ny = y+dy;
    if (nx<0||nx>=COLS||ny<0||ny>=ROWS) return true;
    if (owner[idx(nx,ny)] !== body.id || state[idx(nx,ny)] !== 1) return true;
  }
  return false;
}

function killBody(body, corpseFrac) {
  // умирает целиком: каждая клетка тела становится трупом одновременно
  const rel = RELEASE[body.guild] * (corpseFrac === undefined ? 1 : corpseFrac);
  for (const i of body.cells) { if (rel > 0.001) { state[i]=2; corpseFood[i]=rel; } else state[i]=0; owner[i] = 0; }
  bodies.delete(body.id);
  stats.died++; stats.diedBy[body.guild]++; stats.lifeBy[body.guild] += body.age;
}

function moveBody(body, dx, dy) {
  // жёсткое движение: всё тело сдвигается на одну клетку, форма сохраняется
  const targets = [];
  for (const i of body.cells) {
    const x = (i % COLS) + dx, y = ((i / COLS) | 0) + dy;
    if (x<0||x>=COLS||y<0||y>=ROWS) return false;
    const t = idx(x,y);
    if (state[t] !== 0 && owner[t] !== body.id) return false;
    targets.push(t);
  }
  const newFoot = [];
  for (const t of body.foot) {
    const x = (t % COLS) + dx, y = ((t / COLS) | 0) + dy;
    if (x<0||x>=COLS||y<0||y>=ROWS) return false;
    newFoot.push(idx(x,y));
  }
  for (const i of body.cells) { state[i]=0; owner[i]=0; cellGuild[i]=G_NONE; }
  const gc = GCODE[body.guild];
  for (const t of targets) { state[t]=1; owner[t]=body.id; cellGuild[t]=gc; }
  body.cells = targets; body.foot = newFoot; body.ox += dx; body.oy += dy;
  stats.moves++;
  return true;
}

// ---------- мутация ----------
// Каждый ген потомка берётся от одного из двух родителей броском монеты, и только
// потом накладывается обычная мутация. В этом и весь смысл пола: удачные сочетания,
// собранные из разных линий, а не медленный дрейф одной.
function recombine(ga, gb) {
  const g = {};
  for (const k of GENES) g[k] = Math.random() < 0.5 ? ga[k] : gb[k];
  return g;
}

function mutateAllele(pg, withMacro) {
  const m = params.mutation, g = {};
  for (const k of GENES) g[k] = pg[k];
  for (const k of Object.keys(DRIFT)) {
    const [lo,hi] = RANGE[k];
    g[k] = clamp(pg[k] + (Math.random()*2-1)*DRIFT[k]*m, lo, hi);
  }
  for (const k of ['minN','maxN','broodSize','shapeA','shapeB']) {
    const [lo,hi] = RANGE[k];
    g[k] = clamp(pg[k] + (Math.random() < m*0.45 ? (Math.random()<0.5?-1:1) : 0), lo, hi);
  }
  if (Math.random() < m*0.25) g.shapeType = Math.floor(Math.random()*4);
  g.maxN = Math.max(g.maxN, g.minN + 1);
  // крупная мутация: ОДИН случайный ген из ВСЕХ перебрасывается целиком (п.1)
  if (withMacro && Math.random() < MACRO_MUT_CHANCE) {
    const k = GENES[Math.floor(Math.random()*GENES.length)];
    const [lo,hi] = RANGE[k];
    g[k] = DISCRETE.includes(k) ? lo + Math.floor(Math.random()*(hi-lo+1)) : lo + Math.random()*(hi-lo);
    g.maxN = Math.max(g.maxN, g.minN + 1);
  }
  return g;
}

// ── ДИПЛОИДНОСТЬ. Два набора аллелей на организм, выражается их СРЕДНЕЕ (кроме
// двух генов ниже). Смысл не в удвоении памяти, а в том, что у полового организма
// появляется НЕВЫРАЖЕННЫЙ запас: аллель может быть далеко от фенотипа и пережить
// в гетерозиготе времена, когда он вреден. Гаплоидная схема этого не умеет —
// там что в геноме, то и в теле.
// Бесполое размножение копирует ОБА набора как есть (митоз), поэтому клональная
// линия навсегда сохраняет свою гетерозиготность, но никогда её не перемешивает;
// половое — собирает по гамете от каждого родителя (мейоз с расщеплением).
const DIPLOID = process.env.DIPLO !== '0';
// Среднее осмысленно не для всех генов: тип формы — это КАТЕГОРИЯ (среднее между
// квадратом и овалом — не форма), а замок иммунитета живёт на окружности, где
// среднее между 0.05 и 0.95 даёт 0.5, то есть максимально далёкое от обоих.
// Для них — полное доминирование: выражается аллель A, второй лежит запасом.
const DOMINANT_ONLY = new Set(['shapeType','immuneKey']);
function expressGenome(A, B) {
  const g = {};
  for (const k of GENES) g[k] = DOMINANT_ONLY.has(k) ? A[k] : (A[k] + B[k]) * 0.5;
  for (const k of DISCRETE) if (!DOMINANT_ONLY.has(k)) g[k] = Math.round(g[k]);
  g.maxN = Math.max(g.maxN, g.minN + 1);
  return g;
}
function gamete(al) {
  const h = {};
  for (const k of GENES) h[k] = Math.random() < 0.5 ? al.A[k] : al.B[k];
  return h;
}

// Пакеты (хищник, многоклеточность, смена ниши, основание половой линии) работают
// по ФЕНОТИПУ и записываются обратно в ОБА аллеля: иначе подъём, ради которого
// пакет существует, не наследуется и рассосётся в первом же поколении.
function applyPackages(g, pg, wasPred, A, B) {
  const before = A && B ? Object.assign({}, g) : null;
  g.__endow = 0;
  // Пакет СМЕНЫ НИШИ. Мутант-травоядное наследует photo~0.8 и получает herb~0.85 —
  // перевес пограничный, и его потомки тут же сваливаются обратно в фототрофы.
  // Замерено: травоядных 0-2 особи при положительном сальдо, то есть ниша не
  // популяция, а мерцающее облако мутантов, и хищнику не на ком жить. Поэтому
  // смена ниши делается решительной: новый признак поднимается, прежний убирается.
  const newGuild = guildOfGenome(g), oldGuild = guildOfGenome(pg);
  if (newGuild !== oldGuild) {
    const key = { photo:'photo', herb:'herb', pred:'aggression', sapro:'sapro' };
    const nk = key[newGuild], ok = key[oldGuild];
    g[nk] = Math.max(g[nk], 0.72 + Math.random()*0.2);
    g[ok] = Math.min(g[ok], 0.42 + Math.random()*0.1);
  }
  // Многоклеточность — тоже K-стратегия, и по той же причине, что и хищничество:
  // тело это вложение, которому нужно время окупиться. Без этого пакета линия,
  // впервые построившая тело, вымирает от старости раньше, чем успевает заместиться
  // (проверено прямым опытом: с коротким lifespan — ноль тел к 1000-му часу,
  // с длинным — рост с 40 подсаженных до 121 тела и 78 дифференцированных к 2000-му).
  const tplSize = templateOf(g.shapeType, g.shapeA, g.shapeB).length;
  const parentTpl = templateOf(pg.shapeType, pg.shapeA, pg.shapeB).length;
  // пакет срабатывает при ЛЮБОМ увеличении плана, а не только при первом выходе
  // из одноклеточности: сердцевина появляется лишь с 3x3, и переход 2x2 -> 3x3
  // нуждается в амортизации ровно так же, как самый первый шаг к телу
  if (tplSize > parentTpl) {
    g.lifespan = Math.max(g.lifespan, 800 + tplSize*180 + Math.random()*600);
  }
  // Пакет ОСНОВАНИЯ ПОЛОВОЙ ЛИНИИ, по тому же принципу, что у хищника и
  // многоклеточности: полу мешает не невыгодность, а старт. Замерено — при равном
  // старте пол выигрывает (1741 против 1210 к 30 000 ч), но одинокому мутанту не с
  // кем скрещиваться. Поэтому первый половой потомок сразу получает выводок побольше
  // и запас, чтобы вокруг него возникла группа совместимых партнёров, а не одиночка.
  if (params.sexReprod && g.sexual >= 0.5 && pg.sexual < 0.15) {
    g.broodSize = Math.max(g.broodSize, 3);
    g.__endow = Math.max(g.__endow || 0, 10);
  }
  if (guildOfGenome(g) === 'pred' && !wasPred) {
    g.lifespan = Math.max(g.lifespan, 1800 + Math.random()*3200);
    g.moveSpeed = Math.max(g.moveSpeed, 0.65 + Math.random()*0.3);
    g.broodSize = Math.max(g.broodSize, 2);
    g.__endow = Math.max(g.__endow, 34);   // хватит, чтобы дойти до добычи и один раз поохотиться
  }
  // тот же принцип для многоклеточности: линия, впервые строящая тело, должна
  // успеть его построить — иначе одноклеточные потомки всегда обгоняют её по размножению
  // В зародышевую линию пишется ТОЛЬКО то, что пакет реально поднял. Первая версия
  // писала обратно весь фенотип целиком — и стирала всю гетерозиготность в каждом
  // поколении: аллели A и B становились побитово одинаковыми, диплоидность
  // превращалась в гаплоидность с двойным расходом памяти (замерено: средняя
  // разница аллелей по lifespan ровно 0 на 3000-м часу).
  if (before) for (const k of GENES) if (g[k] !== before[k]) { A[k] = g[k]; B[k] = g[k]; }
  return g;
}

function mutateGenome(pg, wasPred) { return applyPackages(mutateAllele(pg, true), pg, wasPred); }

// КРУПНАЯ МУТАЦИЯ В ДИПЛОИДЕ ИДЁТ ПО ОБОИМ АЛЛЕЛЯМ. Иначе она наполовину гасится
// усреднением, argmax пищевых генов перестаёт переключаться — и ниши не возникают
// вовсе. Замерено ровно это: три seed'а из трёх дали чистую монокультуру
// фототрофов (929/1251/1218 тел, ни одного травоядного, хищника и сапротрофа) и
// ноль половых линий, потому что и `sexual` не дотягивал до порога 0.5.
// Мелкий дрейф при этом остаётся ПОАЛЛЕЛЬНЫМ — он и создаёт скрытый запас.
function macroMutate(A, B) {
  if (Math.random() >= MACRO_MUT_CHANCE) return;
  const k = GENES[Math.floor(Math.random()*GENES.length)];
  const [lo,hi] = RANGE[k];
  const v = DISCRETE.includes(k) ? lo + Math.floor(Math.random()*(hi-lo+1)) : lo + Math.random()*(hi-lo);
  A[k] = v; B[k] = v;
  A.maxN = Math.max(A.maxN, A.minN+1); B.maxN = Math.max(B.maxN, B.minN+1);
}

// Единая точка сборки генома потомка: и гаплоидный путь, и диплоидный.
// ДИПЛОИДНОСТЬ ВОЗНИКАЕТ ИЗ ПОЛА, а не даётся всем даром. Основатель гаплоиден
// (`al.A === al.B` — один набор), и пока линия клонируется, она гаплоидна: шаг
// мутации у неё полный, как был. Слияние двух гамет даёт ДИПЛОИДА — два набора,
// среднее в фенотипе и запас в невыраженном аллеле. Дальше эта линия остаётся
// диплоидной и при клональном размножении (митоз копирует оба набора).
// Так устроены реальные жизненные циклы с чередованием поколений, и так
// диплоидность что-то ЗНАЧИТ в модели: это плата и приз за пол разом.
// Сделать диплоидными всех — измерено и отброшено: усреднение гасит шаг мутации
// у клонального большинства, и ниши перестают возникать (три seed'а из трёх:
// чистая монокультура фототрофов).
// СОМАТИКА ДИПЛОИДНА, ГАПЛОИДНА ТОЛЬКО ГАМЕТА. Прежняя версия делала гаплоидной
// целую клональную ЛИНИЮ — это гаплонтный цикл (так живут многие грибы и
// водоросли), но для зверя он неверен: у животного взрослое тело диплоидно, а
// один набор несёт только половая клетка. Теперь тело всегда с двумя наборами,
// а гаплоидность существует ровно там, где ей место — в гамете, между мейозом
// и оплодотворением.
function gameteOf(b) { return gamete(b.al); }
function childGenome(body, mate, wasPred) {
  if (!DIPLOID) {
    const g = mutateGenome(mate ? recombine(body.g, mate.g) : body.g, wasPred);
    return { g, al: { A: g, B: g } };
  }
  // Клон — митоз: оба набора копируются как есть, гетерозиготность сохраняется.
  const A = mutateAllele(mate ? gameteOf(body) : body.al.A, false);
  const B = mutateAllele(mate ? gameteOf(mate) : body.al.B, false);
  macroMutate(A, B);
  const g = expressGenome(A, B);
  applyPackages(g, body.g, wasPred, A, B);
  return { g, al: { A, B } };
}

function founderGenome() {
  return {
    metab: 0.22+Math.random()*0.32, effic: 0.55+Math.random()*0.25,
    thresh: 7+Math.random()*7, costFrac: 0.35+Math.random()*0.2,
    minN: Math.floor(Math.random()*2), maxN: 3+Math.floor(Math.random()*5),
    aggression: 0.02+Math.random()*0.06, armor: 0.02+Math.random()*0.06,
    photo: 0.55+Math.random()*0.35, herb: 0.02+Math.random()*0.06, sapro: 0.02+Math.random()*0.06,
    cycleHours: 14+Math.random()*14, moveSpeed: 0.4+Math.random()*0.4,
    lifespan: 280+Math.random()*350, broodSize: 1,
    sexual: 0,   // пол обязан возникнуть мутацией, как и все ниши
    immunity: 0.05+Math.random()*0.05,
    immuneKey: Math.random(),   // «замок»: какой генотип паразита распознаётся
    dispersal: 0.15+Math.random()*0.2, seedProv: 0.3+Math.random()*0.2,
    dioecy: 0.1+Math.random()*0.2,   // склонность линии быть раздельнополой
    dormancy: 0.05+Math.random()*0.15,   // глубина покоя зачатка
    shapeType: 0, shapeA: 1, shapeB: 1,          // основатель одноклеточный
  };
}

// Основатель ГЕТЕРОЗИГОТЕН: два независимых набора вместо одного удвоенного.
// Иначе стартовая популяция полностью гомозиготна, запаса нет ни у кого, и
// диплоидность первые тысячи часов ничем не отличается от гаплоидности.
function founderDiploid() {
  // Основатель диплоиден и ГЕТЕРОЗИГОТЕН: два независимых набора. Гомозиготный
  // старт означал бы, что запаса нет ни у кого и первые тысячи часов
  // диплоидность ничем не отличается от гаплоидности.
  const A = founderGenome(), B = founderGenome();
  return [expressGenome(A, B), { A, B }];
}

function decayCorpses() {
  for (let i=0;i<N;i++) if (state[i]===2) {
    corpseFood[i] -= 0.0025;
    if (corpseFood[i] <= 0.001) { state[i]=0; corpseFood[i]=0; }
  }
}

function processSpores() {
  if (!CONIDIA_ON) return;
  for (const b of bodies.values()) if (b.guild === 'sapro') {
    for (const i of b.cells) {
      sporeDensity[i] = Math.min(SPORE_CAP, sporeDensity[i] + SPORE_DEPOSIT);
      const x=i%COLS, y=(i/COLS)|0;
      for (const [dx,dy] of noff) { const nx=x+dx, ny=y+dy;
        if (nx>=0&&nx<COLS&&ny>=0&&ny<ROWS) sporeDensity[idx(nx,ny)] = Math.min(SPORE_CAP, sporeDensity[idx(nx,ny)]+SPORE_DEPOSIT*0.4); }
    }
  }
  for (let i=0;i<N;i++) {
    if (sporeDensity[i] <= 0) continue;
    sporeDensity[i] *= SPORE_DECAY;
    if (state[i]===2 && sporeDensity[i] > SPORE_THRESHOLD && Math.random() < GERMINATE_CHANCE) {
      const x=i%COLS, y=(i/COLS)|0;
      const empt = [];
      for (const [dx,dy] of noff) { const nx=x+dx, ny=y+dy;
        if (nx>=0&&nx<COLS&&ny>=0&&ny<ROWS && state[idx(nx,ny)]===0) empt.push([nx,ny]); }
      if (empt.length) {
        const [gx,gy] = empt[Math.floor(Math.random()*empt.length)];
        // КОНИДИЯ — бесполая спора, то есть КЛОН. Раньше она всходила
        // основательским геномом: каждое прорастание заводило новую линию с
        // нуля, и ниша сапротрофа переизобреталась заново вместо того, чтобы
        // эволюционировать. Геном берётся у ближайшего живого сапротрофа —
        // это и есть та грибница, которая сюда насыпала спор.
        let src = null, lin = 0;
        if (CONIDIA_INHERIT) {
          const c = NB24.cnt[i], base = i*NB24.k;
          for (let o=0;o<c;o++) { const ni = NB24.tab[base+o];
            if (state[ni]===1 && cellGuild[ni]===G_SAPRO) { const b = bodies.get(owner[ni]); if (b) { src = b; break; } } }
        }
        let g, al = null;
        if (src) {
          const kid = childGenome(src, null, false);
          g = kid.g; al = kid.al; lin = src.lineage;
        } else {
          const mk = () => { const q = founderGenome();
            q.photo = 0.02+Math.random()*0.06; q.sapro = 0.55+Math.random()*0.35;
            q.cycleHours = 48+Math.random()*100; q.lifespan = 1500+Math.random()*2500;
            return q; };
          const CA = mk(), CB = mk();
          g = expressGenome(CA, CB); al = { A: CA, B: CB };
          lin = nextLineageId++;
        }
        if (tryPlaceBody(g, lin, gx, gy, 5, al)) { sporeDensity[i]=0; stats.germ++; if (src) stats.conidiaKin++; }
      }
    }
  }
}

// Гамета совместима с телом, если тело той же ниши и не разошлось по пищевым
// генам дальше видового зазора — то же правило, что у двух взрослых.
function gameteFits(hg, b) {
  if (b.guild !== gGuild(hg)) return false;
  const y = b.g;
  return Math.abs(hg.photo-y.photo) <= SPECIES_GAP && Math.abs(hg.herb-y.herb) <= SPECIES_GAP
      && Math.abs(hg.aggression-y.aggression) <= SPECIES_GAP && Math.abs(hg.sapro-y.sapro) <= SPECIES_GAP;
}
const gGuild = g => guildOfGenome(g);

// Гаметы: движение, поиск партнёра, гибель по сроку. Отдельная фаза, потому что
// гамета — не тело: она не занимает клетку, ничего не ест и никого не кормит.
function processGametes() {
  if (!gametes.length) return;
  let w = 0;
  for (let k=0;k<gametes.length;k++) {
    const q = gametes[k];
    if (++q.age > GAMETE_LIFE) { stats.gamLost++; continue; }
    let fertilized = false;
    for (let st=0; st<GAMETE_SPEED && !fertilized; st++) {
      const x = q.i%COLS, y = (q.i/COLS)|0;
      // инерция хода: гамета идёт в прежнюю сторону, слегка виляя
      if (Math.random() < 0.25 || (q.dx===0 && q.dy===0)) {
        q.dx = (Math.random()*3|0)-1; q.dy = (Math.random()*3|0)-1;
      }
      const nx = x+q.dx, ny = y+q.dy;
      if (nx<0||nx>=COLS||ny<0||ny>=ROWS) { q.dx = -q.dx; q.dy = -q.dy; continue; }
      q.i = idx(nx,ny);
      const c = NB8.cnt[q.i], base = q.i*NB8.k;
      for (let o=0;o<c;o++) {
        const ni = NB8.tab[base+o];
        if (state[ni]!==1) continue;
        const host = bodies.get(owner[ni]);
        if (!host || host.id === q.from || host.cooldown > 0) continue;
        if (!bears(host)) continue;                      // самец гамету не принимает
        if (host.g.sexual < 0.15 || host.energy < host.g.thresh*0.6) continue;
        if (!gameteFits(q.g, host)) continue;
        if (fertilize(host, q)) { fertilized = true; stats.gamHit++; }
        break;
      }
    }
    if (fertilized) continue;
    gametes[w++] = q;
  }
  gametes.length = w;
}

// Оплодотворение: приходящая гамета становится одним набором, своя — вторым.
// Зачаток и его цену платит ПРИНИМАЮЩАЯ сторона: она на месте, ей и вынашивать.
function fertilize(host, q) {
  const hg = host.g;
  const perChild = hg.thresh * hg.costFrac;
  const A = mutateAllele(q.g, false);
  const B = mutateAllele(gameteOf(host), false);
  macroMutate(A, B);
  const cg = expressGenome(A, B);
  applyPackages(cg, hg, host.guild === 'pred', A, B);
  const tpl = templateOf(cg.shapeType, cg.shapeA, cg.shapeB).length;
  const childCost = perChild * (1 + 0.35*(tpl-1));
  const kind = host.guild === 'photo' ? 0 : host.guild === 'sapro' ? 1 : 2;
  const prov = childCost * (kind === 2 ? (0.50 + cg.seedProv*EGG_PROV)
                          : kind === 1 ? (0.10 + cg.seedProv*SPORE_PROV)
                          : (0.35 + cg.seedProv*0.8));
  const cost = prov + childCost*(kind === 2 ? (EGG_OVERHEAD + cg.dispersal*EGG_FLIGHT)
                               : kind === 1 ? (SPORE_OVERHEAD + cg.dispersal*SPORE_FLIGHT)
                               : (SEED_OVERHEAD + cg.dispersal*SEED_FLIGHT));
  const price = cost * (host.sex === 'f' ? FEM_BEAR_DISCOUNT : 1);
  if (host.energy < price + hg.thresh*0.25) return false;
  if (!launchSeed(host, cg, host.lineage, prov, kind, { A, B })) return false;
  host.energy -= price;
  host.cooldown = hg.cycleHours;
  stats.sexBirths++;
  return true;
}

// Семя ждёт СВОЕГО часа: свободной клетки и света. Всхожесть детерминирована —
// при выполненных условиях семя всходит, а не бросает кубик (то же правило, что
// у поедания: случайность на месте решения превращает механику в шум).
function processSeeds() {
  if (!seeds.length) return;
  let w = 0;
  for (let k=0;k<seeds.length;k++) {
    const s = seeds[k];
    s.energy -= (s.kind === 2 ? EGG_UPKEEP : (s.kind ? SPORE_UPKEEP : SEED_UPKEEP)) * dormUpkeep(s.g);
    if (s.energy <= 0.02) { if (s.kind === 2) stats.eggRot++; else if (s.kind) stats.sporeRot++; else stats.seedRot++; continue; }
    const x = s.i%COLS, y = (s.i/COLS)|0;
    // Семя ждёт СВЕТА, спора ждёт СУБСТРАТА — это и есть разница ниш, перенесённая
    // на стадию покоя: фототрофу нужно куда встать под солнцем, грибу — на чём расти.
    let ready = false;
    if (state[s.i] === 0) {
      if (s.kind === 2) ready = (++s.age) >= s.incub;     // икра ждёт СВОЙ срок, а не погоду
      else if (s.kind === 1) {
        for (const [dx,dy] of noff) { const nx=x+dx, ny=y+dy;
          if (nx>=0&&nx<COLS&&ny>=0&&ny<ROWS && state[idx(nx,ny)]===2) { ready = true; break; } }
      } else ready = vGrad[y]*dayFactor*fertility[s.i] >= SEED_GERM_LIGHT;
    }
    if (ready && Math.random() < germChance(s.g) && tryPlaceBody(s.g, s.lineage, x, y, s.energy, s.al)) {
      if (s.kind === 2) stats.eggHatch++; else if (s.kind) stats.sporeGerm++; else stats.seedGerm++;
      continue;
    }
    stats.seedWait++;
    // ветер сносит семя — это свойство мира, а не признак семени: своего движения
    // у семени нет, иначе оно дублировало бы moveSpeed и стало бы просто зверем
    if (s.kind !== 2 && Math.random() < SEED_DRIFT) {
      const nx = x + (Math.random()*3|0) - 1, ny = y + (Math.random()*3|0) - 1;
      if (nx>=0&&nx<COLS&&ny>=0&&ny<ROWS) s.i = idx(nx,ny);
    }
    seeds[w++] = s;
  }
  seeds.length = w;
}

// Запуск семени: точка приземления берётся от случайной клетки родителя, дальность
// — из гена, но РОЗЫГРЫШЕМ от 1 до предела, иначе дальняя линия теряла бы ближние
// места целиком. Улетевшее за край чашки семя пропадает — цена дальнего разлёта.
function launchSeed(body, cg, lineage, provision, kind, al) {
  if (seeds.length >= SEED_MAX) return false;
  const c = body.cells[Math.floor(Math.random()*body.cells.length)];
  const x = c%COLS, y = (c/COLS)|0;
  const R = 1 + Math.floor(cg.dispersal*(kind === 2 ? EGG_RANGE : kind ? SPORE_RANGE : SEED_RANGE));
  const d = 1 + Math.floor(Math.random()*R);
  const a = Math.random()*Math.PI*2;
  const nx = Math.round(x + Math.cos(a)*d), ny = Math.round(y + Math.sin(a)*d);
  if (nx<0||nx>=COLS||ny<0||ny>=ROWS) { stats.seedLost++; return true; }  // цена уплачена, зачаток потерян
  const p = { i: idx(nx,ny), g: cg, al, lineage, energy: provision, kind };
  if (kind === 2) { p.age = 0; p.incub = EGG_INCUB + cg.seedProv*EGG_INCUB_PROV; stats.eggMade++; }
  else if (kind) stats.sporeMade++; else stats.seedMade++;
  seeds.push(p);
  return true;
}

function step() {
  const hourOfDay = hours % 24;
  if (params.dayNight) dayFactor = (hourOfDay>=6 && hourOfDay<=18) ? Math.sin((hourOfDay-6)/12*Math.PI) : 0.15;
  else dayFactor = 1;
  phaseX += 0.00006; phaseY += 0.00004;
  // плодородие дрейфует на 0.00006/час — ежечасный пересчёт 4232 клеток впустую
  if (hours % 8 === 0) computeFertility();
  decayCorpses();
  processSpores();
  processSeeds();
  processGametes();

  order.length = 0;
  for (const b of bodies.values()) order.push(b);
  for (let i=order.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); const t=order[i]; order[i]=order[j]; order[j]=t; }

  for (const body of order) {
    if (!bodies.has(body.id)) continue;
    const g = body.g;
    body.age++;
    if (body.cooldown > 0) body.cooldown--;
    if (body.age > g.lifespan) { stats.dAge++; killBody(body); continue; }   // смерть тела целиком по возрасту

    const size = body.cells.length;
    let interiorCount = 0;
    const borderCells = [];  // маркер снимается в конце обработки тела
    // граница считается ОДИН раз за час на тело: раньше isBorder вызывался повторно
    // ещё и в цикле дохода — лишний обход восьми соседей на каждую клетку каждый час
    for (const i of body.cells) { if (isBorder(body, i)) { borderCells.push(i); borderMark[i] = 1; } else interiorCount++; }
    const differentiated = interiorCount > 0;   // дифференцировка возможна только если есть сердцевина
    const interiorFrac = size ? interiorCount / size : 0;

    // ---- доход ----
    if (body.par) {
      body.par.load = Math.min(1, body.par.load + 0.03);
      body.energy -= body.par.load * body.par.vir * PAR_VIR * size * PAR_DMG;   // крупное тело — крупная мишень
      stats.parHours++;
      // Базовое выздоровление обязательно: при чистом `иммунитет*0.02` и стартовом
      // иммунитете 0.08 срок болезни выходил 625 часов, то есть пожизненно, и мир
      // вымирал прежде, чем иммунитет успевал подняться отбором.
      if (Math.random() < 0.004 + g.immunity*0.06) { body.par = null; stats.parCleared++; }
    }
    const pace = paceOf(g.metab);   // темп обмена: множитель на весь доход
    let income = 0;
    if (body.guild === 'photo') {
      for (const i of body.cells) {
        const y = (i/COLS)|0;
        const synth = !differentiated ? 1 : (borderMark[i] ? BORDER_SYNTH : INTERIOR_SYNTH);
        income += g.photo * vGrad[y] * dayFactor * PHOTO_GAIN * fertility[i] * synth * pace;
      }
    }
    body.energy += income;

    // ---- апкип ----
    const guildIsHetero = body.guild !== 'photo';
    const senescence = 0.4 / Math.max(200, g.lifespan);
    const nicheSum = g.photo + g.herb + g.aggression + g.sapro;
    const dom = Math.max(g.photo, g.herb, g.aggression, g.sapro);
    // Конкуренция за место сильнее ВНУТРИ своей ниши, чем между нишами: соседи,
    // живущие с того же ресурса, мешают по-настоящему. Так монокультура фототрофов
    // прореживает сама себя, а гетеротрофы, которые по устройству ниши всегда сидят
    // среди чужих клеток, не платят за это (ровно на этом я раньше их и утопил).
    let crowd = 0, crowdSame = 0;
    const myCode = GCODE[body.guild];
    for (let bi2=0; bi2<borderCells.length; bi2++){
      const i = borderCells[bi2], c = NB8.cnt[i], base = i*NB8.k;
      for (let o=0;o<c;o++){ const ni = NB8.tab[base+o];
        if (state[ni]!==1 || owner[ni]===body.id) continue;
        crowd++;
        if (cellGuild[ni] === myCode) crowdSame++;
      } }
    const moveTax = (body.guild==='herb'||body.guild==='pred') ? g.moveSpeed*0.03*size : 0;
    const upkeep = size*(g.metab + dom*0.10 + (nicheSum-dom)*0.02 + g.armor*0.03 + (guildIsHetero ? g.effic*0.05 : 0))
                 + crowdSame*0.045 + (crowd-crowdSame)*0.006 + body.age*senescence*AGE_SCALE(size) + size*0.015 + moveTax
                 + size*g.lifespan*SOMA
                 + size*g.immunity*IMM_COST;   // содержание долговечного тела
    { const k = (body.foot.length>1 && size>=body.foot.length) ? acct.multi : (body.foot.length===1 ? acct.uni : null);
      if (k) { k.h++; k.cells += size; k.inc += income; k.upk += upkeep; } }
    { const q = gacct[body.guild]; q.h++; q.inc += income; q.upk += upkeep; }
    if (mv[body.guild]) mv[body.guild].h++;
    body.energy -= upkeep;
    const eBefore = body.energy;
    if (body.energy <= 0) { for(const i of borderCells) borderMark[i]=0; stats.dStarve++; killBody(body); continue; } // смерть тела целиком: общий пул исчерпан

    // ---- питание гетеротрофов: добывает барьер, перерабатывает сердцевина ----
    let ate = false, moved = false;
    if (body.guild !== 'photo') {
      const processing = 1 + INTERIOR_PROCESS * interiorFrac;
      let gained = 0;   // сколько энергии дал этот час кормёжки
      // итоговая доля усвоения — никогда не больше ASSIM_CAP, то есть всегда < 1
      const assim = Math.min(ASSIM_CAP, ASSIM_BASE[body.guild] * g.effic * processing) * pace;   // темп обмена и на еду
      // Ниша соседа берётся из cellGuild, а не из bodies.get(): три замыкания-предиката
      // пересоздавались на КАЖДОЕ тело КАЖДЫЙ час и стоили ~7% профиля.
      const myId = body.id, mode = GCODE[body.guild];
      let targets = [];
      for (let bi3=0; bi3<borderCells.length; bi3++){ const i = borderCells[bi3];
        const R = mode===G_SAPRO ? NB4R : NB24;
        const c2 = R.cnt[i], b2 = i*R.k;
        for (let o=0;o<c2;o++){ const ni = R.tab[b2+o];
          if (mode===G_SAPRO){ if (state[ni]===2) targets.push(ni); }
          else if (state[ni]===1 && owner[ni]!==myId){
            const gq = cellGuild[ni];
            if (mode===G_PRED ? (gq===G_HERB||gq===G_PRED) : gq===G_PHOTO) targets.push(ni);
          } } }

      const bites = Math.min(borderCells.length, 6);   // укусов за час — по числу барьерных клеток
      if (targets.length) {
        let tgt = targets[Math.floor(Math.random()*targets.length)];
        if (body.guild === 'pred' && params.predation) {
          ate = true;   // добыча в пределах досягаемости: дерёмся, а не уходим
          for (let bi=0; bi<bites; bi++) if (Math.random() < g.aggression*0.65) {
            const victim = bodies.get(owner[tgt]);
            if (victim) {
              body.energy -= (0.3 + g.aggression*0.6);
              const vSize = victim.cells.length;
              const vBorder = isBorder(victim, tgt);
              const vDiff = victim.cells.length >= 9 && victim.cells.some(c => !isBorder(victim, c));
              const effArmor = victim.g.armor + (vDiff && vBorder ? BORDER_ARMOR_BONUS : 0);
              const atk = (body.energy/size) * (0.6+g.aggression*1.15) * (0.8+Math.random()*0.5);
              const def = (victim.energy/vSize) * (0.5+effArmor) * (0.75+Math.random()*0.5);
              if (atk > def) {
                // барьер пробит -> тело гибнет целиком (п.4)
                body.energy += (victim.energy*0.75 + vSize*RELEASE[victim.guild]*0.75) * assim;
                stats.dPred++; killBody(victim, 0.25); stats.eaten++; stats.fedBy[body.guild]++; ate = true;
              }
            }
          }
        } else if (body.guild === 'herb') {
          for (let bi=0; bi<bites; bi++) {
            const victim = bodies.get(owner[tgt]);
            if (victim) {
              // Укус — ДОЛЯ энергии растения, а не фиксированная величина. С жёстким потолком
              // herb*2.4 травоядное снимало одинаково и с голодного, и с жирного растения:
              // замерено 0.95 против 0.98 на тело-час при полуторакратной разнице в доходе
              // растений. Поэтому рост первичной продукции (например, круглосуточный свет)
              // никак не доходил до травоядных, и мир вырождался в монокультуру.
              // Доля даёт крупный кусок с жирного растения, абсолютный минимум —
              // добивает слабое. Без минимума укус лишь «стрижёт»: замерено, что за
              // 20 000 часов травоядные убили ТРИ растения, место не освобождалось
              // вовсе, решётка стояла забитой на 87%, и все умирали от старости.
              const bite = Math.min(0.55, g.herb*HFRAC);
              let drain = Math.max(victim.energy*bite, g.herb*HMIN);
              drain = Math.min(drain, victim.energy, g.herb*HCAP*Math.sqrt(size));
              victim.energy -= drain;
              body.energy += drain*assim - 0.12; gained += drain*assim; ate = true;
              stats.eaten++; stats.fedBy[body.guild]++; ate = true;
              // Съеденное растение оставляет лишь остаток, а не полноценный труп: его ведь
              // съели. С полным трупом выходило наоборот — чем активнее травоядные едят,
              // тем плотнее заваливают чашку непроходимыми останками (абиотический распад
              // 0.0025/час, труп лежит сотни часов), и место под потомство не открывалось.
              if (victim.energy <= 0) { stats.dPred++; killBody(victim, GRAZE_LEFT); }
            }
          }
        } else if (body.guild === 'sapro') {
          for (let bi=0; bi<bites; bi++) {
            const drain = Math.min(corpseFood[tgt], g.sapro*params.decomp*9*Math.sqrt(size));
            corpseFood[tgt] -= drain;
            body.energy += drain*assim; gained += drain*assim; ate = true;
            if (corpseFood[tgt] <= 0.001) { state[tgt]=0; corpseFood[tgt]=0; }
            stats.fedBy[body.guild]++; ate = true;
          }
        }
      }
      // Травоядное уходит не когда еды нет вовсе, а когда ПАСТБИЩЕ ВЫЕДЕНО: час
      // кормёжки не окупил даже собственных расходов. Иначе в мире, забитом
      // растениями, еда всегда под боком и трогаться с места незачем — замерено
      // 0.2-1.3 шага на 100 тело-часов при 93% занятости решётки.
      if (mode === G_HERB && gained < upkeep*SAT) ate = false;
      // Ищем еду, когда НЕ ПОЕЛИ, а не только когда вокруг вообще пусто. Раньше
      // движение стояло в ветке else от «есть цель в радиусе 2», а при решётке,
      // забитой растениями, такого не случается никогда: замерено 0 шагов.
      if (!ate && (mode===G_HERB || mode===G_PRED)) {
        const seekPred = mode===G_PRED;
        const hx = body.cells[0]%COLS, hy = (body.cells[0]/COLS)|0;
        let found = null;
        for (let so=0; so<senseOffsets.length; so++){
          const dx = senseOffsets[so][0], dy = senseOffsets[so][1];
          const nx=hx+dx, ny=hy+dy;
          if (nx<0||nx>=COLS||ny<0||ny>=ROWS) continue;
          const ni = idx(nx,ny);
          if (state[ni]!==1 || owner[ni]===myId) continue;
          const gq = cellGuild[ni];
          if (seekPred ? (gq===G_HERB||gq===G_PRED) : gq===G_PHOTO) { found = [dx,dy]; break; } }
        let sx, sy;
        if (found) { sx = Math.sign(found[0]); sy = Math.sign(found[1]); }
        else {
          // добычи не видно — поисковое блуждание с инерцией курса.
          // без этого организм с пустым радиусом восприятия стоял на месте и голодал
          if (body.hx === undefined || Math.random() < 0.12) {
            const d = noff[Math.floor(Math.random()*noff.length)];
            body.hx = d[0]; body.hy = d[1];
          }
          sx = body.hx; sy = body.hy;
        }
        // Прямой шаг к добыче упирается в неё саму: её клетка занята ею же. Поэтому
        // пробуем направления по убыванию полезности — организм обходит препятствие,
        // а не замирает вплотную к еде.
        if (mv[body.guild]) mv[body.guild].try++;
        const ax = sx || 1, ay = sy || 1;
        const dirs = [[sx,sy],[sx,0],[0,sy],[sx,-ay],[-ax,sy],[sy,sx],[-sy,-sx],[-ax,-ay]];
        let stepped = false;
        for (let di=0; di<dirs.length && !stepped; di++){
          const ddx = dirs[di][0], ddy = dirs[di][1];
          if ((ddx || ddy) && moveBody(body, ddx, ddy)) { sx = ddx; sy = ddy; stepped = true; }
        }
        if (stepped) {
          if (mv[body.guild]) mv[body.guild].m++;
          body.energy -= MOVE_COST*(0.7+g.moveSpeed*0.6)*size;
          moved = true;
          // быстрые успевают шагнуть дважды за час: иначе moveSpeed влиял только на
          // цену шага и отбор гнал его к минимуму
          if (Math.random() < g.moveSpeed-0.5 && moveBody(body, sx, sy)) {
            if (mv[body.guild]) mv[body.guild].m++;
            body.energy -= MOVE_COST*0.5*size;
          }
        } else if (!found) { body.hx = undefined; }
      }
    }
    for (const i of borderCells) borderMark[i] = 0;   // снимаем маркер: доход уже посчитан
    if (bodies.has(body.id)) gacct[body.guild].fed += Math.max(0, body.energy - eBefore);
    if (!bodies.has(body.id)) continue;
    if (body.energy <= 0) { killBody(body); continue; }
    // Ход больше НЕ отменяет размножение. Пока гетеротрофы ходили редко, это было
    // безобидно; теперь они ходят почти каждый час, и запрет лишал их размножения
    // почти полностью — популяции падали вдвое именно из-за него, а не из-за цены шага.
    void moved;

    // ---- рост шаблона, затем размножение ----
    const interiorDiscount = Math.min(0.30, interiorCount*0.04);
    const perChildCost = g.thresh * g.costFrac * (1 - interiorDiscount);
    const growCost = perChildCost * GROWTH_COST_FRAC;

    // достраиваем форму: следующая свободная клетка шаблона (порядок — от центра наружу)
    let slot = -1;
    if (size < body.foot.length) {
      for (const t of body.foot) {
        if (state[t]!==0) continue;
        if (!adjacentToBody(body, t)) continue;   // тело обязано оставаться связным
        slot = t; break;
      }
    }
    if (slot >= 0) {
      // рост не ждёт кулдауна: это не размножение, а достройка собственного тела
      if (body.energy >= growCost + g.thresh*0.35) {
        state[slot]=1; owner[slot]=body.id; cellGuild[slot]=GCODE[body.guild]; body.cells.push(slot);
        body.energy -= growCost; stats.grow++;
      }
      continue;
    }
    // slot < 0 — форма достроена ЛИБО оставшиеся клетки шаблона заняты чужими
    // (тупик: без этого такое тело осталось бы стерильным навсегда)

    // форма достроена -> деление даёт отдельный организм
    if (body.cooldown > 0) continue;
    // Якорь потомка нельзя брать вплотную к родителю: контур ребёнка центрируется на
    // якоре, поэтому у крупного плана он накрыл бы клетки самого родителя (забронированные)
    // и размещение отклонялось бы всегда. Зазор считается по ФАКТИЧЕСКОМУ размеру ребёнка:
    // для тела 4x4 контур идёт от -1 до +2 от якоря, значит зазора в полширины родителя мало.
    let pcx=0, pcy=0;
    for (const i of body.cells) { pcx += i%COLS; pcy += (i/COLS)|0; }
    pcx = Math.round(pcx/size); pcy = Math.round(pcy/size);
    let pw = 1, ph = 1;
    for (const [dx,dy] of body.tpl) { pw = Math.max(pw, dx+1); ph = Math.max(ph, dy+1); }
    const pReach = Math.ceil(Math.max(pw,ph)/2);

    // Кандидаты берём из предпосчитанного кольца: без тригонометрии, со случайной
    // точкой входа (чтобы не было направленной предвзятости) и с ранним выходом.
    function placeChild(cTplArr, cg, childEnergy, al) {
      let cw = 1, ch = 1;
      for (const o of cTplArr) { if (o[0]+1>cw) cw=o[0]+1; if (o[1]+1>ch) ch=o[1]+1; }
      const gap = Math.min(RING_MAX, pReach + Math.ceil((cw>ch?cw:ch)/2) + 1);
      const lo = ringStart[gap], hi = ringStart[Math.min(RING_MAX, gap+3)+1];
      const span = hi - lo;
      if (span <= 0) return null;
      const start = Math.floor(Math.random()*span);
      let tried = 0;
      for (let k=0; k<span && tried<18; k++) {
        const o = ringOff[lo + ((start+k) % span)];
        const nx = pcx + o[0], ny = pcy + o[1];
        if (nx<0||nx>=COLS||ny<0||ny>=ROWS) continue;
        if (state[idx(nx,ny)] !== 0) continue;
        tried++;
        const child = tryPlaceBody(cg, body.lineage, nx, ny, childEnergy, al);
        if (child) return child;
      }
      return null;
    }
    // Половое размножение: партнёр той же ниши, совместимый, сам готовый. Если
    // склонность к полу есть, а партнёра рядом нет — организм ЖДЁТ и не размножается
    // в этот час. Отсюда требование к продолжительности жизни: короткоживущая
    // половая линия просто не доживает до встречи.
    let mate = null;
    if (params.sexReprod && Math.random() < g.sexual) {
      const hx0 = body.cells[0]%COLS, hy0 = (body.cells[0]/COLS)|0;
      for (let so=0; so<senseOffsets.length && !mate; so++) {
        const nx = hx0+senseOffsets[so][0], ny = hy0+senseOffsets[so][1];
        if (nx<0||nx>=COLS||ny<0||ny>=ROWS) continue;
        const ni = idx(nx,ny);
        if (state[ni]!==1 || owner[ni]===body.id) continue;
        const cand = bodies.get(owner[ni]);
        if (!cand || cand.cooldown > 0) continue;
        if (cand.energy < cand.g.thresh*0.5) continue;   // партнёр должен быть в силах
        if (cand.g.sexual < 0.15) continue;              // и сам не быть строго клональным
        if (!sexesFit(body, cand)) continue;             // два самца или две самки — не пара
        if (!bears(body) && !bears(cand)) continue;      // носить зачаток должен хоть кто-то
        if (!compatible(body, cand)) continue;
        mate = cand;
      }
      // ФАКУЛЬТАТИВНЫЙ пол: не дождавшись партнёра, размножаемся клонально. Так
      // поступают многие реальные виды, и это снимает проблему старта: одинокий
      // половой мутант в клональном мире не имеет партнёра вовсе, ждёт и проигрывает.
      // Замерено: при равном старте пол выигрывает (1741 против 1210 к 30 000 ч),
      // но возникнув в одиночку — не может закрепиться.
      if (!mate) {
        stats.mateFail++;
        // Партнёра рядом нет — вместо пустого ожидания организм ВЫПУСКАЕТ ГАМЕТУ.
        // Это и есть смысл подвижной половой клетки: сидячему фототрофу партнёр
        // не дойдёт никогда, а гамета дойдёт.
        if (GAMETES_ON && sheds(body) && gametes.length < GAMETE_MAX && body.energy > g.thresh*0.6) {
          const gcost = g.thresh * g.costFrac * GAMETE_COST * (body.sex === 'm' ? MALE_GAM_DISCOUNT : 1);
          if (body.energy > gcost + g.thresh*0.4) {
            body.energy -= gcost;
            const c0 = body.cells[Math.floor(Math.random()*body.cells.length)];
            gametes.push({ i: c0, g: gameteOf(body), from: body.id, lineage: body.lineage,
                           age: 0, dx: 0, dy: 0 });
            stats.gamMade++;
          }
        }
        body.mateWait = (body.mateWait || 0) + 1;
        if (body.mateWait < MATE_PATIENCE) continue;   // ещё ждём
        body.mateWait = 0;                             // терпение вышло — клонируемся
      } else body.mateWait = 0;
    }

    const wanted = g.broodSize;
    let madeAny = false;
    for (let k=0;k<wanted;k++) {
      const kid = childGenome(body, mate, body.guild==='pred');
      const cg = kid.g;
      // крупный потомок стоит родителю пропорционально телу, которое ему предстоит
      // построить — иначе он стартует с крохами энергии и гибнет, не достроившись
      const cTplArr = templateOf(cg.shapeType, cg.shapeA, cg.shapeB);
      const childCost = perChildCost * (1 + 0.35*(cTplArr.length-1));
      if (body.energy < childCost + g.thresh*0.5) break;
      // ── СЕМЯ вместо подсадки вплотную: только у фототрофа и только при половом
      // размножении. Провизия и дальность заявлены генами и оплачены сразу; место
      // при этом НЕ ищется — в том и смысл, что расселение не упирается в тесноту.
      // Носителем становится тот, кто способен носить: самец передаёт эту работу
      // партнёру целиком, потому и не платит за зачаток.
      const carrier = mate ? (bears(body) ? body : mate) : body;
      const isEgg = EGGS_ON && (carrier.guild === 'herb' || carrier.guild === 'pred');
      if (SEEDS_ON && mate && (carrier.guild === 'photo' || (SPORESEX_ON && carrier.guild === 'sapro') || isEgg)) {
        const isSpore = carrier.guild === 'sapro' ? 1 : 0;
        const kind = isEgg ? 2 : isSpore;
        const prov = childCost * (kind === 2 ? (0.50 + cg.seedProv*EGG_PROV)
                                : isSpore ? (0.10 + cg.seedProv*SPORE_PROV)
                                : (0.35 + cg.seedProv*0.8));
        const seedCost = prov + childCost*(kind === 2
          ? (EGG_OVERHEAD + cg.dispersal*EGG_FLIGHT)
          : isSpore ? (SPORE_OVERHEAD + cg.dispersal*SPORE_FLIGHT)
          : (SEED_OVERHEAD + cg.dispersal*SEED_FLIGHT));
        if (body.energy < seedCost*0.5 + g.thresh*0.25 || mate.energy < seedCost*0.5) break;
        if (!launchSeed(carrier, cg, carrier.lineage, prov, kind, kid.al)) break;
        body.energy -= seedCost*0.5; mate.energy -= seedCost*0.5; stats.sexBirths++;
        madeAny = true;
        continue;
      }
      const child = placeChild(cTplArr, cg, Math.max(childCost*0.55, cg.__endow||0), kid.al);
      if (!child) { stats.noSpot++; body.cooldown = Math.max(6, g.cycleHours*0.3); break; }
      // цена делится между родителями — это и есть двукратная цена пола
      if (mate) { body.energy -= childCost*0.5; mate.energy -= childCost*0.5; stats.sexBirths++; }
      else body.energy -= childCost;
      madeAny = true;
      const k = (body.foot.length>1) ? acct.multi : acct.uni; k.kids++;
    }
    if (madeAny) { body.cooldown = g.cycleHours; if (mate) mate.cooldown = mate.g.cycleHours; }
  }
  for (const body of bodies.values()) {
    if (!body.par || body.par.load < 0.25) continue;
    const src = body.cells[Math.floor(Math.random()*body.cells.length)];
    const c = NB24.cnt[src], base = src*NB24.k;
    for (let o=0;o<c;o++) {
      const ni = NB24.tab[base+o];
      if (state[ni]!==1 || owner[ni]===body.id) continue;
      const host = bodies.get(owner[ni]);
      if (!host || host.par) continue;
      const fit = keyDist(body.par.key, host.g.immuneKey) < MATCH_W ? 1 : 0.12;
      // заразнее тот, кто свирепее: в этом и весь компромисс
      if (Math.random() < PAR_INF * virInf(body.par.vir) * fit * (1 - host.g.immunity*0.85)) {
        let k = body.par.key + (Math.random()*2-1)*0.04;   // ключ мутирует при передаче
        k = k < 0 ? k+1 : (k > 1 ? k-1 : k);
        const v = Math.min(VIR_RANGE, Math.max(0, body.par.vir + (Math.random()*2-1)*VIR_MUT));
        host.par = { key: k, vir: v, load: 0.05 };
        stats.parInfect++;
        break;
      }
    }
  }
  if (bodies.size && Math.random() < PAR_SEED) {
    const arr = [...bodies.values()];
    const v = arr[Math.floor(Math.random()*arr.length)];
    if (!v.par) { v.par = { key: Math.random(), vir: 0.2 + Math.random()*0.6, load: 0.05 }; stats.parSeed++; }
  }
  hours++;
}

// ── ВОСПРОИЗВОДИМОСТЬ. До этого `reset(n)` принимал ЧИСЛО КОЛОНИЙ, а генератор
// был обычный Math.random — два прогона «с тем же стартом» на деле были двумя
// разными мирами, и сравнение А/Б держалось на удаче. Теперь стенд подменяет
// Math.random детерминированным mulberry32 на время прогона: одинаковый seed
// даёт побитово одинаковый мир до первой точки, где сравниваемые правки
// расходятся (метод общих случайных чисел). В браузере ничего не меняется.
function mulberry32(a){ return function(){
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}; }
function reset(colonies=24, seed=null) {
  if (seed !== null) Math.random = mulberry32(seed);
  state.fill(0); owner.fill(0); cellGuild.fill(G_NONE); corpseFood.fill(0); sporeDensity.fill(0);
  seeds.length = 0; gametes.length = 0;
  bodies.clear(); nextBodyId=1; nextLineageId=1; hours=0;
  stats = freshStats();
  // Чашка — плоская плёнка, на которую смотрят СВЕРХУ, поэтому свет равномерен.
  // Раньше стояло `1 - (y/(ROWS-1))*0.68` — падение на 68% сверху вниз, то есть
  // логика водной толщи, снятой сбоку. Значение 0.66 — это среднее прежнего
  // градиента: суммарный световой бюджет чашки не изменился, изменилось только
  // его распределение. Пространственную неоднородность дают пятна плодородия.
  for (let y=0;y<ROWS;y++) vGrad[y] = params.light;
  phaseX = Math.random()*10; phaseY = Math.random()*10;
  computeFertility();
  let placed=0, guard=0;
  while (placed<colonies && guard<colonies*60) {
    guard++;
    const x = Math.floor(Math.random()*COLS), y = Math.floor(Math.random()*ROWS);
    if (state[idx(x,y)]===0) {
      const [fg, fal] = founderDiploid();
      if (tryPlaceBody(fg, nextLineageId++, x, y, 9+Math.random()*4, fal)) placed++;
    }
  }
}

function snapshot() {
  const gc = {photo:0,herb:0,pred:0,sapro:0};
  let cells=0, multi=0, maxSize=0, shapes={0:0,1:0,2:0,3:0}, effSum=0, diff=0;
  for (const b of bodies.values()) {
    gc[b.guild]++; cells += b.cells.length; effSum += b.g.effic;
    if (b.cells.length>1) multi++;
    if (b.cells.some(c=>!isBorder(b,c))) diff++;
    maxSize = Math.max(maxSize, b.cells.length);
    shapes[b.g.shapeType]++;
  }
  let corpses=0; for (let i=0;i<N;i++) if (state[i]===2) corpses++;
  let sexN=0, sexSum=0, lifeSex=0, lifeAsex=0, nSex=0, nAsex=0, infected=0, immSum=0; const keys=[];
  for (const b of bodies.values()) {
    sexSum += b.g.sexual;
    if (b.par) infected++;
    immSum += b.g.immunity; keys.push(b.g.immuneKey);
    if (b.g.sexual >= 0.5) { sexN++; lifeSex += b.g.lifespan; nSex++; }
    else { lifeAsex += b.g.lifespan; nAsex++; }
  }
  let doneCnt=0; for (const b of bodies.values()) if (b.cells.length>=b.foot.length) doneCnt++;
  const kMean = keys.length ? keys.reduce((a,b)=>a+b,0)/keys.length : 0;
  const kSd = keys.length ? Math.sqrt(keys.reduce((a,b)=>a+(b-kMean)*(b-kMean),0)/keys.length) : 0;
  let eggN=0, sporeN=0, seedN=0;
  for (const p of seeds) { if (p.kind===2) eggN++; else if (p.kind) sporeN++; else seedN++; }
  let dspSum=0, prvSum=0; for (const b of bodies.values()) { dspSum+=b.g.dispersal; prvSum+=b.g.seedProv; }
  // Гетерозиготность: средняя разница аллелей, нормированная на диапазон гена.
  // Считается отдельно для половых и клональных линий — в этом вся суть: клон
  // свою гетерозиготность хранит, но никогда не перемешивает.
  const QGEN = GENES.filter(k => !DOMINANT_ONLY.has(k));
  let dormSum=0;
  for (const b of bodies.values()) dormSum += b.g.dormancy;
  let dioN=0, maleN=0;
  for (const b of bodies.values()) { if (b.sex) { dioN++; if (b.sex === 'm') maleN++; } }
  let virSum=0, virN=0, virSq=0;
  for (const b of bodies.values()) if (b.par) { virSum += b.par.vir; virSq += b.par.vir*b.par.vir; virN++; }
  const virAvg = virN ? virSum/virN : 0;
  const virSd = virN ? Math.sqrt(Math.max(0, virSq/virN - virAvg*virAvg)) : 0;
  let hetS=0, nS=0, hetA=0, nA=0;
  let dipN = 0;
  for (const b of bodies.values()) {
    if (b.al.A === b.al.B) continue;
    dipN++;
    let h = 0;
    for (const k of QGEN) { const [lo,hi] = RANGE[k]; h += Math.abs(b.al.A[k]-b.al.B[k])/(hi-lo); }
    h /= QGEN.length;
    if (b.g.sexual >= 0.5) { hetS += h; nS++; } else { hetA += h; nA++; }
  }
  return { hours, org: bodies.size, cells, corpses, sexN, seeds: seeds.length, seedN, sporeN, eggN,
           hetSex: nS? +(hetS/nS).toFixed(4):0, hetAsex: nA? +(hetA/nA).toFixed(4):0, dipN,
           dormAvg: bodies.size? +(dormSum/bodies.size).toFixed(3):0,
           dioN, maleShare: dioN? +(maleN/dioN).toFixed(3):0,
           gametes: gametes.length, virAvg: +virAvg.toFixed(3), virSd: +virSd.toFixed(3),
           dispAvg: bodies.size? +(dspSum/bodies.size).toFixed(3):0, provAvg: bodies.size? +(prvSum/bodies.size).toFixed(3):0,
           infected, immAvg: bodies.size? +(immSum/bodies.size).toFixed(3):0, keySd: +kSd.toFixed(3), sexAvg: bodies.size? +(sexSum/bodies.size).toFixed(3):0,
           lifeSex: nSex? Math.round(lifeSex/nSex):0, lifeAsex: nAsex? Math.round(lifeAsex/nAsex):0, ...gc, multi, diff, maxSize, done: doneCnt,
           effic: bodies.size? (effSum/bodies.size).toFixed(2):'-', shapes };
}

// Только для стенда: выкосить нишу целиком и посмотреть, вернётся ли она из
// банка зачатков. Естественное вымирание ниши в прогоне поймать трудно — оно
// короткое и совпадает с общим развалом, а здесь условие задаётся ровно.
function killGuild(name) {
  let n = 0;
  for (const b of [...bodies.values()]) if (b.guild === name) { killBody(b, 1); bodies.delete(b.id); n++; }
  return n;
}
module.exports = { killGuild, compatible, get mv(){ return mv; }, reset, step, snapshot, get stats(){ return stats; }, params, bodies, get seeds(){ return seeds; }, templateOf, tryPlaceBody, founderGenome,
  get gacct(){ return gacct; }, gReset,
  get acct(){ return acct; }, acctReset,
  get hours(){ return hours; } };

if (require.main === module) {
  const HOURS = parseInt(process.argv[2]||'20000',10);
  reset(24);
  const marks = new Set([24,168,720,2000,5000,10000,15000,20000,30000,50000].filter(h=>h<=HOURS));
  console.log('час\tорг\tклет\tтруп\tphoto\therb\tpred\tsapro\tмного\tдифф\tmax\tготов\teffic\tформы');
  for (let h=0;h<HOURS;h++) {
    step();
    if (marks.has(hours)) {
      const s = snapshot();
      console.log(`${s.hours}\t${s.org}\t${s.cells}\t${s.corpses}\t${s.photo}\t${s.herb}\t${s.pred}\t${s.sapro}\t${s.multi}\t${s.diff}\t${s.maxSize}\t${s.done}\t${s.effic}\t${JSON.stringify(s.shapes)}`);
    }
    if (bodies.size===0) { console.log(`ВЫМИРАНИЕ на часу ${hours}`); break; }
  }
  console.log('события:', JSON.stringify({born:stats.born,died:stats.died,eaten:stats.eaten,moves:stats.moves,germ:stats.germ,grow:stats.grow,dStarve:stats.dStarve,dAge:stats.dAge,dPred:stats.dPred,noRoom:stats.noRoom}));
  console.log('по нишам: ниша | рождено | умерло | ср.жизнь(ч) | удачных кормлений');
  for (const k of ['photo','herb','pred','sapro']) {
    const d = stats.diedBy[k] || 0;
    console.log(`  ${k}\t${stats.bornBy[k]}\t${d}\t${d? (stats.lifeBy[k]/d).toFixed(0):'-'}\t${stats.fedBy[k]}`);
  }
}
