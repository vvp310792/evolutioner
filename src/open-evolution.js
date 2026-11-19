(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenEvolution = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const clip = (v, a, b) => Math.max(a, Math.min(b, v));
  const keys = ['photo', 'herb', 'pred', 'sapro'];
  const directions = [[1,0],[0,1],[-1,0],[0,-1]];
  // Ограничено исполнение программы, а не количество наследуемых локусов.
  const MAX_CELLS = 256, MAX_OPERATIONS = 1024;
  let nextRule = 1, cache = new WeakMap();
  const clone = rules => (rules || []).map(r => ({...r}));
  const founderProgram = () => [{id:0, turn:0, run:0, branch:0, role:0, join:false}];
  function reset() { nextRule = 1; cache = new WeakMap(); }
  function saveState() { return {nextRule}; }
  function restoreState(s) { nextRule = s.nextRule; cache = new WeakMap(); }
  function mutateProgram(rules, mutation) {
    const out = clone(rules || founderProgram());
    for (const rule of out) {
      if (Math.random() < mutation * 0.3) rule.turn = (rule.turn + (Math.random()<0.5?1:3)) % 4;
      if (Math.random() < mutation * 0.5) rule.run = clip(rule.run + (Math.random()<0.5?-1:1), 0, 4);
      if (Math.random() < mutation * 0.25) rule.branch ^= 1 << (Math.random()*2|0);
      if (Math.random() < mutation * 0.2) rule.role = Math.random()*4|0;
      if (Math.random() < mutation * 0.15) rule.join = !rule.join;
    }
    if (Math.random() < mutation * 0.15 && out.length > 1) out.splice(Math.random()*out.length|0, 1);
    if (Math.random() < mutation * 0.2) {
      const source = out[Math.random()*out.length|0] || founderProgram()[0];
      out.splice(Math.random()*(out.length+1)|0, 0, {...source, id:nextRule++});
    }
    if (Math.random() < mutation * 0.1) out.push({id:nextRule++, turn:Math.random()*4|0, run:Math.random()*3|0, branch:0,role:Math.random()*4|0,join:Math.random()<0.5});
    return out;
  }
  function expressProgram(a, b) {
    // Гомологичные правила совмещаются по локусу; у категорий доминирует набор A.
    const rules = new Map();
    for (const r of a || founderProgram()) rules.set(r.id, {...r});
    for (const r of b || founderProgram()) {
      const q = rules.get(r.id);
      if (q) q.run = Math.round((q.run+r.run)/2);
      else rules.set(r.id, {...r});
    }
    return [...rules.values()];
  }
  function programGamete(a, b) {
    const rules = new Map((b || founderProgram()).map(r => [r.id,r]));
    const out = [];
    for (const r of a || founderProgram()) {
      const q = rules.get(r.id);
      if (q) { out.push({...((Math.random()<0.5)?r:q)}); rules.delete(r.id); }
      else if (Math.random()<0.5) out.push({...r});
    }
    for (const r of rules.values()) if (Math.random()<0.5) out.push({...r});
    return out;
  }
  function develop(g) {
    if (cache.has(g)) return cache.get(g);
    const rules = g.program || founderProgram();
    const cells = [[0,0]], roles=[rules[0]?.role||0], occupied = new Map([['0,0',0]]);
    const queue = [{x:0,y:0,heading:0,rule:0,depth:0}];
    const depth = clip(Math.round(g.shapeA || 1),1,30);
    for (let i=0; i<queue.length && i<MAX_OPERATIONS && cells.length<MAX_CELLS; i++) {
      const task = queue[i];
      if (task.depth>=depth || !rules.length) continue;
      const r = rules[task.rule % rules.length];
      const heading = (task.heading+r.turn)%4;
      let {x,y} = task;
      let stopped=false;
      for (let j=0;j<r.run && cells.length<MAX_CELLS;j++) {
        x += directions[heading][0]; y += directions[heading][1];
        const key = x+','+y;
        if (!occupied.has(key)) { occupied.set(key,cells.length); cells.push([x,y]);roles.push(r.role||0); }
        else if(r.join) roles[occupied.get(key)]=r.role||0;
        else {stopped=true;break;}
      }
      if(stopped) continue;
      if (queue.length<MAX_OPERATIONS) queue.push({x,y,heading,rule:task.rule+1,depth:task.depth+1});
      for (let side=0;side<2;side++) if (r.branch & (1<<side)) {
        if (queue.length<MAX_OPERATIONS) queue.push({x,y,heading:(heading+(side?3:1))%4,rule:task.rule+1,depth:task.depth+1});
      }
    }
    const minX = Math.min(...cells.map(c=>c[0])), minY = Math.min(...cells.map(c=>c[1]));
    const plan = cells.map(([x,y])=>[x-minX,y-minY]);
    plan.roles=roles;
    cache.set(g, plan);
    return plan;
  }
  const ROLE_NAMES=['общая','синтезирующая','пищеварительная','защитная'];
  const ROLE_EFFECTS=[{synth:1,feed:1,armor:1,cost:0},
    {synth:1.35,feed:0.65,armor:0.75,cost:0.03},
    {synth:0.65,feed:1.35,armor:0.75,cost:0.03},
    {synth:0.65,feed:0.65,armor:1.5,cost:0.03}];
  function roleAt(body,cell,cols) {
    if(!body.tpl?.roles) return 0;
    if(!body.roleMap) body.roleMap=new Map(body.tpl.map(([x,y],i)=>[x+y*cols,body.tpl.roles[i]]));
    return body.roleMap.get(cell-body.ox-body.oy*cols)||0;
  }
  function cellEffects(body,cell,cols) {return ROLE_EFFECTS[roleAt(body,cell,cols)];}
  function specializationCost(body,cols) {return body.cells.reduce((n,c)=>n+cellEffects(body,c,cols).cost,0);}
  function capability(g, victim, predation=true) {
    const total = victim.photo+victim.herb+victim.aggression+victim.sapro || 1;
    const plant = victim.photo/total, fungal = victim.sapro/total;
    const animal = (victim.herb+victim.aggression)/total;
    const herb = g.herb*plant + g.myco*fungal;
    const pred = predation ? g.aggression*animal : 0;
    return {herb, pred, value:herb+pred};
  }
  function intake(body, channel, energy) {
    if (!body.intake) body.intake = {photo:0,herb:0,pred:0,sapro:0};
    body.intake[channel] += Math.max(0,energy);
  }
  function observedGuild(body) {
    if (!body.intake || !keys.some(k=>body.intake[k]>0)) return body.guild;
    return keys.reduce((a,b)=>body.intake[a]>=body.intake[b]?a:b);
  }
  function metrics(bodies) {
    let mixed=0, programSum=0, programMax=0, specializedPlans=0;
    const energy = {photo:0,herb:0,pred:0,sapro:0};
    for (const b of bodies.values()) {
      const n=(b.g.program || []).length; programSum+=n; programMax=Math.max(programMax,n);
      if(b.tpl?.roles?.some(r=>r>0)) specializedPlans++;
      const values=keys.map(k=>(b.intake || {})[k] || 0), total=values.reduce((a,b)=>a+b,0);
      if (values.filter(v=>v>total*0.05 && v>0).length>1) mixed++;
      keys.forEach((k,i)=>energy[k]+=values[i]);
    }
    return {mixed, programAvg:bodies.size?programSum/bodies.size:0, programMax, specializedPlans, intake:energy};
  }
  let seenMark=null, seenStamp=0, tgtCell=new Int32Array(256), tgtValue=new Float64Array(256), tgtHerb=new Float64Array(256);
  function feed(body, w) {
    const g=body.g, size=body.cells.length;
    const nb=w.neighbors, state=w.state, owner=w.owner, id=body.id, bodyAt=w.bodyAt;
    // Метка вместо Set и типизированные массивы вместо объектов на каждую клетку:
    // порядок целей и сумм тот же, поэтому розыгрыш даёт те же случайные числа.
    if(!seenMark||seenMark.length<state.length) seenMark=new Int32Array(state.length);
    if(++seenStamp>2e9){seenMark.fill(0);seenStamp=1;}
    if(tgtCell.length<w.border.length*nb.k){const n=w.border.length*nb.k*2;tgtCell=new Int32Array(n);tgtValue=new Float64Array(n);tgtHerb=new Float64Array(n);}
    let count=0, total=0, lastOwner=-1, lastCap=null;
    for (const cell of w.border) for (let j=0,c=nb.cnt[cell],base=cell*nb.k;j<c;j++) {
      const t=nb.tab[base+j];
      if (seenMark[t]===seenStamp) continue;
      seenMark[t]=seenStamp;
      const st=state[t];
      if (st===2 && g.sapro>0) {tgtCell[count]=t;tgtValue[count]=g.sapro;tgtHerb[count]=-1;count++;total+=g.sapro;}
      else if (st===1 && owner[t]!==id) {
        const o=owner[t];
        // Соседние клетки цели обычно принадлежат одному телу: способность считается раз на тело.
        if(o!==lastOwner){lastOwner=o;const victim=bodyAt?bodyAt[t]:w.bodies.get(o);lastCap=victim?capability(g,victim.g,w.params.predation):null;}
        if(lastCap && lastCap.value>0){tgtCell[count]=t;tgtValue[count]=lastCap.value;tgtHerb[count]=lastCap.herb;count++;total+=lastCap.value;}
      }
    }
    let gained=0, events=0;
    if (total>0) {
      let draw=Math.random()*total, k=count-1;
      for (let j=0;j<count;j++) { draw-=tgtValue[j]; if(draw<=0){k=j;break;} }
      const target={t:tgtCell[k],value:tgtValue[k],herb:tgtHerb[k],dead:tgtHerb[k]<0};
      const feeding=w.border.reduce((n,c)=>n+cellEffects(body,c,w.cols).feed,0)/Math.max(1,w.border.length);
      const bites=Math.min(w.border.length,6)*feeding, processing=body.tpl?.roles?1:1+0.35*w.interior;
      // Скорость обмена повышает пропускную способность; доля усвоения остаётся < 1.
      if (target.dead) {
        const drain=Math.min(w.corpseFood[target.t],g.sapro*(g.decomp ?? w.params.decomp)*9*Math.sqrt(size)*bites*w.pace);
        w.corpseFood[target.t]=Math.max(0,w.corpseFood[target.t]-drain);
        gained=drain*Math.min(0.9,0.8*g.effic*processing);
        intake(body,'sapro',gained);
        if(w.corpseFood[target.t]<=0.001){w.state[target.t]=0;w.corpseFood[target.t]=0;}
        if(gained>0) events++;
      } else {
        const victim=bodyAt?bodyAt[target.t]:w.bodies.get(w.owner[target.t]);
        if(victim) {
          const power=(body.energy/size)*(0.6+g.aggression*1.15);
          const defense=(victim.energy/victim.cells.length)*(0.5+(victim.g.armor+0.45)*cellEffects(victim,target.t,w.cols).armor);
          const access=power/(power+Math.max(0,defense)+1e-9);
          const drain=Math.min(Math.max(0,victim.energy),target.value*2.4*Math.sqrt(size)*bites*w.pace*access);
          victim.energy-=drain;
          const herbPart=target.herb/target.value;
          gained=drain*Math.min(0.9,(0.70*herbPart+0.88*(1-herbPart))*g.effic*processing);
          intake(body,'herb',gained*herbPart); intake(body,'pred',gained*(1-herbPart));
          if(gained>0) events++;
          if(victim.energy<=0) w.kill(victim);
        }
      }
      body.energy+=gained;
    }
    let moves=0;
    if (gained+w.income<w.upkeep && Math.random()<g.moveSpeed) {
      const origin=body.cells[0], x=origin%w.cols, y=Math.floor(origin/w.cols);
      let desired=null, best=0;
      for(const [dx,dy] of w.sense) {
        const nx=x+dx,ny=y+dy;
        if(nx<0||ny<0||nx>=w.cols||ny>=w.rows) continue;
        const t=ny*w.cols+nx;
        let score=0;
        if(w.state[t]===2) score=g.sapro*w.corpseFood[t];
        else if(w.state[t]===1 && w.owner[t]!==body.id){
          const v=bodyAt?bodyAt[t]:w.bodies.get(w.owner[t]);
          if(v) score=capability(g,v.g,w.params.predation).value*Math.max(0,v.energy/v.cells.length);
        }
        score/=(1+Math.abs(dx)+Math.abs(dy));
        if(score>best){best=score;desired=[Math.sign(dx),Math.sign(dy)];}
      }
      if(!desired){
        if(body.hx===undefined||Math.random()<0.12){const d=directions[Math.random()*4|0];body.hx=d[0];body.hy=d[1];}
        desired=[body.hx,body.hy];
      }
      const [dx,dy]=desired, cost=w.moveCost*(0.7+g.moveSpeed*0.6)*size;
      if(body.energy>cost) for(const [sx,sy] of [[dx,dy],[dx,0],[0,dy],[-dy,dx],[dy,-dx]]) {
        if((sx||sy)&&w.move(body,sx,sy)){body.energy-=cost;moves++;break;}
      }
    }
    return {gained,events,moves};
  }
  function assistance(g, strength, genes, discrete, run, A, B) {
    const s=clip(Number(strength)||0,0,1);
    g.__endow=0;
    if(s===0) return g;
    if(s===1) return run(g,A,B);
    const before={...g};
    run(g,null,null);
    for(const k of genes) {
      let delta=(g[k]-before[k])*s;
      if(discrete.includes(k)) delta=Math.round(before[k]+delta)-before[k];
      g[k]=before[k]+delta;
      if(A&&B){A[k]+=delta;B[k]+=delta;}
    }
    g.__endow*=s;
    return g;
  }
  function assistanceAt(from,elapsed,duration) {
    return clip(from,0,1)*Math.max(0,1-Math.max(0,elapsed)/Math.max(1,duration));
  }
  return {reset,saveState,restoreState,founderProgram,mutateProgram,expressProgram,programGamete,clone,develop,
    capability,intake,observedGuild,metrics,feed,assistance,assistanceAt,
    roleAt,cellEffects,specializationCost,ROLE_NAMES,MAX_CELLS,MAX_OPERATIONS};
});
