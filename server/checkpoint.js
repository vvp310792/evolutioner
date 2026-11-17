'use strict';
const fs=require('node:fs');
const path=require('node:path');
const v8=require('node:v8');
const zlib=require('node:zlib');

function encode(data){return zlib.gzipSync(v8.serialize(data));}
function decode(bytes){return v8.deserialize(zlib.gunzipSync(bytes,{maxOutputLength:256*1024*1024}));}
function writeAtomic(file,data){
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const temp=file+'.tmp';
  const fd=fs.openSync(temp,'w',0o600);
  try{fs.writeFileSync(fd,encode(data));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  if(fs.existsSync(file))fs.copyFileSync(file,file+'.previous');
  fs.renameSync(temp,file);
  if(process.platform!=='win32'){
    const directory=fs.openSync(path.dirname(file),'r');
    try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  }
}
function readCheckpoint(file,modelHash){
  if(!fs.existsSync(file)&&!fs.existsSync(file+'.previous'))return null;
  let data,recovered=false;
  try{data=decode(fs.readFileSync(file));}catch(error){
    // Повреждённый последний файл не должен незаметно начинать другой мир.
    if(!fs.existsSync(file+'.previous'))throw error;
    data=decode(fs.readFileSync(file+'.previous'));
    recovered=true;
    console.error('Последнее сохранение повреждено; загружена предыдущая копия');
  }
  if(data.version!==1||data.modelHash!==modelHash)throw Error('Версия модели отличается от сохранения; требуется явная миграция');
  if(recovered){
    // Следующая запись не должна заменить хорошую резервную копию повреждённым файлом.
    if(fs.existsSync(file))fs.renameSync(file,file+'.corrupt');
    fs.copyFileSync(file+'.previous',file);
  }
  return data;
}
module.exports={encode,decode,writeAtomic,readCheckpoint};
