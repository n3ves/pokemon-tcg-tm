// Estado global, storage e funções de navegação
import { SK } from './config.js';
import { SB } from './supabase.js';
import { migrateIDs } from './prng.js';

const DB = {
  load(k, d) { try { const v=localStorage.getItem(k); return v?JSON.parse(v):d; } catch { return d; } },
  save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// sync status: 'ok' | 'syncing' | 'error' | 'offline'
let syncStatus = 'offline';
let syncError  = '';

function setSyncStatus(s, msg='') {
  syncStatus = s; syncError = msg;
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-lbl');
  if (dot) { dot.className = `sync-dot ${s}`; }
  if (lbl) {
    lbl.textContent = s==='ok'?'Sincronizado':s==='syncing'?'Salvando…':s==='error'?'Erro sync':s==='offline'?'Offline':'';
    lbl.title = syncError;
  }
}

/* saveAll — writes to localStorage immediately, then syncs to Supabase */
function saveAll(tourId) {
  // 1. Always persist locally
  DB.save(SK.PL, G.players);
  DB.save(SK.TN, G.tours);
  DB.save(SK.ST, G.settings);
  // 2. Async sync to Supabase
  syncToSupabase(tourId).catch(e => {
    setSyncStatus('error', e.message);
    console.error('Supabase sync error:', e);
  });
}

async function syncToSupabase(tourId) {
  setSyncStatus('syncing');
  migrateIDs(); // garante que todos os IDs são UUID válidos
  try {
    // Save modified players
    await SB.savePlayers(G.players);
    // Save specific tournament or all
    const toSave = tourId ? G.tours.filter(t=>t.id===tourId) : G.tours;
    for (const t of toSave) await SB.saveTournament(t);
    setSyncStatus('ok');
  } catch(e) {
    setSyncStatus('error', e.message);
    throw e;
  }
}

const G = {
  view:'home', players:[], tours:[], settings:{},
  tid:null, tab:'reg',
  modal:null, notif:null,
  search:'', lastLog:[], timerIv:null,
  loading:true, loadError:'',
};

function ct()  { return G.tours.find(t => t.id === G.tid) || null; }
function nav(v, extra={}) { G.view = v; Object.assign(G, extra); render(); }
function mtour(fn) {
  const t = ct(); if (!t) return;
  fn(t);
  // Save to both localStorage and Supabase (just this tournament)
  DB.save(SK.TN, G.tours);
  SB.saveTournament(t).then(()=>setSyncStatus('ok')).catch(e=>{setSyncStatus('error',e.message);});
  render();
}

export { G, ct, nav, mtour, DB, saveAll, syncToSupabase,
         syncStatus, syncError, setSyncStatus, loadOffline };
