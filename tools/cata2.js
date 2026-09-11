// Та же катастрофа, но мера чувствительнее вымирания: по КАЖДОМУ затемнению
// пишем глубину провала и время восстановления. Вымирание — событие редкое и
// бинарное, на двадцати прогонах оно почти ничего не различает; а событий
// затемнения в одном прогоне шесть, и каждое даёт число.
const S = require("./sim.js");
const sd = +(process.env.SD || 1), HOURS = +(process.env.HOURS || 20000);
const PERIOD = +(process.env.PERIOD || 3000), DUR = +(process.env.DUR || 600);
const LIGHT = +(process.env.LIGHT || 0.62), DARK = +(process.env.DARK || 0.03);
S.reset(24, sd); S.setLight(LIGHT);
let ext = 0, dark = false, before = 0, low = 1e9, waiting = false, t0 = 0;
const depth = [], recov = [], failed = [];
for (let h = 1; h <= HOURS; h++) {
  const ph = h % PERIOD;
  if (!dark && ph === 0) { before = S.bodies.size; low = before; S.setLight(DARK); dark = true; }
  else if (dark && ph === DUR) { S.setLight(LIGHT); dark = false; waiting = true; t0 = h; }
  S.step();
  const n = S.bodies.size;
  if (dark && n < low) low = n;
  if (waiting) {
    if (n < low) low = n;
    if (n >= before * 0.5) { depth.push(low / (before || 1)); recov.push(h - t0); waiting = false; }
    else if (h - t0 > PERIOD - DUR - 1) { depth.push(low / (before || 1)); failed.push(1); waiting = false; }
  }
  if (n === 0) { ext = h; break; }
}
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : -1;
const s = S.snapshot();
console.log([
  process.env.LABEL || "-", sd, process.env.DORM === "0" ? 0 : 1, ext, s.org,
  depth.length, avg(depth).toFixed(3), recov.length, avg(recov).toFixed(0),
  failed.length, s.dormAvg, s.seedN, s.eggN,
].join(","));
