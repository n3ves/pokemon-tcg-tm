// Ponto de entrada — inicialização e exposição global
import { G, nav, loadOffline, DB, SK, saveAll, setSyncStatus } from './state.js';
import { SB } from './supabase.js';
import { migrateIDs } from './prng.js';
import { render } from './render/index.js';
import { setCTMode } from './render/tournaments.js';
import { renderRegSearch } from './actions/registration.js';
import { openPModal, savePlayer, delPlayer, exportPlayers, importPlayersFile, importPlayersTOM, autoDivM } from './actions/players.js';
import { createTour, openTour, delTour } from './actions/tournaments.js';
import { addFromDB, addBulk, removeFromTour, startTour } from './actions/registration.js';
import { setRes, openJudge, saveJudge, dropP } from './actions/results.js';
import { advanceRound, advanceTC, setTC } from './actions/advance.js';
import { toggleTimer, resetTimer } from './actions/timer.js';
import { simulateRound, simulateFull, regenPairings } from './actions/simulation.js';
import { saveSettings, clearData, reloadFromSupabase, forceSyncAll } from './actions/settings.js';
import { exportTour, importTour, exportCSV, exportPlayerCSV, exportTDF, importTDF } from './actions/import-export.js';

// Expõe todas as funções no window (necessário para onclick="" no HTML)
Object.assign(window, {
  G, nav, render, loadOffline,
  setCTMode, renderRegSearch,
  openPModal, savePlayer, delPlayer, exportPlayers, importPlayersFile, importPlayersTOM, autoDivM,
  createTour, openTour, delTour,
  addFromDB, addBulk, removeFromTour, startTour,
  setRes, openJudge, saveJudge, dropP,
  advanceRound, advanceTC, setTC,
  toggleTimer, resetTimer,
  simulateRound, simulateFull, regenPairings,
  saveSettings, clearData, reloadFromSupabase, forceSyncAll,
  exportTour, importTour, exportCSV, exportPlayerCSV, exportTDF, importTDF,
  closeM: () => { G.modal=null; render(); },
});

// ── Init ─────────────────────────────────────────────────────
function loadOffline() {
  G.players  = DB.load(SK.PL, []);
  G.tours    = DB.load(SK.TN, []);
  G.settings = DB.load(SK.ST, { separateDivisions:true, standingsByDiv:true, timerMinutes:50, seed:'', debugMode:false });
  G.tours.forEach(t => { if(!t._timer) t._timer=(t.settings?.timerMinutes||50)*60; t._timerOn=false; });
  G.loading  = false;
  setSyncStatus('offline');
  notify('Rodando offline — dados do cache local', 'warn');
  render();
}

async function init() {
  G.loading = true;
  render(); // show spinner

  // Load settings from localStorage immediately (lightweight)
  G.settings = DB.load(SK.ST, { separateDivisions:true, standingsByDiv:true, timerMinutes:50, seed:'', debugMode:false });

  try {
    setSyncStatus('syncing');
    // Load players and tournaments in parallel
    const [sbPlayers, sbTours] = await Promise.all([
      SB.loadPlayers(),
      SB.loadTournaments(),
    ]);

    // Map DB rows to internal format
    G.players = (sbPlayers || []).map(SB.rowP);
    G.tours   = (sbTours   || []).map(SB.rowT);

    // Cache locally
    DB.save(SK.PL, G.players);
    DB.save(SK.TN, G.tours);

    setSyncStatus('ok');
  } catch (e) {
    console.warn('Supabase load failed, falling back to localStorage:', e);
    G.loadError = e.message?.slice(0,80) || 'Erro de conexão';

    // If it's just a "host not allowed" or network error, go offline
    G.players  = DB.load(SK.PL, []);
    G.tours    = DB.load(SK.TN, []);
    G.tours.forEach(t => { if(!t._timer) t._timer=(t.settings?.timerMinutes||50)*60; t._timerOn=false; });
    setSyncStatus('offline');

    // Show error briefly then continue offline
    G.loading = false;
    render();
    notify('Supabase indisponível — modo offline ativo', 'warn');
    return;
  }

  G.tours.forEach(t => { if(!t._timer) t._timer=(t.settings?.timerMinutes||50)*60; t._timerOn=false; });
  G.loading = false;
  render();
}

init();

init();
