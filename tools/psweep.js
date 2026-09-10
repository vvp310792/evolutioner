const S=require('./sim.js');
const V=process.env.PVIR, C=process.env.ICOST;
S.reset(24);
let ext=0;
for(let h=1;h<=12000;h++){ S.step(); if(S.bodies.size===0){ ext=h; break; } }
const s=S.snapshot(), st=S.stats;
let L=[]; for(const b of S.bodies.values()) L.push(b.g.immunity);
const m=L.length?L.reduce((a,b)=>a+b,0)/L.length:0;
const sd=L.length?Math.sqrt(L.reduce((a,b)=>a+(b-m)*(b-m),0)/L.length):0;
console.log(`вирул=${V} ценаИмм=${C} | ${ext?'ВЫМЕРЛО '+ext:'жив'} | тел ${s.org} заражено ${s.org?Math.round(s.infected/s.org*100):0}% | иммун ${m.toFixed(3)}±${sd.toFixed(3)} | разбросЗамка ${s.keySd} | половых ${s.org?Math.round(s.sexN/s.org*100):0}% | max ${s.maxSize} | photo ${s.photo} herb ${s.herb} pred ${s.pred} sapro ${s.sapro}`);
