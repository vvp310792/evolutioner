// Есть ли в мире дискретные виды? Считаем по правилу, которое сама модель
// использует для скрещивания: та же ниша + расхождение по четырём пищевым генам
// не больше SPECIES_GAP. Компонента связности такого графа — это «род/кольцо»,
// а не вид: совместимость НЕ транзитивна (A~B, B~C, но A≁C), поэтому отдельно
// считаем, какая доля пар внутри компоненты реально скрещивается.
const S = require('./sim.js');
const num=(k,d)=>process.env[k]!==undefined?+process.env[k]:d, flag=(k,d)=>process.env[k]!==undefined?process.env[k]==='1':d;
S.params.mutation=num('MUT',0.12); S.params.decomp=num('DECOMP',0.30); S.params.parasites=num('PAR',1.0);
S.params.dayNight=flag('DAYNIGHT',true); S.params.predation=flag('PRED',true); S.params.sexReprod=flag('SEX',true);
S.reset(24,num('SD',1)); S.setLight(num('LIGHT',0.62));
const H=num('HOURS',12000);
for(let h=1;h<=H;h++){ S.step(); if(S.bodies.size===0){ console.log(JSON.stringify({sd:num('SD',1),extinct:h})); process.exit(0);} }
const all=[...S.bodies.values()];
// union-find по совместимости
const id=new Map(); all.forEach((b,i)=>id.set(b.id,i));
const p=all.map((_,i)=>i); const find=x=>{while(p[x]!==x)x=p[x]=p[p[x]];return x;};
let edges=0, pairs=0;
for(let i=0;i<all.length;i++) for(let j=i+1;j<all.length;j++){
  pairs++;
  if(S.compatible(all[i],all[j])){ edges++; const a=find(i),b=find(j); if(a!==b)p[a]=b; }
}
const comp=new Map();
for(let i=0;i<all.length;i++){ const r=find(i); if(!comp.has(r))comp.set(r,[]); comp.get(r).push(i); }
const sizes=[...comp.values()].map(v=>v.length).sort((a,b)=>b-a);
// плотность внутри крупнейших компонент: доля реально совместимых пар
const dens=[...comp.values()].filter(v=>v.length>=10).slice(0,5).map(v=>{
  let e=0,n=0; for(let a=0;a<v.length;a++) for(let b=a+1;b<v.length;b++){ n++; if(S.compatible(all[v[a]],all[v[b]]))e++; }
  return {n:v.length, плотность:+(e/n).toFixed(3), ниша:all[v[0]].guild};
});
const byGuild={}; for(const b of all) byGuild[b.guild]=(byGuild[b.guild]||0)+1;
console.log(JSON.stringify({sd:num('SD',1), тел:all.length, ниши:byGuild,
  компонент:sizes.length, размеры:sizes.slice(0,8), одиночек:sizes.filter(s=>s===1).length,
  доля_совместимых_пар:+(edges/pairs).toFixed(4), плотность_крупных:dens}));
