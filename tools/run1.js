// Один прогон -> одна строка CSV. Всё задаётся окружением, чтобы farm мог
// гонять матрицу без правки файла: SD (seed), HOURS, LIGHT + флаги ядра.
const S = require("./sim.js");
const sd = +(process.env.SD || 1), HOURS = +(process.env.HOURS || 12000);
if (process.env.LIGHT) S.params.light = +process.env.LIGHT;
S.reset(24, sd);
let ext = 0;
const t0 = Date.now();
for (let h = 1; h <= HOURS; h++) { S.step(); if (S.bodies.size === 0) { ext = h; break; } }
const s = S.snapshot(), st = S.stats;
const all = [...S.bodies.values()];
const plants = all.filter(b => b.guild === "photo" || b.guild === "sapro");
const pdio = plants.filter(b => b.sex).length;
const f = [
  process.env.LABEL || "-", sd, S.params.light, process.env.PDMG || "0.15",
  process.env.DORM === "0" ? 0 : 1, ext, s.org, s.photo, s.herb, s.pred, s.sapro,
  s.virAvg, s.virSd, s.org ? (s.infected / s.org).toFixed(3) : 0, s.immAvg, s.keySd,
  s.dormAvg, s.mycoAvg, s.mycoShare, s.maxSize, plants.length ? (pdio / plants.length).toFixed(3) : 0,
  s.org ? (s.sexN / s.org).toFixed(3) : 0, s.seedN, s.sporeN, s.eggN,
  ((Date.now() - t0) / 1000).toFixed(0),
];
console.log(f.join(","));
