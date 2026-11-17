'use strict';
const {parentPort,workerData}=require('node:worker_threads');
const {performance}=require('node:perf_hooks');
const fs=require('node:fs');
const path=require('node:path');
const {createModel}=require('./model');
const {readCheckpoint,writeAtomic}=require('./checkpoint');

const {file,modelHash}=workerData;
const world=createModel();
let running=true,history=[],savedAt=null,lastSavedHour=0;
const saved=readCheckpoint(file,modelHash);
if(saved){world.model.restore(saved.model);world.model.restoreEvents(saved.events);running=saved.running;history=saved.history;savedAt=saved.savedAt;lastSavedHour=world.model.api.hours;}
function checkpoint(){
  const at=new Date().toISOString();
  writeAtomic(file,{version:1,modelHash,model:world.model.save(),running,history,events:world.model.events(),savedAt:at});
  savedAt=at;lastSavedHour=world.model.api.hours;
}
if(!saved)checkpoint();
let actual=0,measuredAt=performance.now(),measuredHour=world.model.api.hours;
let lastTick=performance.now(),budget=0,stopping=false,saveError=null;
function publish(){
  world.model.api.announceEvents();
  const frame=world.frame(),now=performance.now();
  if(now-measuredAt>=2000){actual=(frame.hours-measuredHour)*1000/(now-measuredAt);measuredAt=now;measuredHour=frame.hours;}
  history.push({hours:frame.hours,org:frame.org,cells:frame.cells,photo:frame.counts.photo,herb:frame.counts.herb,pred:frame.counts.pred,sapro:frame.counts.sapro});
  if(history.length>240)history.shift();
  parentPort.postMessage({type:'frame',frame:{...frame,running,actualHoursPerSecond:running?actual:0,savedAt,lastSavedHour,saveError,
    history,serverTime:Date.now(),modelVersion:modelHash.slice(0,12)}});
}
function safeSave(){
  try{checkpoint();saveError=null;}catch(error){saveError=error.message;running=false;console.error('Сохранение не выполнено:',error.message);}
}
function tick(){
  if(stopping)return;
  const now=performance.now(),elapsed=Math.min(1000,now-lastTick);lastTick=now;
  if(running){
    budget=Math.min(budget+elapsed*world.model.params.hoursPerMinute/60000,world.model.params.hoursPerMinute/60+1);
    const deadline=now+12;
    while(budget>=1&&performance.now()<deadline){world.model.step();budget--;}
  }else budget=0;
  setTimeout(tick,12);
}
parentPort.on('message',message=>{
  const {id}=message;
  try{
    if(message.type==='catalog'){parentPort.postMessage({id,value:world.catalog()});return;}
    if(message.type==='detail'){
      const value=message.cell===undefined?world.detailById(message.body):world.detailAt(message.cell);
      parentPort.postMessage({id,value});return;
    }
    if(message.type==='stop'){
      stopping=true;checkpoint();parentPort.postMessage({id,value:{saved:true}});parentPort.close();return;
    }
    const c=message.command;world.validateCommand(c);
    const resets=['reset','preset','rules'].includes(c.type);
    if(resets){
      checkpoint();
      fs.copyFileSync(file,path.join(path.dirname(file),'before-reset-'+Date.now()+'.evo'));
    }
    world.apply(c);
    if(c.type==='running')running=c.value;
    if(resets){budget=0;history=[];measuredHour=0;measuredAt=performance.now();actual=0;}
    checkpoint();publish();
    parentPort.postMessage({id,value:{ok:true,hours:world.model.api.hours}});
  }catch(error){
    if(error.code){saveError=error.message;running=false;publish();}
    parentPort.postMessage({id,error:error.message});
  }
});
setInterval(publish,500).unref();
setInterval(safeSave,30000).unref();
publish();tick();
