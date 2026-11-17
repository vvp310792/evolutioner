'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
function createAuth(password){
  const salt=crypto.randomBytes(16).toString('hex');
  return {salt,hash:crypto.scryptSync(password,salt,32).toString('hex'),sessionKey:crypto.randomBytes(32).toString('hex')};
}
function loadAuth(file){
  const auth=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!/^[a-f0-9]{32}$/.test(auth.salt)||!/^[a-f0-9]{64}$/.test(auth.hash)||!/^[a-f0-9]{64}$/.test(auth.sessionKey))throw Error('Неверная конфигурация доступа');
  return auth;
}
function matches(password,auth){
  return typeof password==='string'&&password.length<=200&&crypto.timingSafeEqual(crypto.scryptSync(password,auth.salt,32),Buffer.from(auth.hash,'hex'));
}
function sign(payload,auth){return crypto.createHmac('sha256',auth.sessionKey).update(payload).digest('base64url');}
function issue(auth){
  const payload=(Date.now()+30*86400000)+'.'+crypto.randomBytes(12).toString('hex');
  return payload+'.'+sign(payload,auth);
}
function valid(cookie,auth){
  const token=(cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('evo_session='))?.slice(12);
  if(!token || token.length>200)return false;
  const fields=token.split('.');
  if(fields.length!==3||!/^[0-9]+$/.test(fields[0])||Number(fields[0])<Date.now())return false;
  const expected=sign(fields[0]+'.'+fields[1],auth),actual=fields[2];
  return expected.length===actual.length&&crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(actual));
}
if(require.main===module){
  let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);
  process.stdin.on('end',()=>{
    const file=process.argv[2];if(!file||input.length<1)throw Error('Нужны путь и пароль в stdin');
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
    fs.writeFileSync(file,JSON.stringify(createAuth(input)),{mode:0o600,flag:'wx'});
    console.log('Конфигурация доступа создана');
  });
}
module.exports={createAuth,loadAuth,matches,issue,valid};
