'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Worker}=require('node:worker_threads');
const {decode,encode}=require('../server/checkpoint');
const version=require('../server/version');
const [oldPath,newPath,checkpoint,stepArg='200',repeatArg='3']=process.argv.slice(2);
const steps=Number(stepArg),repeats=Number(repeatArg);
if(!oldPath||!newPath||!checkpoint||!Number.isInteger(steps)||steps<1||!Number.isInteger(repeats)||repeats<1)throw Error('Нужны два каталога, копия мира, число шагов и повторов');
const roots=[oldPath,newPath].map(p=>path.resolve(p));
const modelHash=version(roots[0]);
if(version(roots[1])!==modelHash)throw Error('Для сравнения расписаний нужна одна версия модели');
const saved=decode(fs.readFileSync(checkpoint));
if(saved.modelHash!==modelHash)throw Error('Копия мира относится к другой модели');
saved.running=true;saved.model.world.params.hoursPerMinute=600000;
function cpuStats(){
  if(process.platform!=='linux')return null;
  const group=fs.readFileSync('/proc/self/cgroup','utf8').trim().split('\n').find(s=>s.startsWith('0::'))?.slice(3);
  if(!group)return null;
  const folder=path.join('/sys/fs/cgroup',group);
  return {max:fs.readFileSync(path.join(folder,'cpu.max'),'utf8').trim(),...Object.fromEntries(fs.readFileSync(path.join(folder,'cpu.stat'),'utf8').trim().split('\n').map(s=>{const [key,value]=s.split(' ');return [key,Number(value)];}))};
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'evo-scheduler-'));
async function run(index){
  const root=roots[index],file=path.join(dir,'world.evo');fs.writeFileSync(file,encode(saved));
  let source=fs.readFileSync(path.join(root,'server/worker.js'),'utf8');
  const needle='world.model.step();budget--;';
  if(!source.includes(needle))throw Error('Точка ограничения шагов изменилась; обновите измеритель');
  // Наблюдение меняет сохраняемые флаги: обе версии публикуют на тех же шагах.
  source=source.replace('setInterval(publish,500).unref();','').replace('setInterval(safeSave,30000).unref();','');
  source=source.replace(needle,needle+`
    benchmarkSteps++;
    if(benchmarkSteps%20===0)publish();
    if(benchmarkSteps===workerData.steps){
      const elapsedMs=performance.now()-benchmarkStarted;
      parentPort.postMessage({type:'benchmark',elapsedMs,hash:benchmarkDigest(world.model.save()),hours:world.model.api.hours});
      stopping=true;return;
    }`);
  source=source.replace('publish();tick();','benchmarkStarted=performance.now();publish();tick();');
  source=source.replace("require('./model')",`require(${JSON.stringify(path.join(root,'server/model.js'))})`)
    .replace("require('./checkpoint')",`require(${JSON.stringify(path.join(root,'server/checkpoint.js'))})`);
  source=source.replace("'use strict';",`'use strict';\nlet benchmarkSteps=0,benchmarkStarted;const benchmarkDigest=require(${JSON.stringify(path.join(root,'server/state-digest.js'))});`);
  const worker=new Worker(source,{eval:true,workerData:{file,modelHash,steps}});
  try{
    return await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Измерение превысило 60 секунд')),60000);
      worker.on('message',message=>{if(message.type==='benchmark'){clearTimeout(timer);resolve({variant:index===0?'old':'new',...message,hoursPerMinute:steps*60000/message.elapsedMs});}});
      worker.once('error',error=>{clearTimeout(timer);reject(error);});
      worker.once('exit',code=>{clearTimeout(timer);reject(Error('Исполнитель завершился без результата: '+code));});
    });
  }finally{await worker.terminate();}
}
(async()=>{
  try{
    const samples=[],cpuBefore=cpuStats();
    // Чередование порядка уменьшает влияние прогрева и фоновой нагрузки.
    for(let i=0;i<repeats;i++)for(const index of i%2?[1,0]:[0,1])samples.push({repeat:i,...await run(index)});
    if(new Set(samples.map(s=>s.hash)).size!==1)throw Error('Полные состояния после одинаковых шагов различаются');
    const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const oldMs=median(samples.filter(s=>s.variant==='old').map(s=>s.elapsedMs));
    const newMs=median(samples.filter(s=>s.variant==='new').map(s=>s.elapsedMs));
    const cpuAfter=cpuStats();
    console.log(JSON.stringify({steps,repeats,startHours:saved.model.world.hours,startOrganisms:saved.model.world.bodies.length,parity:true,speedup:oldMs/newMs,medianMs:{old:oldMs,new:newMs},cpu:cpuBefore?{max:cpuAfter.max,usageUsec:cpuAfter.usage_usec-cpuBefore.usage_usec,throttledUsec:cpuAfter.throttled_usec-cpuBefore.throttled_usec,throttledPeriods:cpuAfter.nr_throttled-cpuBefore.nr_throttled}:null,samples}));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
