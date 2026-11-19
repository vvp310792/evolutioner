'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const browserModel=require('../tools/browser-model');
test('модель из index.html воспроизводится и продолжает жить при смене помощи',()=>{
  function run(){const m=browserModel();m.reset(12,19);for(let i=0;i<70;i++)m.step();return m;}
  const a=run(),b=run();assert.deepEqual(a.snapshot(),b.snapshot());
  const ids=[...a.bodies.keys()];a.params.packageStrength=1;a.startAssistanceRamp(4);
  assert.deepEqual([...a.bodies.keys()],ids);
  for(let i=0;i<5;i++)a.step();assert.equal(a.params.packageStrength,0);
});
test('в index.html один организм одновременно получает свет и живую органику',()=>{
  const m=browserModel();Object.assign(m.params,{light:1,parasites:0,packageStrength:0});m.reset(0,31);
  const g=m.api.founderGenome();Object.assign(g,{photo:0.8,herb:0.6,sapro:0.3,aggression:0.2,moveSpeed:0});
  const b=m.api.tryPlaceBody(g,1,20,40,50);
  m.api.tryPlaceBody({...g,herb:0,sapro:0,aggression:0},2,21,40,50);
  m.step();assert(b.intake.photo>0);assert(b.intake.herb>0);
});
test('index.html списывает содержание каждой способности даже без подходящей пищи',()=>{
  function energy(herb,sapro){
    const m=browserModel();Object.assign(m.params,{light:0,parasites:0,packageStrength:0});m.reset(0,32);
    const g=m.api.founderGenome();Object.assign(g,{photo:0,herb,sapro,aggression:0,moveSpeed:0,cycleHours:1000});
    const b=m.api.tryPlaceBody(g,1,20,40,50);m.step();return b.energy;
  }
  assert(Math.abs(energy(0,0)-energy(0.5,0.5)-0.1)<1e-9);
});

test('ползунки задают гены основателей, а потомки наследуют аллели',()=>{
  const m=browserModel(19,{native:true});
  Object.assign(m.params,{mutation:0,decomp:0.2,parasites:0});
  m.reset(2,19);
  const [parent,mate]=m.bodies.values();
  assert.equal(parent.g.mutRate,0);
  assert.equal(parent.g.decomp,0.2);
  Object.assign(m.params,{mutation:1,decomp:0.8});
  assert.equal(m.api.rateAverages().decomp,0.2);
  assert.equal(m.api.founderDiploid().g.decomp,0.8);
  assert.equal(m.api.founderDiploid().g.mutRate,1);
  parent.al.A.mods=[{id:100,t:['decomp'],w:[0.5]}];
  for(let i=0;i<32;i++){
    const child=m.api.childGenome(parent,null,false);
    assert.deepEqual(child.al,parent.al);
    assert.notEqual(child.al.A.program,parent.al.A.program);
    assert.notEqual(child.al.A.mods[0],parent.al.A.mods[0]);
  }
  mate.al.A.decomp=mate.al.B.decomp=0.6;
  mate.al.A.tolerance=mate.al.B.tolerance=0.8;
  const child=m.api.childGenome(parent,mate,false);
  assert.equal(child.al.A.decomp,0.2);
  assert.equal(child.al.B.decomp,0.6);
  assert.equal(child.g.tolerance,0.4);
  Object.assign(parent.g,{mutRate:1});
  m.params.mutation=0;
  assert.notEqual(m.api.childGenome(parent,null,false).al.A.metab,parent.al.A.metab);
});

test('после смены ползунка разложения сток падали определяется организмом',()=>{
  function consume(decomp,slider){
    const m=browserModel(19,{native:true});
    Object.assign(m.params,{light:0,parasites:0,decomp});
    m.reset(1,19);
    const [b]=m.bodies.values(), i=b.cells[0];
    Object.assign(b.g,{sapro:0.8,cycleHours:1000,herb:0,aggression:0});
    const corpse=i%46<45?i+1:i-1;
    m.api.state[corpse]=2;m.api.corpseFood[corpse]=15;
    m.params.decomp=slider;
    m.step();
    return m.api.corpseFood[corpse];
  }
  assert.equal(consume(0.5,0),consume(0.5,1));
  assert(consume(0.5,0)<consume(0,1));
});

test('ноль прекращает появление внешних штаммов, а толерантность уменьшает текущий ущерб',()=>{
  function infected(tolerance,parasites){
    const m=browserModel(19,{native:true});
    Object.assign(m.params,{light:0,parasites});
    m.reset(1,19);
    const [b]=m.bodies.values();
    b.g.tolerance=tolerance;
    b.par={key:0.2,vir:1.2,inf:0.72,load:0.5};
    m.step();
    assert.equal(b.par.load,0.53);
    assert.equal(m.api.rateAverages().infectivity,0.72);
    return b.energy;
  }
  assert.equal(infected(0,0),infected(0,3));
  assert(Math.abs(infected(0.75,0)-infected(0,0)-0.53*1.2*0.15*0.75)<1e-10);
  const m=browserModel(19,{native:true});
  m.params.parasites=0;
  m.reset(24,19);
  for(let i=0;i<300;i++)m.step();
  assert(m.bodies.size>24);
  assert.equal(m.api.rateAverages().virulence,null);
});

test('дочерний штамм наследует вред и заразность по отдельности',()=>{
  const m=browserModel(10,{native:true});
  m.params.parasites=0;
  m.reset(1,10);
  const [source]=m.bodies.values();
  const i=source.cells[0], x=i%46, y=Math.floor(i/46);
  const host=m.api.tryPlaceBody(m.api.founderGenome(),500,x+(x===45?-1:1),y,20);
  for(const b of [source,host]){
    Object.assign(b.g,{immuneKey:0.4,immunity:0,herb:0,aggression:0,sapro:0});
    b.cooldown=1000;
  }
  source.par={key:0.4,vir:0,inf:1,load:1};
  for(let i=0;i<100&&!host.par;i++)m.step();
  assert(host.par);
  assert(host.par.vir>=0 && host.par.vir<=0.06);
  assert(host.par.inf>=0.96 && host.par.inf<=1);
});
