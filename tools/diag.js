const S = require('./sim.js');
S.params.mutation = 0.0;                 // мутации выкл: чистая конкуренция двух готовых стратегий
S.reset(0);
let uni=0, big=0;
for (let k=0; k<400 && (uni<40 || big<40); k++) {
  const x = Math.floor(Math.random()*46), y = Math.floor(Math.random()*92);
  const g = S.founderGenome();
  const wantBig = big < 40 && (uni >= 40 || Math.random() < 0.5);
  if (wantBig) { g.shapeType = 0; g.shapeA = 4; g.shapeB = 4; if (process.env.KSTRAT) g.lifespan = 2200 + Math.random()*2000; }
  const b = S.tryPlaceBody(g, wantBig?2:1, x, y, wantBig ? 40 : 10);
  if (b) { if (wantBig) big++; else uni++; }
}
console.log(`подсажено: одноклеточных=${uni}, тел 4x4=${big}`);
console.log('час\tодноклет\tмногоклет\tклеток(много)\tдифф');
for (let h=1; h<=8000; h++) {
  S.step();
  if (h===50||h===200||h===500||h===1000||h===2000||h===4000||h===8000) {
    let u=0, m=0, mc=0, d=0;
    for (const b of S.bodies.values()) {
      if (b.foot.length>1) { m++; mc+=b.cells.length; if (b.cells.length>=9) d++; }
      else u++;
    }
    const A=S.acct;
    const fmt = o => o.h ? `доход/кл ${(o.inc/o.cells).toFixed(3)} апкип/кл ${(o.upk/o.cells).toFixed(3)} сальдо/кл ${((o.inc-o.upk)/o.cells).toFixed(3)} потомков/1000ч ${(o.kids/o.h*1000).toFixed(1)}` : 'нет данных';
    console.log(`${h}\t${u}\t\t${m}\t\t${mc}\t\t${d}`);
    console.log(`      одноклет: ${fmt(A.uni)}`);
    console.log(`      многоклет: ${fmt(A.multi)}`);
    S.acctReset();
    if (u+m===0) { console.log('всё вымерло'); break; }
  }
}
