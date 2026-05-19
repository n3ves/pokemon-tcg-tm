import { DIVS, R } from '../config.js';
import { G, ct, nav, mtour, saveAll, DB, SK, SB } from '../state.js';
import { uid } from '../prng.js';
import { getStandings } from '../stats.js';
import { esc, notify, inferDiv, extractYear, tdfDateToISO } from '../utils.js';
import { render } from '../render/index.js';
import { generateSwiss } from '../swiss.js';
import { recRounds, recCut } from '../config.js';
function createTour() {
  const name = document.getElementById('ct-name')?.value?.trim();
  if (!name) return notify('Nome é obrigatório','err');
  const d = G._ctd||{};
  const t = {
    id: uid(), createdAt: Date.now(),
    name, city: document.getElementById('ct-city')?.value?.trim()||'',
    state: document.getElementById('ct-state')?.value?.trim()||'',
    date: document.getElementById('ct-date')?.value||'',
    mode: d.mode||'cup',
    status: 'registration',
    players:[], rounds:[], currentRound:0, topBracket:null,
    settings: {
      totalRounds: Number(document.getElementById('ct-rounds')?.value)||4,
      topCutSize: Number(document.getElementById('ct-cut')?.value)||0,
      timerMinutes: Number(document.getElementById('ct-timer')?.value)||50,
      seed: document.getElementById('ct-seed')?.value?.trim()||'',
      separateDivisions: document.getElementById('ct-sepdiv')?.checked??true,
      standingsByDiv: document.getElementById('ct-divst')?.checked??true,
      debugMode: document.getElementById('ct-debug')?.checked||false,
      // Inherit organizer from global settings
      organizerName:    G.settings.organizerName    || '',
      organizerPopId:   G.settings.organizerPopId   || '',
      organizerCity:    G.settings.organizerCity     || '',
      organizerCountry: G.settings.organizerCountry  || 'Brazil',
    },
    _timer:0, _timerOn:false,
  };
  t._timer = t.settings.timerMinutes*60;
  G.tours.push(t); G._ctd=null;
  saveAll(); openTour(t.id);
}

function openTour(id) {
  G.tid=id; const t=G.tours.find(x=>x.id===id);
  G.tab = t?.status==='registration'?'reg':t?.status==='finished'?'finished':'rounds';
  nav('tournament');
}

function delTour(id) {
  if (!confirm('Excluir torneio?')) return;
  G.tours = G.tours.filter(t=>t.id!==id);
  DB.save(SK.TN, G.tours);
  SB.deleteTournament(id).then(()=>setSyncStatus('ok')).catch(e=>setSyncStatus('error',e.message));
  notify('Excluído'); nav('tours');
}
export { createTour, openTour, delTour };
