// Прогон с РЕЗКОЙ катастрофой: каждые PERIOD часов свет гаснет на DUR часов.
// Смысл опыта: покой по теории окупается при внезапном ударе, а не при
// медленном удушении. Гаснущий свет бьёт по активным телам (фотосинтез
// останавливается, цепь голодает), но не по спящим зачаткам — их расход от
// света не зависит вовсе. Если гипотеза верна, здесь покой должен выигрывать.
const S = require("./sim.js");
const sd = +(process.env.SD || 1), HOURS = +(process.env.HOURS || 20000);
const PERIOD = +(process.env.PERIOD || 3000), DUR = +(process.env.DUR || 300);
const LIGHT = +(process.env.LIGHT || 0.62), DARK = +(process.env.DARK || 0.03);
S.reset(24, sd);
S.setLight(LIGHT);
let ext = 0, dark = false, hits = 0;
for (let h = 1; h <= HOURS; h++) {
  const phase = h % PERIOD;
  if (!dark && phase === 0) { S.setLight(DARK); dark = true; hits++; }
  else if (dark && phase === DUR) { S.setLight(LIGHT); dark = false; }
  S.step();
  if (S.bodies.size === 0) { ext = h; break; }
}
const s = S.snapshot();
const all = [...S.bodies.values()];
const plants = all.filter(b => b.guild === "photo" || b.guild === "sapro");
console.log([
  process.env.LABEL || "-", sd, LIGHT, process.env.PDMG || "0.15",
  process.env.DORM === "0" ? 0 : 1, ext, s.org, s.photo, s.herb, s.pred, s.sapro,
  s.virAvg, s.virSd, s.org ? (s.infected/s.org).toFixed(3) : 0, s.immAvg, s.keySd,
  s.dormAvg, plants.length ? (plants.filter(b=>b.sex).length/plants.length).toFixed(3) : 0,
  s.org ? (s.sexN/s.org).toFixed(3) : 0, s.seedN, s.sporeN, s.eggN, hits,
].join(","));
