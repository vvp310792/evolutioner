'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const target = path.join(root,'index.html');
const source = fs.readFileSync(path.join(root,'src/open-evolution.js'),'utf8').trim();
const start='<!-- OPEN-EVOLUTION:BEGIN -->', end='<!-- OPEN-EVOLUTION:END -->';
const block=start+'\n<script>\n'+source+'\n</script>\n'+end;
const html=fs.readFileSync(target,'utf8');
let built;
if(html.includes(start)) built=html.slice(0,html.indexOf(start))+block+html.slice(html.indexOf(end)+end.length);
else built=html.replace('<script>\n(function(){',block+'\n<script>\n(function(){');
if(!built.includes(block)) throw new Error('Не найдена точка встраивания');
if(process.argv.includes('--check')) {
  if(html!==built) throw new Error('Встроенная модель отличается от src/open-evolution.js: запустите node tools/build.js');
} else fs.writeFileSync(target,built);
