'use strict';
const fs=require('node:fs');
const path=require('node:path');
const version=require('../server/version');
const digest=require('../server/state-digest');
const {readCheckpoint,writeAtomic}=require('../server/checkpoint');
const [oldRoot,newRoot,file]=process.argv.slice(2);
if(!oldRoot||!newRoot||!file)throw Error('Нужны прежний каталог, новый каталог и файл остановленного мира');
const oldHash=version(oldRoot),newHash=version(newRoot),saved=readCheckpoint(file,oldHash);
if(!saved)throw Error('Нет сохранения для переноса');
const oldModel=require(path.join(path.resolve(oldRoot),'server/model.js')).createModel().model;
const newModel=require(path.join(path.resolve(newRoot),'server/model.js')).createModel().model;
oldModel.restore(saved.model);newModel.restore(saved.model);
for(let i=0;i<30;i++){oldModel.step();newModel.step();}
if(digest(oldModel.save())!==digest(newModel.save()))throw Error('Продолжение мира различается; перенос отменён');
const backup=file+'.before-runtime-'+Date.now();fs.copyFileSync(file,backup);
const migrated={...saved,modelHash:newHash,migratedAt:new Date().toISOString(),migratedFrom:oldHash};
writeAtomic(file,migrated);writeAtomic(file,migrated);
console.log(JSON.stringify({migrated:true,hours:saved.model.world.hours,oldHash,newHash,continuationHash:digest(newModel.save())}));
