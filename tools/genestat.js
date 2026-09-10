const fs = require('fs');
const S = require('./sim.js');
S.reset(24);
const KEYS = ['photo','herb','aggression','sapro','armor','lifespan','cycleHours','shapeA','sexual','metab'];
const out = [];
function snap(h){
  const acc = {}; for(const k of KEYS) acc[k]=[];
  let maxB=0;
  for(const b of S.bodies.values()){
    for(const k of KEYS) acc[k].push(b.g[k]);
    if(b.cells.length>maxB) maxB=b.cells.length;
  }
  const m={}, sd={};
  for(const k of KEYS){ const a=acc[k];
    if(!a.length){ m[k]='-'; sd[k]='-'; continue; }
    const mm=a.reduce((x,y)=>x+y,0)/a.length;
    m[k]=+mm.toFixed(2);
    sd[k]=+Math.sqrt(a.reduce((x,y)=>x+(y-mm)*(y-mm),0)/a.length).toFixed(3);
  }
  out.push(`час ${h}\tтел ${S.bodies.size}\tкрупнейшее ${maxB}`);
  out.push('  среднее: ' + KEYS.map(k=>`${k.slice(0,5)}=${m[k]}`).join('  '));
  out.push('  разброс: ' + KEYS.map(k=>`${k.slice(0,5)}=${sd[k]}`).join('  '));
  fs.writeFileSync('eqm.txt', out.join('\n'));
}
const marks=[2000,8000,20000,40000];
for(let h=1;h<=40000;h++){
  S.step();
  if(S.bodies.size===0){ out.push('ВЫМЕРЛО '+h); fs.writeFileSync('eqm.txt', out.join('\n')); break; }
  if(marks.includes(h)) snap(h);
}
