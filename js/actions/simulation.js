import { DIVS, R } from '../config.js';
import { G, ct, nav, mtour, saveAll, DB, SK, SB } from '../state.js';
import { uid } from '../prng.js';
import { getStandings } from '../stats.js';
import { esc, notify, inferDiv, extractYear, tdfDateToISO } from '../utils.js';
import { render } from '../render/index.js';
import { generateSwiss } from '../swiss.js';
import { makeRNG } from '../prng.js';
function simulateRound() {
  if(!confirm('Preencher resultados pendentes aleatoriamente?'))return;
  const rng=makeRNG(Date.now());
  mtour(t=>{
    const rnd=t.rounds[t.currentRound-1]; if(!rnd)return;
    rnd.pairings=rnd.pairings.map(p=>{
      if(p.result!==null||p.isBye) return p;
      const r=rng(); return {...p,result:r<.45?R.P1:r<.9?R.P2:r<.96?R.TIE:R.DL};
    });
  });
  notify('Rodada simulada','ok');
}

function simulateFull() {
  if(!confirm('Simular o torneio COMPLETO do início? Isso vai sobrescrever todos os dados do torneio.'))return;
  const t=ct();if(!t)return;
  if(t.status==='registration'){startTour();}
  // Run all remaining rounds automatically
  setTimeout(()=>_simLoop(),100);
}

function _simLoop() {
  const t=ct();if(!t||t.status==='finished')return;
  if(t.status==='topcut'){
    const last=t.topBracket[t.topBracket.length-1];
    const rng=makeRNG(Date.now());
    last.matches=last.matches.map(m=>({...m,winner:rng()<.5?'p1':'p2'}));
    saveAll();
    const nb=advanceBracket(t.topBracket);
    if(nb){t.topBracket=nb;saveAll();setTimeout(_simLoop,50);}
    else{t.status='finished';G.tab='finished';saveAll();render();}
    return;
  }
  const rnd=t.rounds[t.currentRound-1];if(!rnd)return;
  const rng=makeRNG(Date.now());
  rnd.pairings=rnd.pairings.map(p=>{
    if(p.result!==null||p.isBye)return p;
    const r=rng();return{...p,result:r<.45?R.P1:r<.9?R.P2:r<.96?R.TIE:R.DL};
  });
  saveAll();
  setTimeout(()=>{advanceRound();setTimeout(_simLoop,50);},50);
}

function regenPairings() {
  if(!confirm('Regerar pareamentos da rodada atual? Os resultados atuais serão perdidos.'))return;
  const t=ct();if(!t||t.status!=='rounds')return;
  const {pairings,log,seed}=generateSwiss(t);
  const rnd=t.rounds[t.currentRound-1];
  rnd.pairings=pairings;rnd.pairingLog=log;rnd.seed=seed;
  G.lastLog=log; saveAll(); notify('Pareamentos regerados','ok'); render();
}
export { simulateRound, simulateFull, regenPairings };
