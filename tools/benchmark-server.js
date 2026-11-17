'use strict';
const fs=require('node:fs');
const browserModel=require('./browser-model');
const {decode}=require('../server/checkpoint');
const saved=decode(fs.readFileSync(process.argv[2])).model;
const steps=Number(process.argv[3]||100);
const result=[];
const digest=require('../server/state-digest');
for(const native of [false,true]){
  const model=browserModel(1,{native});model.restore(saved);
  const start=performance.now();for(let i=0;i<steps;i++)model.step();
  const elapsed=(performance.now()-start)/1000;
  result.push({native,seconds:elapsed,hoursPerSecond:steps/elapsed,hash:digest(model.save()),snapshot:model.snapshot()});
}
if(result[0].hash!==result[1].hash)throw Error('Расхождение режимов исполнения');
console.log(JSON.stringify({parity:true,result}));
