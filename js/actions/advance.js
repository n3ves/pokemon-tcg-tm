import { DIVS, R } from '../config.js';
import { G, ct, nav, mtour, saveAll, DB, SK, SB } from '../state.js';
import { uid } from '../prng.js';
import { getStandings } from '../stats.js';
import { esc, notify, inferDiv, extractYear, tdfDateToISO } from '../utils.js';
import { render } from '../render/index.js';
import { generateSwiss } from '../swiss.js';
import { buildTopCut, advanceBracket } from '../swiss.js';
function advanceRound() {
  const t=ct(); if(!t)return;
  const rnd=t.rounds[t.currentRound-1];
  if(!rnd||!rnd.pairings.every(p=>p.result!==null)) return notify('Lance todos os resultados primeiro','warn');

  // Mark bye players
  rnd.pairings.filter(p=>p.isBye).forEach(p=>{
    t.players=t.players.map(x=>x.id===p.p1?{...x,hadBye:true}:x);
  });

  const isLast=t.currentRound>=t.settings.totalRounds;
  if(isLast){
    if(t.settings.topCutSize>0){
      const stand=getStandings(t.players,t.rounds);
      t.topBracket=buildTopCut(stand,t.settings.topCutSize);
      t.status='topcut'; G.tab='topcut';
    } else {
      t.status='finished'; G.tab='finished';
    }
  } else {
    const {pairings,log,seed}=generateSwiss(t);
    t.rounds.push({number:t.currentRound+1,pairings,pairingLog:log,seed,timestamp:Date.now()});
    t.currentRound++; t._timer=t.settings.timerMinutes*60; t._timerOn=false;
    clearInterval(G.timerIv); G.lastLog=log; G.tab='rounds';
  }
  saveAll(); render();
}

function advanceTC() {
  const t=ct(); if(!t?.topBracket)return;
  const last=t.topBracket[t.topBracket.length-1];
  if(!last.matches.every(m=>m.winner)) return notify('Defina todos os vencedores','warn');
  if(last.matches.length===1){ t.status='finished'; G.tab='finished'; }
  else {
    const nb=advanceBracket(t.topBracket);
    if(nb) t.topBracket=nb;
  }
  saveAll(); render();
}

function setTC(mid, winner) {
  mtour(t=>{
    const last=t.topBracket[t.topBracket.length-1];
    last.matches=last.matches.map(m=>m.id===mid?{...m,winner}:m);
  });
}
export { advanceRound, advanceTC, setTC };
