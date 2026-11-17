'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const zlib=require('node:zlib');
const {Worker}=require('node:worker_threads');
const {loadAuth,matches,issue,valid}=require('./auth');
const {validateCommand}=require('./model');
const root=path.resolve(__dirname,'..');
const modelHash=require('./version')(root);
const dataDir=process.env.EVO_DATA_DIR||path.join(root,'var');
const auth=loadAuth(process.env.EVO_AUTH_FILE||path.join(dataDir,'auth.json'));
const port=Number(process.env.PORT||8797),secure=process.env.EVO_SECURE_COOKIE!=='0';
const expectedOrigin=process.env.EVO_ORIGIN||'https://evo.valeriypolunovskiy.ru';
const worker=new Worker(path.join(__dirname,'worker.js'),{workerData:{file:path.join(dataDir,'world.evo'),modelHash}});
let cached=null,cachedZip=null,frameAt=0,workerError=null,sequence=0,shuttingDown=false;
const pending=new Map(),attempts=new Map(),commands=new Map();
function rpc(message){
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('Расчёт не ответил вовремя'));},10000);
    pending.set(id,{resolve,reject,timer});worker.postMessage({...message,id});
  });
}
worker.on('message',message=>{
  if(message.type==='frame'){
    cached=Buffer.from(JSON.stringify(message.frame));cachedZip=zlib.gzipSync(cached);frameAt=Date.now();return;
  }
  const p=pending.get(message.id);if(!p)return;
  clearTimeout(p.timer);pending.delete(message.id);
  if(message.error)p.reject(Error(message.error));else p.resolve(message.value);
});
function failed(error){
  workerError=error.message;
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();
  console.error('Исполнитель остановлен:',error.message);
  if(!shuttingDown)setTimeout(()=>process.exit(1),1000).unref();
}
worker.on('error',failed);
worker.on('exit',code=>{if(!shuttingDown)failed(Error('Код завершения исполнителя: '+code));});
const startedAt=Date.now();
setInterval(()=>{if(!shuttingDown&&!workerError&&Date.now()-(frameAt||startedAt)>30000)failed(Error('Исполнитель не публикует состояние больше 30 секунд'));},5000).unref();
function limit(map,key,max,windowMs){
  const now=Date.now(),entry=map.get(key);
  if(!entry||entry.until<now){map.set(key,{n:1,until:now+windowMs});return true;}
  return ++entry.n<=max;
}
setInterval(()=>{for(const map of [attempts,commands])for(const [key,v]of map)if(v.until<Date.now())map.delete(key);},60000).unref();
async function json(req){
  let size=0,text='';
  for await(const chunk of req){size+=chunk.length;if(size>8192)throw Error('Слишком большой запрос');text+=chunk;}
  return JSON.parse(text||'{}');
}
const staticFiles={'/':['remote.html','text/html; charset=utf-8'],'/app.js':['app.js','application/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/controls.css':['controls.css','text/css; charset=utf-8']};
const login=fs.readFileSync(path.join(__dirname,'web/login.html'));
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
  function send(code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
  try{
    const url=new URL(req.url,'http://localhost');
    const authenticated=valid(req.headers.cookie,auth);
    if(req.method==='POST'){
      if(req.headers.origin!==expectedOrigin || !String(req.headers['content-type']).startsWith('application/json'))return send(403,{error:'Запрос должен прийти с этой страницы'});
      if(url.pathname==='/api/login'){
        const ip=String(req.headers['cf-connecting-ip']||req.socket.remoteAddress);
        if(!limit(attempts,ip,5,60000)||!limit(attempts,'all',40,60000))return send(429,{error:'Слишком много попыток. Подождите минуту.'});
        if(!matches((await json(req)).password,auth))return send(401,{error:'Неверный пароль'});
        res.setHeader('Set-Cookie','evo_session='+issue(auth)+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000'+(secure?'; Secure':''));
        return send(200,{ok:true});
      }
      if(!authenticated)return send(401,{error:'Нужен пароль'});
      if(url.pathname==='/api/logout'){
        res.setHeader('Set-Cookie','evo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(secure?'; Secure':''));return send(200,{ok:true});
      }
      if(url.pathname==='/api/command'){
        if(workerError)return send(503,{error:'Расчёт остановлен'});
        if(!limit(commands,'all',40,10000))return send(429,{error:'Слишком много команд'});
        const command=validateCommand(await json(req));
        return send(200,await rpc({type:'command',command}));
      }
      return send(404,{error:'Не найдено'});
    }
    if(req.method!=='GET')return send(405,{error:'Метод не поддерживается'});
    if(url.pathname==='/health'){
      const healthy=!workerError&&cached&&Date.now()-frameAt<10000;
      return send(healthy?200:503,{ok:!!healthy,modelVersion:modelHash.slice(0,12)});
    }
    if(url.pathname==='/api/state'){
      if(!authenticated)return send(401,{error:'Нужен пароль'});
      if(workerError||!cached||Date.now()-frameAt>10000)return send(503,{error:'Расчёт временно недоступен'});
      const gzip=/\bgzip\b/.test(req.headers['accept-encoding']||'');
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8',Vary:'Accept-Encoding',...(gzip?{'Content-Encoding':'gzip'}:{})});res.end(gzip?cachedZip:cached);return;
    }
    if(url.pathname==='/api/body'||url.pathname==='/api/cell'){
      if(!authenticated)return send(401,{error:'Нужен пароль'});
      if(workerError)return send(503,{error:'Расчёт остановлен'});
      const cell=url.pathname==='/api/cell',value=Number(url.searchParams.get('id'));
      if(!Number.isInteger(value)||value<0||(cell&&value>=46*92))return send(400,{error:'Неверный номер'});
      return send(200,await rpc({type:'detail',...(cell?{cell:value}:{body:value})}));
    }
    if(url.pathname==='/api/catalog'){
      if(!authenticated)return send(401,{error:'Нужен пароль'});
      if(workerError)return send(503,{error:'Расчёт остановлен'});
      return send(200,await rpc({type:'catalog'}));
    }
    if(url.pathname==='/login.js'){
      res.writeHead(200,{'Content-Type':'application/javascript; charset=utf-8'});res.end(fs.readFileSync(path.join(__dirname,'web/login.js')));return;
    }
    if(staticFiles[url.pathname]){
      const [file,type]=staticFiles[url.pathname];res.writeHead(200,{'Content-Type':type});
      res.end(url.pathname==='/'&&!authenticated?login:fs.readFileSync(path.join(__dirname,'web',file)));return;
    }
    send(404,{error:'Не найдено'});
  }catch(error){send(400,{error:error.message});}
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(port,'127.0.0.1',()=>console.log('Эволюционер: интерфейс на локальном порту '+server.address().port));
async function stop(){
  if(shuttingDown)return;shuttingDown=true;server.close();
  try{await rpc({type:'stop'});}catch(error){console.error('Не удалось сохранить при остановке:',error.message);process.exitCode=1;}
  await worker.terminate();process.exit(process.exitCode||0);
}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
