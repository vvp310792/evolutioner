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
