'use strict';
const crypto=require('node:crypto');
module.exports=function digest(saved){
  return crypto.createHash('sha256').update(JSON.stringify(saved,(key,value)=>{
    // План и roleMap — кэши генома; порядок свойств не меняет состояние мира.
    if(key==='tpl'||key==='roleMap')return undefined;
    if(ArrayBuffer.isView(value))return Array.from(value);
    if(value&&typeof value==='object'&&!Array.isArray(value))return Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]]));
    return value;
  })).digest('hex');
};
