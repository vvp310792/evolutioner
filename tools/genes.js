// Свободные гены: что отбор оставил из случайных. Один прогон — одна JSON-строка:
// параметры, seed, итог мира и по свободным генам — среднее на тело, у скольких есть,
// у половых против клональных, по нишам, и главное — какие признаки они трогают и с
// каким знаком. Совпадение мишеней и знаков между НЕЗАВИСИМЫМИ мирами — отбор;
// разное в каждом мире — попутчики удачной линии (hitchhiking). Разделить их
// можно только по нескольким seed'ам, поэтому один прогон ничего не доказывает.
const S = require('./sim.js');
const num=(k,d)=>process.env[k]!==undefined?+process.env[k]:d, flag=(k,d)=>process.env[k]!==undefined?process.env[k]==='1':d;
S.params.mutation=num('MUT',0.12); S.params.decomp=num('DECOMP',0.30); S.params.parasites=num('PAR',1.0);
S.params.dayNight=flag('DAYNIGHT',true); S.params.predation=flag('PRED',true); S.params.sexReprod=flag('SEX',true);
const sd=num('SD',1), H=num('HOURS',12000), LIGHT=num('LIGHT',0.62);
S.reset(24,sd); S.setLight(LIGHT);
let ext=0; const trail=[];
for(let h=1;h<=H;h++){ S.step(); if(h%2000===0){ const s=S.snapshot(); trail.push([h,s.org,s.modAvg,s.modShare]); } if(S.bodies.size===0){ ext=h; break; } }
const s=S.snapshot(), all=[...S.bodies.values()];
const byGuild={}; for(const b of all){ const q=byGuild[b.guild]||(byGuild[b.guild]={n:0,mods:0}); q.n++; q.mods+=b.nMods||0; }
for(const k in byGuild) byGuild[k]=+(byGuild[k].mods/byGuild[k].n).toFixed(2);
// плейотропия: сколько признаков трогает средний ген
let pl=0, pn=0; for(const b of all) for(const set of [b.al.A.mods,b.al.B.mods]) if(set) for(const q of set){ pl+=q.t.length; pn++; }
console.log(JSON.stringify({ mods:process.env.MODS!=='0', light:LIGHT, mut:S.params.mutation, decomp:S.params.decomp, par:S.params.parasites,
  dn:S.params.dayNight?1:0, pred:S.params.predation?1:0, sex:S.params.sexReprod?1:0, seed:sd, extinct:ext,
  org:s.org, photo:s.photo, herb:s.herb, pred_n:s.pred, sapro:s.sapro, maxSize:s.maxSize, sexShare:s.org?+(s.sexN/s.org).toFixed(3):0,
  modAvg:s.modAvg, modMax:s.modMax, modShare:s.modShare, modSex:s.modSex, modAsex:s.modAsex, pleio:pn?+(pl/pn).toFixed(2):0,
  byGuild, tgt:s.modTgt, sign:s.modSign, trail }));
