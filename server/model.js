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
  if(c.type==='seed')return {type:'seed'};
  if(c.type==='preset'&&typeof c.id==='string'&&Object.hasOwn(presetIds,c.id)&&validStart(c))return c;
  if(c.type==='rules'&&validStart(c)&&typeof c.openDiet==='boolean'&&typeof c.programBodies==='boolean'&&Number.isFinite(c.packageStrength)&&c.packageStrength>=0&&c.packageStrength<=1)return c;
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
const presetIds=Object.freeze(Object.fromEntries(['default','lug','savanna','skudny','klon','multi','sex','queen','myco','bank','nopar','parpress','noon','rich','poor'].map(id=>[id,true])));
function validStart(c){return Number.isInteger(c.founders)&&c.founders>=1&&c.founders<=200&&Number.isInteger(c.seed)&&c.seed>=0&&c.seed<=0xffffffff;}
function createModel(seed=19){
  const model=browserModel(seed,{native:true});
  model.params.hoursPerMinute=2400;
  function detail(body){
    if(!body)return null;
    return {id:body.id,lineage:body.lineage,age:body.age,energy:body.energy,structuralEnergy:body.structuralEnergy||0,
      cells:body.cells,planned:body.tpl.length,guild:body.guild,sex:body.sex,infected:!!body.par,
      virulence:body.par?.vir??null,heterozygosity:model.api.heteroOf(body),modScale:model.api.modScale,
      intake:body.intake||{},genome:body.g,alleles:body.al,
      interior:body.cells.filter(i=>[i-46,i+46,i%46?i-1:-1,i%46<45?i+1:-1].every(j=>j>=0&&j<46*92&&model.api.owner[j]===body.id)).length,
      genes:model.api.geneInfo.map(([key,label,min,max,desc])=>({key,label,min,max,description:model.api.geneDescription(key,desc).replace(/<[^>]*>/g,''),active:model.api.geneActive(key,body.guild)})),
      roles:body.cells.map(i=>Open.roleAt(body,i,46))};
  }
  function catalog(){
    return {presets:Object.entries(model.api.presets).map(([id,p])=>({id,title:model.presetTitles[id],note:p.note,values:{light:p.light,mutation:p.mut,decomp:p.decomp,parasites:p.par,predation:p.pred,sexReprod:p.sex,dayNight:p.dn}})),
      genes:model.api.geneInfo.map(([key,label,min,max,desc])=>({key,label,min,max,description:model.api.geneDescription(key,desc).replace(/<[^>]*>/g,''),unused:model.params.programBodies&&['shapeType','shapeB'].includes(key)})),scales:model.api.scales};
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
      params:{...model.params},grid:grid.toString('base64'),owners:owners.toString('base64'),readouts:model.readouts(),events:model.events(),
      sexualLines:[...api.bodies.values()].filter(b=>b.g.sexual>=.5).length};
  }
  return {model,frame,catalog,detailById:id=>detail(model.bodies.get(id)),
    detailAt:i=>detail(model.bodies.get(model.api.owner[i])),validateCommand,
    apply(c){
      validateCommand(c);
      if(c.type==='params'){
        Object.assign(model.params,c.values);
        if('packageStrength'in c.values)model.params.assistanceRamp=null;
      }else if(c.type==='reset')model.reset(c.founders,c.seed);
      else if(c.type==='preset'){
        const p=catalog().presets.find(p=>p.id===c.id);
        Object.assign(model.params,p.values);model.reset(c.founders,c.seed);
      }else if(c.type==='rules'){
        Object.assign(model.params,{openDiet:c.openDiet,programBodies:c.programBodies,packageStrength:c.packageStrength});
        model.reset(c.founders,c.seed);
      }else if(c.type==='seed'){
        let placed=0;for(let guard=0;guard<3000&&placed<6;guard++){
          const i=Math.floor(model.api.random()*46*92);
          if(model.api.state[i]===0&&model.api.spawnFounder(i,9+model.api.random()*4))placed++;
        }
      }
      else if(c.type==='taper')model.startAssistanceRamp();
    }};
}
module.exports={createModel,validateCommand};
