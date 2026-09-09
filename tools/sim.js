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
   // равномерная освещённость плоской плёнки
const GRAZE_LEFT = 0.12;   // от съеденного растения остаётся лишь остаток

const SAT = 1.0;   // насколько час кормёжки должен окупать расходы, чтобы остаться на месте
const HFRAC = 0.35, HCAP = 8, HMIN = 0.4;   // доля от энергии растения, потолок, абсолютный минимум укуса
    // старение растёт с размером тела, но не линейно  // вырастить свою клетку дешевле, чем породить организм  // внутренние перерабатывают добытое барьером

const GENES = ['metab','effic','thresh','costFrac','minN','maxN','aggression','armor',
               'photo','herb','sapro','cycleHours','moveSpeed','lifespan','broodSize',
               'shapeType','shapeA','shapeB','sexual'];
const RANGE = {
  metab:[0.15,1.7], effic:[0.35,1.0], thresh:[4,40], costFrac:[0.2,0.9],
  minN:[0,4], maxN:[1,8], aggression:[0,1], armor:[0,1], photo:[0,1], herb:[0,1],
  sapro:[0,1], cycleHours:[4,1200], moveSpeed:[0.15,1], lifespan:[100,12000],
  broodSize:[1,4], shapeType:[0,3], shapeA:[1,5], shapeB:[1,5], sexual:[0,1],
};
const DRIFT = { metab:0.5, effic:0.5, thresh:7, costFrac:0.28, aggression:0.25, armor:0.25,
                photo:0.25, herb:0.25, sapro:0.25, cycleHours:20, moveSpeed:0.3, lifespan:150, sexual:0.25 };
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
let nextBodyId = 1, nextLineageId = 1;
let hours = 0, phaseX = 0, phaseY = 0, dayFactor = 1;
const order = [];   // переиспользуемый буфер обхода тел
let params = { mutation: 0.12, decomp: 0.3, light: 0.62, predation: true, dayNight: true, sexReprod: true };
function freshStats(){ return { born:0, died:0, eaten:0, moves:0, germ:0, grow:0,
  dStarve:0, dAge:0, dPred:0, noRoom:0, noSpot:0, sexBirths:0, mateFail:0,
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
  if (type >= 2) { a = Math.min(a, 3); b = Math.min(b, 3); }
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
function tryPlaceBody(g, lineage, anchorX, anchorY, energy) {
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
  const body = { id, g, lineage, guild: guildOfGenome(g), ox, oy, tpl,
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

function mutateGenome(pg, wasPred) {
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
  if (Math.random() < MACRO_MUT_CHANCE) {
    const k = GENES[Math.floor(Math.random()*GENES.length)];
    const [lo,hi] = RANGE[k];
    g[k] = DISCRETE.includes(k) ? lo + Math.floor(Math.random()*(hi-lo+1)) : lo + Math.random()*(hi-lo);
    g.maxN = Math.max(g.maxN, g.minN + 1);
  }
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
  return g;
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
    shapeType: 0, shapeA: 1, shapeB: 1,          // основатель одноклеточный
  };
}

function decayCorpses() {
  for (let i=0;i<N;i++) if (state[i]===2) {
    corpseFood[i] -= 0.0025;
    if (corpseFood[i] <= 0.001) { state[i]=0; corpseFood[i]=0; }
  }
}

function processSpores() {
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
        const g = founderGenome();
        g.photo = 0.02+Math.random()*0.06; g.sapro = 0.55+Math.random()*0.35;
        g.cycleHours = 48+Math.random()*100; g.lifespan = 1500+Math.random()*2500;
        if (tryPlaceBody(g, nextLineageId++, gx, gy, 5)) { sporeDensity[i]=0; stats.germ++; }
      }
    }
  }
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
    let income = 0;
    if (body.guild === 'photo') {
      for (const i of body.cells) {
        const y = (i/COLS)|0;
        const synth = !differentiated ? 1 : (borderMark[i] ? BORDER_SYNTH : INTERIOR_SYNTH);
        income += g.photo * vGrad[y] * dayFactor * PHOTO_GAIN * fertility[i] * synth;
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
                 + crowdSame*0.045 + (crowd-crowdSame)*0.006 + body.age*senescence*AGE_SCALE(size) + size*0.015 + moveTax;
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
      const assim = Math.min(ASSIM_CAP, ASSIM_BASE[body.guild] * g.effic * processing);
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
    function placeChild(cTplArr, cg, childEnergy) {
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
        const child = tryPlaceBody(cg, body.lineage, nx, ny, childEnergy);
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
        body.mateWait = (body.mateWait || 0) + 1;
        if (body.mateWait < MATE_PATIENCE) continue;   // ещё ждём
        body.mateWait = 0;                             // терпение вышло — клонируемся
      } else body.mateWait = 0;
    }

    const wanted = g.broodSize;
    let madeAny = false;
    for (let k=0;k<wanted;k++) {
      const cg = mutateGenome(mate ? recombine(g, mate.g) : g, body.guild==='pred');
      // крупный потомок стоит родителю пропорционально телу, которое ему предстоит
      // построить — иначе он стартует с крохами энергии и гибнет, не достроившись
      const cTplArr = templateOf(cg.shapeType, cg.shapeA, cg.shapeB);
      const childCost = perChildCost * (1 + 0.35*(cTplArr.length-1));
      if (body.energy < childCost + g.thresh*0.5) break;
      const child = placeChild(cTplArr, cg, Math.max(childCost*0.55, cg.__endow||0));
      if (!child) { stats.noSpot++; body.cooldown = Math.max(6, g.cycleHours*0.3); break; }
      // цена делится между родителями — это и есть двукратная цена пола
      if (mate) { body.energy -= childCost*0.5; mate.energy -= childCost*0.5; stats.sexBirths++; }
      else body.energy -= childCost;
      madeAny = true;
      const k = (body.foot.length>1) ? acct.multi : acct.uni; k.kids++;
    }
    if (madeAny) { body.cooldown = g.cycleHours; if (mate) mate.cooldown = mate.g.cycleHours; }
  }
  hours++;
}

function reset(colonies=24) {
  state.fill(0); owner.fill(0); cellGuild.fill(G_NONE); corpseFood.fill(0); sporeDensity.fill(0);
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
    if (state[idx(x,y)]===0 && tryPlaceBody(founderGenome(), nextLineageId++, x, y, 9+Math.random()*4)) placed++;
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
  let sexN=0, sexSum=0, lifeSex=0, lifeAsex=0, nSex=0, nAsex=0;
  for (const b of bodies.values()) {
    sexSum += b.g.sexual;
    if (b.g.sexual >= 0.5) { sexN++; lifeSex += b.g.lifespan; nSex++; }
    else { lifeAsex += b.g.lifespan; nAsex++; }
  }
  let doneCnt=0; for (const b of bodies.values()) if (b.cells.length>=b.foot.length) doneCnt++;
  return { hours, org: bodies.size, cells, corpses, sexN, sexAvg: bodies.size? +(sexSum/bodies.size).toFixed(3):0,
           lifeSex: nSex? Math.round(lifeSex/nSex):0, lifeAsex: nAsex? Math.round(lifeAsex/nAsex):0, ...gc, multi, diff, maxSize, done: doneCnt,
           effic: bodies.size? (effSum/bodies.size).toFixed(2):'-', shapes };
}

module.exports = { compatible, get mv(){ return mv; }, reset, step, snapshot, get stats(){ return stats; }, params, bodies, templateOf, tryPlaceBody, founderGenome,
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
