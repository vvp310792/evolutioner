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
].join(","));
