'use strict';
const sim=require('./browser-model')();
const [mode='zero',seedText='1',lightText='0.8',hoursText='2000']=process.argv.slice(2);
if(!['zero','full','abrupt','ramp','legacy'].includes(mode)) throw Error('Неизвестный режим');
const seed=Number(seedText),light=Number(lightText),hours=Number(hoursText);
Object.assign(sim.params,{openDiet:mode!=='legacy',programBodies:mode!=='legacy',heritableRates:mode!=='legacy',
  packageStrength:mode==='zero'?0:1,light});
sim.reset(24,seed);
const samples=[];
for(let h=0;h<hours;h++){
  if(h===400 && mode==='abrupt') sim.params.packageStrength=0;
  if(h===400 && mode==='ramp') sim.startAssistanceRamp(1000);
  sim.step();
  if((h+1)%200===0 || h+1===hours){
    const s=sim.snapshot();
    for(const b of sim.bodies.values()) if(!Number.isFinite(b.energy)||!Number.isFinite(b.structuralEnergy||0)) throw Error('Не конечная энергия');
    samples.push({h:s.hours,org:s.org,cells:s.cells,multi:s.multi,maxSize:s.maxSize,
      mixed:s.open.mixed,rules:s.open.programMax,specialized:s.open.specializedPlans,
      assistance:s.assistance,intake:s.open.intake});
    process.stderr.write(JSON.stringify(samples.at(-1))+'\n');
  }
}
process.stdout.write(JSON.stringify({engine:'index.html',mode,seed,light,hours,samples})+'\n');
