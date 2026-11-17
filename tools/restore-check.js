'use strict';
const {createModel}=require('../server/model');
const {encode,decode}=require('../server/checkpoint');
const chunks=[];process.stdin.on('data',s=>chunks.push(s));
process.stdin.on('end',()=>{const m=createModel(999);m.model.restore(decode(Buffer.concat(chunks)));for(let h=0;h<180;h++)m.model.step();process.stdout.write(encode(m.model.save()));});
