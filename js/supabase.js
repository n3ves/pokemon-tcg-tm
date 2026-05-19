// Supabase REST client e mapeamento de dados
import { DIVS } from './config.js';

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

export { SB_URL, SB_KEY, sbFetch, SB };
