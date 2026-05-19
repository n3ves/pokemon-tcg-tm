import { DIVS, R } from '../config.js';
import { G, ct, nav, mtour, saveAll, DB, SK, SB } from '../state.js';
import { uid } from '../prng.js';
import { getStandings } from '../stats.js';
import { esc, notify, inferDiv, extractYear, tdfDateToISO } from '../utils.js';
import { render } from '../render/index.js';
function setRes(pid, result) {
  mtour(t=>{
    const rnd=t.rounds[t.currentRound-1]; if(!rnd)return;
    rnd.pairings=rnd.pairings.map(p=>p.id===pid?{...p,result}:p);
  });
}

function openJudge(pid) { G.modal={type:'judge',pid}; render(); }

function saveJudge(pid) {
  const result=document.getElementById('j-res')?.value||null;
  const note=document.getElementById('j-note')?.value?.trim()||null;
  const drop1=document.getElementById('j-drop1')?.checked;
  const drop2=document.getElementById('j-drop2')?.checked;
  mtour(t=>{
    const rnd=t.rounds[t.currentRound-1]; if(!rnd)return;
    const pair=rnd.pairings.find(p=>p.id===pid);
    rnd.pairings=rnd.pairings.map(p=>p.id===pid?{...p,result:result||null,judgeNote:note}:p);
    if(drop1&&pair) t.players=t.players.map(p=>p.id===pair.p1?{...p,dropped:true}:p);
    if(drop2&&pair&&pair.p2!=='BYE') t.players=t.players.map(p=>p.id===pair.p2?{...p,dropped:true}:p);
  });
  closeM(); notify('Atualizado pelo juiz','ok');
}

function dropP(pid) {
  if(!confirm('Confirmar drop?'))return;
  mtour(t=>{ t.players=t.players.map(p=>p.id===pid?{...p,dropped:true}:p); });
}
export { setRes, openJudge, saveJudge, dropP };
