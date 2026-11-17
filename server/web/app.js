'use strict';
const $=id=>document.getElementById(id),number=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2});
const names={photo:'свет',herb:'растительная пища',pred:'животная пища',sapro:'падаль'};
const roles=['обычная','синтезирующая','пищеварительная','защитная'];
const colors=['#52c57f','#dcc15d','#e77586','#b094e5'];
const ctx=$('dish').getContext('2d'),chart=$('chart').getContext('2d');
let frame=null,owners=null,selected=null,polling=null,drawCount=0,connectionError=false;
let catalog=null,catalogMode='',catalogLoading=false,pendingReset={type:'reset'};
let speedDraft=null,speedTimer=null,speedSending=false;
const speedFromSlider=position=>Math.max(1,Math.round(600000**(position/100)));
const sliderFromSpeed=rate=>100*Math.log(rate)/Math.log(600000);
const statLabels={sPop:'Живо клеток',sCorpse:'Трупов на поле',sLineages:'Линий живо',sExtinct:'Вымерло линий',sFights:'Схваток / выпасов',sMoves:'Перемещений',sSpores:'Прорастаний конидий',sMyco:'Грибоядность зверей',sSex:'Раздельнополость и самцы',sVir:'Свирепость штаммов',sGam:'Гамет в пути / дошедших',sSeeds:'Зачатков в почве',sSeedGerm:'Всходов / сгнивших зачатков',sBodies:'Многоклеточных',sMaxBody:'Крупнейшее тело',sDiff:'Тел с внутренними клетками',sMods:'Свободные гены',sInf:'Заражено',sKey:'Разброс замков иммунитета',sSexB:'Рождений от пола',sLight:'Текущая освещённость'};
async function api(url,data){
  const response=await fetch(url,{cache:'no-store',...(data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});
  if(response.status===401){location.replace('/');throw Error('Нужен повторный вход');}
  const result=await response.json();if(!response.ok)throw Error(result.error||'Сервер временно недоступен');return result;
}
async function command(data){
  $('error').textContent='';
  try{await api('/api/command',data);return await poll(true);}
  catch(error){$('error').textContent=error.message;return false;}
}
function bytes(base64){return Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}
function draw(s){
  const grid=bytes(s.grid),raw=bytes(s.owners),view=new DataView(raw.buffer);owners=new Int32Array(s.cols*s.rows);
  ctx.fillStyle='#0b1212';ctx.fillRect(0,0,368,736);
  for(let i=0;i<owners.length;i++){
    owners[i]=view.getInt32(i*4,true);
    const k=i*4,code=grid[k],x=i%s.cols*8,y=Math.floor(i/s.cols)*8,marks=grid[k+3];
    if(code){
      if(code===5)ctx.fillStyle=`hsl(30 17% ${12+grid[k+1]/14}%)`;
      else{const hue=[0,142,46,350,268][code];ctx.fillStyle=`hsl(${hue} 53% ${23+grid[k+1]/6}%)`;}
      ctx.fillRect(x,y,7,7);
      if(grid[k+2]){ctx.fillStyle=['','#a4ff70','#ffa858','#76d4ff'][grid[k+2]];ctx.fillRect(x+5,y+2,1,3);}
      if(marks&1){ctx.fillStyle='#8cc8ff';ctx.fillRect(x,y,2,2);}
      if(marks&2){ctx.fillStyle='#ffaadd';ctx.fillRect(x+5,y+5,2,2);}
      if(marks&4){ctx.fillStyle='#ec4899';ctx.fillRect(x+2,y+2,2,2);}
    }else{
      if(marks&8){ctx.fillStyle='#4ade80';ctx.fillRect(x+1,y+1,2,2);}
      if(marks&16){ctx.fillStyle='#b094e5';ctx.fillRect(x+4,y+1,2,2);}
      if(marks&32){ctx.fillStyle='#facc15';ctx.fillRect(x+1,y+4,3,3);}
    }
    if(marks&64){ctx.fillStyle='#bee6ff';ctx.fillRect(x+4,y+4,2,2);}
  }
  ctx.strokeStyle='rgba(7,15,10,.6)';ctx.lineWidth=.6;ctx.beginPath();
  for(let i=0;i<owners.length;i++)if(owners[i]){
    const x=i%s.cols*8,y=Math.floor(i/s.cols)*8;
    if(i%s.cols===0||owners[i-1]!==owners[i]){ctx.moveTo(x,y);ctx.lineTo(x,y+7);}
    if(i<s.cols||owners[i-s.cols]!==owners[i]){ctx.moveTo(x,y);ctx.lineTo(x+7,y);}
  }
  ctx.stroke();
  if(selected){ctx.strokeStyle='#fff0a8';ctx.lineWidth=1.5;for(let i=0;i<owners.length;i++)if(owners[i]===selected)ctx.strokeRect(i%s.cols*8+.5,Math.floor(i/s.cols)*8+.5,6,6);}
  drawCount++;
}
function drawChart(history){
  const w=640,h=180;chart.clearRect(0,0,w,h);if(history.length<2)return;
  const max=Math.max(10,...history.map(s=>s.org));
  chart.strokeStyle='#304137';chart.lineWidth=1;chart.beginPath();chart.moveTo(0,h-20);chart.lineTo(w,h-20);chart.stroke();
  ['photo','herb','pred','sapro'].forEach((key,j)=>{
    chart.strokeStyle=colors[j];chart.lineWidth=2;chart.beginPath();
    history.forEach((s,i)=>{const x=i/(history.length-1)*w,y=h-20-s[key]/max*(h-35);if(i)chart.lineTo(x,y);else chart.moveTo(x,y);});chart.stroke();
  });
  chart.font='16px system-ui';chart.fillStyle='#9db0a2';chart.fillText(number(history[0].hours)+' ч',0,h-1);
  const end=number(history.at(-1).hours)+' ч';chart.fillText(end,w-chart.measureText(end).width,h-1);
}
function update(s){
  if(connectionError){$('error').textContent='';connectionError=false;}
  frame=s;draw(s);drawChart(s.history);
  updateDashboard(s);
  const mode=s.params.openDiet+'-'+s.params.programBodies;
  if(catalogMode!==mode&&!catalogLoading)loadCatalog(mode);
  $('dot').classList.add('online');$('connection').textContent=s.running?'Сервер считает · связь установлена':'Расчёт на паузе · связь установлена';
  $('clock').textContent='День '+number(Math.floor(s.hours/24)+1)+' · '+number(s.hours)+' ч';
  $('worldState').textContent=s.org===0?(s.seeds||s.gametes?'Остались зачатки':'Жизнь вымерла'):s.running?'Мир живёт':'Пауза';
  for(const id of ['org','cells','multi','maxSize'])$(id).textContent=number(s[id]);
  $('mixed').textContent=number(s.open.mixed);$('maxRules').textContent=number(s.open.programMax);
  $('actualRate').textContent=number(s.actualHoursPerSecond*60)+' ч/мин фактически';
  $('counts').textContent=Object.entries(names).map(([key,title])=>title+': '+number(s.counts[key])).join(' · ');
  $('dormant').textContent='Зачатки: '+number(s.seeds)+' · гаметы: '+number(s.gametes)+' · падаль: '+number(s.counts.corpses);
  $('saved').textContent=s.saveError?'Ошибка сохранения: '+s.saveError:'Сохранено '+new Date(s.savedAt).toLocaleTimeString('ru-RU')+' · '+number(s.lastSavedHour)+' ч мира';
  $('toggle').textContent=s.running?'Пауза':'Продолжить';
  for(const key of ['light','mutation','decomp','parasites']){
    if(document.activeElement!==$(key))$(key).value=s.params[key];
    $(key+'Value').textContent=key==='mutation'?number(Number($(key).value)*100)+'%':number(Number($(key).value));
  }
  for(const key of ['dayNight','predation','sexReprod'])if(document.activeElement!==$(key))$(key).checked=s.params[key];
  if(speedDraft===null){
    if(document.activeElement!==$('speed'))$('speed').value=s.params.hoursPerMinute;
    if(document.activeElement!==$('speedSlider'))$('speedSlider').value=sliderFromSpeed(s.params.hoursPerMinute);
  }
  $('speedValue').textContent=number(speedDraft??s.params.hoursPerMinute)+' ч/мин';
  $('serverSpeed').textContent=number(s.params.hoursPerMinute)+' ч/мин';
  updateSpeedStatus(s);
  if(!$('resetDialog').open){
    $('openDiet').checked=s.params.openDiet;$('programBodies').checked=s.params.programBodies;
    $('modelMode').value=!s.params.openDiet&&!s.params.programBodies&&s.params.packageStrength===1?'legacy':s.params.openDiet&&s.params.programBodies&&s.params.packageStrength===0?'open':'custom';
  }
  updateScaleNotes(s);
  if(document.activeElement!==$('assistance'))$('assistance').value=s.params.packageStrength*100;
  $('assistanceValue').textContent=number(s.params.packageStrength*100)+'%';
  $('taper').disabled=s.params.packageStrength<=0||!!s.params.assistanceRamp;
  $('ramp').textContent=s.params.assistanceRamp?'Идёт плавное снижение; осталось '+number(Math.max(0,s.params.assistanceRamp.duration-s.hours+s.params.assistanceRamp.start))+' часов мира.':'';
  $('version').textContent='Версия '+s.modelVersion+' · последний кадр '+new Date(s.serverTime).toLocaleTimeString('ru-RU');
}
function updateSpeedStatus(s){
  const target=s.params.hoursPerMinute,actual=s.actualHoursPerSecond*60;
  // В двухсекундном замере один целый шаг даёт до 30 ч/мин погрешности.
  const tolerance=Math.max(target*.15,31);
  $('speedActual').textContent=s.running&&(!s.speedMeasurementReady||speedDraft!==null)?'измеряем…':number(actual)+' ч/мин';
  let status='following',message='Сервер выдерживает заданную скорость.';
  if(!s.running){status='paused';message='Расчёт на паузе.';}
  else if(speedDraft!==null){status='sending';message='Отправляем новое значение на сервер…';}
  else if(!s.speedMeasurementReady){status='measuring';message='Измеряем скорость после изменения цели…';}
  else if(target<60){status='slow';message='Один модельный час примерно каждые '+number(60/target)+' секунд реального времени.';}
  else if(actual===0){status='measuring';message='Ожидаем завершённые шаги расчёта…';}
  else if(actual<target-tolerance){status='limited';message='Сервер не успевает за целью: достигнут предел расчёта для текущего мира. Чтобы замедлить мир, задайте значение ниже фактической скорости.';}
  else if(actual>target+tolerance){status='measuring';message='Уточняем фактическую скорость…';}
  $('speedLimit').dataset.state=status;$('speedLimit').textContent=message;
}
async function poll(force=false){
  // После команды нужен новый запрос: уже начатый мог получить прежнюю цель.
  while(polling){if(!force)return;await polling;}
  if(document.hidden&&!force)return;
  polling=(async()=>{
    try{update(await api('/api/state'));return true;}
    catch(error){connectionError=true;$('dot').classList.remove('online');$('connection').textContent='Связь прервана. Переподключаемся…';$('error').textContent=error.message;return false;}
    finally{polling=null;}
  })();
  return polling;
}
function text(tag,value,parent,cls){const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;parent.appendChild(node);return node;}
function table(rows,parent){const t=document.createElement('table');for(const row of rows){const tr=document.createElement('tr');for(const value of row)text('td',value,tr);t.appendChild(tr);}parent.appendChild(t);}
function updateDashboard(s){
  const full=$('fullStats');full.replaceChildren();
  table([...Object.entries(statLabels).map(([id,label])=>[label,s.readouts?.[id]??'—']),['Половых организмов',number(s.sexualLines)]],full);
  for(const [id,key]of [['trophic','trioLegend'],['traits','sTraits'],['lifeTraits','sTraits2'],['growthStats','sOpen']])$(id).textContent=s.readouts?.[key]||'—';
  $('eventLog').replaceChildren();for(const event of s.events||[])text('p',event.text,$('eventLog'),'hint');
}
async function loadCatalog(mode){
  catalogLoading=true;
  try{
    catalog=await api('/api/catalog');catalogMode=mode;
    const chosen=$('preset').value;$('preset').replaceChildren(new Option('— выбрать —',''));
    for(const p of catalog.presets)$('preset').add(new Option(p.title,p.id));$('preset').value=chosen;
    const ref=$('geneReference');ref.replaceChildren();
    for(const gene of catalog.genes){
      const d=document.createElement('details');text('summary',gene.label+' · '+gene.min+'…'+gene.max+(gene.unused?' · в этой модели не используется':''),d);
      text('p',gene.description,d,'hint');ref.appendChild(d);
    }
    updateScaleNotes(frame);
  }catch(error){$('error').textContent=error.message;}
  finally{catalogLoading=false;}
}
function updateScaleNotes(s){
  if(!s)return;
  const legacy=!s.params.openDiet&&!s.params.programBodies&&s.params.packageStrength===1;
  const meaning={light:'Общий множитель поступающего света.',mutation:'Сила наследуемых изменений: 0% выключает мутации, 100% задаёт максимальную силу.',decomp:'Скорость разложения органики и её доступности сапротрофам.',parasites:'Общий множитель вреда от паразитов; признаки штаммов эволюционируют отдельно.'};
  for(const key of Object.keys(meaning)){
    const zone=catalog?.scales[key]?.zones.find(z=>s.params[key]>=z[0]&&s.params[key]<=z[1]);
    $(key+'Note').textContent=meaning[key]+(legacy&&zone?' Прежняя калибровка: '+zone[3]+' — '+zone[4]+'.':'');
    $(key+'Note').dataset.zone=legacy&&zone?zone[2]:'';
  }
}
const geneNames={photo:'Фотосинтез',herb:'Растительная пища',aggression:'Животная пища',sapro:'Падаль',armor:'Защита',moveSpeed:'Скорость движения',lifespan:'Срок жизни',broodSize:'Размер выводка',cycleHours:'Период размножения',thresh:'Энергетический порог',effic:'Усвоение пищи',metab:'Обмен веществ',costFrac:'Вклад в потомка',dormancy:'Глубина покоя',sexual:'Половое размножение',dioecy:'Раздельнополость',shapeA:'Глубина роста',shapeB:'Параметр прежней формы',shapeType:'Прежняя форма',minN:'Минимум соседей',maxN:'Максимум соседей',seedProv:'Вклад в зачаток',dispersal:'Расселение',myco:'Грибная пища'};
async function inspect(url){
  try{
    const b=await api(url),content=$('bodyContent');content.replaceChildren();
    if(!b){$('bodyHint').textContent='Здесь сейчас нет живого организма.';$('refreshBody').hidden=true;selected=null;return;}
    selected=b.id;$('refreshBody').hidden=false;$('bodyHint').textContent='Организм #'+b.id+' · линия #'+b.lineage+'. Данные на момент запроса.';
    table([['Возраст',number(b.age)+' из '+number(b.genome.lifespan)+' ч'],['Тело',b.cells.length+' из '+b.planned+' клеток плана'],['Внутренних / барьерных клеток',b.interior+' / '+(b.cells.length-b.interior)],['Энергия',number(b.energy)],['Вложено в структуру',number(b.structuralEnergy)],['Основное питание',names[b.guild]],['Пол',b.sex==='m'?'мужской':b.sex==='f'?'женский':'гермафродит'],['Паразиты',b.infected?'есть':'нет']],content);
    const total=Object.values(b.intake).reduce((a,v)=>a+v,0);
    text('p','Гетерозиготность: '+number(b.heterozygosity*100)+'%'+(b.infected?' · свирепость штамма '+number(b.virulence):''),content,'hint');
    text('h3','Полученная энергия за жизнь',content);
    table(Object.entries(names).map(([k,name])=>[name,number(b.intake[k]||0)+(total?' · '+number((b.intake[k]||0)/total*100)+'%':'')]),content);
    text('h3','Правила роста',content);
    for(const [i,r]of (b.genome.program||[]).entries())text('p',(i+1)+'. Поворот '+r.turn*90+'°; делений '+r.run+'; ветви '+(r.branch===3?'в обе стороны':r.branch===1?'влево':r.branch===2?'вправо':'нет')+'; '+roles[r.role]+' клетка; соединение '+(r.join?'разрешено':'выключено')+'.',content,'hint');
    text('h3','Все признаки и оба набора генов',content);
    for(const gene of b.genes){
      const d=document.createElement('details');text('summary',gene.label+': '+number(b.genome[gene.key])+(gene.active?'':' · не действует'),d);
      const progress=document.createElement('progress');progress.max=gene.max-gene.min;progress.value=Math.max(0,Math.min(progress.max,b.genome[gene.key]-gene.min));d.appendChild(progress);
      table([['Диапазон',gene.min+'…'+gene.max],['Набор A',number(b.alleles.A[gene.key])],['Набор B',number(b.alleles.B[gene.key])]],d);
      text('p',gene.description,d,'hint');content.appendChild(d);
    }
    text('h3','Свободные гены',content);
    const mods=new Map();
    for(const set of ['A','B'])for(const mod of b.alleles[set].mods||[]){const item=mods.get(mod.id)||{mod,sets:[]};item.sets.push(set);mods.set(mod.id,item);}
    if(!mods.size)text('p','Свободных генов нет: ещё не возникли или утрачены.',content,'hint');
    text('p','Сдвиги свободных генов указаны в процентах диапазона признака с учётом числа копий.',content,'hint');
    for(const {mod,sets}of mods.values())text('p','№'+mod.id+' · наборы '+sets.join('/')+' · '+mod.t.map((key,i)=>(b.genes.find(g=>g.key===key)?.label||geneNames[key]||key)+': '+(mod.w[i]>=0?'+':'')+number(mod.w[i]*b.modScale*100*sets.length/2)+'%').join(', '),content,'hint');
    draw(frame);
  }catch(error){$('error').textContent=error.message;}
}
$('dish').addEventListener('click',event=>{
  if(!frame)return;const box=event.currentTarget.getBoundingClientRect();
  const x=Math.min(frame.cols-1,Math.floor((event.clientX-box.left)/box.width*frame.cols));
  const y=Math.min(frame.rows-1,Math.floor((event.clientY-box.top)/box.height*frame.rows));
  inspect('/api/cell?id='+(y*frame.cols+x));
});
$('refreshBody').addEventListener('click',()=>inspect('/api/body?id='+selected));
$('toggle').addEventListener('click',()=>frame&&command({type:'running',value:!frame.running}));
async function sendSpeed(){
  clearTimeout(speedTimer);
  if(speedSending||speedDraft===null)return;
  speedSending=true;const value=speedDraft;
  if(frame)updateSpeedStatus(frame);
  const ok=await command({type:'params',values:{hoursPerMinute:value}});
  speedSending=false;
  if(speedDraft===value){speedDraft=null;if(ok&&frame)update(frame);}
  else speedTimer=setTimeout(sendSpeed,350);
  if(!ok&&speedDraft===null){
    $('speedActual').textContent='—';$('speedLimit').dataset.state='unconfirmed';
    $('speedLimit').textContent='Не удалось получить подтверждение скорости. Ожидаем свежие данные сервера…';
  }
}
$('speedSlider').addEventListener('input',event=>{
  speedDraft=speedFromSlider(Number(event.target.value));$('speed').value=speedDraft;
  $('speedValue').textContent=number(speedDraft)+' ч/мин';clearTimeout(speedTimer);speedTimer=setTimeout(sendSpeed,350);
});
$('speedSlider').addEventListener('change',sendSpeed);
$('speed').addEventListener('change',event=>{
  speedDraft=Number(event.target.value);$('speedSlider').value=sliderFromSpeed(Math.max(1,speedDraft));sendSpeed();
});
for(const input of document.querySelectorAll('[data-param]')){
  input.addEventListener('input',()=>$(input.id+'Value').textContent=input.id==='mutation'?number(input.value*100)+'%':number(input.value));
  input.addEventListener('change',()=>command({type:'params',values:{[input.dataset.param]:Number(input.value)}}));
}
for(const input of document.querySelectorAll('[data-switch]'))input.addEventListener('change',()=>command({type:'params',values:{[input.dataset.switch]:input.checked}}));
$('assistance').addEventListener('input',event=>$('assistanceValue').textContent=number(event.target.value)+'%');
$('assistance').addEventListener('change',event=>command({type:'params',values:{packageStrength:Number(event.target.value)/100}}));
$('taper').addEventListener('click',()=>command({type:'taper'}));
$('save').addEventListener('click',()=>command({type:'save'}));
function askReset(action,title){
  pendingReset=action;$('resetTitle').textContent=title;
  $('resetDescription').textContent='Текущий общий мир будет заменён после подтверждения. Сервер предварительно сохранит отдельную копию.';
  $('startSummary').textContent='Основателей: '+$('founders').value+' · начальное число: '+$('seed').value;
  $('resetError').textContent='';$('resetDialog').showModal();
}
$('preset').addEventListener('change',()=>{
  const p=catalog?.presets.find(p=>p.id===$('preset').value);$('applyPreset').disabled=!p;
  $('notePreset').textContent=p?p.note:'Свой набор настроек — двигайте ползунки ниже.';
});
$('applyPreset').addEventListener('click',()=>askReset({type:'preset',id:$('preset').value},'Применить «'+catalog.presets.find(p=>p.id===$('preset').value).title+'»?'));
$('modelMode').addEventListener('change',()=>{
  const open=$('modelMode').value==='open';askReset({type:'rules',openDiet:open,programBodies:open,packageStrength:open?0:1},'Сменить модель и начать новый мир?');
});
for(const key of ['openDiet','programBodies'])$(key).addEventListener('change',()=>askReset({type:'rules',openDiet:$('openDiet').checked,programBodies:$('programBodies').checked,packageStrength:frame.params.packageStrength},'Сменить правила и начать новый мир?'));
$('seedMore').addEventListener('click',()=>command({type:'seed'}));
$('reset').addEventListener('click',()=>askReset({type:'reset'},'Начать новый мир?'));
$('cancelReset').addEventListener('click',()=>{$('resetDialog').close();if(frame)update(frame);});
$('resetDialog').addEventListener('cancel',()=>setTimeout(()=>frame&&update(frame),0));
$('confirmReset').addEventListener('click',async()=>{
  const founders=Number($('founders').value),seed=Number($('seed').value);
  if(!Number.isInteger(founders)||founders<1||founders>200||!Number.isInteger(seed)||seed<0||seed>4294967295){$('resetError').textContent='Проверьте число организмов и начальное число.';return;}
  if(await command({...pendingReset,founders,seed})){selected=null;$('bodyContent').replaceChildren();$('bodyHint').textContent='Выберите организм в чашке.';$('resetDialog').close();if(frame)update(frame);}
});
$('logout').addEventListener('click',async()=>{await api('/api/logout',{});location.replace('/');});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll(true);});
window.evoRemote={get frame(){return frame;},get draws(){return drawCount;}};
setInterval(poll,500);poll();
