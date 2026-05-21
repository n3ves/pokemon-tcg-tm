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
      players: (t.players||[]).map(tp => {
        const newId = isUUID(tp.id) ? tp.id : uid();
        if (!isUUID(tp.id)) map.set(tp.id, newId);
        return {
          ...tp,
          id:  newId,
          gid: map.get(tp.gid) || tp.gid,
        };
      }),
      rounds: (t.rounds||[]).map(rnd => ({
        ...rnd,
        pairings: (rnd.pairings||[]).map(p => ({
          ...p,
          p1: map.get(p.p1) || p.p1,
          p2: p.p2 === 'BYE' ? 'BYE' : (map.get(p.p2) || p.p2),
        })),
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
const VER = '1.0.1';
const SK  = { PL:'ptcg_pl_v3', TN:'ptcg_tn_v3', ST:'ptcg_st_v3' };
const DIVS = ['Juniors','Seniors','Masters'];
const DC   = { Juniors:'dJ', Seniors:'dS', Masters:'dM' };
const R    = { P1:'p1', P2:'p2', TIE:'tie', DL:'dl', BYE:'bye' };

// ─── Supabase ───────────────────────────────────────────────
// Supabase REST client e mapeamento de dados

const SB_URL = 'https://dlzfxzkvcdycvovnqeya.supabase.co';
const SB_KEY = 'sb_publishable_D7HJx2dydwnyZtgbf-tOOw_YvEDMfgs';

async function _sbRefreshToken() {
  const auth = (typeof G !== 'undefined') ? G.auth : null;
  if (!auth || !auth.refreshToken) return false;
  try {
    const r = await fetch(SB_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SB_KEY },
      body: JSON.stringify({ refresh_token: auth.refreshToken }),
    });
    if (!r.ok) return false;
    const data = await r.json();
    if (!data.access_token) return false;
    G.auth.token = data.access_token;
    if (data.refresh_token) G.auth.refreshToken = data.refresh_token;
    try { localStorage.setItem('ptcg_auth', JSON.stringify(G.auth)); } catch(_) {}
    console.log('[sbFetch] Token refreshed OK');
    return true;
  } catch(e) {
    console.warn('[sbFetch] Refresh failed:', e);
    return false;
  }
}

async function sbFetch(method, table, body, qs) {
  if (qs === undefined) qs = '';
  const getToken = function() {
    return (typeof G !== 'undefined' && G && G.auth && G.auth.token) ? G.auth.token : SB_KEY;
  };
  const makeHeaders = function(token) {
    return {
      'apikey':        SB_KEY,
      'Authorization': 'Bearer ' + token,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation,resolution=merge-duplicates',
    };
  };
  const bodyStr = body != null ? JSON.stringify(body) : undefined;

  let res = await fetch(SB_URL + '/rest/v1/' + table + qs, {
    method: method,
    headers: makeHeaders(getToken()),
    body: bodyStr,
  });

  // JWT expirado -> refresh e tenta novamente (só se estava usando token de usuário)
  if (res.status === 401 && typeof G !== 'undefined' && G && G.auth && G.auth.refreshToken) {
    console.warn('[sbFetch] 401 em /' + table + ' — tentando refresh...');
    const refreshed = await _sbRefreshToken();
    if (refreshed) {
      res = await fetch(SB_URL + '/rest/v1/' + table + qs, {
        method: method,
        headers: makeHeaders(getToken()),
        body: bodyStr,
      });
    } else {
      // Refresh falhou — limpa sessão para evitar loop
      if (typeof G !== 'undefined' && G) {
        G.auth = null;
        try { localStorage.removeItem('ptcg_auth'); } catch(_) {}
        console.warn('[sbFetch] Refresh falhou, sessão encerrada');
        if (typeof notify === 'function') notify('Sessão expirada — faça login novamente', 'warn');
        if (typeof render === 'function') render();
      }
    }
  }

  if (!res.ok) {
    const msg = await res.text().catch(function() { return res.statusText; });
    throw new Error(method + ' /' + table + ': ' + res.status + ' — ' + msg.slice(0,120));
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

  // ── Auth ─────────────────────────────────────────────────
  signIn: (email, password) => fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'apikey': SB_KEY },
    body: JSON.stringify({ email, password }),
  }).then(r => r.json()),

  signOut: (token) => fetch(`${SB_URL}/auth/v1/logout`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'apikey': SB_KEY, 'Authorization': `Bearer ${token}` },
  }),

  getUser: (token) => fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${token}` },
  }).then(r => r.json()),

  vRow: v => ({
    id:               v.id,
    name:             v.name             || null,
    nickname:         v.nickname         || null,
    address:          v.address          || null,
    city:             v.city             || null,
    state:            v.state            || null,
    zip:              v.zip              || null,
    responsible:      v.responsible      || null,
    contact:          v.contact          || null,
    notes:            v.notes            || null,
    active:           v.active !== false,
    organizer_name:   v.organizerName    || null,
    organizer_popid:  v.organizerPopId   || null,
  }),
  rowV: r => ({
    id:             r.id,
    name:           r.name          || '',
    nickname:       r.nickname      || '',
    address:        r.address       || '',
    city:           r.city          || '',
    state:          r.state         || '',
    zip:            r.zip           || '',
    responsible:    r.responsible   || '',
    contact:        r.contact       || '',
    notes:          r.notes         || '',
    active:         r.active !== false,
    organizerName:  r.organizer_name  || '',
    organizerPopId: r.organizer_popid || '',
    createdAt:      r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  }),

  loadVenues:    ()  => sbFetch('GET','venues',null,'?order=name.asc'),
  saveVenue:     v   => sbFetch('POST','venues',SB.vRow(v)),
  deleteVenue:   id  => sbFetch('DELETE','venues',null,'?id=eq.'+id),

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

/* ════════════════════════════════════════════════════════
   SUPABASE REALTIME — WebSocket nativo (protocolo v2)
════════════════════════════════════════════════════════ */
const SBRealtime = (function () {
  // Supabase Realtime usa o protocolo Phoenix/WebSocket
  // URL: wss://<project>.supabase.co/realtime/v1/websocket
  const TABLES        = ['players', 'tournaments', 'venues'];
  const RECONNECT_MS  = [1000, 2000, 5000, 10000, 30000];
  let ws        = null;
  let ref       = 0;
  let hbTimer   = null;
  let active    = false;
  let reconnTry = 0;

  function nextRef() { return String(++ref); }

  function getWsUrl() {
    // Inclui token do utilizador se disponível; fallback para anon key
    const token = (typeof G !== 'undefined' && G && G.auth && G.auth.token)
      ? G.auth.token : SB_KEY;
    return SB_URL.replace('https://', 'wss://')
      + '/realtime/v1/websocket?apikey=' + SB_KEY
      + '&vsn=1.0.0';
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function joinChannel(table) {
    // Formato Phoenix channel join para Supabase Realtime v2
    send({
      topic:   'realtime:public:' + table,
      event:   'phx_join',
      payload: {
        config: {
          broadcast:        { self: false },
          presence:         { key: '' },
          postgres_changes: [{ event: '*', schema: 'public', table: table }],
        },
      },
      ref: nextRef(),
    });
  }

  function applyChange(table, eventType, newRow, oldRow) {
    if (typeof G === 'undefined' || typeof render !== 'function') return;
    let changed = false;

    if (table === 'players') {
      if (eventType === 'DELETE') {
        const id = (oldRow || {}).id;
        if (id) { G.players = G.players.filter(function(p) { return p.id !== id; }); changed = true; }
      } else if (newRow) {
        const p = SB.rowP(newRow);
        const idx = G.players.findIndex(function(x) { return x.id === p.id; });
        if (idx >= 0) { G.players[idx] = p; } else { G.players.push(p); }
        changed = true;
      }
    }

    else if (table === 'tournaments') {
      if (eventType === 'DELETE') {
        const id = (oldRow || {}).id;
        if (id) { G.tours = G.tours.filter(function(t) { return t.id !== id; }); changed = true; }
      } else if (newRow) {
        const incoming = SB.rowT(newRow);
        const existing = G.tours.find(function(x) { return x.id === incoming.id; });
        // Preserva timer local se for o torneio activo
        if (existing) { incoming._timer = existing._timer; incoming._timerOn = existing._timerOn; }
        const idx = G.tours.findIndex(function(x) { return x.id === incoming.id; });
        if (idx >= 0) { G.tours[idx] = incoming; } else { G.tours.push(incoming); }
        changed = true;
      }
    }

    else if (table === 'venues') {
      if (eventType === 'DELETE') {
        const id = (oldRow || {}).id;
        if (id) { G.venues = G.venues.filter(function(v) { return v.id !== id; }); changed = true; }
      } else if (newRow) {
        const v = SB.rowV(newRow);
        const idx = G.venues.findIndex(function(x) { return x.id === v.id; });
        if (idx >= 0) { G.venues[idx] = v; } else { G.venues.push(v); }
        changed = true;
      }
    }

    if (!changed) return;

    // Não re-renderiza se o utilizador logado está a editar exactamente este torneio
    const amEditing = (
      table === 'tournaments' && newRow &&
      G.view === 'tournament' && G.tourId === newRow.id && G.auth
    );
    if (!amEditing) {
      console.log('[Realtime]', eventType, table, ((newRow || oldRow) || {}).id || '');
      render();
    }
  }

  function onMessage(raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    var event   = msg.event;
    var payload = msg.payload || {};

    // Heartbeat reply / join ack → ignorar
    if (event === 'phx_reply' || event === 'phx_close') return;

    // Erro de canal
    if (event === 'phx_error') {
      console.warn('[Realtime] canal erro:', payload);
      return;
    }

    // Supabase v2: dados chegam no evento "postgres_changes" com
    //   payload.data.type, payload.data.table, payload.data.record, payload.data.old_record
    // OU directamente no payload (v1 compat)
    var data = payload.data || payload;
    var etype = data.type   || data.eventType;
    var table = data.table;
    var rec   = data.record     || data.new;
    var old   = data.old_record || data.old;

    if (table && etype) {
      applyChange(table, etype, rec, old);
    }
  }

  function connect() {
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    var url = getWsUrl();
    try { ws = new WebSocket(url); } catch (e) {
      console.warn('[Realtime] WebSocket não suportado:', e);
      return;
    }

    ws.onopen = function () {
      console.log('[Realtime] conectado');
      reconnTry = 0;
      TABLES.forEach(joinChannel);
      clearInterval(hbTimer);
      hbTimer = setInterval(function () {
        send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() });
      }, 25000);
      if (typeof setSyncStatus === 'function') setSyncStatus('ok');
    };

    ws.onmessage = function (e) { onMessage(e.data); };

    ws.onerror = function (e) {
      console.warn('[Realtime] erro WebSocket');
    };

    ws.onclose = function () {
      clearInterval(hbTimer);
      if (!active) return;
      var delay = RECONNECT_MS[Math.min(reconnTry, RECONNECT_MS.length - 1)];
      reconnTry++;
      console.warn('[Realtime] desconectado — reconectando em ' + delay + 'ms');
      if (typeof setSyncStatus === 'function') setSyncStatus('offline');
      setTimeout(connect, delay);
    };
  }

  return {
    start: function () {
      if (active) return;
      active = true;
      connect();
    },
    stop: function () {
      active = false;
      clearInterval(hbTimer);
      if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    },
    // Força re-subscribe (útil após refresh de token)
    reconnect: function () {
      reconnTry = 0;
      connect();
    },
  };
})();