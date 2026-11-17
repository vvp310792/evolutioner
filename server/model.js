'use strict';
const browserModel=require('../tools/browser-model');
const Open=require('../src/open-evolution');

const limits={hoursPerMinute:[1,600000],mutation:[0,1],decomp:[0,1],light:[0,2],parasites:[0,3],packageStrength:[0,1]};
const switches=['predation','dayNight','sexReprod'];
const guilds=['photo','herb','pred','sapro'];
function validateCommand(c){
  if(!c || typeof c!=='object' || Array.isArray(c)) throw Error('Неверная команда');
  if(c.type==='running' && typeof c.value==='boolean') return c;
  if(c.type==='taper' || c.type==='save') return {type:c.type};
  if(c.type==='reset' && Number.isInteger(c.founders) && c.founders>=1 && c.founders<=200 && Number.isInteger(c.seed) && c.seed>=0 && c.seed<=0xffffffff) return c;
  if(c.type==='params' && c.values && typeof c.values==='object' && !Array.isArray(c.values)){
    for(const [key,value] of Object.entries(c.values)){
      if(Object.hasOwn(limits,key)){if(!Number.isFinite(value)||value<limits[key][0]||value>limits[key][1])throw Error('Параметр вне диапазона: '+key);}
      else if(!switches.includes(key)||typeof value!=='boolean')throw Error('Неизвестный параметр: '+key);
    }
    return c;
  }
  throw Error('Неизвестная команда');
}
function createModel(seed=19){
  const model=browserModel(seed,{native:true});
  model.params.hoursPerMinute=2400;
  function detail(body){
    if(!body)return null;
    return {id:body.id,lineage:body.lineage,age:body.age,energy:body.energy,structuralEnergy:body.structuralEnergy||0,
      cells:body.cells,planned:body.tpl.length,guild:body.guild,sex:body.sex,infected:!!body.par,
      intake:body.intake||{},genome:body.g,alleles:body.al,
      roles:body.cells.map(i=>Open.roleAt(body,i,46))};
  }
  function frame(){
    const api=model.api,grid=Buffer.alloc(46*92*4),owners=Buffer.alloc(46*92*4);
    const counts={photo:0,herb:0,pred:0,sapro:0,corpses:0};
    for(let i=0;i<api.state.length;i++)if(api.state[i]===2){grid[i*4]=5;grid[i*4+1]=Math.min(255,Math.round(api.corpseFood[i]*45));counts.corpses++;}
    for(const b of api.bodies.values()){
      counts[b.guild]++;
      const brightness=Math.round(Math.max(0,Math.min(255,60+160*b.energy/(b.cells.length*b.g.thresh*1.3))));
      for(const i of b.cells){
        const k=i*4;grid[k]=guilds.indexOf(b.guild)+1;grid[k+1]=brightness;grid[k+2]=Open.roleAt(b,i,46);
        grid[k+3]=(b.sex==='m'?1:b.sex==='f'?2:0)|(b.par?4:0);owners.writeInt32LE(b.id,k);
      }
    }
    for(const s of api.seeds)grid[s.i*4+3]|=s.kind===2?32:s.kind===1?16:8;
    for(const g of api.gametes)grid[g.i*4+3]|=64;
    return {...model.snapshot(),cols:46,rows:92,counts,seeds:api.seeds.length,gametes:api.gametes.length,
      params:{...model.params},grid:grid.toString('base64'),owners:owners.toString('base64')};
  }
  return {model,frame,detailById:id=>detail(model.bodies.get(id)),
    detailAt:i=>detail(model.bodies.get(model.api.owner[i])),validateCommand,
    apply(c){
      validateCommand(c);
      if(c.type==='params'){
        Object.assign(model.params,c.values);
        if('packageStrength'in c.values)model.params.assistanceRamp=null;
      }else if(c.type==='reset')model.reset(c.founders,c.seed);
      else if(c.type==='taper')model.startAssistanceRamp();
    }};
}
module.exports={createModel,validateCommand};
