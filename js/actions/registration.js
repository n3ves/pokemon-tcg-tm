import { DIVS, R } from '../config.js';
import { G, ct, nav, mtour, saveAll, DB, SK, SB } from '../state.js';
import { uid } from '../prng.js';
import { getStandings } from '../stats.js';
import { esc, notify, inferDiv, extractYear, tdfDateToISO } from '../utils.js';
import { render } from '../render/index.js';
import { generateSwiss } from '../swiss.js';
import { recRounds, recCut } from '../config.js';
function addFromDB(gid) {
  const t=ct(); if(!t)return;
  const gp=G.players.find(p=>p.id===gid); if(!gp)return;
  if (t.players.some(p=>p.gid===gid)) return notify('Já registrado','warn');
  t.players.push({id:uid(),gid,name:gp.name,division:gp.division,dropped:false,dq:false,hadBye:false});
  saveAll(); render();
  // Clear search
  const inp=document.getElementById('reg-q'); if(inp){inp.value='';} const r=document.getElementById('reg-res'); if(r)r.innerHTML='';
  notify(`${gp.name} adicionado`,'ok');
}

function addBulk() {
  const t=ct(); if(!t)return;
  const txt=document.getElementById('bulk-in')?.value||'';
  const div=document.getElementById('bulk-div')?.value||'Masters';
  let added=0;
  txt.split('\n').map(l=>l.trim()).filter(Boolean).forEach(name=>{
    let gp=G.players.find(p=>p.name.toLowerCase()===name.toLowerCase());
    if(!gp){gp={id:uid(),name,division:div,createdAt:Date.now(),nickname:'',playerId:'',city:'',state:'',birthDate:'',contact:'',notes:''};G.players.push(gp);}
    if(!t.players.some(p=>p.gid===gp.id)){t.players.push({id:uid(),gid:gp.id,name:gp.name,division:div,dropped:false,dq:false,hadBye:false});added++;}
  });
  saveAll(); notify(`${added} jogador${added!==1?'es':''} adicionado${added!==1?'s':''}`,'ok'); render();
}

function removeFromTour(pid) {
  mtour(t=>{ t.players=t.players.filter(p=>p.id!==pid); });
}

function startTour() {
  const t=ct(); if(!t||t.players.length<2)return;
  const n=t.players.length;
  if (!t.settings.totalRounds) t.settings.totalRounds=recRounds(n);
  if (t.settings.topCutSize===undefined) t.settings.topCutSize=recCut(n,t.settings.mode);
  const {pairings,log,seed} = generateSwiss(t);
  t.rounds.push({number:1,pairings,pairingLog:log,seed,timestamp:Date.now()});
  t.currentRound=1; t.status='rounds'; t._timer=t.settings.timerMinutes*60;
  G.lastLog=log; G.tab='rounds';
  saveAll(); render();
}
export { addFromDB, addBulk, removeFromTour, startTour, renderRegSearch };
