import { DIVS, R } from '../config.js';
import { G, ct, nav, mtour, saveAll, DB, SK, SB } from '../state.js';
import { uid } from '../prng.js';
import { getStandings } from '../stats.js';
import { esc, notify, inferDiv, extractYear, tdfDateToISO } from '../utils.js';
import { render } from '../render/index.js';
import { fmt } from '../utils.js';
function toggleTimer() {
  const t=ct(); if(!t)return;
  t._timerOn=!t._timerOn;
  if(t._timerOn){
    clearInterval(G.timerIv);
    G.timerIv=setInterval(()=>{
      const t=ct(); if(!t||!t._timerOn){clearInterval(G.timerIv);return;}
      if(t._timer>0){
        t._timer--;
        const el=document.getElementById('tmr');
        if(el){el.textContent=fmt(t._timer);el.className=`timer ${t._timer<300?'tc2':t._timer<600?'tw':''}`;}
      } else {t._timerOn=false;clearInterval(G.timerIv);render();}
    },1000);
  } else clearInterval(G.timerIv);
  saveAll(); render();
}

function resetTimer() {
  const t=ct();if(!t)return;
  clearInterval(G.timerIv); t._timerOn=false; t._timer=t.settings.timerMinutes*60;
  saveAll(); render();
}
export { toggleTimer, resetTimer };
