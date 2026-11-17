'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../src/open-evolution');
const sim=require('../tools/sim');
function random(seed) { return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;}; }
function withRandom(seed,run){const old=Math.random;Math.random=random(seed);try{return run();}finally{Math.random=old;}}
function world(g, victimGenes, dead=false) {
  const body={id:1,g,cells:[0],energy:10,guild:'photo'};
  const victim={id:2,g:victimGenes,cells:[1],energy:10,guild:'pred'};
  const state=new Uint8Array([1,dead?2:1]),owner=new Int32Array([1,2]);
  const corpseFood=new Float32Array([0,10]),bodies=new Map([[1,body],[2,victim]]);
  return {body,victim,w:{state,owner,corpseFood,bodies,params:{predation:true,decomp:0.3},border:[0],
    neighbors:{cnt:[1,1],tab:[1,0],k:1},sense:[],cols:2,rows:1,interior:0,pace:1,
    income:10,upkeep:0,moveCost:0.1,move:()=>false,kill:b=>{bodies.delete(b.id);state[1]=2;}}};
}
const genes={photo:0.9,herb:0.7,aggression:0.2,sapro:0.5,myco:0.3,effic:0.8,armor:0.1,moveSpeed:0.5};
test('правила создают связное ветвящееся тело, ограничивая исполнение',()=>{
  const plan=E.develop({shapeA:30,program:[{id:1,turn:0,run:3,branch:3},{id:2,turn:1,run:2,branch:3}]});
  assert(plan.length>4 && plan.length<=E.MAX_CELLS);
  const seen=new Set([plan[0].join(',')]);
  for(const [x,y] of plan.slice(1)){
    assert([[x+1,y],[x-1,y],[x,y+1],[x,y-1]].some(p=>seen.has(p.join(','))));
    assert(!seen.has([x,y].join(',')));seen.add([x,y].join(','));
  }
});
test('дупликации и удаления изменяют длину, не меняя геном родителя',()=>withRandom(7,()=>{
  E.reset();const parent=E.founderProgram(),saved=JSON.stringify(parent);let p=parent,min=1,max=1,deleted=false;
  for(let i=0;i<300;i++){const q=E.mutateProgram(p,1);if(q.length<p.length)deleted=true;p=q;min=Math.min(min,p.length);max=Math.max(max,p.length);}
  assert(max>1);assert(deleted);assert.equal(JSON.stringify(parent),saved);
}));
test('гамета наследует гомологичные локусы и не делит изменяемые объекты с родителем',()=>withRandom(8,()=>{
  const a=[{id:0,turn:0,run:1,branch:0}],b=[{id:0,turn:2,run:2,branch:0}];
  const h=E.programGamete(a,b);assert.equal(h.length,1);h[0].run=4;assert.equal(a[0].run,1);assert.equal(b[0].run,2);
  assert.equal(E.expressProgram(a,b)[0].run,2);
}));
test('нулевая помощь не меняет гены и не вызывает пакет; промежуточная масштабируется',()=>{
  const run=g=>{g.speed=10;g.count=4;g.__endow=20;return g;};
  const g={speed:2,count:1};E.assistance(g,0,['speed','count'],['count'],()=>{throw Error('пакет вызван');});
  assert.deepEqual(g,{speed:2,count:1,__endow:0});
  E.assistance(g,0.5,['speed','count'],['count'],run);assert.equal(g.speed,6);assert.equal(g.count,3);assert.equal(g.__endow,10);
});
test('подчинённая пищевая способность работает при любом ярлыке организма',()=>{
  for(const label of ['photo','herb','pred','sapro']){
    const {body,victim,w}=world(genes,{photo:1,herb:0,aggression:0,sapro:0,armor:0});
    body.guild=label;victim.guild=label;withRandom(1,()=>E.feed(body,w));
    assert(body.energy>10);assert(victim.energy<10);assert(body.intake.herb>0);
    assert(body.energy-10<=10-victim.energy+1e-9);
  }
});
test('падаль доступна фотосинтезирующему организму; передача энергии с потерями',()=>{
  const {body,w}=world(genes,genes,true);const before=w.corpseFood[1];withRandom(2,()=>E.feed(body,w));
  assert(body.intake.sapro>0);assert(body.energy-10<=before-w.corpseFood[1]+1e-6);
});
test('отключение хищничества исключает животную пищу при сохранении растительной',()=>{
  assert.equal(E.capability({...genes,herb:0,myco:0},{photo:0,sapro:0,herb:1,aggression:0},false).value,0);
  assert(E.capability(genes,{photo:1,sapro:0,herb:0,aggression:0},false).value>0);
});
test('совместимость не использует пищевой ярлык в открытом режиме',()=>{
  sim.params.openDiet=true;
  assert(sim.compatible({guild:'photo',g:genes},{guild:'pred',g:genes}));
  sim.params.openDiet=false;assert(!sim.compatible({guild:'photo',g:genes},{guild:'pred',g:genes}));sim.params.openDiet=true;
});
test('в замкнутом тёмном мире сумма энергии тел и падали не возрастает',()=>{
  sim.params.openDiet=true;sim.params.programBodies=true;sim.params.packageStrength=0;sim.params.light=0;sim.params.parasites=0;
  sim.reset(12,123);
  const total=()=>[...sim.bodies.values()].reduce((n,b)=>n+Math.max(0,b.energy)+(b.structuralEnergy||0),0)+[...sim.corpseFood].reduce((a,b)=>a+b,0)+sim.seeds.reduce((n,s)=>n+s.energy,0);
  let previous=total();
  for(let h=0;h<80;h++){sim.step();const now=total();assert(now<=previous+0.0001,`${h}: ${previous} -> ${now}`);previous=now;}
});
test('потомок наследует программу отдельно от соматического тела',()=>{
  sim.params.light=0.8;sim.params.mutation=0;sim.params.packageStrength=0;sim.reset(2,21);
  const b=[...sim.bodies.values()][0],saved=JSON.stringify(b.al);
  const child=sim.childGenome(b,null,false);
  assert.deepEqual(child.g.program,b.g.program);child.al.A.program[0].run=4;
  assert.equal(JSON.stringify(b.al),saved);assert.equal(child.g.__endow,0);
});
test('соединение при встрече с клеткой меняет последующий рост и её специализацию',()=>{
  const rules=[{id:0,turn:0,run:2,branch:0,role:0},
    {id:1,turn:2,run:2,branch:0,role:2},{id:2,turn:0,run:2,branch:0,role:3}];
  const stopped=E.develop({shapeA:3,program:rules});
  const joined=E.develop({shapeA:3,program:rules.map(r=>({...r,join:true}))});
  assert.equal(stopped.length,3);assert.equal(joined.length,5);
  const body={tpl:joined,ox:2,oy:3};
  const cell=2+3*20+joined[0][0]+joined[0][1]*20;
  assert.equal(E.roleAt(body,cell,20),2);
  assert(E.cellEffects(body,cell,20).feed>1);assert(E.cellEffects(body,cell,20).synth<1);
  assert(E.cellEffects(body,cell,20).cost>0);
});
test('снижение помощи сохраняет мир и достигает нуля без отрицательных значений',()=>{
  assert.equal(E.assistanceAt(1,500,1000),0.5);assert.equal(E.assistanceAt(1,2000,1000),0);
  sim.params.light=0;sim.params.packageStrength=1;sim.reset(2,17);
  const body=[...sim.bodies.values()][0];sim.startAssistanceRamp(4);
  assert.equal([...sim.bodies.values()][0],body);
  for(let h=0;h<5;h++)sim.step();
  assert.equal(sim.params.packageStrength,0);assert.equal(sim.params.assistanceRamp,null);
});
test('энергия сохраняется с потерями при росте, размножении и поедании в темноте',()=>{
  sim.params.light=0;sim.params.parasites=0;sim.params.mutation=0;sim.params.packageStrength=0;sim.reset(0,21);
  const g=sim.founderGenome();Object.assign(g,{minN:0,maxN:8,shapeA:4,cycleHours:1,sexual:0,metab:0.15,photo:0,herb:0.5,sapro:0.5,aggression:0.5});
  g.program=[{id:0,turn:0,run:1,branch:1,role:2,join:true}];
  const parent=sim.tryPlaceBody(g,1,20,40,1000);assert(parent);
  const energy=()=>[...sim.bodies.values()].reduce((n,b)=>n+Math.max(0,b.energy)+(b.structuralEnergy||0),0)+[...sim.corpseFood].reduce((a,b)=>a+b,0)+sim.seeds.reduce((n,s)=>n+s.energy,0);
  let previous=energy();
  for(let h=0;h<70;h++){sim.step();const next=energy();assert(next<=previous+0.001,`${h}: ${previous} -> ${next}`);previous=next;}
  assert(sim.stats.grow>0);assert(sim.stats.born>1);
});
