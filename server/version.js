'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
module.exports=function version(root){
  const hash=crypto.createHash('sha256');
  for(const file of ['index.html','server/model.js','tools/browser-model.js'])hash.update(fs.readFileSync(path.join(root,file)));
  return hash.digest('hex');
};
