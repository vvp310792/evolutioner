const S = require('./sim.js');
S.reset(0);
let sx=0, as=0;
for (let k=0; k<600 && (sx<30 || as<30); k++){
  const x=Math.floor(Math.random()*46), y=Math.floor(Math.random()*92);
  const g=S.founderGenome();
  const wantSex = sx<30 && (as>=30 || Math.random()<0.5);
  g.sexual = wantSex ? 0.9 : 0.0;
  const b=S.tryPlaceBody(g, wantSex?2:1, x, y, 10);
  if (b){ if(wantSex) sx++; else as++; }
}
console.log(`подсажено: половых=${sx}, клональных=${as}`);
console.log('час\tполовых\tклональных\tср.ген sexual');
for (let h=1; h<=30000; h++){
  S.step();
  if (h===200||h===1000||h===3000||h===8000||h===15000||h===30000){
    let a=0,b=0,sum=0;
    for (const o of S.bodies.values()){ sum+=o.g.sexual; if(o.g.sexual>=0.5) a++; else b++; }
    console.log(`${h}\t${a}\t\t${b}\t\t${(sum/Math.max(1,S.bodies.size)).toFixed(3)}`);
    if (a+b===0){ console.log('всё вымерло'); break; }
  }
}
