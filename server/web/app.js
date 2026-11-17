'use strict';
const $=id=>document.getElementById(id),number=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2});
const names={photo:'свет',herb:'растительная пища',pred:'животная пища',sapro:'падаль'};
const roles=['обычная','синтезирующая','пищеварительная','защитная'];
const colors=['#52c57f','#dcc15d','#e77586','#b094e5'];
const ctx=$('dish').getContext('2d'),chart=$('chart').getContext('2d');
let frame=null,owners=null,selected=null,polling=false,drawCount=0,connectionError=false;
async function api(url,data){
  const response=await fetch(url,{cache:'no-store',...(data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});
  if(response.status===401){location.replace('/');throw Error('Нужен повторный вход');}
  const result=await response.json();if(!response.ok)throw Error(result.error||'Сервер временно недоступен');return result;
}
async function command(data){
  $('error').textContent='';
  try{await api('/api/command',data);await poll(true);return true;}
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
    $(key+'Value').textContent=number(Number($(key).value));
  }
  for(const key of ['dayNight','predation','sexReprod'])if(document.activeElement!==$(key))$(key).checked=s.params[key];
  if(document.activeElement!==$('speed')){
    if(![...$('speed').options].some(o=>Number(o.value)===s.params.hoursPerMinute))$('speed').add(new Option(number(s.params.hoursPerMinute),s.params.hoursPerMinute));
    $('speed').value=s.params.hoursPerMinute;
  }
  if(document.activeElement!==$('assistance'))$('assistance').value=s.params.packageStrength*100;
  $('assistanceValue').textContent=number(s.params.packageStrength*100)+'%';
  $('taper').disabled=s.params.packageStrength<=0||!!s.params.assistanceRamp;
  $('ramp').textContent=s.params.assistanceRamp?'Идёт плавное снижение; осталось '+number(Math.max(0,s.params.assistanceRamp.duration-s.hours+s.params.assistanceRamp.start))+' часов мира.':'';
  $('version').textContent='Версия '+s.modelVersion+' · последний кадр '+new Date(s.serverTime).toLocaleTimeString('ru-RU');
}
async function poll(force=false){
  if(polling||document.hidden&&!force)return;polling=true;
  try{update(await api('/api/state'));}
  catch(error){connectionError=true;$('dot').classList.remove('online');$('connection').textContent='Связь прервана. Переподключаемся…';$('error').textContent=error.message;}
  finally{polling=false;}
}
function text(tag,value,parent,cls){const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;parent.appendChild(node);return node;}
function table(rows,parent){const t=document.createElement('table');for(const row of rows){const tr=document.createElement('tr');for(const value of row)text('td',value,tr);t.appendChild(tr);}parent.appendChild(t);}
const geneNames={photo:'Фотосинтез',herb:'Растительная пища',aggression:'Животная пища',sapro:'Падаль',armor:'Защита',moveSpeed:'Скорость движения',lifespan:'Срок жизни',broodSize:'Размер выводка',cycleHours:'Период размножения',thresh:'Энергетический порог',effic:'Усвоение пищи',metab:'Обмен веществ',costFrac:'Вклад в потомка',dormancy:'Глубина покоя',sexual:'Половое размножение',dioecy:'Раздельнополость',shapeA:'Глубина роста',shapeB:'Параметр прежней формы',shapeType:'Прежняя форма',minN:'Минимум соседей',maxN:'Максимум соседей',seedProv:'Вклад в зачаток',dispersal:'Расселение',myco:'Грибная пища'};
async function inspect(url){
  try{
    const b=await api(url),content=$('bodyContent');content.replaceChildren();
    if(!b){$('bodyHint').textContent='Здесь сейчас нет живого организма.';$('refreshBody').hidden=true;selected=null;return;}
    selected=b.id;$('refreshBody').hidden=false;$('bodyHint').textContent='Организм #'+b.id+' · линия #'+b.lineage+'. Данные на момент запроса.';
    table([['Возраст',number(b.age)+' ч'],['Тело',b.cells.length+' из '+b.planned+' клеток плана'],['Энергия',number(b.energy)],['Основное питание',names[b.guild]],['Пол',b.sex==='m'?'мужской':b.sex==='f'?'женский':'оба'],['Паразиты',b.infected?'есть':'нет']],content);
    const total=Object.values(b.intake).reduce((a,v)=>a+v,0);
    text('h3','Полученная энергия за жизнь',content);
    table(Object.entries(names).map(([k,name])=>[name,number(b.intake[k]||0)+(total?' · '+number((b.intake[k]||0)/total*100)+'%':'')]),content);
    text('h3','Правила роста',content);
    for(const [i,r]of (b.genome.program||[]).entries())text('p',(i+1)+'. Поворот '+r.turn*90+'°; делений '+r.run+'; ветви '+(r.branch===3?'в обе стороны':r.branch===1?'влево':r.branch===2?'вправо':'нет')+'; '+roles[r.role]+' клетка; соединение '+(r.join?'разрешено':'выключено')+'.',content,'hint');
    const details=document.createElement('details');text('summary','Все числовые признаки',details);
    table(Object.entries(b.genome).filter(([k,v])=>typeof v==='number'&&!k.startsWith('__')).map(([k,v])=>[geneNames[k]||k,number(v)]),details);content.appendChild(details);
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
$('speed').addEventListener('change',event=>command({type:'params',values:{hoursPerMinute:Number(event.target.value)}}));
for(const input of document.querySelectorAll('[data-param]')){
  input.addEventListener('input',()=>$(input.id+'Value').textContent=number(input.value));
  input.addEventListener('change',()=>command({type:'params',values:{[input.dataset.param]:Number(input.value)}}));
}
for(const input of document.querySelectorAll('[data-switch]'))input.addEventListener('change',()=>command({type:'params',values:{[input.dataset.switch]:input.checked}}));
$('assistance').addEventListener('input',event=>$('assistanceValue').textContent=number(event.target.value)+'%');
$('assistance').addEventListener('change',event=>command({type:'params',values:{packageStrength:Number(event.target.value)/100}}));
$('taper').addEventListener('click',()=>command({type:'taper'}));
$('save').addEventListener('click',()=>command({type:'save'}));
$('reset').addEventListener('click',()=>$('resetDialog').showModal());
$('cancelReset').addEventListener('click',()=>$('resetDialog').close());
$('confirmReset').addEventListener('click',async()=>{
  const founders=Number($('founders').value),seed=Number($('seed').value);
  if(!Number.isInteger(founders)||founders<1||founders>200||!Number.isInteger(seed)||seed<0||seed>4294967295){$('resetError').textContent='Проверьте число организмов и начальное число.';return;}
  if(await command({type:'reset',founders,seed})){selected=null;$('bodyContent').replaceChildren();$('bodyHint').textContent='Выберите организм в чашке.';$('resetDialog').close();}
});
$('logout').addEventListener('click',async()=>{await api('/api/logout',{});location.replace('/');});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll(true);});
window.evoRemote={get frame(){return frame;},get draws(){return drawCount;}};
setInterval(poll,500);poll();
