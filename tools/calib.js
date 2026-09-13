// Калибровочный прогон: все ручки интерфейса задаются окружением, строка CSV на выходе.
// Ровно те параметры, которые пользователь может выставить сам, — потому что результат
// калибровки должен превращаться в пресет, а пресет умеет трогать только интерфейс.
const S = require("./sim.js");
const num = (k, d) => process.env[k] !== undefined ? +process.env[k] : d;
const flag = (k, d) => process.env[k] !== undefined ? process.env[k] === "1" : d;

const sd = num("SD", 1), HOURS = num("HOURS", 12000);
S.params.mutation  = num("MUT", 0.12);
S.params.decomp    = num("DECOMP", 0.30);
S.params.parasites = num("PAR", 1.0);
S.params.dayNight  = flag("DAYNIGHT", true);
S.params.predation = flag("PRED", true);
S.params.sexReprod = flag("SEX", true);
const LIGHT = num("LIGHT", 0.62);
S.reset(24, sd);
S.setLight(LIGHT);

let ext = 0, popSum = 0, popN = 0, popMin = 1e9;
for (let h = 1; h <= HOURS; h++) {
  S.step();
  if (h % 500 === 0) { const n = S.bodies.size; popSum += n; popN++; if (n < popMin) popMin = n; }
  if (S.bodies.size === 0) { ext = h; break; }
}
const s = S.snapshot(), t = S.stats;
const all = [...S.bodies.values()];
// ── ВИДОВАЯ СТРУКТУРА. Компоненты графа скрещиваний по тому же правилу, каким
// модель выбирает партнёра. Считается на ПОДВЫБОРКЕ до 300 тел: полный граф это
// O(n²) на двух тысячах тел в каждом из тысячи прогонов, а ранг точки по числу
// компонент от подвыборки не меняется. Компонента — не вид (совместимость
// нетранзитивна, см. CLAUDE.md), это «род»: группа, внутри которой гены ещё текут.
function components(list) {
  const p = list.map((_, i) => i), find = x => { while (p[x] !== x) x = p[x] = p[p[x]]; return x; };
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
    if (S.compatible(list[i], list[j])) { const a = find(i), b = find(j); if (a !== b) p[a] = b; }
  const cnt = new Map();
  for (let i = 0; i < list.length; i++) { const r = find(i); cnt.set(r, (cnt.get(r) || 0) + 1); }
  return [...cnt.values()];
}
// Граф строится по ВСЕМ телам. Подвыборка (была 300) давала артефакт, а не меру:
// связная группа рвётся просто от недобора, и число «родов» росло с численностью
// мира ровно там, где падала доля выборки — 2 рода при 150 телах и 4 при 2400,
// при доле выборки 1.00 и 0.10. Прямая сверка на одном мире из 2838 тел: полный
// граф 7 компонент (5 крупных), подвыборка 300 — 8 компонент (4 крупных).
// Цена полного графа оказалась пустяковой: 720 мс против 100-250 с самого прогона.
const SUB = 6000;   // страховка от O(n²) на невозможно большом мире, не рабочий режим
let sub = all;
if (all.length > SUB) { sub = all.slice(); for (let i = sub.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const q = sub[i]; sub[i] = sub[j]; sub[j] = q; } sub = sub.slice(0, SUB); }
const comps = all.length ? components(sub) : [];
const compBig = comps.filter(c => c >= 5).length;
// плейотропия и самая частая мишень свободных генов — чем занят возникший геном
let pleioSum = 0, pleioN = 0; const tgt = {};
for (const b of all) for (const set of [b.al.A.mods, b.al.B.mods]) if (set) for (const q of set) {
  pleioSum += q.t.length; pleioN++; for (const k of q.t) tgt[k] = (tgt[k] || 0) + 1; }
const topTgt = Object.entries(tgt).sort((a, b) => b[1] - a[1])[0];
const plants = all.filter(b => b.guild === "photo" || b.guild === "sapro");
const diff = all.filter(b => b.cells.length >= 9).length;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
console.log([
  LIGHT, S.params.mutation, S.params.decomp, S.params.parasites,
  S.params.dayNight ? 1 : 0, S.params.predation ? 1 : 0, S.params.sexReprod ? 1 : 0,
  sd, ext, s.org, s.photo, s.herb, s.pred, s.sapro,
  s.maxSize, diff, s.multi,
  s.virAvg, s.org ? (s.infected / s.org).toFixed(3) : 0, s.immAvg, s.keySd,
  s.mycoAvg, s.mycoShare, s.dormAvg,
  s.org ? (s.sexN / s.org).toFixed(3) : 0, plants.length ? (plants.filter(b => b.sex).length / plants.length).toFixed(3) : 0,
  s.seedN, s.sporeN, s.eggN, s.gametes,
  mean(all.map(b => b.g.lifespan)).toFixed(0), mean(all.map(b => b.g.metab)).toFixed(3),
  mean(all.map(b => b.g.armor)).toFixed(3), mean(all.map(b => b.g.effic)).toFixed(3),
  popN ? Math.round(popSum / popN) : 0, popMin === 1e9 ? 0 : popMin,
  t.moves, t.eaten, t.born,
  s.modAvg, s.modMax, s.modShare, s.modSex, s.modAsex,
  pleioN ? (pleioSum / pleioN).toFixed(2) : 0, topTgt ? topTgt[0] : "-",
  comps.length, compBig, comps.length ? Math.max(...comps) : 0,
].join(","));
