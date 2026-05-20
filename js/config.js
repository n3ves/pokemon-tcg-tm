'use strict';
// ─── PRNG ───────────────────────────────────────────────────
// PRNG seeded (Mulberry32) + helpers de ID
function makeRNG(seed) {
  let s = (seed >>> 0) || 0xCAFEBABE;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function uid() {
  // Gera UUID v4 válido para Supabase
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function isUUID(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s||''));
}
// Migra IDs antigos (curtos) para UUID antes de enviar ao Supabase
function migrateIDs() {
  const map = new Map(); // oldId → newUUID
  G.players = G.players.map(p => {
    if (isUUID(p.id)) return p;
    const nid = uid(); map.set(p.id, nid);
    return { ...p, id: nid };
  });
  G.tours = G.tours.map(t => {
    const tid = isUUID(t.id) ? t.id : uid();
    if (!isUUID(t.id)) map.set(t.id, tid);
    return {
      ...t,
      id: tid,
      players: (t.players||[]).map(tp => ({
        ...tp,
        gid: map.get(tp.gid) || tp.gid,
      })),
    };
  });
  if (map.size > 0) {
    DB.save(SK.PL, G.players);
    DB.save(SK.TN, G.tours);
    console.log(`[migrateIDs] ${map.size} IDs migrados para UUID`);
  }
}

// ─── Constants ──────────────────────────────────────────────
// Constantes e configurações globais
const VER = '3.0';
const SK  = { PL:'ptcg_pl_v3', TN:'ptcg_tn_v3', ST:'ptcg_st_v3' };
const DIVS = ['Juniors','Seniors','Masters'];
const DC   = { Juniors:'dJ', Seniors:'dS', Masters:'dM' };
const R    = { P1:'p1', P2:'p2', TIE:'tie', DL:'dl', BYE:'bye' };

// ─── Supabase ───────────────────────────────────────────────
// Supabase REST client e mapeamento de dados

const SB_URL = 'https://dlzfxzkvcdycvovnqeya.supabase.co';
const SB_KEY = 'sb_publishable_D7HJx2dydwnyZtgbf-tOOw_YvEDMfgs';

async function sbFetch(method, table, body, qs = '') {
  const res = await fetch(`${SB_URL}/rest/v1/${table}${qs}`, {
    method,
    headers: {
      'apikey':        SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation,resolution=merge-duplicates',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`${method} /${table}: ${res.status} — ${msg.slice(0,120)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const SB = {
  /* ── player row mappings ─────────────────────────────── */
  pRow: p => ({
    id: p.id, name: p.name,
    nickname: p.nickname||null, player_id: p.playerId||null,
    birth_date: p.birthDate ? `${extractYear(p.birthDate)||new Date().getFullYear()}-02-27` : null, division: p.division||'Masters',
    city: p.city||null, state: p.state||null,
    contact: p.contact||null, notes: p.notes||null,
  }),
  rowP: r => ({
    id: r.id,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    name: r.name, nickname: r.nickname||'',
    playerId: r.player_id||'', birthDate: r.birth_date ? String(extractYear(r.birth_date)||'') : '',
    division: r.division||'Masters', city: r.city||'',
    state: r.state||'', contact: r.contact||'', notes: r.notes||'',
  }),

  /* ── tournament row mappings ─────────────────────────── */
  tRow: t => {
    const { _timer, _timerOn, ...state } = t;
    return {
      id: t.id, name: t.name,
      city: t.city||null, state: t.state||null, date: t.date||null,
      venue_id: t.venueId||null,
      mode: ({'cust':'custom'}[t.mode]||t.mode||'custom'), status: t.status, current_round: t.currentRound,
      settings: t.settings, timer_seconds: _timer||(t.settings?.timerMinutes||50)*60,
      top_bracket: t.topBracket||null,
      full_state: state,   // entire serialised tournament
    };
  },
  rowT: r => {
    const s = r.full_state || {};
    return {
      ...s,
      id: r.id, name: r.name,
      city: r.city||'', state: r.state||'', date: r.date||'',
      mode: r.mode||'custom', status: r.status||'registration',
      currentRound: r.current_round||0,
      settings: { ...(s.settings||{}), ...(r.settings||{}) },
      topBracket: r.top_bracket || s.topBracket || null,
      players: s.players||[], rounds: s.rounds||[],
      _timer: r.timer_seconds||(r.settings?.timerMinutes||50)*60,
      _timerOn: false,
    };
  },

  /* ── API calls ───────────────────────────────────────── */
  loadPlayers:    ()  => sbFetch('GET','players',null,'?order=name.asc'),
  savePlayers:    arr => arr.length ? sbFetch('POST','players',arr.map(SB.pRow)) : Promise.resolve(),
  savePlayer:     p   => sbFetch('POST','players',SB.pRow(p)),
  deletePlayer:   id  => sbFetch('DELETE','players',null,`?id=eq.${id}`),

  loadVenues:    ()  => sbFetch('GET','venues',null,'?order=name.asc'),
  saveVenue:     v   => sbFetch('POST','venues',v),
  deleteVenue:   id  => sbFetch('DELETE','venues',null,`?id=eq.${id}`),

  loadTournaments: () => sbFetch('GET','tournaments',null,
    '?select=id,name,city,state,date,mode,status,current_round,settings,timer_seconds,top_bracket,full_state,created_at&order=created_at.desc'),
  saveTournament:  t  => sbFetch('POST','tournaments',SB.tRow(t)),
  deleteTournament:id => sbFetch('DELETE','tournaments',null,`?id=eq.${id}`),
};

// Official Pokémon Swiss rounds table
const SW_TBL = [[0,3],[9,4],[17,5],[33,6],[65,7],[129,8]];
function recRounds(n) { let r = 3; for (const [m,x] of SW_TBL) if (n >= m) r = x; return r; }
function recCut(n, mode) {
  if (mode === 'lc') return 0;
  if (n < 8)  return 0;
  if (n < 16) return 4;
  return 8;
}
