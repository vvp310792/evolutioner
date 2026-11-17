'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
// Стенд исполняет скрипты самого index.html: проверяется именно выдаваемая модель.
// Заглушки убирают рисование и события интерфейса, не заменяя правила мира.
module.exports=function browserModel(seed=1){
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const elements=new Map();
  const ctx=new Proxy({}, {get:()=>()=>{}});
  function element(id=''){
    return {id,value:id==='initColonies'?'24':'0',width:id==='dish'?368:400,height:id==='dish'?736:46,
      style:{},children:[],classList:{add(){},remove(){}},addEventListener(){},
      getContext:()=>ctx,appendChild(e){this.children.push(e);},prepend(e){this.children.unshift(e);},
      get lastChild(){return this.children.at(-1);},removeChild(e){this.children.splice(this.children.indexOf(e),1);},remove(){}};
  }
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element(id));return elements.get(id);},
    createElement:()=>element(),querySelectorAll:()=>[]};
  const math=Object.create(Math);
  function setSeed(value){let a=value;math.random=()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
  setSeed(seed);
  const context=vm.createContext({document,Math:math,console,performance,requestAnimationFrame(){},setTimeout(){}});
  context.window=context;
  for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(match[1],context,{filename:'index.html'});
  const api=context.evolutioner;
  return {params:api.params,bodies:api.bodies,step:api.step,
    reset(n=24,value=seed){setSeed(value);elements.get('initColonies').value=String(n);api.reset();},
    startAssistanceRamp(duration=1000){api.params.assistanceRamp={from:api.params.packageStrength,start:api.hours,duration};},
    snapshot(){
      let cells=0,multi=0,maxSize=0;for(const b of api.bodies.values()){
        cells+=b.cells.length;if(b.cells.length>1)multi++;maxSize=Math.max(maxSize,b.cells.length);
      }
      return {hours:api.hours,org:api.bodies.size,cells,multi,maxSize,open:JSON.parse(JSON.stringify(api.metrics())),assistance:api.params.packageStrength};
    },api};
};
