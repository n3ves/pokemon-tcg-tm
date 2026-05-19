import { DIVS, R } from '../config.js';
import { G, ct, nav, mtour, saveAll, DB, SK, SB } from '../state.js';
import { uid } from '../prng.js';
import { getStandings } from '../stats.js';
import { esc, notify, inferDiv, extractYear, tdfDateToISO } from '../utils.js';
import { render } from '../render/index.js';
import { SB_URL, SB } from '../supabase.js';
function saveSettings() {
  G.settings.timerMinutes      = Number(document.getElementById('st-timer')?.value)||50;
  G.settings.seed              = document.getElementById('st-seed')?.value?.trim()||'';
  G.settings.separateDivisions = document.getElementById('st-sepdiv')?.checked??true;
  G.settings.standingsByDiv    = document.getElementById('st-divst')?.checked??true;
  G.settings.debugMode         = document.getElementById('st-debug')?.checked||false;
  // Organizer
  G.settings.organizerName    = document.getElementById('st-org-name')?.value?.trim()||'';
  G.settings.organizerPopId   = document.getElementById('st-org-popid')?.value?.trim()||'';
  G.settings.organizerCity    = document.getElementById('st-org-city')?.value?.trim()||'';
  G.settings.organizerCountry = document.getElementById('st-org-country')?.value?.trim()||'Brazil';
  DB.save(SK.ST, G.settings);
  notify('Salvo','ok');
}

function clearData() {
  if(!confirm('Apagar TODOS os dados?'))return;
  if(!confirm('Confirme: sem possibilidade de recuperação.'))return;
  G.players=[];G.tours=[];saveAll();notify('Dados apagados');render();
}
export { saveSettings, clearData, reloadFromSupabase, forceSyncAll };
