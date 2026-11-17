'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,spawnSync}=require('node:child_process');
const {once}=require('node:events');
const {createModel,validateCommand}=require('../server/model');
const {encode,decode,readCheckpoint,writeAtomic}=require('../server/checkpoint');
const {createAuth,issue,valid,matches}=require('../server/auth');
const digest=require('../server/state-digest');
test('обычный контекст и VM исполняют те же события HTML',()=>{
  const browserModel=require('../tools/browser-model'),a=browserModel(19),b=browserModel(19,{native:true});
  for(let i=0;i<240;i++){a.step();b.step();}
  assert.equal(digest(a.save()),digest(b.save()));
});
test('второй мир не сбрасывает счётчики первого и не создаёт глобальных переменных',()=>{
  const globals=Object.keys(globalThis),a=createModel(19);
  for(let i=0;i<100;i++)a.model.step();
  const before=digest(a.model.save()),b=createModel(7);
  b.model.reset();for(let i=0;i<100;i++)b.model.step();
  assert.equal(digest(a.model.save()),before);
  assert.deepEqual(Object.keys(globalThis),globals);
});

test('сохранение продолжает тот же случайный мир, включая следующие рождения',()=>{
  const a=createModel(19);a.model.params.mutation=.5;
  for(let h=0;h<180;h++)a.model.step();
  const saved=decode(encode(a.model.save())),events=a.model.events();
  const b=createModel(999);b.model.restore(saved);b.model.restoreEvents(events);
  for(let h=0;h<180;h++){a.model.step();b.model.step();}
  assert.equal(digest(a.model.save()),digest(b.model.save()));
  assert.deepEqual(a.frame(),b.frame());assert.ok(a.model.api.hours===360);
  assert.ok(a.model.api.saveWorld().nextBodyId>saved.world.nextBodyId);
  const fresh=spawnSync(process.execPath,[path.join(__dirname,'../tools/restore-check.js')],{input:encode(saved),maxBuffer:64*1024*1024});
  assert.equal(fresh.status,0,fresh.stderr.toString());
  assert.equal(digest(decode(fresh.stdout)),digest(a.model.save()));
});
test('полная панель: все пресеты из HTML, показатели без изменения мира, оба набора генов',()=>{
  const world=createModel(19),catalog=world.catalog();
  assert.equal(catalog.presets.length,15);assert.equal(catalog.genes.length,26);
  assert.deepEqual(catalog.presets.map(p=>p.id),Object.keys(world.model.api.presets));
  for(const p of catalog.presets){
    assert.ok(p.title&&p.note);world.apply({type:'preset',id:p.id,founders:12,seed:7});
    for(const [key,value]of Object.entries(p.values))assert.equal(world.model.params[key],value);
    assert.equal(world.model.bodies.size,12);assert.equal(world.model.api.hours,0);
  }
  world.apply({type:'rules',openDiet:false,programBodies:false,packageStrength:1,founders:12,seed:7});
  assert.equal(world.model.params.openDiet,false);assert.equal(world.model.params.programBodies,false);
  for(let i=0;i<20;i++)world.model.step();
  const before=digest(world.model.save()),frame=world.frame();assert.equal(digest(world.model.save()),before);
  for(const id of ['sPop','sCorpse','sLineages','sExtinct','sFights','sMoves','sSpores','sMyco','sSex','sVir','sGam','sSeeds','sSeedGerm','sBodies','sMaxBody','sDiff','sMods','sInf','sKey','sSexB','sLight','sTraits','sTraits2','sOpen','trioLegend'])assert.ok(Object.hasOwn(frame.readouts,id),id);
  assert.equal(Number(frame.readouts.sPop),frame.cells);
  const body=world.detailById(world.model.bodies.keys().next().value);
  assert.equal(body.genes.length,26);assert.ok(body.alleles.A&&body.alleles.B);assert.ok(body.genes.every(g=>g.description.length));
  const org=world.model.bodies.size,hours=world.model.api.hours;
  world.apply({type:'seed'});assert.equal(world.model.bodies.size,org+6);assert.equal(world.model.api.hours,hours);
  const eventBody=world.model.bodies.values().next().value;eventBody.guild='herb';
  const evoBefore=world.model.events().filter(e=>e.kind==='evo').length;
  world.frame();assert.equal(world.model.events().filter(e=>e.kind==='evo').length,evoBefore);
  world.model.api.announceEvents();world.model.api.announceEvents();
  assert.equal(world.model.events().filter(e=>e.kind==='evo').length,evoBefore+1);
  assert.throws(()=>validateCommand({type:'preset',id:'constructor',founders:12,seed:7}));
  assert.throws(()=>validateCommand({type:'rules',openDiet:true,programBodies:true,packageStrength:1,founders:0,seed:7}));
});
test('атомарное сохранение, предыдущая копия и запрет несовместимой версии',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'evo-checkpoint-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'world.evo'),v={version:1,modelHash:'same',hours:10};
  writeAtomic(file,v);writeAtomic(file,{...v,hours:20});assert.equal(readCheckpoint(file,'same').hours,20);
  fs.writeFileSync(file,'bad');assert.equal(readCheckpoint(file,'same').hours,10);
  writeAtomic(file,{...v,hours:30});
  fs.writeFileSync(file,'bad');assert.equal(readCheckpoint(file,'same').hours,10);
  fs.unlinkSync(file);assert.equal(readCheckpoint(file,'same').hours,10);
  assert.throws(()=>readCheckpoint(file,'different'),/Версия/);
  fs.writeFileSync(file,'bad');fs.writeFileSync(file+'.previous','bad');assert.throws(()=>readCheckpoint(file,'same'));
});
test('подписанный доступ отклоняет другой пароль, подделку и истёкшую сессию',()=>{
  const auth=createAuth('test-only-password');assert.ok(matches('test-only-password',auth));assert.ok(!matches('wrong',auth));
  const token=issue(auth);assert.ok(valid('evo_session='+token,auth));
  assert.ok(!valid('evo_session='+token.slice(0,-3)+'xxx',auth));assert.ok(!valid('evo_session=1.abc.def',auth));assert.ok(!valid('',auth));
});
test('параметры ограничены допустимыми командами',()=>{
  assert.throws(()=>validateCommand({type:'params',values:{__proto__:null,openDiet:false}}));
  assert.throws(()=>validateCommand({type:'params',values:{light:NaN}}));
  assert.throws(()=>validateCommand({type:'params',values:{mutation:2}}));
  assert.throws(()=>validateCommand(JSON.parse('{"type":"params","values":{"toString":1}}')));
  assert.throws(()=>validateCommand(JSON.parse('{"type":"params","values":{"constructor":1}}')));
  assert.throws(()=>validateCommand({type:'reset',founders:1e8,seed:1}));
  assert.doesNotThrow(()=>validateCommand({type:'params',values:{light:.8,predation:false}}));
});
test('HTTP: пароль, защита команд, сохранение и продолжение после перезапуска',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'evo-http-'));
  fs.writeFileSync(path.join(dir,'auth.json'),JSON.stringify(createAuth('test-only-password')));
  let child;
  async function start(){
    child=spawn(process.execPath,[path.join(__dirname,'../server/main.js')],{env:{...process.env,EVO_DATA_DIR:dir,EVO_SECURE_COOKIE:'0',EVO_ORIGIN:'http://localhost',PORT:'0'},stdio:['ignore','pipe','pipe']});
    let log='';
    const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Сервер не запустился: '+log)),15000);child.stderr.on('data',s=>log+=s);child.stdout.on('data',s=>{log+=s;const m=log.match(/порту (\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Сервер завершился '+code+': '+log));});});
    return 'http://127.0.0.1:'+port;
  }
  async function stop(){if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}}
  t.after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true});});
  let base=await start(),cookie='';
  const request=(route,body,origin='http://localhost')=>fetch(base+route,{method:body?'POST':'GET',headers:{cookie,Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  for(let i=0;i<50;i++){const r=await fetch(base+'/health');if(r.ok)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal((await request('/api/state')).status,401);
  assert.match(await(await request('/')).text(),/Пароль доступа/);
  assert.equal((await request('/api/login',{password:'test-only-password'},'https://wrong.test')).status,403);
  assert.equal((await request('/api/login',{password:'wrong'})).status,401);
  const login=await request('/api/login',{password:'test-only-password'});assert.equal(login.status,200);
  cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
  assert.equal((await(await request('/api/catalog')).json()).presets.length,15);
  assert.equal((await request('/api/command',{type:'running',value:false})).status,200);
  assert.equal((await request('/api/command',{type:'params',values:{light:999}})).status,400);
  assert.equal((await request('/api/command',{type:'params',values:{light:.91}})).status,200);
  const s=await(await request('/api/state')).json();assert.equal(s.params.light,.91);assert.equal(s.running,false);assert.ok(s.grid.length>0);
  await new Promise(r=>setTimeout(r,650));assert.equal((await(await request('/api/state')).json()).hours,s.hours);
  assert.equal((await request('/api/command',{type:'save'})).status,200);
  await stop();base=await start();
  for(let i=0;i<50;i++){if((await fetch(base+'/health')).ok)break;await new Promise(r=>setTimeout(r,50));}
  const restored=await(await request('/api/state')).json();assert.equal(restored.hours,s.hours);assert.equal(restored.grid,s.grid);assert.equal(restored.params.light,.91);assert.equal(restored.running,false);assert.deepEqual(restored.events,s.events);
  assert.equal((await request('/api/command',{type:'running',value:true})).status,200);
  await new Promise(r=>setTimeout(r,750));assert.ok((await(await request('/api/state')).json()).hours>s.hours);
  assert.equal((await request('/api/command',{type:'params',values:{hoursPerMinute:600000}})).status,200);
  let fast;
  for(let i=0;i<60;i++){
    fast=await(await request('/api/state')).json();if(fast.speedMeasurementReady)break;
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(fast.speedMeasurementReady);assert.ok(fast.actualHoursPerSecond>1);
  assert.equal((await request('/api/command',{type:'params',values:{hoursPerMinute:60}})).status,200);
  const changed=await(await request('/api/state')).json();assert.equal(changed.speedMeasurementReady,false);assert.equal(changed.actualHoursPerSecond,0);
  await new Promise(r=>setTimeout(r,2700));
  const slow=await(await request('/api/state')).json();assert.ok(slow.speedMeasurementReady);
  assert.ok(slow.actualHoursPerSecond>.6&&slow.actualHoursPerSecond<1.4,slow.actualHoursPerSecond);
  assert.ok(slow.hours-changed.hours>=2&&slow.hours-changed.hours<=3,slow.hours-changed.hours);
  assert.equal((await request('/api/command',{type:'reset',founders:12,seed:7})).status,200);
  assert.ok(fs.readdirSync(dir).some(n=>n.startsWith('before-reset-')));
  assert.equal((await request('/api/command',{type:'preset',id:'rich',founders:12,seed:7})).status,200);
  assert.equal((await request('/api/command',{type:'rules',openDiet:false,programBodies:false,packageStrength:1,founders:12,seed:7})).status,200);
  const legacy=await(await request('/api/state')).json();assert.equal(legacy.params.openDiet,false);assert.equal(legacy.params.programBodies,false);
  assert.equal((await request('/api/command',{type:'seed'})).status,200);
  assert.equal((await request('/api/logout',{})).status,200);
});
