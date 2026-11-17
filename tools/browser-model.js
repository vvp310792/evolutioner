'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
// Стенд исполняет скрипты самого index.html: проверяется именно выдаваемая модель.
// Заглушки убирают рисование и события интерфейса, не заменяя правила мира.
module.exports=function browserModel(seed=1,{native=false}={}){
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const elements=new Map();
  const ctx=new Proxy({}, {get:()=>()=>{}});
  function element(id=''){
    return {id,value:id==='initColonies'?'24':'0',width:id==='dish'?368:400,height:id==='dish'?736:46,
      style:{},children:[],classList:{add(){},remove(){}},addEventListener(){},
      get innerHTML(){return this.html||'';},set innerHTML(value){this.html=value;this.children.length=0;},
      getContext:()=>ctx,appendChild(e){this.children.push(e);},prepend(e){this.children.unshift(e);},
      get lastChild(){return this.children.at(-1);},removeChild(e){this.children.splice(this.children.indexOf(e),1);},remove(){}};
  }
  const document={getElementById(id){if(!elements.has(id))elements.set(id,element(id));return elements.get(id);},
    createElement:()=>element(),querySelectorAll:()=>[]};
  const math=Object.create(Math);
  let randomState;
  function setSeed(value){randomState=value;math.random=()=>{randomState|=0;randomState=randomState+0x6D2B79F5|0;let t=Math.imul(randomState^randomState>>>15,1|randomState);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296;};}
  setSeed(seed);
  const context={document,Math:math,console,performance,requestAnimationFrame(){},setTimeout(){}};
  context.window=context;
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
  if(native){
    // Код доверенного HTML исполняется в одном контексте V8: переходы между VM
    // на каждом вызове Math замедляли сервер. Ввод посетителей сюда не попадает.
    const run=new Function('document','Math','console','performance','requestAnimationFrame','setTimeout','globalThis','module',
      '\"use strict\";const window=globalThis;\n'+scripts[0]+'\nconst OpenEvolution=globalThis.OpenEvolution;\n'+scripts.slice(1).join('\n'));
    run(document,math,console,performance,context.requestAnimationFrame,context.setTimeout,context,undefined);
  }else{
    vm.createContext(context);
    for(const source of scripts)vm.runInContext(source,context,{filename:'index.html'});
  }
  const api=context.evolutioner;
  return {params:api.params,bodies:api.bodies,step:api.step,
    presetTitles:Object.fromEntries([...html.match(/<select id="preset">([\s\S]*?)<\/select>/)[1].matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(m=>[m[1],m[2]])),
    readouts(){
      // Сбор показателей не должен менять мир или выдавать повторные эволюционные события.
      api.updateStats(false);
      return Object.fromEntries([...elements].filter(([id])=>/^s[A-Z]|^trioLegend$/.test(id)).map(([id,el])=>[id,String(el.textContent??'')]));
    },
    events(){return elements.get('log').children.map(el=>({kind:el.className,text:el.textContent}));},
    restoreEvents(events=[]){const log=elements.get('log');log.innerHTML='';for(const e of events.slice(0,24)){const row=element();row.className=e.kind;row.textContent=e.text;log.appendChild(row);}},
    save(){return {world:api.saveWorld(),randomState};},
    restore(saved){const copy=structuredClone(saved);api.restoreWorld(copy.world);randomState=copy.randomState;},
    reset(n=24,value=seed){setSeed(value);elements.get('initColonies').value=String(n);api.reset();},
    startAssistanceRamp(duration=1000){api.params.assistanceRamp={from:api.params.packageStrength,start:api.hours,duration};},
    snapshot(){
      let cells=0,multi=0,maxSize=0;for(const b of api.bodies.values()){
        cells+=b.cells.length;if(b.cells.length>1)multi++;maxSize=Math.max(maxSize,b.cells.length);
      }
      return {hours:api.hours,org:api.bodies.size,cells,multi,maxSize,open:JSON.parse(JSON.stringify(api.metrics())),assistance:api.params.packageStrength};
    },api};
};
