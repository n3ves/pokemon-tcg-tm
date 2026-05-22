'use strict';
// Normaliza string: remove acentos e converte para minúsculas
function norm(s) {
  return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
}
// Estado global, storage e funções de navegação



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
  if (dot) {
    dot.className = 'sync-dot ' + s;
    const titles = { ok:'Realtime ativo — atualizações automáticas', syncing:'Sincronizando…', error:'Erro: '+msg, offline:'Offline (cache local)' };
    dot.title = titles[s] || s;
  }
  if (lbl) {
    const labels = { ok:'', syncing:'Salvando…', error:'Erro sync', offline:'Offline' };
    lbl.textContent = labels[s] || '';
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
    // Marca IDs para suprimir o eco do Realtime (evita render() redundante)
    if (typeof SBRealtime !== 'undefined') {
      G.players.forEach(p => SBRealtime.suppress(p.id));
      const toMark = tourId ? G.tours.filter(t=>t.id===tourId) : G.tours;
      toMark.forEach(t => SBRealtime.suppress(t.id));
      G.venues.forEach(v => SBRealtime.suppress(v.id));
    }
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
  view:'home', players:[], tours:[], settings:{}, venues:[],
  auth: null,  // { token, user } when logged in
  tid:null, tab:'reg', vid:null,
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

// Helpers de formatação, badges, inferência de divisão


function closeM() { G.modal=null; render(); }

function clearTourPlayers() {
  mtour(t => { t.players = []; });
}

/* Add player to tournament being created (before createTour) */
function setCTMode(mode) {
  saveCTFormState();
  G._ctd = G._ctd || {};
  G._ctd.mode = mode;
  if (mode === 'lc')      G._ctd.topCutSize = 0;
  else if (mode === 'cup') G._ctd.topCutSize = 8;
  else if (mode === 'one') G._ctd.topCutSize = 8;
  render();
}

function onCTRoundsChange(val) {
  G._ctd = G._ctd || {};
  G._ctd.totalRounds = val === 'auto' ? 'auto' : val === 'custom' ? 'custom' : Number(val);
  if (val === 'custom') {
    const existing = document.getElementById('ct-rounds-custom');
    if (!existing) {
      const sel = document.getElementById('ct-rounds');
      const inp = document.createElement('input');
      inp.type='number'; inp.id='ct-rounds-custom'; inp.min=3; inp.max=15; inp.value=3;
      inp.style.marginTop='6px'; inp.placeholder='Mínimo 3';
      sel.parentNode.appendChild(inp);
    }
  }
}

function saveCTFormState() {
  if (G.view !== 'ctour') return;
  G._ctd = G._ctd || {};
  G._ctd.name         = document.getElementById('ct-name')?.value         ?? G._ctd.name         ?? '';
  G._ctd.city         = document.getElementById('ct-city')?.value         ?? G._ctd.city         ?? '';
  G._ctd.state        = document.getElementById('ct-state')?.value        ?? G._ctd.state        ?? '';
  G._ctd.date         = document.getElementById('ct-date')?.value         ?? G._ctd.date         ?? '';
  G._ctd.sanctionedId = document.getElementById('ct-sanction')?.value     ?? G._ctd.sanctionedId ?? '';
  G._ctd.venueId      = document.getElementById('ct-venue')?.value        ?? G._ctd.venueId      ?? null;
  G._ctd.totalRounds  = document.getElementById('ct-rounds')?.value       ?? G._ctd.totalRounds  ?? 'auto';
  G._ctd.topCutSize   = Number(document.getElementById('ct-cut')?.value)  ?? G._ctd.topCutSize   ?? 0;
  G._ctd.timerMinutes = Number(document.getElementById('ct-timer')?.value)?? G._ctd.timerMinutes ?? 50;
  G._ctd.seed         = document.getElementById('ct-seed')?.value         ?? G._ctd.seed         ?? '';
  G._ctd.separateDivisions = document.getElementById('ct-sepdiv')?.checked ?? G._ctd.separateDivisions ?? true;
  G._ctd.standingsByDiv    = document.getElementById('ct-divst')?.checked  ?? G._ctd.standingsByDiv    ?? true;
  G._ctd.debugMode         = document.getElementById('ct-debug')?.checked  ?? G._ctd.debugMode         ?? false;
}
function _refreshCTPlayerPanel() {
  const el = document.getElementById('ct-player-panel');
  if (!el) { render(); return; }  // fallback full render if panel not found
  const d = G._ctd || {};
  const players = d.players || [];
  el.innerHTML = players.length === 0 ? '' : `
    <div class="sep" style="margin:8px 0"></div>
    <div class="lbl mb6">Selecionados</div>
    ${players.map((p,i)=>`<div class="plr" style="padding:6px 10px">
      <span class="mono muted" style="min-width:20px;font-size:11px">${i+1}</span>
      <span style="flex:1;font-size:13px">${esc(p.name)}</span>
      ${dbadge(p.division)}
      <button class="ib" onclick="ctRemovePlayer('${p.id}')"><i class="ti ti-x"></i></button>
    </div>`).join('')}`;

  // Clear search box and results — no render() triggered
  const inp = document.getElementById('ct-pq');
  if (inp) { inp.value = ''; inp.focus(); }
  const res = document.getElementById('ct-pres');
  if (res) res.innerHTML = '';
  // Pulse the counter badge instead of notify (avoids 3s render timer)
  const countEl = document.getElementById('ct-pcount');
  if (countEl) {
    countEl.textContent = players.length + ' selecionado' + (players.length!==1?'s':'');
    countEl.className = 'badge bs';
    setTimeout(()=>{ countEl.className='badge bn'; }, 1500);
  }
}
function ctAddPlayer(gid) {
  saveCTFormState();
  G._ctd.players = G._ctd.players || [];
  const gp = G.players.find(p => p.id === gid);
  if (!gp) return;
  if (G._ctd.players.some(p => p.gid === gid)) return notify('Já adicionado','warn');
  G._ctd.players.push({ id: uid(), gid, name: gp.name, division: gp.division, dropped:false, dq:false, hadBye:false });
  _refreshCTPlayerPanel();
}

function ctRemovePlayer(id) {
  saveCTFormState();
  G._ctd.players = (G._ctd.players||[]).filter(p => p.id !== id);
  _refreshCTPlayerPanel();
}

function renderCTPlayerSearch(q) {
  const el = document.getElementById('ct-pres');
  if (!el) return;
  if (!q || q.length < 1) { el.innerHTML=''; return; }
  const have = new Set((G._ctd?.players||[]).map(p=>p.gid));
  const found = G.players.filter(p => !have.has(p.id) && (
    norm(p.name).includes(norm(q)) ||
    norm(p.playerId||'').includes(norm(q))
  )).slice(0, 6);
  el.innerHTML = found.length === 0
    ? `<p class="muted small mt8">Sem resultados.</p>`
    : `<div class="card p0 mt8">${found.map(p=>`
      <div class="plr" style="padding:8px 12px" onclick="ctAddPlayer('${p.id}');document.getElementById('ct-pq').value='';document.getElementById('ct-pres').innerHTML=''">
        <div style="flex:1">
          <div>${esc(p.name)}</div>
          <div class="muted small">${p.division}${p.playerId?' · '+esc(p.playerId):''}</div>
        </div>
        ${dbadge(p.division)}
        <i class="ti ti-plus muted"></i>
      </div>`).join('')}</div>`;
}

function openEditTourModal() {
  G.modal = { type: 'edit-tour' }; render();
}

function saveEditTour() {
  const name = document.getElementById('et-name')?.value?.trim();
  if (!name) return notify('Nome é obrigatório','err');
  mtour(t => {
    t.name        = name;
    t.city        = document.getElementById('et-city')?.value?.trim()||'';
    t.state       = document.getElementById('et-state')?.value?.trim()||'';
    t.date        = document.getElementById('et-date')?.value||'';
    t.sanctionedId= document.getElementById('et-sanction')?.value?.trim()||'';
    t.venueId     = document.getElementById('et-venue')?.value||null;
  });
  closeM();
  notify('Informações atualizadas','ok');
}

function blob(data, filename, type='application/json') {
  const b=new Blob([data],{type});
  const url=URL.createObjectURL(b);
  const a=document.createElement('a');
  a.href=url;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function pick(ext, cb) {
  const inp=document.createElement('input');
  inp.type='file';inp.accept=ext;
  inp.onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const r=new FileReader();
    r.onload=ev=>{try{cb(ev.target.result);}catch{notify('Erro ao processar arquivo','err');}};
    r.readAsText(f);
  };
  inp.click();
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(s) { const m = Math.floor(s/60), sc = s%60; return `${String(m).padStart(2,'0')}:${String(sc).padStart(2,'0')}`; }
function pct(n) { return (n*100).toFixed(1)+'%'; }
function dbadge(d) { return `<span class="badge ${DC[d]||''}">${d?d[0]:'?'}</span>`; }
function stbadge(t) {
  const m={registration:'bi',rounds:'bw',topcut:'bw',finished:'bs'};
  const l={registration:'Registro',rounds:'Rodadas',topcut:'Top Cut',finished:'Finalizado'};
  return `<span class="badge ${m[t.status]||'bn'}">${l[t.status]||t.status}</span>`;
}
function pname(id, t) { const p = (t||ct())?.players.find(x=>x.id===id); if (!p) return '?'; return p.name || G.players.find(x=>x.id===p.gid)?.name || (p.playerId&&G.players.find(x=>x.playerId===p.playerId)?.name) || '?'; }
function resolveName(p) { return p.name || G.players.find(x=>x.id===p.gid)?.name || (p.playerId&&G.players.find(x=>x.playerId===p.playerId)?.name) || '?'; }
function pdiv(id, t)  { const p = (t||ct())?.players.find(x=>x.id===id); return p ? p.division : 'Masters'; }
// bd aceita: ano "2005", ISO "2005-02-27", TDF "02/27/2005"
function extractYear(bd) {
  if (!bd) return null;
  const s = String(bd).trim();
  if (/^\d{4}$/.test(s)) return parseInt(s);
  if (/^\d{4}-/.test(s)) return parseInt(s.slice(0,4));
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return parseInt(s.slice(6));
  return null;
}
function calcAge(bd) {
  const y = extractYear(bd);
  if (!y) return null;
  return new Date().getFullYear() - y;
}
function inferDiv(bd) {
  const a = calcAge(bd);
  if (a === null) return 'Masters';
  if (a <= 10) return 'Juniors';
  if (a <= 15) return 'Seniors';
  return 'Masters';
}
// Formata para TDF: sempre 02/27/ANO
function yearToTdfBirth(bd) {
  const y = extractYear(bd);
  if (!y) return '02/27/1990';
  return '02/27/' + y;
}
function venueName(id) {
  if (!id) return '';
  const v = G.venues.find(x=>x.id===id);
  return v ? v.name : '';
}
function initials(name) { return name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2); }

let notifTimer = null;
function notify(msg, type='info') {
  G.notif = { msg, type };
  clearTimeout(notifTimer);
  notifTimer = setTimeout(()=>{ G.notif=null; render(); }, 3000);
  // Quick partial re-render for notification
  const el = document.getElementById('notif-slot');
  if (el) el.innerHTML = renderNotif();
}


/* ════════════════════════════════════════════════════════
   AUTH — login/logout, read-only guard
════════════════════════════════════════════════════════ */
function isLoggedIn() { return !!G.auth?.token; }

function requireAuth(action) {
  if (isLoggedIn()) return true;
  G.modal = { type: 'login', redirect: action };
  render();
  return false;
}

async function doSignIn() {
  const email = document.getElementById('login-email')?.value?.trim();
  const pwd   = document.getElementById('login-pwd')?.value;
  if (!email || !pwd) return notify('Preencha email e senha','warn');
  const btn = document.getElementById('login-btn');
  if (btn) btn.disabled = true;
  const res = await SB.signIn(email, pwd);
  if (btn) btn.disabled = false;
  if (res.error || !res.access_token) {
    notify(res.error?.message || 'Credenciais inválidas','err');
    return;
  }
  G.auth = { token: res.access_token, refreshToken: res.refresh_token||null, email: res.user?.email || email };
  localStorage.setItem('ptcg_auth', JSON.stringify(G.auth));
  closeM();
  notify(`Logado como ${G.auth.email}`,'ok');
  render();
}

async function doSignOut() {
  if (G.auth?.token) await SB.signOut(G.auth.token).catch(()=>{});
  G.auth = null;
  localStorage.removeItem('ptcg_auth');
  notify('Saiu da conta');
  render();
}

function renderLoginModal() {
  return `
<div class="mtitle"><i class="ti ti-lock"></i> Entrar</div>
<p class="muted small mb16">Somente organizadores autorizados podem editar torneios.</p>
<div class="f mb10">
  <label>E-mail</label>
  <input id="login-email" type="email" placeholder="seu@email.com" autofocus
    onkeydown="if(event.key==='Enter')document.getElementById('login-pwd').focus()">
</div>
<div class="f mb16">
  <label>Senha</label>
  <input id="login-pwd" type="password" placeholder="••••••••"
    onkeydown="if(event.key==='Enter')doSignIn()">
</div>
<div class="fx gap6" style="justify-content:flex-end">
  <button class="btn" onclick="closeM()">Cancelar</button>
  <button id="login-btn" class="btn btn-p" onclick="doSignIn()">
    <i class="ti ti-login"></i> Entrar
  </button>
</div>`;
}

function renderHome() {
  const finished   = G.tours.filter(t=>t.status==='finished');
  const active     = G.tours.filter(t=>t.status==='rounds'||t.status==='topcut');
  const planned    = G.tours.filter(t=>t.status==='registration');
  const recent     = [...G.tours].sort((a,b)=>(b.date||b.createdAt)>(a.date||a.createdAt)?1:-1).reverse().slice(0,6);
  const venues     = G.venues.filter(v=>v.active!==false);

  return `
<div class="mb16">
  <h1 style="font-size:22px">Dashboard</h1>
  <p class="muted small mt4">Jerry v${VER} — Pokémon TCG Tournament Manager</p>
</div>

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px">
  <div class="sc" style="cursor:pointer;padding:20px 16px" onclick="nav('players')">
    <div class="sv" style="font-size:36px;color:var(--it)">${G.players.length}</div>
    <div class="sl" style="font-size:12px;margin-top:6px"><i class="ti ti-users"></i> Jogadores</div>
  </div>
  <div class="sc" style="cursor:pointer;padding:20px 16px;border-color:var(--st)" onclick="G.search='';nav('tours')">
    <div class="sv" style="font-size:36px;color:var(--st)">${finished.length}</div>
    <div class="sl" style="font-size:12px;margin-top:6px"><i class="ti ti-trophy"></i> Concluídos</div>
  </div>
  <div class="sc" style="cursor:pointer;padding:20px 16px;border-color:var(--wt)" onclick="G.search='';nav('tours')">
    <div class="sv" style="font-size:36px;color:var(--wt)">${active.length}</div>
    <div class="sl" style="font-size:12px;margin-top:6px"><i class="ti ti-player-play"></i> Em andamento</div>
  </div>
  <div class="sc" style="cursor:pointer;padding:20px 16px" onclick="G.search='';nav('tours')">
    <div class="sv" style="font-size:36px;color:var(--t2)">${planned.length}</div>
    <div class="sl" style="font-size:12px;margin-top:6px"><i class="ti ti-calendar"></i> Planejados</div>
  </div>
  <div class="sc" style="cursor:pointer;padding:20px 16px" onclick="nav('venues')">
    <div class="sv" style="font-size:36px;color:var(--it)">${venues.length}</div>
    <div class="sl" style="font-size:12px;margin-top:6px"><i class="ti ti-building-store"></i> Locais</div>
  </div>
</div>

${renderCountdownCard()}
<div class="g2 gap16">
  <div>
    <div class="fx sb2 mb12" style="align-items:flex-start">
      <h2>Torneios recentes</h2>
      <button class="btn btn-sm" onclick="nav('tours')"><i class="ti ti-list"></i> Ver todos</button>
    </div>
    <div class="card p0">
      ${recent.length===0
        ?`<div class="empty"><i class="ti ti-trophy"></i><p>Nenhum torneio ainda</p></div>`
        :recent.map(t=>`<div class="plr" onclick="openTour('${t.id}')" style="align-items:flex-start;padding:12px 16px">
            <div style="flex:1;min-width:0">
              <div class="fx gap6 mb4" style="flex-wrap:wrap">
                <strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name)}</strong>
                ${stbadge(t)}
              </div>
              <div class="muted small" style="margin-top:2px">
                ${t.date?t.date+' · ':''}${t.venueId?esc(venueName(t.venueId))+' · ':''}${t.players.length} jogadores
              </div>
            </div>
            <i class="ti ti-chevron-right muted" style="margin-top:2px"></i>
          </div>`).join('')}
    </div>
    ${active.length>0?`
    <div class="card mt12" style="border-color:var(--wt)">
      <div class="lbl mb8" style="color:var(--wt)"><i class="ti ti-player-play"></i> Em andamento</div>
      ${active.map(t=>`<div class="plr" onclick="openTour('${t.id}')">
        <div style="flex:1">
          <div style="font-weight:500">${esc(t.name)}</div>
          <div class="muted small">Rodada ${t.currentRound}/${t.settings.totalRounds} · ${t.players.filter(p=>!p.dropped&&!p.dq).length} ativos</div>
        </div>
        <i class="ti ti-arrow-right muted"></i>
      </div>`).join('')}
    </div>`:''}
  </div>
  <div class="fxc gap12">
    <div class="card">
      <h3 class="mb12">Ações rápidas</h3>
      <div class="fxc gap8">
        <button class="btn btn-p fw jc" style="padding:11px" onclick="nav('ctour')">
          <i class="ti ti-plus"></i> Novo torneio
        </button>
        <button class="btn fw jc" style="padding:11px" onclick="importTDF()">
          <i class="ti ti-file-code"></i> Importar campeonato (.tdf)
        </button>
        <button class="btn fw jc" style="padding:11px" onclick="importTour()">
          <i class="ti ti-cloud-download"></i> Restaurar backup (.json)
        </button>
        <button class="btn fw jc" style="padding:11px" onclick="nav('players')">
          <i class="ti ti-users"></i> Ver jogadores
        </button>
      </div>
    </div>
  </div>
</div>`;
}

function renderPlayers() {
  const q = norm(G.search);
  const list = G.players.filter(p =>
    !q || norm(p.name).includes(q) ||
    norm(p.nickname||'').includes(q) ||
    norm(p.playerId||'').includes(q) ||
    norm(p.city||'').includes(q)
  );
  const incomplete = G.players.filter(p => !p.playerId || !p.birthDate || !p.city);
  return `
${incomplete.length>0?`<div class="well mb12" style="border:1px solid var(--wt);background:var(--wb);border-radius:8px;padding:10px 14px"><div class="fx gap8"><i class="ti ti-alert-triangle" style="color:var(--wt);flex-shrink:0;margin-top:2px"></i><div><strong style="font-size:13px;color:var(--wt)">${incomplete.length} perfil${incomplete.length>1?'s':''} incompleto${incomplete.length>1?'s':''}</strong><div class="small mt4" style="color:var(--wt);opacity:.85">${incomplete.slice(0,3).map(p=>esc(p.name)).join(', ')}${incomplete.length>3?' e mais '+(incomplete.length-3):''} — faltam dados como Player ID, ano de nascimento ou cidade.</div></div></div></div>`:''}
<div class="fx sb2 mb16"><h1>Jogadores</h1>
  <div class="fx gap6">
    <button class="btn btn-sm" onclick="exportPlayers()"><i class="ti ti-download"></i> Exportar</button>
    <div class="fx gap6">
      <button class="btn btn-sm" onclick="importPlayersTOM()"><i class="ti ti-file-code"></i> Importar .xml (TOM)</button>
      <button class="btn btn-sm" onclick="importPlayersFile()"><i class="ti ti-upload"></i> Importar .json</button>
    </div>
    <button class="btn btn-p btn-sm" onclick="openPModal(null)"><i class="ti ti-plus"></i> Novo</button>
  </div>
</div>
<div class="sw"><i class="ti ti-search"></i>
  <input id="players-search" placeholder="Buscar nome, nickname, ID, cidade..." value="${esc(G.search)}" oninput="updatePlayersList(this.value)" autofocus>
</div>
<div class="card p0" id="players-list">
${list.length===0?`<div class="empty"><i class="ti ti-user-off"></i><p>Nenhum jogador encontrado</p></div>`:
list.map(p=>`<div class="plr" onclick="nav('pdetail',{pid:'${p.id}'})">
  <div class="av">${esc(initials(p.name))}</div>
  <div style="flex:1;min-width:0">
    <div class="fx gap6">
      <strong>${esc(p.name)}</strong>
      ${p.nickname?`<span class="muted small">"${esc(p.nickname)}"</span>`:''}
      ${dbadge(p.division)}
    </div>
    <div class="muted small mt4">${p.playerId?'ID: '+esc(p.playerId)+' · ':''}${esc(p.city||'')}${p.state?' / '+p.state:''}</div>
  </div>
  <div class="fx gap4">
    <button class="btn btn-xs" onclick="event.stopPropagation();openPModal('${p.id}')"><i class="ti ti-edit"></i></button>
    <button class="btn btn-xs btn-d" onclick="event.stopPropagation();delPlayer('${p.id}')"><i class="ti ti-trash"></i></button>
  </div>
</div>`).join('')}
</div>
<p class="muted small mt8 tc">${list.length} jogador${list.length!==1?'es':''}</p>`;
}


/* ════════════════════════════════════════════════════════
   SVG CHARTS — pure SVG, no external library
════════════════════════════════════════════════════════ */
function svgLineChart(data, opts={}) {
  const W=opts.w||400, H=opts.h||150;
  const pad={t:10,r:16,b:32,l:40};
  const iW=W-pad.l-pad.r, iH=H-pad.t-pad.b;
  if(!data.length) return `<svg width="${W}" height="${H}"></svg>`;

  const minV = opts.min!==undefined ? opts.min : Math.min(...data);
  const maxV = opts.max!==undefined ? opts.max : Math.max(...data);
  const range = maxV-minV || 1;
  const scaleY = v => pad.t + iH - ((v-minV)/range)*iH;
  const scaleX = i => pad.l + (i/(data.length-1||1))*iW;

  // Y axis ticks
  const yTicks = [];
  const step = opts.yStep || Math.ceil(range/4);
  for(let v=minV; v<=maxV+0.01; v+=step) yTicks.push(Math.round(v));

  // X axis labels (max 6)
  const xLabels = opts.labels||[];
  const xStep = Math.max(1, Math.ceil(xLabels.length/6));

  // Line path
  const pts = data.map((v,i)=>`${scaleX(i).toFixed(1)},${scaleY(v).toFixed(1)}`);
  const linePath = 'M'+pts.join('L');
  // Fill area
  const fillPath = linePath +
    `L${scaleX(data.length-1).toFixed(1)},${(pad.t+iH).toFixed(1)}` +
    `L${scaleX(0).toFixed(1)},${(pad.t+iH).toFixed(1)}Z`;

  // Point colors
  const ptColors = data.map((_,i) => opts.pointColor ? opts.pointColor(data[i],i) : (opts.color||'#378ADD'));

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">
    <defs><clipPath id="cp${Math.random().toString(36).slice(2,6)}"><rect x="${pad.l}" y="${pad.t}" width="${iW}" height="${iH}"/></clipPath></defs>
    ${yTicks.map(v=>`
      <line x1="${pad.l}" x2="${pad.l+iW}" y1="${scaleY(v).toFixed(1)}" y2="${scaleY(v).toFixed(1)}" stroke="currentColor" stroke-opacity=".08" stroke-width="1"/>
      <text x="${pad.l-6}" y="${scaleY(v).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="currentColor" opacity=".5">${opts.formatY?opts.formatY(v):v}</text>`).join('')}
    ${xLabels.filter((_,i)=>i%xStep===0).map((lbl,_,arr,idx)=>{
      const origIdx = xLabels.indexOf(lbl);
      return `<text x="${scaleX(origIdx).toFixed(1)}" y="${H-6}" text-anchor="middle" font-size="9" fill="currentColor" opacity=".5">${lbl.length>8?lbl.slice(0,8)+'…':lbl}</text>`;
    }).join('')}
    <path d="${fillPath}" fill="${opts.color||'#378ADD'}" opacity=".12"/>
    <path d="${linePath}" fill="none" stroke="${opts.color||'#378ADD'}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${data.map((v,i)=>`<circle cx="${scaleX(i).toFixed(1)}" cy="${scaleY(v).toFixed(1)}" r="3.5" fill="${ptColors[i]}" stroke="${opts.bg||'var(--bg)'}" stroke-width="1.5"/>`).join('')}
  </svg>`;
}

function svgXLabels(labels, data, W=400, H=150, pad={t:10,r:16,b:32,l:40}) {
  // helper used inside svgLineChart for x labels - handled inline above
}

function svgBarChart(datasets, labels, opts={}) {
  const W=opts.w||400, H=opts.h||150;
  const pad={t:10,r:16,b:32,l:32};
  const iW=W-pad.l-pad.r, iH=H-pad.t-pad.b;
  const n=labels.length;
  if(!n) return `<svg width="${W}" height="${H}"></svg>`;

  // Stack values
  const totals = labels.map((_,i) => datasets.reduce((s,d)=>s+(d.data[i]||0),0));
  const maxV = Math.max(...totals,1);
  const barW = Math.max(8, (iW/n)*0.6);
  const gap  = iW/n;
  const xStep = Math.max(1, Math.ceil(n/6));

  let bars = '';
  labels.forEach((lbl,i) => {
    const x = pad.l + i*gap + (gap-barW)/2;
    let y = pad.t+iH;
    datasets.forEach(ds => {
      const val = ds.data[i]||0;
      const bH  = (val/maxV)*iH;
      y -= bH;
      if(bH>0) bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bH.toFixed(1)}" fill="${ds.color}" rx="1"/>`;
    });
    if(i%xStep===0)
      bars += `<text x="${(x+barW/2).toFixed(1)}" y="${H-6}" text-anchor="middle" font-size="9" fill="currentColor" opacity=".5">${lbl.length>8?lbl.slice(0,8)+'…':lbl}</text>`;
  });

  const yTicks = [0, Math.round(maxV/2), maxV];
  const yLines = yTicks.map(v=>{
    const y = pad.t+iH-(v/maxV)*iH;
    return `<line x1="${pad.l}" x2="${pad.l+iW}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="currentColor" stroke-opacity=".08" stroke-width="1"/>
    <text x="${pad.l-4}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="currentColor" opacity=".5">${v}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg" style="display:block">
    ${yLines}${bars}
  </svg>`;
}

function svgDonut(values, colors, size=140) {
  const total = values.reduce((a,b)=>a+b,0);
  if(!total) return `<svg width="${size}" height="${size}"></svg>`;
  const cx=size/2, cy=size/2, R=size/2-10, r=R*0.58;
  let angle=-Math.PI/2, paths='';
  values.forEach((v,i)=>{
    const sweep = (v/total)*2*Math.PI;
    const x1=cx+R*Math.cos(angle), y1=cy+R*Math.sin(angle);
    angle+=sweep;
    const x2=cx+R*Math.cos(angle), y2=cy+R*Math.sin(angle);
    const x3=cx+r*Math.cos(angle), y3=cy+r*Math.sin(angle);
    const x4=cx+r*Math.cos(angle-sweep), y4=cy+r*Math.sin(angle-sweep);
    const large=sweep>Math.PI?1:0;
    if(sweep>0.01)
      paths+=`<path d="M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} L${x3.toFixed(2)},${y3.toFixed(2)} A${r},${r} 0 ${large},0 ${x4.toFixed(2)},${y4.toFixed(2)}Z" fill="${colors[i]}"/>`;
  });
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
}

// Match tournament player to global player (by gid OR playerId)
function tpMatchesGP(tp, gp) {
  return (tp.gid && tp.gid === gp.id) ||
         (tp.playerId && gp.playerId && tp.playerId === gp.playerId);
}
function renderPDetail() {
  const gp = G.players.find(p => p.id === G.pid);
  if (!gp) return `<div class="empty">Jogador não encontrado</div>`;
  const age = calcAge(gp.birthDate);

  // Collect tournament history sorted by date
  const history = G.tours
    .filter(t => t.players.some(tp => tpMatchesGP(tp, gp)) && t.rounds.length > 0)
    .sort((a,b) => (a.date||a.createdAt) > (b.date||b.createdAt) ? 1 : -1)
    .map(t => {
      const tp  = t.players.find(x=>tpMatchesGP(x, gp));
      const st  = getStandings(t.players, t.rounds);
      const pos = st.findIndex(x=>x.id===tp.id)+1;
      const s   = calcStats(tp.id, t.rounds);
      const gp2 = s.w+s.l+s.t;
      const wr  = gp2>0 ? Math.round(s.w/gp2*100) : 0;
      return { t, tp, s, pos, total: t.players.filter(p=>!p.dq).length, wr, name: t.name, date: t.date||'' };
    });

  const allTours = G.tours.filter(t => t.players.some(tp=>tpMatchesGP(tp, gp)));
  const tw = history.reduce((a,h)=>a+h.s.w,0);
  const tl = history.reduce((a,h)=>a+h.s.l,0);
  const tt = history.reduce((a,h)=>a+h.s.t,0);
  const totalGP = tw+tl+tt;
  const avgWR   = totalGP>0 ? Math.round(tw/totalGP*100) : 0;

  // Best placement %
  const bestPos = history.length ? history.reduce((b,h)=>{
    const pct = h.pos/h.total; return pct < b ? pct : b;
  }, 1) : null;

  // Current win streak
  let streak = 0;
  for(const h of [...history].reverse()){
    if(h.s.w > h.s.l) streak++; else break;
  }

  // Archetypes used (include N/A for missing)
  const archUsed = {};
  history.forEach(h => {
    const key = h.tp.deckArchetype || 'N/A';
    archUsed[key] = (archUsed[key]||0) + 1;
  });
  const archRanked = Object.entries(archUsed).sort((a,b)=>b[1]-a[1]);

  // Group by venue
  const byVenue = {};
  history.forEach(h => {
    const vname = h.t.venueId ? venueName(h.t.venueId) : 'Sem local';
    if (!byVenue[vname]) byVenue[vname] = [];
    byVenue[vname].push(h);
  });
  const venueGroups = Object.entries(byVenue).sort((a,b)=>a[0].localeCompare(b[0],'pt'));

  // Warning: finished tournaments without decklist
  const missingDeck = history.filter(h => h.t.status==='finished' && !h.tp.deckArchetype);

  // Charts:
  // WR and WLT: grouped by venue (average per venue)
  // Position: sorted by date (chronological)

  // By venue for WR + WLT
  const venueOrder = venueGroups.map(([vname]) => vname);
  const chartVenueLabels = venueOrder.map(v => v.length>10 ? v.slice(0,10)+'…' : v);
  const chartVenueWR = venueOrder.map(vname => {
    const vh = byVenue[vname]||[];
    const vw=vh.reduce((s,h)=>s+h.s.w,0), vl=vh.reduce((s,h)=>s+h.s.l,0), vt=vh.reduce((s,h)=>s+h.s.t,0);
    const vgp=vw+vl+vt; return vgp>0?Math.round(vw/vgp*100):0;
  });
  const chartVenueW = venueOrder.map(vname => (byVenue[vname]||[]).reduce((s,h)=>s+h.s.w,0));
  const chartVenueL = venueOrder.map(vname => (byVenue[vname]||[]).reduce((s,h)=>s+h.s.l,0));
  const chartVenueT = venueOrder.map(vname => (byVenue[vname]||[]).reduce((s,h)=>s+h.s.t,0));

  // By date for position (chronological = history is already asc)
  const chartDateLabels = history.map(h => (h.date||h.t.date||'').slice(5)||h.name.slice(0,8));
  const chartPos        = history.map(h => h.pos);

  return `
<div class="fx gap12 mb16">
  <button class="btn btn-sm" onclick="nav('players')"><i class="ti ti-arrow-left"></i> Voltar</button>
  <div class="av" style="width:48px;height:48px;font-size:16px">${esc(initials(gp.name))}</div>
  <div>
    <h1 style="font-size:18px">${esc(gp.name)}${gp.nickname?` <span class="muted" style="font-size:14px">"${esc(gp.nickname)}"</span>`:''}</h1>
    <div class="fx gap6 mt4">
      ${dbadge(gp.division)}
      ${gp.playerId?`<span class="badge bn">ID: ${esc(gp.playerId)}</span>`:''}
      ${gp.city?`<span class="badge bn">${esc(gp.city)}</span>`:''}
      ${age!==null?`<span class="badge bn">${age} anos</span>`:''}
    </div>
  </div>
  <button class="btn btn-sm ml" onclick="openPModal('${gp.id}')"><i class="ti ti-edit"></i> Editar</button>
</div>

<div class="g4 mb16">
  <div class="sc"><div class="sv">${allTours.length}</div><div class="sl">Torneios</div></div>
  <div class="sc"><div class="sv">${avgWR}%</div><div class="sl">Win rate</div></div>
  <div class="sc"><div class="sv">${bestPos!==null?'Top '+Math.round(bestPos*100)+'%':'—'}</div><div class="sl">Melhor posição</div></div>
  <div class="sc"><div class="sv">${streak>0?streak+'🔥':'—'}</div><div class="sl">Sequência</div></div>
</div>

${history.length === 0 ? `
<div class="card mb16"><div class="empty"><i class="ti ti-chart-bar"></i><p>Nenhuma rodada completada ainda</p></div></div>
` : `
<div class="g2 gap16 mb16">
  <div class="card">
    <div class="lbl mb10">Win rate por loja</div>
    <div style="display:flex;gap:12px;font-size:11px;color:var(--t2);margin-bottom:8px">
      <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:2px;background:#378ADD;display:inline-block"></span>Win rate %</span>
    </div>
    ${svgLineChart(chartVenueWR,{w:440,h:150,min:0,max:100,color:"#378ADD",labels:chartVenueLabels,formatY:v=>v+"%",pointColor:(v)=>v>=50?"#639922":"#E24B4A"})}
  </div>
  <div class="card">
    <div class="lbl mb10">Resultados por loja</div>
    <div style="display:flex;gap:12px;font-size:11px;color:var(--t2);margin-bottom:8px">
      <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#639922;display:inline-block"></span>V</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#E24B4A;display:inline-block"></span>D</span>
      <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#BA7517;display:inline-block"></span>E</span>
    </div>
    ${svgBarChart([{data:chartVenueW,color:"#639922"},{data:chartVenueT,color:"#BA7517"},{data:chartVenueL,color:"#E24B4A"}],chartVenueLabels,{w:440,h:150})}
  </div>
</div>

<div class="g2 gap16 mb16">
  <div class="card">
    <div class="lbl mb10">Posição final (por data)</div>
    ${svgLineChart(chartPos.map(v=>-v),{w:440,h:150,min:-Math.max(...chartPos,4),max:-1,color:"#7F77DD",labels:chartDateLabels,formatY:v=>"#"+(-v),pointColor:(_,i)=>chartPos[i]===1?"#639922":"#7F77DD"})}
  </div>
  <div class="card">
    <div class="lbl mb10">Distribuição total</div>
    <div style="display:flex;align-items:center;gap:16px">
      <div style="flex-shrink:0">${svgDonut([tw,tl,tt],["#639922","#E24B4A","#BA7517"],140)}</div>
      <div style="flex:1">
        ${[['#639922','Vitórias',tw],['#E24B4A','Derrotas',tl],['#BA7517','Empates',tt]].map(([c,l,v])=>`
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="width:10px;height:10px;border-radius:2px;background:${c};flex-shrink:0"></span>
          <span style="flex:1;font-size:13px;color:var(--t2)">${l}</span>
          <strong>${v}</strong>
          <span style="font-size:12px;color:var(--t2)">${totalGP>0?Math.round(v/totalGP*100):0}%</span>
        </div>`).join('')}
      </div>
    </div>
  </div>
</div>
`}

${missingDeck.length>0?`
<div class="well mb16" style="border:1px solid var(--wt);background:var(--wb)">
  <div class="fx gap8">
    <i class="ti ti-alert-triangle" style="color:var(--wt);font-size:16px;flex-shrink:0;margin-top:1px"></i>
    <div>
      <div style="font-size:13px;font-weight:500;color:var(--wt)">Decklists pendentes</div>
      <div class="small mt4" style="color:var(--wt);opacity:.85">
        ${missingDeck.map(h=>`<strong>${esc(h.name)}</strong>`).join(', ')} — torneio${missingDeck.length>1?'s':''} finalizado${missingDeck.length>1?'s':''} sem decklist registrada.
      </div>
    </div>
  </div>
</div>`:''}

<div class="g2 gap16 mb16">
  <div>
    <h2 class="mb12">Histórico de torneios</h2>
    ${allTours.length===0?`<div class="card"><div class="empty"><p>Nenhum torneio</p></div></div>`:
    venueGroups.map(([vname, vhist])=>`
      <div class="lbl mb6 mt12">${esc(vname)}</div>
      <div class="card p0 mb8">
      ${[...vhist].reverse().map(h=>{
        const won = h.pos===1;
        const top = h.total>0 && h.pos<=Math.ceil(h.total*0.25);
        const noDeck = h.t.status==='finished' && !h.tp.deckArchetype;
        const hasList = h.tp.deckList && h.tp.deckList.trim().length>0;
        const deckId = 'deck-'+h.t.id;
        return `<div>
          <div class="plr" style="cursor:pointer" onclick="openTour('${h.t.id}')">
            <div style="flex:1;min-width:0">
              <div class="fx gap6 mb4">
                <strong style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(h.name)}</strong>
                ${won?`<span class="badge bs"><i class="ti ti-trophy"></i> 1°</span>`:top?`<span class="badge bi">Top ${Math.ceil(h.total*0.25)}</span>`:''}
                ${noDeck?`<span class="badge bw" title="Sem decklist"><i class="ti ti-alert-triangle"></i></span>`:''}
              </div>
              <div class="muted small">
                ${h.date?h.date+' · ':''}${h.t.rounds.length} rodadas
                ${h.tp.deckArchetype?` · <strong>${esc(h.tp.deckArchetype)}</strong>`:''}
              </div>
            </div>
            <div class="fx gap6">
              <span class="mono" style="font-size:12px">${h.s.w}/${h.s.l}/${h.s.t}</span>
              <span class="badge bn">#${h.pos}/${h.total}</span>
              <span class="badge ${h.wr>=50?'bs':'bd'}" style="font-size:11px">${h.wr}%</span>
              ${hasList?`<button class="btn btn-xs" onclick="event.stopPropagation();toggleDeckList('${deckId}')"><i class="ti ti-cards"></i></button>`:''}
            </div>
          </div>
          ${hasList?`<div id="${deckId}" style="display:none;padding:10px 16px;background:var(--s2);border-top:1px solid var(--bd)">
            <div class="lbl mb6">Decklist</div>
            <pre style="font-size:11px;font-family:var(--mono);white-space:pre-wrap;line-height:1.6">${esc(h.tp.deckList)}</pre>
          </div>`:''}
        </div>`;
      }).join('')}
      </div>`
    ).join('')}
  </div>

  <div>
    <div style="display:flex;flex-direction:column;gap:12px">
      <div>
        <h2 class="mb12">Decks jogados</h2>
        <div class="card">
        ${archRanked.map(([name,count],i)=>{
          const colors=['#D85A30','#7F77DD','#1D9E75','#378ADD','#BA7517','#D4537E','#888780','#639922'];
          const color = name==='N/A' ? '#9ca3af' : colors[i%colors.length];
          return `<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:0.5px solid var(--bd)">
            <span style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></span>
            <span style="flex:1;font-size:13px${name==='N/A'?';color:var(--t2);font-style:italic':''}">${esc(name)}</span>
            <div style="width:70px;height:4px;background:var(--s2);border-radius:2px;overflow:hidden">
              <div style="width:${Math.round(count/archRanked[0][1]*100)}%;height:100%;background:${color}"></div>
            </div>
            <span class="muted small">${count}x</span>
          </div>`;
        }).join('')}
        </div>
      </div>
      ${venueGroups.length>1?`
      <div>
        <h2 class="mb12">Performance por local</h2>
        <div class="card">
        ${venueGroups.map(([vname, vhist])=>{
          const vw = vhist.reduce((s,h)=>s+h.s.w,0);
          const vl = vhist.reduce((s,h)=>s+h.s.l,0);
          const vt = vhist.reduce((s,h)=>s+h.s.t,0);
          const vgp = vw+vl+vt;
          const vwr = vgp>0?Math.round(vw/vgp*100):0;
          return `<div style="padding:8px 0;border-bottom:0.5px solid var(--bd)">
            <div class="fx sb2 mb4">
              <span style="font-size:13px;font-weight:500">${esc(vname)}</span>
              <span class="badge ${vwr>=50?'bs':'bd'}" style="font-size:11px">${vwr}%</span>
            </div>
            <div class="fx gap12 muted small">
              <span>${vhist.length} torneio${vhist.length>1?'s':''}</span>
              <span>${vw}V ${vl}D ${vt}E</span>
            </div>
          </div>`;
        }).join('')}
        </div>
      </div>`:''}
    </div>
  </div>
</div>

`;
  // Store chart data for post-render initialization
  G._chartData = { labels:chartVenueLabels, wr:chartVenueWR, w:chartVenueW, l:chartVenueL, t:chartVenueT,
                   pos:chartPos, dateLabels:chartDateLabels, tw, tl, tt };
}

/* ════════════════════════════════════════════════════════
   GLOBAL DECKLISTS PAGE
════════════════════════════════════════════════════════ */
function getGlobalArchStats() {
  // Aggregate archetype usage across all tournaments
  const stats = {}; // arch → { count, wins, losses, ties, players: Set }
  G.tours.forEach(t => {
    t.players.forEach(tp => {
      if (!tp.deckArchetype) return;
      const arch = tp.deckArchetype;
      if (!stats[arch]) stats[arch] = { count:0, w:0, l:0, t:0, players: new Set(), tournaments: new Set() };
      const s = calcStats(tp.id, t.rounds);
      stats[arch].count++;
      stats[arch].w += s.w;
      stats[arch].l += s.l;
      stats[arch].t += s.t;
      const playerKey = tp.gid || tp.playerId; if (playerKey) stats[arch].players.add(playerKey);
      stats[arch].tournaments.add(t.id);
    });
  });
  // Convert Sets to counts and calculate win rate
  return Object.entries(stats).map(([name, s]) => {
    const gp = s.w + s.l + s.t;
    return {
      name, count: s.count, w: s.w, l: s.l, t: s.t,
      gp, wr: gp > 0 ? Math.round(s.w/gp*100) : 0,
      players: s.players.size,
      tournaments: s.tournaments.size,
    };
  }).sort((a,b) => b.count - a.count);
}

function renderGlobalDecklists() {
  const archs   = getGlobalArchStats();
  const allUsed = getAllArchetypes(); // for datalist
  const q       = norm(G.search);
  const filtered = archs.filter(a => !q || norm(a.name).includes(q));
  const total    = archs.reduce((s,a) => s+a.count, 0);
  const archColors = ['#D85A30','#7F77DD','#1D9E75','#378ADD','#BA7517','#D4537E','#888780','#639922','#993C1D','#534AB7'];

  return `
<div class="fx sb2 mb16">
  <div>
    <h1 class="mb4">Decklists</h1>
    <div class="muted small">${total} registros em ${G.tours.filter(t=>t.players.some(p=>p.deckArchetype)).length} torneios</div>
  </div>
  <button class="btn btn-p" onclick="openArchModal(null)">
    <i class="ti ti-plus"></i> Novo deck
  </button>
</div>

<div class="sw mb16">
  <i class="ti ti-search"></i>
  <input id="decks-search" placeholder="Buscar deck..." value="${esc(G.search)}" oninput="updateDecksList(this.value)">
</div>

${filtered.length === 0 ? `
<div class="card mb16">
  <div class="empty">
    <i class="ti ti-cards"></i>
    <p>${total===0?'Nenhum deck registrado ainda. Registre decks dentro de um torneio na aba Decklists.':'Nenhum resultado para a busca.'}</p>
  </div>
</div>` : `

<div style="display:grid;grid-template-columns:1fr 260px;gap:16px;align-items:start">

  <div class="card p0 mb16">
    <table>
      <thead><tr>
        <th>#</th><th>Deck</th><th>Usos</th><th>Torneios</th><th>Jogadores únicos</th><th>W/L/E</th><th>Win rate</th>
      </tr></thead>
      <tbody id="decks-table-body">
      ${filtered.map((a,i) => {
        const color = archColors[archs.indexOf(a) % archColors.length];
        const maxCount = filtered[0]?.count || 1;
        return `<tr>
          <td class="muted mono" style="font-size:11px">${i+1}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></span>
              <span style="font-weight:500">${esc(a.name)}</span>
            </div>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:60px;height:4px;background:var(--s2);border-radius:2px;overflow:hidden">
                <div style="width:${Math.round(a.count/maxCount*100)}%;height:100%;background:${color}"></div>
              </div>
              <span class="mono">${a.count}</span>
            </div>
          </td>
          <td class="mono">${a.tournaments}</td>
          <td class="mono">${a.players}</td>
          <td class="mono muted">${a.w}/${a.l}/${a.t}</td>
          <td>
            <span class="badge ${a.wr>=50?'bs':'bd'}" style="font-size:11px">${a.wr}%</span>
          </td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>
  </div>

  <div style="display:flex;flex-direction:column;gap:12px">
    <div class="card">
      <div class="lbl mb10">Top decks</div>
      ${filtered.slice(0,8).map((a,i) => {
        const color = archColors[archs.indexOf(a) % archColors.length];
        const maxC = filtered[0]?.count||1;
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:0.5px solid var(--bd)">
          <span style="width:8px;height:8px;border-radius:2px;background:${color};flex-shrink:0"></span>
          <span style="flex:1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name)}</span>
          <div style="width:50px;height:4px;background:var(--s2);border-radius:2px;overflow:hidden">
            <div style="width:${Math.round(a.count/maxC*100)}%;height:100%;background:${color}"></div>
          </div>
          <span class="muted" style="font-size:11px;min-width:18px;text-align:right">${a.count}</span>
        </div>`;
      }).join('')}
    </div>

  </div>
</div>`}`;
}

function renderDeckPlayerList(t, filter) {
  const q = norm(filter || '');
  const players = q
    ? t.players.filter(p => norm(resolveName(p)).includes(q) || norm(p.deckArchetype||'').includes(q))
    : t.players;

  if (!players.length) return `<div class="empty"><p>Nenhum jogador encontrado</p></div>`;

  const archColors = ['#D85A30','#7F77DD','#1D9E75','#378ADD','#BA7517','#D4537E','#888780','#639922'];
  const archColorMap = {};
  let ci = 0;
  t.players.forEach(p => {
    if(p.deckArchetype && !archColorMap[p.deckArchetype])
      archColorMap[p.deckArchetype] = archColors[ci++ % archColors.length];
  });

  return players.map((p,i) => {
    const name = resolveName(p);
    return `
    <div class="plr" style="padding:10px 16px">
      <span class="muted mono" style="min-width:24px;font-size:11px">${t.players.indexOf(p)+1}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500">${esc(name)}</div>
        <div class="muted small">${p.division}</div>
      </div>
      ${p.deckArchetype ? `
        <span style="background:${archColorMap[p.deckArchetype]||'#888'}22;color:${archColorMap[p.deckArchetype]||'#888'};
          border:0.5px solid ${archColorMap[p.deckArchetype]||'#888'}44;
          padding:3px 10px;border-radius:8px;font-size:12px;font-weight:500;white-space:nowrap">
          ${esc(p.deckArchetype)}
        </span>
        ${p.deckList ? `<i class="ti ti-file-text muted" title="Lista completa registrada" style="font-size:14px"></i>` : ''}
        <button class="btn btn-xs" onclick="openDeckModal('${p.id}')"><i class="ti ti-edit"></i></button>
      ` : `
        <span class="muted small" style="font-style:italic">—</span>
        <button class="btn btn-xs btn-p" onclick="openDeckModal('${p.id}')">
          <i class="ti ti-plus"></i> Registrar
        </button>
      `}
    </div>`;
  }).join('');
}

function filterDeckList(q) {
  const t = ct(); if (!t) return;
  const el = document.getElementById('deck-player-list');
  if (el) el.innerHTML = renderDeckPlayerList(t, q);
}

function saveDeckQuick() {
  if (!requireAuth()) return;
  const pid   = document.getElementById('deck-quick-player')?.value;
  const sel   = document.getElementById('deck-quick-arch')?.value?.trim();
  const custom= document.getElementById('deck-quick-arch-custom')?.value?.trim();
  const arch  = custom || sel;
  if (!pid)  return notify('Selecione um jogador','warn');
  if (!arch) return notify('Selecione ou digite o deck','warn');
  mtour(t => { t.players = t.players.map(p => p.id===pid ? {...p, deckArchetype:arch} : p); });
  document.getElementById('deck-quick-arch').value = '';
  document.getElementById('deck-quick-player').value = '';
  notify('Decklist salva','ok');
}

function openDeckModal(pid) {
  const t = ct(); if (!t) return;
  const p = pid ? t.players.find(x=>x.id===pid) : null;
  G.modal = { type:'deck', pid, playerName: p?.name||'', arch: p?.deckArchetype||'', list: p?.deckList||'' };
  render();
}

function saveDeckModal() {
  if (!requireAuth()) return;
  const pid  = G.modal?.pid;
  const arch = document.getElementById('dm-arch')?.value?.trim()||'';
  const list = document.getElementById('dm-list')?.value?.trim()||'';
  const selPid = document.getElementById('dm-player')?.value || pid;
  if (!selPid) return notify('Selecione um jogador','warn');
  mtour(t => { t.players = t.players.map(p => p.id===selPid ? {...p, deckArchetype:arch||null, deckList:list||null} : p); });
  closeM();
  notify('Decklist salva','ok');
}

function renderDeckModal() {
  const t = ct(); if (!t) return '';
  const m = G.modal;
  const allArchs = getAllArchetypes();
  const p = m.pid ? t.players.find(x=>x.id===m.pid) : null;
  return `
<div class="mtitle"><i class="ti ti-cards"></i> ${p ? 'Editar decklist — '+esc(p.name) : 'Registrar decklist'}</div>
${!m.pid ? `
<div class="f mb12">
  <label>Jogador</label>
  <select id="dm-player">
    <option value="">Selecionar...</option>
    ${t.players.map(pl=>`<option value="${pl.id}" ${pl.id===m.pid?'selected':''}>${esc(pl.name)} · ${pl.division}</option>`).join('')}
  </select>
</div>` : `<input type="hidden" id="dm-player" value="${m.pid}">`}
<div class="f mb12">
  <label>Deck</label>
  <input id="dm-arch" list="dm-arch-list" value="${esc(m.arch)}"
    placeholder="Charizard ex, Gardevoir ex...">
  <datalist id="dm-arch-list">
    ${allArchs.map(a=>`<option value="${esc(a)}">`).join('')}
  </datalist>
  ${allArchs.length > 0 ? `
  <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px">
    ${allArchs.slice(0,8).map(a=>`
      <button class="btn btn-xs" style="font-size:11px"
        onclick="document.getElementById('dm-arch').value='${esc(a).replace(/'/g,"\'")}'">${esc(a)}</button>
    `).join('')}
  </div>` : ''}
</div>
<div class="f mb16">
  <label>Lista completa <span class="muted small">(opcional)</span></label>
  <textarea id="dm-list" style="height:140px;font-family:var(--mono);font-size:12px"
    placeholder="4 Charizard ex (OBF 125)&#10;2 Charmander (OBF 26)&#10;...">${esc(m.list)}</textarea>
  <span class="muted small mt4">Formato livre — um card por linha</span>
</div>
${m.pid && (m.arch||m.list) ? `
<div class="mb12">
  <button class="btn btn-xs btn-d" onclick="clearDeck('${m.pid}')">
    <i class="ti ti-trash"></i> Remover decklist
  </button>
</div>` : ''}
<div class="fx gap6" style="justify-content:flex-end">
  <button class="btn" onclick="closeM()">Cancelar</button>
  <button class="btn btn-p" onclick="saveDeckModal()"><i class="ti ti-check"></i> Salvar</button>
</div>`;
}

function clearDeck(pid) {
  if (!confirm('Remover a decklist deste jogador?')) return;
  mtour(t => { t.players = t.players.map(p => p.id===pid ? {...p, deckArchetype:null, deckList:null} : p); });
  closeM();
  notify('Decklist removida');
}

function renderDebug(t) {
  const log = G.lastLog || [];
  const rnd = t.rounds[t.currentRound-1];
  const rndLog = rnd?.pairingLog || [];
  const display = log.length ? log : rndLog;

  function colorLine(l) {
    if (l.startsWith('═')||l.startsWith('─')) return `<span class="l-hd">${esc(l)}</span>`;
    if (l.startsWith('⚠')||l.includes('REMATCH')||l.includes('ERRO')) return `<span class="l-er">${esc(l)}</span>`;
    if (l.startsWith('BYE')||l.startsWith('Float')) return `<span class="l-wn">${esc(l)}</span>`;
    if (l.startsWith('Grupo')||l.startsWith('Mesas')||l.startsWith('Byes')) return `<span class="l-mi">${esc(l)}</span>`;
    if (l.includes('×')) return `<span class="l-ok">${esc(l)}</span>`;
    return esc(l);
  }

  return `
<div class="fx sb2 mb16"><h2>Modo Debug</h2>
  <div class="fx gap6">
    <button class="btn btn-sm" onclick="regenPairings()"><i class="ti ti-refresh"></i> Regerar pareamentos</button>
    <button class="btn btn-sm" onclick="simulateFull()"><i class="ti ti-player-play"></i> Simular torneio completo</button>
  </div>
</div>
<div class="card mb16">
  <h3 class="mb8">Configurações de pareamento</h3>
  <div class="g3">
    <div class="well"><div class="sl">Seed</div><div class="mono mt4">${t.settings.seed||'Aleatório'}</div></div>
    <div class="well"><div class="sl">Separar divisões</div><div class="mono mt4">${t.settings.separateDivisions?'Sim':'Não'}</div></div>
    <div class="well"><div class="sl">Rodada atual</div><div class="mono mt4">${t.currentRound}/${t.settings.totalRounds}</div></div>
  </div>
</div>
<div class="card mb16">
  <h3 class="mb8">Validação de pareamentos</h3>
  ${validatePairings(t)}
</div>
<h3 class="mb8">Log do último pareamento</h3>
${display.length===0?`<div class="well muted small">Nenhum log disponível</div>`:
`<div class="dblog">${display.map(colorLine).join('\n')}</div>`}`;
}

function validatePairings(t) {
  const issues = [];
  for (const rnd of t.rounds) {
    const seen = new Set();
    for (const p of rnd.pairings) {
      if (p.isBye) continue;
      if (seen.has(p.p1)) issues.push(`R${rnd.number}: ${pname(p.p1,t)} aparece 2x`);
      if (seen.has(p.p2)) issues.push(`R${rnd.number}: ${pname(p.p2,t)} aparece 2x`);
      seen.add(p.p1); seen.add(p.p2);
    }
  }
  if (!issues.length)
    return `<span class="badge bs"><i class="ti ti-check"></i> Nenhum problema encontrado</span>`;

  return `
${issues.map(i=>`<div class="badge bd mb4"><i class="ti ti-alert-circle"></i> ${esc(i)}</div>`).join('')}
`;
}

/* ── EXPORT TAB ── */

/* ════════════════════════════════════════════════════════
   PRINT — Pairing Sheet, Match Slips, Standings
════════════════════════════════════════════════════════ */
function openPrintWindow(html, title) {
  const w = window.open('', '_blank', 'width=900,height=700');
  w.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; background: #fff; }
  @media print {
    body { margin: 0; }
    .no-print { display: none !important; }
    @page { size: A4; margin: 12mm 14mm; }
  }
  .no-print {
    background: #1d4ed8; color: #fff; border: none; padding: 10px 20px;
    font-size: 14px; cursor: pointer; border-radius: 6px; margin: 12px;
    display: block;
  }
  ${html._css||''}
</style>
</head>
<body>
<button class="no-print" onclick="window.print()">🖨️ Imprimir</button>
${html._body}
</body>
</html>`);
  w.document.close();
}

function printPairings(tid) {
  const t = G.tours.find(x=>x.id===tid)||ct(); if(!t)return;
  const rnd = t.rounds[t.currentRound-1]; if(!rnd)return notify('Nenhuma rodada ativa','warn');

  const rows = rnd.pairings
    .filter(p=>!p.isBye)
    .sort((a,b)=>(a.table||0)-(b.table||0))
    .map(p => {
      const p1 = t.players.find(x=>x.id===p.p1);
      const p2 = t.players.find(x=>x.id===p.p2);
      const s1 = calcStats(p.p1, t.rounds.slice(0,-1));
      const s2 = calcStats(p.p2, t.rounds.slice(0,-1));
      return { table:p.table, p1, p2, s1, s2 };
    });

  const byes = rnd.pairings.filter(p=>p.isBye).map(p=>{
    const pl = t.players.find(x=>x.id===p.p1);
    const s = calcStats(p.p1, t.rounds.slice(0,-1));
    return { pl, s };
  });

  const body = `
<div style="text-align:center;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #000">
  <div style="font-size:18px;font-weight:bold">${esc(t.name)}</div>
  <div style="font-size:13px;margin-top:4px">Rodada ${t.currentRound} de ${t.settings.totalRounds} &nbsp;·&nbsp; ${t.players.filter(p=>!p.dropped&&!p.dq).length} jogadores ativos</div>
</div>
<table style="width:100%;border-collapse:collapse">
  <thead>
    <tr style="background:#f0f0f0">
      <th style="padding:6px 8px;text-align:left;border:1px solid #ccc;width:60px">Mesa</th>
      <th style="padding:6px 8px;text-align:left;border:1px solid #ccc">Jogador 1</th>
      <th style="padding:6px 8px;text-align:center;border:1px solid #ccc;width:40px">Div</th>
      <th style="padding:6px 8px;text-align:center;border:1px solid #ccc;width:70px">Record</th>
      <th style="padding:6px 8px;text-align:center;border:1px solid #ccc;width:24px">VS</th>
      <th style="padding:6px 8px;text-align:left;border:1px solid #ccc">Jogador 2</th>
      <th style="padding:6px 8px;text-align:center;border:1px solid #ccc;width:40px">Div</th>
      <th style="padding:6px 8px;text-align:center;border:1px solid #ccc;width:70px">Record</th>
    </tr>
  </thead>
  <tbody>
    ${rows.map((r,i)=>`
    <tr style="background:${i%2===0?'#fff':'#f8f8f8'}">
      <td style="padding:7px 8px;border:1px solid #ccc;font-weight:bold;text-align:center">${r.table}</td>
      <td style="padding:7px 8px;border:1px solid #ccc;font-weight:bold">${esc(r.p1?.name||'?')}</td>
      <td style="padding:7px 8px;border:1px solid #ccc;text-align:center">${r.p1?.division[0]||'?'}</td>
      <td style="padding:7px 8px;border:1px solid #ccc;text-align:center">${r.s1.w}/${r.s1.l}/${r.s1.t} (${r.s1.mp})</td>
      <td style="padding:7px 8px;border:1px solid #ccc;text-align:center;color:#666">vs</td>
      <td style="padding:7px 8px;border:1px solid #ccc;font-weight:bold">${esc(r.p2?.name||'?')}</td>
      <td style="padding:7px 8px;border:1px solid #ccc;text-align:center">${r.p2?.division[0]||'?'}</td>
      <td style="padding:7px 8px;border:1px solid #ccc;text-align:center">${r.s2.w}/${r.s2.l}/${r.s2.t} (${r.s2.mp})</td>
    </tr>`).join('')}
    ${byes.map(b=>`
    <tr style="background:#fffbeb">
      <td style="padding:7px 8px;border:1px solid #ccc;text-align:center;color:#888">—</td>
      <td style="padding:7px 8px;border:1px solid #ccc;font-weight:bold">${esc(b.pl?.name||'?')}</td>
      <td style="padding:7px 8px;border:1px solid #ccc;text-align:center">${b.pl?.division[0]||'?'}</td>
      <td style="padding:7px 8px;border:1px solid #ccc;text-align:center">${b.s.w}/${b.s.l}/${b.s.t} (${b.s.mp})</td>
      <td colspan="4" style="padding:7px 8px;border:1px solid #ccc;color:#888;font-style:italic">BYE — vitória automática</td>
    </tr>`).join('')}
  </tbody>
</table>
<div style="margin-top:12px;font-size:10px;color:#666;text-align:right">
  Impresso em ${new Date().toLocaleString('pt-BR')} &nbsp;·&nbsp; Record: W/L/E (Pts)
</div>`;

  openPrintWindow({ _body: body }, `Pairings R${t.currentRound} — ${t.name}`);
}

function makeBarcodeSVG(w, h, seed) {
  let s = seed >>> 0;
  let bars = '', x = 0, col = 0;
  while (x < w) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const bw = (s % 3) + 1;
    if (col % 2 === 0) bars += `<rect x="${x}" y="0" width="${bw}" height="${h}" fill="#000"/>`;
    x += bw; col++;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bars}</svg>`;
}

function printMatchSlips(tid) {
  const t = G.tours.find(x=>x.id===tid)||ct(); if(!t)return;
  const rnd = t.rounds[t.currentRound-1]; if(!rnd)return notify('Nenhuma rodada ativa','warn');

  const pairs = rnd.pairings
    .filter(p=>!p.isBye)
    .sort((a,b)=>(a.table||0)-(b.table||0));

  const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#f0f0f0;padding:8mm}
    .page-title{text-align:center;font-size:10px;margin-bottom:6mm;color:#444}
    .slips-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:5mm}
    .slip{background:#fff;border:1px solid #000;display:flex;flex-direction:row;height:52mm;overflow:hidden;page-break-inside:avoid}
    .side{width:22mm;display:flex;flex-direction:row;flex-shrink:0;overflow:hidden}
    .side-r{border-left:1px solid #ddd}
    .side-l{border-right:1px solid #ddd}
    .col-id{width:7mm;display:flex;flex-direction:column;justify-content:space-between;align-items:center;padding:2mm 1mm}
    .col-bc{width:5mm;display:flex;align-items:center;justify-content:center}
    .col-text{flex:1;display:flex;align-items:center;justify-content:center}
    .vtext{writing-mode:vertical-rl;font-family:Arial,Helvetica,sans-serif;font-size:7.5pt;letter-spacing:.3px;white-space:nowrap;text-align:center;line-height:1.2}
    .vtext-flip{transform:rotate(180deg)}
    .vtext strong{font-size:8.5pt;font-weight:bold;letter-spacing:.5px}
    .center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:2mm 3mm}
    .dashed-box{border:1px dashed #000;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:1.5mm 2mm}
    .key-line{font-size:6.5pt;letter-spacing:.3px}
    .pname{font-size:9pt;font-weight:bold;letter-spacing:.3px;text-align:center}
    .rnd{font-size:6.5pt;text-align:center;margin-top:0.5mm}
    .instr{font-size:5.5pt;text-align:center;line-height:1.4;color:#222}
    .games{display:flex;flex-direction:column;gap:1mm;align-items:flex-start}
    .gitem{display:flex;align-items:center;gap:2mm;font-size:6.5pt}
    .chk{width:3mm;height:3mm;border:0.5px solid #000;display:inline-block;flex-shrink:0}
    .tie{font-size:8pt;font-weight:bold;letter-spacing:1px;margin-top:1mm}
    @media print{
      .no-print{display:none!important}
      @page{size:A4 portrait;margin:8mm}
      body{background:#fff;padding:0}
    }
  `;

  function slip(p) {
    const p1 = t.players.find(x=>x.id===p.p1);
    const p2 = t.players.find(x=>x.id===p.p2);
    const s1 = calcStats(p.p1, t.rounds.slice(0,-1));
    const s2 = calcStats(p.p2, t.rounds.slice(0,-1));
    const tname = esc(t.name).toUpperCase();
    const seed1 = (p.table||1) * 9371;
    const seed2 = (p.table||1) * 7463;
    const seedC = (p.table||1) * 5284;
    const p1n = (p1?.name||'?').toUpperCase();
    const p2n = (p2?.name||'?').toUpperCase();
    const p1id = p1?.playerId ? p1.playerId + ' - ' + (p1?.division[0]||'?') + 'A' : (p1?.division[0]||'?') + 'A';
    const p2id = p2?.playerId ? p2.playerId + ' - ' + (p2?.division[0]||'?') + 'A' : (p2?.division[0]||'?') + 'A';

    return `<div class="slip">
      <!-- LEFT SIDE -->
      <div class="side side-l">
        <div class="col-id">
          <span class="vtext vtext-flip" style="font-size:6pt">${p1id}</span>
          <span class="vtext vtext-flip" style="font-size:5.5pt">${s1.w}/${s1.l}/${s1.t} (${s1.mp})</span>
        </div>
        <div class="col-bc">${makeBarcodeSVG(8, 46*3.78, seed1)}</div>
        <div class="col-text">
          <div class="vtext vtext-flip">
            <strong>TABLE ${p.table}</strong><br>
            ${esc(p1n)}<br>
            <strong>WINNER</strong>
          </div>
        </div>
      </div>
      <!-- CENTER -->
      <div class="center">
        <div class="dashed-box">
          <div style="display:flex;flex-direction:column;align-items:center;gap:0.5mm">
            <span class="key-line">key: ${String(seed1).slice(0,6)}</span>
            ${makeBarcodeSVG(120, 10*3.78, seedC)}
          </div>
          <div>
            <div class="pname">${esc(p1n)}</div>
            <div class="rnd">Round ${t.currentRound} / ${t.settings.totalRounds}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:1mm">
            <div class="instr">checkmark who wins each game,<br>then both players sign after end</div>
            <div class="games">
              <div class="gitem"><span class="chk"></span><span>game 1</span></div>
              <div class="gitem"><span class="chk"></span><span>game 2</span></div>
              <div class="gitem"><span class="chk"></span><span>game 3</span></div>
            </div>
            <div class="tie">TIE</div>
          </div>
        </div>
      </div>
      <!-- RIGHT SIDE -->
      <div class="side side-r">
        <div class="col-text">
          <div class="vtext">
            <strong>TABLE ${p.table}</strong><br>
            ${esc(p2n)}<br>
            <strong>WINNER</strong>
          </div>
        </div>
        <div class="col-bc">${makeBarcodeSVG(8, 46*3.78, seed2)}</div>
        <div class="col-id">
          <span class="vtext" style="font-size:6pt">${p2id}</span>
          <span class="vtext" style="font-size:5.5pt">${s2.w}/${s2.l}/${s2.t} (${s2.mp})</span>
        </div>
      </div>
    </div>`;
  }

  const body = `
<div class="page-title">
  <strong>${esc(t.name).toUpperCase()}</strong> &nbsp;—&nbsp;
  MATCH SLIPS &nbsp;—&nbsp; ROUND ${t.currentRound} / ${t.settings.totalRounds}
  &nbsp;&nbsp;·&nbsp;&nbsp; Recorte e entregue um slip por mesa
</div>
<div class="slips-grid">${pairs.map(slip).join('')}</div>`;

  openPrintWindow({ _body: body, _css: css }, `Match Slips R${t.currentRound} — ${t.name}`);
}

function printStandings(tid) {
  const t = G.tours.find(x=>x.id===tid)||ct(); if(!t)return;
  const stand = getStandings(t.players, t.rounds);
  const cutSize = t.settings.topCutSize;

  const body = `
<div style="text-align:center;margin-bottom:16px;padding-bottom:10px;border-bottom:2px solid #000">
  <div style="font-size:18px;font-weight:bold">${esc(t.name)}</div>
  <div style="font-size:12px;margin-top:4px">
    Standings após Rodada ${t.currentRound} de ${t.settings.totalRounds}
    ${cutSize>0?` · Top ${cutSize} classificado${cutSize!==1?'s':''}`:''}</div>
</div>
<table style="width:100%;border-collapse:collapse">
  <thead>
    <tr style="background:#f0f0f0">
      <th style="padding:6px 8px;border:1px solid #ccc;width:36px">#</th>
      <th style="padding:6px 8px;border:1px solid #ccc;text-align:left">Jogador</th>
      <th style="padding:6px 8px;border:1px solid #ccc;width:30px">Div</th>
      <th style="padding:6px 8px;border:1px solid #ccc;width:60px">Pts</th>
      <th style="padding:6px 8px;border:1px solid #ccc;width:70px">W/L/E</th>
      <th style="padding:6px 8px;border:1px solid #ccc;width:65px">OWP%</th>
      <th style="padding:6px 8px;border:1px solid #ccc;width:65px">OOWP%</th>
    </tr>
  </thead>
  <tbody>
    ${stand.map((p,i)=>`
    ${i===cutSize&&cutSize>0?`<tr><td colspan="7" style="padding:0;border:none"><div style="height:2px;background:#dc2626;margin:2px 0"></div></td></tr>`:''}
    <tr style="background:${i%2===0?'#fff':'#f8f8f8'}${p.dropped?';opacity:.5':''}">
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center;font-weight:bold">${i+1}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;font-weight:${i<3?'bold':'normal'}">${esc(p.name)}${p.dropped?' (dropped)':''}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center">${p.division[0]}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center;font-weight:bold">${p.mp}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center">${p.w}/${p.l}/${p.t}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center">${(p.owp*100).toFixed(1)}%</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center">${(p.oowp*100).toFixed(1)}%</td>
    </tr>`).join('')}
  </tbody>
</table>
<div style="margin-top:10px;font-size:10px;color:#666;text-align:right">
  Impresso em ${new Date().toLocaleString('pt-BR')}
</div>`;

  openPrintWindow({ _body: body }, `Standings — ${t.name}`);
}

function renderExport(t) {
  const canExportTDF = t.status === 'finished' || t.rounds.length > 0;
  const venue       = G.venues.find(v=>v.id===t.venueId);
  const orgName     = venue?.organizerName  || t.settings?.organizerName  || '';
  const orgPopId    = venue?.organizerPopId || t.settings?.organizerPopId || '';
  const hasOrg      = orgName && orgPopId;
  const hasSanction = !!t.sanctionedId;
  const hasPlayerId = t.players.every(p => {
    const gp = G.players.find(x=>x.id===p.gid);
    return gp?.playerId || p.playerId;
  });

  const warn = (ok, label) =>
    `<div class="fx gap6 mb4 small ${ok?'':''}">
      <i class="ti ti-${ok?'check':'alert-triangle'}" style="color:var(--${ok?'it':'wt'})"></i>
      <span style="color:var(--${ok?'t1':'wt'})">${label}</span>
    </div>`;

  return `
<h2 class="mb16">Exportar / Importar</h2>

<div class="card mb16" style="border:2px solid var(--it)">
  <div class="fx sb2 mb12">
    <div class="fx gap8">
      <span class="badge bi" style="font-size:13px;padding:4px 12px"><i class="ti ti-file-code"></i> TOM Data File (.tdf)</span>
      <span class="badge bn small">Formato oficial Pokémon</span>
    </div>
    <button class="btn btn-xs" onclick="nav('tournament',{tab:'edit'});G.modal={type:'edit-tour'};render()">
      <i class="ti ti-edit"></i> Editar dados
    </button>
  </div>

  <div class="g2 gap16 mb12">
    <div class="well">
      <div class="lbl mb8">Checklist para submissão</div>
      ${warn(canExportTDF, 'Pelo menos 1 rodada finalizada')}
      ${warn(hasSanction, 'Sanction ID preenchido' + (hasSanction?' ('+esc(t.sanctionedId)+')':''))}
      ${warn(hasOrg, 'Organizer no local' + (hasOrg?' ('+esc(orgName)+' · '+esc(orgPopId)+')':''))}
      ${warn(hasPlayerId, 'Player IDs de todos os jogadores')}
      ${warn(!!t.date, 'Data do evento preenchida')}
    </div>
    <div class="well">
      <div class="lbl mb8">Dados do arquivo</div>
      <div class="small mb4"><span class="muted">Torneio:</span> ${esc(t.name)}</div>
      <div class="small mb4"><span class="muted">Data:</span> ${t.date||'—'}</div>
      <div class="small mb4"><span class="muted">Rodadas:</span> ${t.rounds.length}/${t.settings.totalRounds}</div>
      <div class="small mb4"><span class="muted">Jogadores:</span> ${t.players.length}</div>
      <div class="small mb4"><span class="muted">Divisões:</span> ${[...new Set(t.players.map(p=>p.division))].join(', ')||'—'}</div>
      <div class="small"><span class="muted">Status:</span> ${t.status}</div>
    </div>
  </div>

  <div class="fx gap8">
    <button class="btn btn-p ${canExportTDF?'':'btn-disabled'}" ${canExportTDF?'':'disabled'} onclick="exportTDF('${t.id}')">
      <i class="ti ti-download"></i> Exportar .tdf
    </button>
    <button class="btn" onclick="importTDF()">
      <i class="ti ti-upload"></i> Importar .tdf
    </button>
  </div>
  ${!canExportTDF?`<p class="muted small mt8">Finalize pelo menos 1 rodada para exportar.</p>`:''}
  ${!hasSanction||!hasOrg?`<p class="muted small mt4">⚠ Submissão ao TOM requer Sanction ID e Organizer preenchidos.</p>`:''}
</div>

<div class="g2 gap16">
  <div class="card">
    <h3 class="mb8"><i class="ti ti-database-export"></i> Backup (.json)</h3>
    <p class="muted small mb12">Dados internos completos do torneio.</p>
    <button class="btn" onclick="exportTour('${t.id}')"><i class="ti ti-download"></i> Baixar .json</button>
  </div>
  <div class="card">
    <h3 class="mb8"><i class="ti ti-database-import"></i> Restaurar</h3>
    <p class="muted small mb12">Carrega backup .json exportado anteriormente.</p>
    <button class="btn" onclick="importTour()"><i class="ti ti-upload"></i> Carregar .json</button>
  </div>
  <div class="card">
    <h3 class="mb8"><i class="ti ti-table"></i> Standings (.csv)</h3>
    <p class="muted small mb12">Classificação atual para planilha.</p>
    <button class="btn" onclick="exportCSV('${t.id}')"><i class="ti ti-download"></i> Baixar CSV</button>
  </div>
  <div class="card">
    <h3 class="mb8"><i class="ti ti-users"></i> Jogadores (.csv)</h3>
    <p class="muted small mb12">Lista de inscritos no torneio.</p>
    <button class="btn" onclick="exportPlayerCSV('${t.id}')"><i class="ti ti-download"></i> Baixar CSV</button>
  </div>
</div>`;
}

/* ── TIMER (inline topbar) ── */
// Regras oficiais Pokémon TCG de tempo por modo
const TIMER_RULES = {
  lc:   { swiss:50, topCut:75, swissBO:'BO3', topCutBO:'BO3', extraTurns:3 },
  cup:  { swiss:50, topCut:75, swissBO:'BO3', topCutBO:'BO3', extraTurns:3 },
  one:  { swiss:50, topCut:75, swissBO:'BO3', topCutBO:'BO3', extraTurns:3 },
  cust: { swiss:50, topCut:75, swissBO:'BO3', topCutBO:'BO3', extraTurns:3 },
};

function getTimerRules(t) {
  return TIMER_RULES[t.mode || t.settings?.mode || 'cup'] || TIMER_RULES.cup;
}

function getPhaseMinutes(t) {
  const rules = getTimerRules(t);
  return t.status === 'topcut' ? rules.topCut : rules.swiss;
}

function renderTimerBlock(t) {
  const s   = t._timer != null ? t._timer : getPhaseMinutes(t)*60;
  const tot = getPhaseMinutes(t)*60;
  const pct = tot > 0 ? Math.round((1 - s/tot)*100) : 0;
  const cls = s <= 0 ? 'tc2' : s < 300 ? 'tc2' : s < 600 ? 'tw' : '';
  const rules = getTimerRules(t);
  const phase = t.status === 'topcut' ? 'Top Cut' : 'Swiss';
  const bo    = t.status === 'topcut' ? rules.topCutBO : rules.swissBO;
  return `<div class="fx gap6 ml" style="align-items:center">
    <div style="display:flex;flex-direction:column;align-items:flex-end;line-height:1">
      <span class="timer ${cls}" id="tmr" style="font-size:22px;font-weight:700;font-variant-numeric:tabular-nums">${fmt(s)}</span>
      <span style="font-size:10px;color:var(--t2)">${phase} · ${bo} · ${getPhaseMinutes(t)}min</span>
    </div>
    <div style="width:36px;height:36px;position:relative;flex-shrink:0">
      <svg width="36" height="36" viewBox="0 0 36 36" style="transform:rotate(-90deg)">
        <circle cx="18" cy="18" r="15" fill="none" stroke="var(--bd)" stroke-width="3"/>
        <circle cx="18" cy="18" r="15" fill="none" stroke="${s<300?'var(--er)':s<600?'var(--wt)':'var(--it)'}" stroke-width="3"
          stroke-dasharray="${Math.round(2*Math.PI*15)}"
          stroke-dashoffset="${Math.round(2*Math.PI*15*(1-pct/100))}"
          stroke-linecap="round"/>
      </svg>
    </div>
    <div class="fx gap4">
      <button class="btn btn-sm" onclick="toggleTimer()" id="tmrbtn" title="${t._timerOn?'Pausar':'Iniciar'}">
        <i class="ti ti-${t._timerOn?'player-pause':'player-play'}"></i>
      </button>
      <button class="btn btn-sm" onclick="resetTimer()" title="Resetar"><i class="ti ti-refresh"></i></button>
      <button class="btn btn-sm" onclick="openTimerConfig()" title="Configurar timer"><i class="ti ti-settings"></i></button>
    </div>
  </div>`;
}


/* ── Changelog ───────────────────────────────────────────── */
function tlog(t, msg) {
  if (!t) return;
  if (!t.log) t.log = [];
  const now  = new Date();
  const hhmm = now.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  t.log.push({ ts: Date.now(), hhmm, msg });
  if (t.log.length > 200) t.log = t.log.slice(-200);
}

/* ── Timer sync helpers ──────────────────────────────────── */
function _startTimerInterval() {
  clearInterval(G.timerIv);
  G.timerIv = setInterval(() => {
    const t = ct(); if (!t) { clearInterval(G.timerIv); return; }
    if (t.timerStartedAt && t._timerPausedAt == null) {
      const elapsed = Math.floor((Date.now() - t.timerStartedAt) / 1000);
      t._timer = Math.max(0, (t.settings.timerMinutes * 60) - elapsed);
    }
    if (!t.timerStartedAt || t._timerPausedAt != null) { clearInterval(G.timerIv); return; }
    const s   = t._timer;
    const el  = document.getElementById('tmr');
    const cls = s < 300 ? 'tc2' : s < 600 ? 'tw' : '';
    if (el) { el.textContent = fmt(s); el.className = 'timer ' + cls; }
    const tot  = getPhaseMinutes(t) * 60;
    const circ = Math.round(2 * Math.PI * 15);
    const ring = document.getElementById('tmr-ring');
    if (ring) {
      const pct = tot > 0 ? (1 - s / tot) : 0;
      ring.setAttribute('stroke-dashoffset', Math.round(circ * (1 - pct)));
      ring.setAttribute('stroke', s < 300 ? 'var(--er)' : s < 600 ? 'var(--wt)' : 'var(--it)');
    }
    if (s === 600) notify('⏱ 10 minutos!', 'warn');
    else if (s === 300) notify('⚠️ 5 minutos!', 'warn');
    else if (s === 60)  notify('🚨 1 minuto!', 'warn');
    else if (s === 0) {
      clearInterval(G.timerIv);
      if (el) { el.textContent = '00:00'; el.className = 'timer tc2'; }
      notify('🔔 Tempo esgotado! Registre os resultados.', 'warn');
      _playTimeUpSound();
    }
  }, 500);
}

function _resumeTimerIfNeeded() {
  const t = ct(); if (!t) return;
  if (t.timerStartedAt && t._timerPausedAt == null) {
    const elapsed = Math.floor((Date.now() - t.timerStartedAt) / 1000);
    t._timer  = Math.max(0, t.settings.timerMinutes * 60 - elapsed);
    t._timerOn = true;
    _startTimerInterval();
  }
}

function _playTimeUpSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // 3 bips descendentes
    [[880,0],[660,0.3],[440,0.6]].forEach(([freq, delay]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.4, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.4);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.5);
    });
  } catch(e) { /* AudioContext não disponível */ }
}

function openTimerConfig() {
  const t = ct(); if (!t) return;
  const rules = getTimerRules(t);
  G.modal = { type: 'timer-config' };
  render();
}

function renderTimerConfigModal() {
  const t = ct(); if (!t) return '';
  const rules   = getTimerRules(t);
  const curMins = t.settings?.timerMinutes || getPhaseMinutes(t);
  return `
<div class="mtitle"><i class="ti ti-clock"></i> Configurar timer da rodada</div>
<div class="card mb12" style="background:var(--s1);border:none">
  <div class="lbl mb4">Regras oficiais para este modo (${(t.mode||'cup').toUpperCase()})</div>
  <div class="g2">
    <div class="well tc">
      <div style="font-size:18px;font-weight:700">${rules.swiss}min</div>
      <div class="muted small">Swiss (${rules.swissBO})</div>
    </div>
    <div class="well tc">
      <div style="font-size:18px;font-weight:700">${rules.topCut}min</div>
      <div class="muted small">Top Cut (${rules.topCutBO})</div>
    </div>
  </div>
  <div class="muted small mt8">+${rules.extraTurns} turnos extras após o tempo</div>
</div>
<div class="f mb12">
  <label>Tempo customizado (min)</label>
  <input type="number" id="tcfg-min" min="5" max="120" value="${curMins}" style="font-size:18px;text-align:center">
</div>
<div class="g2 mb4">
  ${[20,30,50,60].map(m=>`<button class="btn" onclick="document.getElementById('tcfg-min').value=${m}">${m}min</button>`).join('')}
</div>
<div class="sep"></div>
<div class="fx gap6" style="justify-content:flex-end">
  <button class="btn" onclick="closeM()">Cancelar</button>
  <button class="btn btn-p" onclick="applyTimerConfig()"><i class="ti ti-check"></i> Aplicar e resetar</button>
</div>`;
}

function applyTimerConfig() {
  const t = ct(); if (!t) return;
  const mins = parseInt(document.getElementById('tcfg-min')?.value) || 50;
  mtour(t => {
    t.settings.timerMinutes = mins;
    t._timer   = mins * 60;
    t._timerOn = false;
    clearInterval(G.timerIv);
  });
  closeM();
  notify(`Timer configurado: ${mins} min`, 'ok');
}

function renderSettings() {
  const s = G.settings;
  const statusColor = syncStatus==='ok'?'bs':syncStatus==='error'?'bd':syncStatus==='syncing'?'bw':'bn';
  const statusLabel = syncStatus==='ok'?'Sincronizado com Supabase':syncStatus==='error'?`Erro: ${syncError}`:syncStatus==='syncing'?'Sincronizando…':'Offline (cache local)';
  return `
<h1 class="mb20">Configurações globais</h1>
<div style="max-width:540px">

<div class="card mb16" style="border-color:var(--it)">
  <div class="fx gap8 mb12">
    <i class="ti ti-database" style="color:var(--it);font-size:20px"></i>
    <h3>Supabase</h3>
    <span class="badge ${statusColor} ml">${statusLabel}</span>
  </div>
  <div class="well mb12" style="font-size:12px">
    <div class="mono mb4" style="color:var(--t2)">URL</div>
    <div class="mono">${SB_URL}</div>
  </div>
  <div class="fxc gap8">
    <button class="btn btn-p btn-sm" onclick="reloadFromSupabase()"><i class="ti ti-refresh"></i> Recarregar do Supabase</button>
    <button class="btn btn-sm" onclick="forceSyncAll()"><i class="ti ti-cloud-upload"></i> Forçar sync completo</button>
  </div>
  <div class="sep"></div>
  <h3 class="mb8">⚠ Precisando rodar a migration?</h3>
  <p class="muted small mb8">Se o app mostrar erro 404 ao salvar, rode este SQL no <a href="https://supabase.com/dashboard/project/dlzfxzkvcdycvovnqeya/sql/new" target="_blank" style="color:var(--it)">SQL Editor</a>:</p>
  <div class="dblog" style="font-size:12px;max-height:80px">ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS full_state JSONB DEFAULT '{}';\nGRANT ALL ON tournaments TO anon, authenticated;\nGRANT ALL ON players TO anon, authenticated;</div>
  <p class="muted small mt8">Também precisa adicionar seu domínio em: <strong>Settings → API → Allowed hosts</strong></p>
</div>

<div class="card mb16">
  <h3 class="mb12">Padrões de torneio</h3>
  <div class="f"><label>Tempo padrão por rodada (min)</label><input type="number" id="st-timer" value="${s.timerMinutes||50}"></div>
  <div class="f"><label>Seed padrão (vazio = aleatório)</label><input id="st-seed" value="${s.seed||''}"></div>
  <div class="fxc gap12 mt8">
    <label class="fx gap6"><input type="checkbox" id="st-sepdiv" ${s.separateDivisions!==false?'checked':''}> Separar divisões por padrão</label>
    <label class="fx gap6"><input type="checkbox" id="st-divst"  ${s.standingsByDiv!==false?'checked':''}> Standings por divisão</label>
    <label class="fx gap6"><input type="checkbox" id="st-debug"  ${s.debugMode?'checked':''}> Modo debug</label>
  </div>
</div>
<button class="btn btn-p" onclick="saveSettings()"><i class="ti ti-check"></i> Salvar</button>
<div class="card mt16">
  <h3 class="mb8">Dados locais</h3>
  <div class="fx gap8">
    <button class="btn btn-sm" onclick="exportPlayers()"><i class="ti ti-download"></i> Exportar jogadores</button>
    <button class="btn btn-sm btn-d" onclick="clearData()"><i class="ti ti-trash"></i> Limpar tudo</button>
  </div>
</div>
</div>`;}

async function reloadFromSupabase() {
  G.loading = true; render();
  try {
    const [sbP, sbT] = await Promise.all([SB.loadPlayers(), SB.loadTournaments()]);
    G.players = (sbP||[]).map(SB.rowP);
    G.tours   = (sbT||[]).map(SB.rowT);
    G.tours.forEach(t=>{if(!t._timer)t._timer=(t.settings?.timerMinutes||50)*60;t._timerOn=false;});
    DB.save(SK.PL, G.players); DB.save(SK.TN, G.tours);
    setSyncStatus('ok'); notify('Dados recarregados do Supabase','ok');
  } catch(e) { setSyncStatus('error',e.message); notify('Erro: '+e.message,'err'); }
  G.loading=false; render();
}

async function forceSyncAll() {
  setSyncStatus('syncing');
  try {
    await SB.savePlayers(G.players);
    for (const t of G.tours) await SB.saveTournament(t);
    setSyncStatus('ok'); notify('Sync completo','ok');
  } catch(e) { setSyncStatus('error',e.message); notify('Erro: '+e.message,'err'); }
}

function renderModal() {
  const m = G.modal;
  let body = '', maxW = '480px';

  if (m.type === 'player') {
    const p = m.id ? G.players.find(x=>x.id===m.id) : null;
    const div = p?.division || 'Masters';
    body = `
<div class="mtitle">${p?'Editar jogador':'Novo jogador'}</div>
<div class="g2">
  <div class="f"><label>Nome completo *</label><input id="m-name" value="${esc(p?.name||'')}" autofocus></div>
  <div class="f"><label>Nickname</label><input id="m-nick" value="${esc(p?.nickname||'')}"></div>
</div>
<div class="g2">
  <div class="f"><label>Player ID (Pokémon)</label><input id="m-pid" value="${esc(p?.playerId||'')}"></div>
  <div class="f"><label>Ano de nascimento</label><input type="number" id="m-birth" placeholder="ex: 2005" min="1940" max="${new Date().getFullYear()}" value="${p?.birthDate?extractYear(p.birthDate)||'':''}" oninput="autoDivM(this.value)"></div>
</div>
<div class="g2">
  <div class="f"><label>Divisão *</label><select id="m-div">${DIVS.map(d=>`<option ${div===d?'selected':''}>${d}</option>`).join('')}</select></div>
  <div class="f"><label>Contato</label><input id="m-contact" value="${esc(p?.contact||'')}"></div>
</div>
<div class="g2">
  <div class="f"><label>Cidade</label><input id="m-city" value="${esc(p?.city||'')}"></div>
  <div class="f"><label>Estado</label><input id="m-state" value="${esc(p?.state||'')}"></div>
</div>
<div class="f"><label>Observações</label><textarea id="m-notes" style="height:60px">${esc(p?.notes||'')}</textarea></div>
<div class="fx gap6" style="justify-content:flex-end;margin-top:4px">
  <button class="btn" onclick="closeM()">Cancelar</button>
  <button class="btn btn-p" onclick="savePlayer('${m.id||''}','${m.addToTour||''}')"><i class="ti ti-check"></i> Salvar</button>
</div>`;
  }

  if (m.type === 'edit-tour') {
    const t = ct();
    body = `
<div class="mtitle"><i class="ti ti-edit"></i> Editar informações do torneio</div>
<div class="f"><label>Nome *</label><input id="et-name" value="${esc(t?.name||'')}"></div>
<div class="g2">
  <div class="f"><label>Cidade</label><input id="et-city" value="${esc(t?.city||'')}"></div>
  <div class="f"><label>Estado</label><input id="et-state" value="${esc(t?.state||'')}"></div>
</div>
<div class="g2">
  <div class="f"><label>Data</label><input type="date" id="et-date" value="${t?.date||''}"></div>
  <div class="f"><label>ID Sancionada</label><input id="et-sanction" placeholder="##-##-######" value="${esc(t?.sanctionedId||'')}" style="font-family:var(--mono)"></div>
</div>
<div class="f"><label>Local</label>
  <select id="et-venue">
    <option value="">Sem local</option>
    ${G.venues.filter(v=>v.active!==false).map(v=>`<option value="${v.id}" ${(t?.venueId||'')=== v.id?'selected':''}>${esc(v.name)}${v.city?' — '+esc(v.city):''}</option>`).join('')}
  </select>
</div>
<div class="fx gap6" style="justify-content:flex-end;margin-top:4px">
  <button class="btn" onclick="closeM()">Cancelar</button>
  <button class="btn btn-p" onclick="saveEditTour()"><i class="ti ti-check"></i> Salvar</button>
</div>`;
  }

  if (m.type === 'login') { body = renderLoginModal(); maxW = '360px'; }
  if (m.type === 'venue') { body = renderVenueModal(); }
  if (m.type === 'arch') { body = renderArchModal(); }
  if (m.type === 'deck')         { body = renderDeckModal(); }
  if (m.type === 'timer-config') { body = renderTimerConfigModal(); maxW = '420px'; }

  if (m.type === 'judge') {
    const t = ct(), rnd = t?.rounds[t.currentRound-1];
    const pair = rnd?.pairings.find(p=>p.id===m.pid);
    body = `
<div class="mtitle"><i class="ti ti-gavel"></i> Edição de juiz — Mesa ${pair?.table||'?'}</div>
<p class="muted small mb12">${pair?`${pname(pair.p1,t)} vs ${pair.p2==='BYE'?'BYE':pname(pair.p2,t)}`:''}</p>
<div class="f"><label>Resultado</label><select id="j-res">
  <option value="">Sem resultado</option>
  <option value="${R.P1}" ${pair?.result===R.P1?'selected':''}>P1 venceu</option>
  <option value="${R.P2}" ${pair?.result===R.P2?'selected':''}>P2 venceu</option>
  <option value="${R.TIE}" ${pair?.result===R.TIE?'selected':''}>Empate</option>
  <option value="${R.DL}"  ${pair?.result===R.DL?'selected':''}>Double Loss</option>
</select></div>
<div class="f"><label>Nota</label><input id="j-note" value="${esc(pair?.judgeNote||'')}" placeholder="Penalidade, extensão..."></div>
<label class="fx gap6 mb12"><input type="checkbox" id="j-drop1" ${t?.players.find(x=>x.id===pair?.p1)?.dropped?'checked':''}> Drop P1 (${pair?pname(pair.p1,t):''})</label>
<label class="fx gap6 mb16"><input type="checkbox" id="j-drop2" ${t?.players.find(x=>x.id===pair?.p2)?.dropped?'checked':''}> Drop P2 (${pair&&pair.p2!=='BYE'?pname(pair.p2,t):''})</label>
<div class="fx gap6" style="justify-content:flex-end">
  <button class="btn" onclick="closeM()">Cancelar</button>
  <button class="btn btn-p" onclick="saveJudge('${m.pid}')"><i class="ti ti-check"></i> Salvar</button>
</div>`;
  }

  return `<div class="mbg" onclick="if(event.target===this)closeM()"><div class="mbox">${body}</div></div>`;
}

function autoDivM(yr) { const d=inferDiv(yr); const s=document.getElementById('m-div'); if(s)s.value=d; }

function render() {
  const app = document.getElementById('app');

  // Loading screen
  if (G.loading) {
    app.innerHTML = `
    <div class="loading-screen">
      <div class="spinner"></div>
      <span style="color:var(--t2);font-size:14px">Conectando ao Supabase…</span>
      ${G.loadError?`<div class="badge bd mt8">${esc(G.loadError)}</div><button class="btn btn-sm mt8" onclick="loadOffline()">Continuar offline</button>`:''}
    </div>`;
    return;
  }

  const isTour = G.view === 'tournament';

  const navItems = [
    { icon:'ti-home',   label:'Home',       view:'home' },
    { icon:'ti-users',  label:'Jogadores',  view:'players' },
    { icon:'ti-trophy', label:'Torneios',   view:'tours' },
    { icon:'ti-cards',  label:'Decklists',  view:'decklists' },
    { icon:'ti-building-store', label:'Locais', view:'venues' },
    { icon:'ti-calendar-month', label:'Temporadas', view:'seasons' },
    { icon:'ti-medal',  label:'Ranking', view:'ranking' },
    null,
    { icon:'ti-settings',label:'Config.',   view:'settings' },
  ];

  const sidebar = !isTour ? `<div class="sb">
    ${navItems.map(n => n===null
      ? `<div style="height:8px"></div>`
      : `<div class="ni ${G.view===n.view?'on':''}" onclick="nav('${n.view}');G.search=''">
          <i class="ti ${n.icon}"></i>${n.label}</div>`
    ).join('')}
  </div>` : '';

  let content = '';
  if (G.view==='home')        content = renderHome();
  else if (G.view==='players') content = renderPlayers();
  else if (G.view==='pdetail') content = renderPDetail();
  else if (G.view==='tours')     content = renderTours();
  else if (G.view==='decklists')  content = renderGlobalDecklists();
  else if (G.view==='venues')      content = renderVenues();
  else if (G.view==='vdetail')     content = renderVenueDetail();
  else if (G.view==='ctour')   content = renderCreateTour();
  else if (G.view==='tournament') content = renderTour();
  else if (G.view==='seasons')  content = renderSeasons();
  else if (G.view==='ranking')   content = renderRanking();
  else if (G.view==='settings') content = renderSettings();



  app.innerHTML = `
  ${!isTour ? `<div class="tb">
    <strong style="font-size:15px;letter-spacing:-.3px">Jerry</strong>
    <span class="badge bn" style="font-size:10px">v${VER}</span>
    <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
      ${isLoggedIn()
        ? `<span class="muted" style="font-size:11px">${esc(G.auth.email.split('@')[0])}</span>
           <button class="btn btn-xs" onclick="doSignOut()" title="Sair"><i class="ti ti-logout"></i></button>`
        : `<button class="btn btn-xs btn-p" onclick="G.modal={type:'login'};render()" style="gap:4px">
             <i class="ti ti-lock" style="font-size:13px"></i> Entrar
           </button>`}
      <span class="sync-dot ${syncStatus}" id="sync-dot" title="${esc(syncError)}"></span>
    </div>
  </div>` : ''}
  <div class="layout">
    ${sidebar}
    <div class="${isTour?'full-main':'main'}">${content}</div>
  </div>
  <div id="notif-slot">${renderNotif()}</div>
  ${G.modal ? renderModal() : ''}`;

}

function renderNotif() {
  if (!G.notif) return '';
  return `<div class="notif ${G.notif.type}">${esc(G.notif.msg)}</div>`;
}

function openPModal(id, addToTour=false) { G.modal={type:'player',id,addToTour}; render(); }

function savePlayer(id, addToTourId) {
  const name = document.getElementById('m-name')?.value?.trim();
  if (!name) return notify('Nome é obrigatório','err');
  const dup = G.players.find(p=>norm(p.name)===norm(name)&&p.id!==id);
  if (dup && !confirm(`"${dup.name}" já existe. Criar mesmo assim?`)) return;
  const data = {
    name,
    nickname: document.getElementById('m-nick')?.value?.trim()||'',
    playerId: document.getElementById('m-pid')?.value?.trim()||'',
    birthDate: document.getElementById('m-birth')?.value?.trim()||'',
    division: document.getElementById('m-div')?.value||'Masters',
    contact: document.getElementById('m-contact')?.value?.trim()||'',
    city: document.getElementById('m-city')?.value?.trim()||'',
    state: document.getElementById('m-state')?.value?.trim()||'',
    notes: document.getElementById('m-notes')?.value?.trim()||'',
  };
  if (id) {
    const i = G.players.findIndex(p=>p.id===id);
    if (i>=0) G.players[i]={...G.players[i],...data};
  } else {
    const np = {id:uid(), createdAt:Date.now(), ...data};
    G.players.push(np);
    if (addToTourId) { addFromDB(np.id); return; }
  }
  saveAll(); closeM(); notify('Jogador salvo','ok');
}

function delPlayer(id) {
  if (!requireAuth()) return;
  if (!confirm('Excluir jogador?')) return;
  G.players = G.players.filter(p=>p.id!==id);
  DB.save(SK.PL, G.players);
  SB.deletePlayer(id).then(()=>setSyncStatus('ok')).catch(e=>setSyncStatus('error',e.message));
  notify('Excluído'); render();
}

function exportPlayers() {
  blob(JSON.stringify(G.players,null,2), `ptcg-jogadores-${Date.now()}.json`);
}

function importPlayersFile() {
  pick('.json', data => {
    const arr = JSON.parse(data);
    if (!Array.isArray(arr)) return notify('Formato inválido','err');
    let added=0;
    arr.forEach(p => { if (!G.players.find(x=>x.id===p.id)) { G.players.push(p); added++; } });
    saveAll(); notify(`${added} jogadores importados`,'ok'); render();
  });
}

/* Import players.xml from TOM local database */
function importPlayersTOM() {
  pick('.xml', xmlStr => {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlStr, 'application/xml');
    const err    = doc.querySelector('parsererror');
    if (err) return notify('XML inválido','err');

    const playerEls = doc.querySelectorAll('players > player');
    if (!playerEls.length) return notify('Nenhum jogador encontrado no arquivo','err');

    let added=0, updated=0, skipped=0;

    for (const pel of playerEls) {
      const userId    = pel.getAttribute('userid') || '';
      const firstName = pel.querySelector('firstname')?.textContent?.trim() || '';
      const lastName  = pel.querySelector('lastname')?.textContent?.trim()  || '';
      const bdRaw     = pel.querySelector('birthdate')?.textContent?.trim() || '';
      const name      = [firstName, lastName].filter(Boolean).join(' ');
      if (!name) continue;

      // Birth year: always 02/27/YYYY in TOM
      const birthYear = String(extractYear(tdfDateToISO(bdRaw)) || '');
      const division  = inferDiv(birthYear);

      // Try to find existing by playerId or name
      const existing = G.players.find(p =>
        (userId && p.playerId === userId) ||
        norm(p.name) === norm(name)
      );

      if (existing) {
        // Update playerId if we now have it and didn't before
        if (userId && !existing.playerId) {
          existing.playerId  = userId;
          existing.birthDate = birthYear || existing.birthDate;
          existing.division  = division;
          updated++;
        } else {
          skipped++;
        }
      } else {
        G.players.push({
          id:        uid(),
          createdAt: Date.now(),
          name,
          nickname:  '',
          playerId:  userId,
          birthDate: birthYear,
          division,
          city:      '',
          state:     '',
          contact:   '',
          notes:     'Importado via players.xml (TOM)',
        });
        added++;
      }
    }

    saveAll();
    const parts = [];
    if (added)   parts.push(`${added} adicionados`);
    if (updated) parts.push(`${updated} atualizados`);
    if (skipped) parts.push(`${skipped} ignorados`);
    notify(`players.xml: ${parts.join(', ')}`, 'ok');
    render();
  });
}

function createTour() {
  if (!requireAuth()) return;
  const name = document.getElementById('ct-name')?.value?.trim();
  if (!name) return notify('Nome é obrigatório','err');
  const d = G._ctd||{};
  const t = {
    id: uid(), createdAt: Date.now(),
    name, city: document.getElementById('ct-city')?.value?.trim()||'',
    state: document.getElementById('ct-state')?.value?.trim()||'',
    date: document.getElementById('ct-date')?.value||'',
    sanctionedId: document.getElementById('ct-sanction')?.value?.trim()||'',
      venueId: document.getElementById('ct-venue')?.value||null,
    mode: d.mode||'cup',
    status: 'registration',
    players:[], rounds:[], currentRound:0, topBracket:null,
    settings: {
      totalRounds: (()=>{
        const v = document.getElementById('ct-rounds')?.value;
        if (!v || v==='auto') return 'auto'; // resolved at startTour
        if (v==='custom') return Math.max(3, Number(document.getElementById('ct-rounds-custom')?.value)||3);
        return Math.max(3, Number(v));
      })(),
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
  // Include players pre-selected during creation
  if (d.players?.length) t.players = d.players;
  G.tours.push(t); G._ctd=null;
  saveAll(); openTour(t.id);
}

function openTour(id) {
  G.tid=id; const t=G.tours.find(x=>x.id===id);
  G.tab = t?.status==='registration'?'reg':t?.status==='finished'?'finished':'rounds';
  nav('tournament');
}

function delTour(id) {
  if (!requireAuth()) return;
  if (!confirm('Excluir torneio?')) return;
  G.tours = G.tours.filter(t=>t.id!==id);
  DB.save(SK.TN, G.tours);
  SB.deleteTournament(id).then(()=>setSyncStatus('ok')).catch(e=>setSyncStatus('error',e.message));
  notify('Excluído'); nav('tours');
}

function addFromDB(gid) {
  const t=ct(); if(!t)return;
  const gp=G.players.find(p=>p.id===gid); if(!gp)return;
  if (t.players.some(p=>p.gid===gid)) return notify('Já registrado','warn');
  t.players.push({id:uid(),gid,name:gp.name,division:gp.division,dropped:false,dq:false,hadBye:false});
  saveAll();
  // Limpa search
  const inp=document.getElementById('reg-q'); if(inp) inp.value='';
  const res=document.getElementById('reg-res'); if(res) res.innerHTML='';
  notify(gp.name+' adicionado','ok');
  // Atualiza só os dois painéis no DOM — sem render() completo
  _refreshRegPlayerList(t);
  _updateRegHeader(t);
  // Refresca banco (remove o jogador que acabou de entrar)
  const dbEl = document.getElementById('reg-db-list');
  if (dbEl) dbEl.innerHTML = renderRegDBList(t, _regDBFilter, _regDBPage);
}

function _refreshRegPlayerList(t) {
  const el = document.getElementById('reg-player-list');
  if (!el) { render(); return; }
  if (!t.players.length) {
    el.innerHTML = '<div class="empty"><i class="ti ti-users"></i><p>Nenhum jogador</p></div>';
    return;
  }
  el.innerHTML = t.players.map((p,i) => {
    const gp  = G.players.find(x => x.id === p.gid);
    const pid = gp?.playerId || p.gid || p.id;
    return '<div class="plr">' +
      '<span class="mono muted" style="min-width:24px">' + (i+1) + '</span>' +
      '<span style="flex:1">' + esc(p.name) + '</span>' + dbadge(p.division) +
      '<a href="player.html?id=' + encodeURIComponent(pid) + '&tour=' + t.id + '" target="_blank" class="ib" title="Página pública"><i class="ti ti-external-link"></i></a>' +
      '<button class="ib" onclick="removeFromTour(\'' + p.id + '\')"><i class="ti ti-x"></i></button>' +
      '</div>';
  }).join('');
}

function _updateRegHeader(t) {
  const el = document.getElementById('reg-header-badges');
  if (!el) return;
  const byDiv = DIVS.map(d=>({d,c:t.players.filter(p=>p.division===d).length})).filter(x=>x.c>0);
  const rec = recRounds(t.players.length);
  const cut = recCut(t.players.length, t.settings?.mode);
  el.innerHTML =
    byDiv.map(({d,c}) => '<span class="badge ' + DC[d] + '">' + d[0] + ': ' + c + '</span>').join('') +
    (t.players.length > 0 ? '<span class="muted small">' + rec + ' rodadas · ' + (cut ? 'Top '+cut : 'Sem top cut') + '</span>' : '');
  // Habilita/desabilita botão iniciar
  const btn = document.getElementById('reg-start-btn');
  if (btn) btn.disabled = t.players.length < 2;
}

function addBulk() {
  const t=ct(); if(!t)return;
  const txt=document.getElementById('bulk-in')?.value||'';
  const div=document.getElementById('bulk-div')?.value||'Masters';
  let added=0;
  txt.split('\n').map(l=>l.trim()).filter(Boolean).forEach(name=>{
    let gp=G.players.find(p=>norm(p.name)===norm(name));
    if(!gp){gp={id:uid(),name,division:div,createdAt:Date.now(),nickname:'',playerId:'',city:'',state:'',birthDate:'',contact:'',notes:''};G.players.push(gp);}
    if(!t.players.some(p=>p.gid===gp.id)){t.players.push({id:uid(),gid:gp.id,name:gp.name,division:div,dropped:false,dq:false,hadBye:false});added++;}
  });
  saveAll(); notify(added + ' jogador' + (added!==1?'es':'') + ' adicionado' + (added!==1?'s':''),'ok');
  const _tb=ct(); if(_tb){_refreshRegPlayerList(_tb);_updateRegHeader(_tb);}
}

function removeFromTour(pid) {
  mtour(t=>{
    t.players = t.players.filter(p=>p.id!==pid);
    _refreshRegPlayerList(t);
    _updateRegHeader(t);
    const dbEl = document.getElementById('reg-db-list');
    if (dbEl) dbEl.innerHTML = renderRegDBList(t, _regDBFilter, _regDBPage);
  });
}

function startTour() {
  if (!requireAuth()) return;
  const t=ct(); if(!t) return;
  if(t.players.length < 4) return notify('Mínimo de 4 jogadores para iniciar','err');
  const n=t.players.length;
  // Resolve 'auto' ou valor inválido pelo nº real de jogadores
  if(!t.settings.totalRounds || t.settings.totalRounds==='auto' || isNaN(Number(t.settings.totalRounds)))
    t.settings.totalRounds = recRounds(n);
  t.settings.totalRounds = Math.max(3, Number(t.settings.totalRounds));
  if (t.settings.topCutSize===undefined) t.settings.topCutSize=recCut(n,t.settings.mode);
  const {pairings,log,seed} = generateSwiss(t);
  t.rounds.push({number:1,pairings,pairingLog:log,seed,timestamp:Date.now()});
  if (!t.settings.timerMinutes) {
    const rules = TIMER_RULES[t.mode||'cup']||TIMER_RULES.cup;
    t.settings.timerMinutes = rules.swiss;
  }
  t.currentRound=1; t.status='rounds'; t._timer=t.settings.timerMinutes*60;
  G.lastLog=log; G.tab='rounds';
  saveAll(); render();
}

function setRes(pid, result) {
  if (!requireAuth()) return;
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
  if (!requireAuth()) return;
  if(!confirm('Confirmar drop?'))return;
  mtour(t=>{ t.players=t.players.map(p=>p.id===pid?{...p,dropped:true}:p); });
}

function advanceRound() {
  if (!requireAuth()) return;
  const t=ct(); if(!t)return;
  const rnd=t.rounds[t.currentRound-1];
  if(!rnd||!rnd.pairings.every(p=>p.result!==null)) return notify('Lance todos os resultados primeiro','warn');

  // Mark bye players
  rnd.pairings.filter(p=>p.isBye).forEach(p=>{
    t.players=t.players.map(x=>x.id===p.p1?{...x,hadBye:true}:x);
  });

  const isLast=t.currentRound>=t.settings.totalRounds;
  if(isLast){
    if(t.settings.topCutSize>0){
      const stand=getStandings(t.players,t.rounds);
      t.topBracket=buildTopCut(stand,t.settings.topCutSize);
      t.status='topcut'; G.tab='topcut';
    } else {
      t.status='finished'; G.tab='finished';
    }
  } else {
    const {pairings,log,seed}=generateSwiss(t);
    t.rounds.push({number:t.currentRound+1,pairings,pairingLog:log,seed,timestamp:Date.now()});
    t.currentRound++; t._timer=t.settings.timerMinutes*60; t._timerOn=false;
    clearInterval(G.timerIv); G.lastLog=log; G.tab='rounds';
  }
  saveAll(); render();
}

function advanceTC() {
  const t=ct(); if(!t?.topBracket)return;
  const last=t.topBracket[t.topBracket.length-1];
  if(!last.matches.every(m=>m.winner)) return notify('Defina todos os vencedores','warn');
  if(last.matches.length===1){ t.status='finished'; G.tab='finished'; }
  else {
    const nb=advanceBracket(t.topBracket);
    if(nb) t.topBracket=nb;
  }
  saveAll(); render();
}

function setTC(mid, winner) {
  mtour(t=>{
    const last=t.topBracket[t.topBracket.length-1];
    last.matches=last.matches.map(m=>m.id===mid?{...m,winner}:m);
  });
}

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
        const cls=t._timer<300?'tc2':t._timer<600?'tw':'';
        if(el){el.textContent=fmt(t._timer);el.className='timer '+cls;}
        // Alertas nos marcos oficiais
        if(t._timer===600) notify('⏱ 10 minutos!','warn');
        else if(t._timer===300) notify('⚠️ 5 minutos!','warn');
        else if(t._timer===60)  notify('🚨 1 minuto!','warn');
      } else {
        t._timerOn=false; clearInterval(G.timerIv);
        const el=document.getElementById('tmr');
        if(el){el.textContent='00:00';el.className='timer tc2';}
        notify('🔔 Tempo esgotado! Registre os resultados.','warn');
        _playTimeUpSound();
        render();
      }
    },1000);
  } else clearInterval(G.timerIv);
  saveAll(); render();
}

function resetTimer() {
  const t=ct();if(!t)return;
  clearInterval(G.timerIv); t._timerOn=false; t._timer=t.settings.timerMinutes*60;
  saveAll(); render();
}

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

function saveSettings() {
  G.settings.timerMinutes      = Number(document.getElementById('st-timer')?.value)||50;
  G.settings.seed              = document.getElementById('st-seed')?.value?.trim()||'';
  G.settings.separateDivisions = document.getElementById('st-sepdiv')?.checked??true;
  G.settings.standingsByDiv    = document.getElementById('st-divst')?.checked??true;
  G.settings.debugMode         = document.getElementById('st-debug')?.checked||false;
  DB.save(SK.ST, G.settings);
  notify('Salvo','ok');
}

function clearData() {
  if(!confirm('Apagar TODOS os dados?'))return;
  if(!confirm('Confirme: sem possibilidade de recuperação.'))return;
  G.players=[];G.tours=[];saveAll();notify('Dados apagados');render();
}

function exportTour(id) {
  const t=G.tours.find(x=>x.id===id)||ct();if(!t)return;
  blob(JSON.stringify(t,null,2),`torneio-${t.name.replace(/[^a-z0-9]/gi,'-')}-${Date.now()}.json`);
}

function importTour() {
  pick('.json', data=>{
    const d=JSON.parse(data);
    if(d.players&&d.rounds!==undefined){
      if(!G.tours.find(x=>x.id===d.id)) G.tours.push(d);
      else if(confirm('Torneio já existe. Substituir?')) G.tours=G.tours.map(t=>t.id===d.id?d:t);
      saveAll(); notify('Importado','ok'); nav('tours');
    } else notify('Formato de torneio inválido','err');
  });
}

function exportCSV(id) {
  const t=G.tours.find(x=>x.id===id)||ct();if(!t)return;
  const stand=getStandings(t.players,t.rounds);
  const rows=[['Pos','Nome','Divisão','Pts','W','L','E','OWP%','OOWP%'],...stand.map((p,i)=>[i+1,p.name,p.division,p.mp,p.w,p.l,p.t,(p.owp*100).toFixed(2),(p.oowp*100).toFixed(2)])];
  blob(rows.map(r=>r.join(',')).join('\n'),`standings-${t.name.replace(/[^a-z0-9]/gi,'-')}.csv`,'text/csv');
}

function exportPlayerCSV(id) {
  const t=G.tours.find(x=>x.id===id)||ct();if(!t)return;
  const rows=[['Nome','Divisão','Drop','DQ'],...t.players.map(p=>[p.name,p.division,p.dropped?'Sim':'Não',p.dq?'Sim':'Não'])];
  blob(rows.map(r=>r.join(',')).join('\n'),`jogadores-${t.name.replace(/[^a-z0-9]/gi,'-')}.csv`,'text/csv');
}

/* ═══════════════════════════════════════════════════════════════
   TDF ENGINE — Tournament Data File (TOM official format)
   ---------------------------------------------------------------
   Spec reverse-engineered from TOM v1.74 .tdf files
   Outcome codes: 1=P1 wins, 2=P2 wins, 3=Tie, 4=Double Loss, 5=Bye
   Category codes: 0=Juniors, 1=Seniors, 2=Masters
   Stage codes (round): 6=Swiss completed, 8=Last Swiss round
   Tournament stage: 5=Finished
═══════════════════════════════════════════════════════════════ */

const TDF_OUT_TO_R  = { 1:R.P1, 2:R.P2, 3:R.TIE, 4:R.DL, 5:R.BYE };
const TDF_R_TO_OUT  = { [R.P1]:1, [R.P2]:2, [R.TIE]:3, [R.DL]:4, [R.BYE]:5 };
const TDF_CAT_DIV   = { 0:'Juniors', 1:'Seniors', 2:'Masters' };
const TDF_DIV_CAT   = { Juniors:0, Seniors:1, Masters:2 };

/* ── DATE HELPERS ─────────────────────────────────────────── */
// TDF uses MM/DD/YYYY; we use YYYY-MM-DD
function tdfDateToISO(d) {
  if (!d) return '';
  const [m,day,y] = d.split('/');
  if (!y) return '';
  return `${y}-${(m||'01').padStart(2,'0')}-${(day||'01').padStart(2,'0')}`;
}
function isoToTdfDate(d) {
  if (!d) return '';
  const [y,m,day] = d.split('-');
  if (!y) return '';
  return `${(m||'01').padStart(2,'0')}/${(day||'01').padStart(2,'0')}/${y}`;
}
function nowTdfTs() {
  const n = new Date();
  const mm = String(n.getMonth()+1).padStart(2,'0');
  const dd = String(n.getDate()).padStart(2,'0');
  const yy = n.getFullYear();
  const hh = String(n.getHours()).padStart(2,'0');
  const mi = String(n.getMinutes()).padStart(2,'0');
  const ss = String(n.getSeconds()).padStart(2,'0');
  return `${mm}/${dd}/${yy} ${hh}:${mi}:${ss}`;
}
function escXML(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

// Ponto de entrada — inicialização e exposição global















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
  openEditTourModal, saveEditTour, toggleDeckList, saveCTFormState, _refreshCTPlayerPanel,
  setCTMode, onCTRoundsChange,
  isLoggedIn, requireAuth, doSignIn, doSignOut,
  clearTourPlayers, ctAddPlayer, ctRemovePlayer, renderCTPlayerSearch,
  regDBPage, refreshRegDB, regSearchEnter,
  openDeckModal, saveDeckModal, saveDeckQuick, clearDeck, filterDeckList,
  openArchModal, saveArchModal, deleteArchetype, addGlobalArchetype,
  printPairings, printMatchSlips, printStandings,
  updatePlayersList, updateToursList, updateDecksList, updateVenuesList,
  openVenueModal, saveVenueModal, deleteVenue,
});

// ── Init ─────────────────────────────────────────────────────



/* ════════════════════════════════════════════════════════
   PARTIAL LIST UPDATERS — avoid losing focus on search
════════════════════════════════════════════════════════ */
function _playerRow(p, i) {
  return `<div class="plr" onclick="nav('pdetail',{pid:'${p.id}'})">
    <div class="av">${esc(initials(p.name))}</div>
    <div style="flex:1;min-width:0">
      <div class="fx gap6">
        <strong>${esc(p.name)}</strong>
        ${p.nickname?`<span class="muted small">"${esc(p.nickname)}"</span>`:''}
        ${dbadge(p.division)}
      </div>
      <div class="muted small mt4">${p.playerId?'ID: '+esc(p.playerId)+' · ':''}${esc(p.city||'')}${p.state?' / '+p.state:''}${(!p.playerId||!p.birthDate)?'<span class="muted" style="color:var(--wt);margin-left:4px">⚠</span>':''}</div>
    </div>
    <div class="fx gap4">
      <button class="btn btn-xs" onclick="event.stopPropagation();openPModal('${p.id}')"><i class="ti ti-edit"></i></button>
      <button class="btn btn-xs btn-d" onclick="event.stopPropagation();delPlayer('${p.id}')"><i class="ti ti-trash"></i></button>
    </div>
  </div>`;
}

function updatePlayersList(q) {
  G.search = q;
  const nq = norm(q);
  const list = G.players.filter(p =>
    !nq || norm(p.name).includes(nq) ||
    norm(p.nickname||'').includes(nq) ||
    norm(p.playerId||'').includes(nq) ||
    norm(p.city||'').includes(nq)
  );
  const el = document.getElementById('players-list');
  const ct = document.getElementById('players-count');
  if (el) el.innerHTML = list.length===0
    ? `<div class="empty"><i class="ti ti-user-off"></i><p>Nenhum jogador encontrado</p></div>`
    : list.map((p,i) => _playerRow(p,i)).join('');
  if (ct) ct.textContent = list.length + ' jogador' + (list.length!==1?'es':'');
}

function updateToursList(q) {
  G.search = q;
  const nq = norm(q);
  const list = G.tours
    .filter(t => !nq || norm(t.name).includes(nq) || norm(t.city||'').includes(nq))
    .sort((a,b) => { const sortByDate = (a,b) => { const da = a.date ? new Date(a.date).getTime() : a.createdAt; const db = b.date ? new Date(b.date).getTime() : b.createdAt; return db - da; };; return sortByDate(a,b); });
  const el = document.getElementById('tours-list');
  if (!el) return;
  el.innerHTML = list.length===0
    ? `<div class="empty"><i class="ti ti-trophy"></i><p>Nenhum torneio</p></div>`
    : list.map(t => `<div class="plr" onclick="openTour('${t.id}')">
        <div style="flex:1">
          <div class="fx gap6 mb4"><strong>${esc(t.name)}</strong>${stbadge(t)}</div>
          <div class="muted small">${t.mode?.toUpperCase()||'—'} · ${esc(t.city||'—')}${t.venueId?' · '+esc(venueName(t.venueId)):''} · ${t.players.length} jogadores · ${t.rounds.length}/${t.settings.totalRounds} rodadas</div>
        </div>
        <div class="fx gap4">
          <button class="btn btn-xs" onclick="event.stopPropagation();exportTour('${t.id}')"><i class="ti ti-download"></i></button>
          <button class="btn btn-xs btn-d" onclick="event.stopPropagation();delTour('${t.id}')"><i class="ti ti-trash"></i></button>
          <i class="ti ti-chevron-right muted"></i>
        </div>
      </div>`).join('');
}

function updateDecksList(q) {
  G.search = q;
  const archs = getGlobalArchStats();
  const nq = norm(q);
  const filtered = archs.filter(a => !nq || norm(a.name).includes(nq));
  const el = document.getElementById('decks-table-body');
  const el2 = document.getElementById('decks-top-archs');
  const archColors = ['#D85A30','#7F77DD','#1D9E75','#378ADD','#BA7517','#D4537E','#888780','#639922','#993C1D','#534AB7'];
  if (el) {
    el.innerHTML = filtered.map((a,i) => {
      const color = archColors[archs.indexOf(a) % archColors.length];
      const maxCount = filtered[0]?.count || 1;
      return `<tr>
        <td class="muted mono" style="font-size:11px">${i+1}</td>
        <td><div style="display:flex;align-items:center;gap:8px">
          <span style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></span>
          <span style="font-weight:500">${esc(a.name)}</span>
        </div></td>
        <td><div style="display:flex;align-items:center;gap:8px">
          <div style="width:60px;height:4px;background:var(--s2);border-radius:2px;overflow:hidden">
            <div style="width:${Math.round(a.count/maxCount*100)}%;height:100%;background:${color}"></div>
          </div>
          <span class="mono">${a.count}</span>
        </div></td>
        <td class="mono">${a.tournaments}</td>
        <td class="mono">${a.players}</td>
        <td class="mono muted">${a.w}/${a.l}/${a.t}</td>
        <td><span class="badge ${a.wr>=50?'bs':'bd'}" style="font-size:11px">${a.wr}%</span></td>
      </tr>`;
    }).join('');
  }
}


/* ════════════════════════════════════════════════════════
   RESTORED FUNCTIONS — lost during refactor
════════════════════════════════════════════════════════ */

function renderRegSearch(q) {
  const el = document.getElementById('reg-res');
  if (!el) return;
  if (!q || q.length < 1) { el.innerHTML=''; return; }
  const t = ct(); if (!t) return;
  const have = new Set(t.players.map(p=>p.gid).filter(Boolean));
  const found = G.players.filter(p => !have.has(p.id) && (
    norm(p.name).includes(norm(q)) ||
    norm(p.playerId||'').includes(norm(q))
  )).slice(0, 6);
  el.innerHTML = found.length === 0
    ? `<p class="muted small mt8">Sem resultados. <button class="btn btn-xs" onclick="openPModal(null,true)">Criar novo</button></p>`
    : `<div class="card p0 mt8">${found.map(p=>`
      <div class="plr" style="padding:8px 12px" onclick="addFromDB('${p.id}');document.getElementById('reg-q').value='';document.getElementById('reg-res').innerHTML=''">
        <div style="flex:1">
          <div style="font-size:13px">${esc(p.name)}</div>
          <div class="muted small">${p.division}${p.playerId?' · <span class="mono">'+esc(p.playerId)+'</span>':''}</div>
        </div>
        ${dbadge(p.division)}
        <i class="ti ti-plus muted"></i>
      </div>`).join('')}</div>`;
}

function regSearchEnter() {
  const q = document.getElementById('reg-q')?.value?.trim();
  if (!q) return;
  const t = ct(); if (!t) return;
  const have = new Set(t.players.map(p=>p.gid).filter(Boolean));
  const found = G.players.filter(p => !have.has(p.id) && (
    norm(p.name).startsWith(norm(q)) || norm(p.playerId||'') === norm(q)
  ));
  if (found.length === 1) { addFromDB(found[0].id); document.getElementById('reg-q').value=''; }
}

let _regDBPage = 0, _regDBFilter = '';

function refreshRegDB(filter) {
  _regDBFilter = filter || '';
  _regDBPage = 0;
  const t = ct(); if (!t) return;
  const el = document.getElementById('reg-db-list');
  if (el) el.innerHTML = renderRegDBList(t, _regDBFilter, _regDBPage);
}

function regDBPage(pg) {
  _regDBPage = pg;
  const t = ct(); if (!t) return;
  const el = document.getElementById('reg-db-list');
  if (el) el.innerHTML = renderRegDBList(t, _regDBFilter, _regDBPage);
}

function toggleDeckList(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display==='none' ? 'block' : 'none';
}

function updateVenuesList(q) {
  G.search = q;
  const nq = norm(q);
  const list = G.venues
    .filter(v => !nq || norm(v.name).includes(nq) || norm(v.city||'').includes(nq) || norm(v.responsible||'').includes(nq))
    .sort((a,b) => a.name.localeCompare(b.name,'pt'));
  const el = document.getElementById('venues-list');
  if (el) el.innerHTML = renderVenueRows(list);
}

function openVenueModal(id) {
  G.modal = { type:'venue', id }; render();
}

async function saveVenueModal(id) {
  if (!requireAuth()) return;
  const name = document.getElementById('vm-name')?.value?.trim();
  if (!name) return notify('Nome é obrigatório','err');
  const data = {
    id:           id || uid(),
    name,
    nickname:     document.getElementById('vm-nick')?.value?.trim()||null,
    address:      document.getElementById('vm-addr')?.value?.trim()||null,
    city:         document.getElementById('vm-city')?.value?.trim()||null,
    state:        document.getElementById('vm-state')?.value?.trim()||null,
    zip:          document.getElementById('vm-zip')?.value?.trim()||null,
    responsible:  document.getElementById('vm-resp')?.value?.trim()||null,
    contact:      document.getElementById('vm-contact')?.value?.trim()||null,
    notes:        document.getElementById('vm-notes')?.value?.trim()||null,
    active:       document.getElementById('vm-active')?.checked ?? true,
    organizerName:  document.getElementById('vm-org-name')?.value?.trim()||null,
    organizerPopId: document.getElementById('vm-org-popid')?.value?.trim()||null,
  };
  if (id) {
    G.venues = G.venues.map(v => v.id===id ? {...v,...data} : v);
  } else {
    G.venues.push(data);
  }
  DB.save('ptcg_venues_v3', G.venues);
  SB.saveVenue(data).then(()=>setSyncStatus('ok')).catch(e=>setSyncStatus('error',e.message));
  closeM();
  notify('Local salvo','ok');
}

function deleteVenue(id) {
  if (!requireAuth()) return;
  if (!confirm('Excluir este local? Os torneios vinculados perderão a referência.')) return;
  G.venues = G.venues.filter(v=>v.id!==id);
  DB.save('ptcg_venues_v3', G.venues);
  SB.deleteVenue(id).then(()=>setSyncStatus('ok')).catch(e=>setSyncStatus('error',e.message));
  notify('Local excluído');
  nav('venues');
}

function openArchModal(name) {
  G.modal = { type:'arch', name: name||'' }; render();
}

function saveArchModal(oldName) {
  if (!requireAuth()) return;
  const name = document.getElementById('arch-name')?.value?.trim();
  if (!name) return notify('Informe o nome','warn');
  G.settings.archetypes = G.settings.archetypes || [];
  if (oldName) {
    G.tours.forEach(t => {
      t.players.forEach(p => { if(p.deckArchetype===oldName) p.deckArchetype=name; });
    });
    G.settings.archetypes = G.settings.archetypes.map(a => a===oldName?name:a);
    DB.save(SK.TN, G.tours);
  } else {
    if (!G.settings.archetypes.includes(name)) G.settings.archetypes.push(name);
  }
  G.settings.archetypes.sort((a,b)=>a.localeCompare(b,'pt'));
  DB.save(SK.ST, G.settings);
  closeM(); notify('Salvo','ok');
}

function deleteArchetype(name) {
  if (!requireAuth()) return;
  if (!confirm(`Remover "${name}" do banco? Não afeta decklists já registradas.`)) return;
  G.settings.archetypes = (G.settings.archetypes||[]).filter(a=>a!==name);
  DB.save(SK.ST, G.settings);
  closeM(); notify('Removido'); render();
}

function addGlobalArchetype() {
  if (!requireAuth()) return;
  const name = document.getElementById('ga-name')?.value?.trim();
  if (!name) return notify('Informe o nome do deck','warn');
  G.settings.archetypes = G.settings.archetypes || [];
  if (G.settings.archetypes.some(a => norm(a)===norm(name)))
    return notify('Deck já existe','warn');
  G.settings.archetypes.push(name);
  G.settings.archetypes.sort((a,b) => a.localeCompare(b,'pt'));
  DB.save(SK.ST, G.settings);
  notify(`"${name}" adicionado`,'ok');
  render();
}


function renderTours() {
  const q = norm(G.search);
  const list = G.tours
    .filter(t => !q || norm(t.name).includes(q) || norm(t.city||'').includes(q))
    .sort((a,b) => { const da=a.date?new Date(a.date).getTime():a.createdAt; const db=b.date?new Date(b.date).getTime():b.createdAt; return db-da; });
  return `
<div class="fx sb2 mb16"><h1>Torneios</h1>
  <div class="fx gap6">
    <button class="btn btn-sm" onclick="importTour()"><i class="ti ti-upload"></i> Importar</button>
    <button class="btn btn-p btn-sm" onclick="nav('ctour')"><i class="ti ti-plus"></i> Novo</button>
  </div>
</div>
<div class="sw"><i class="ti ti-search"></i>
  <input id="tours-search" placeholder="Buscar..." value="${esc(G.search)}" oninput="updateToursList(this.value)">
</div>
<div class="card p0" id="tours-list">
${list.length===0?`<div class="empty"><i class="ti ti-trophy"></i><p>Nenhum torneio</p></div>`:
list.map(t=>`<div class="plr" onclick="openTour('${t.id}')">
  <div style="flex:1">
    <div class="fx gap6 mb4"><strong>${esc(t.name)}</strong>${stbadge(t)}</div>
    <div class="muted small">${t.mode?.toUpperCase()||'—'} · ${esc(t.city||'—')}${t.venueId?' · '+esc(venueName(t.venueId)):''} · ${t.players.length} jogadores · ${t.rounds.length}/${t.settings.totalRounds} rodadas</div>
  </div>
  <div class="fx gap4">
    <button class="btn btn-xs" onclick="event.stopPropagation();exportTour('${t.id}')"><i class="ti ti-download"></i></button>
    <button class="btn btn-xs btn-d" onclick="event.stopPropagation();delTour('${t.id}')"><i class="ti ti-trash"></i></button>
    <i class="ti ti-chevron-right muted"></i>
  </div>
</div>`).join('')}
</div>`;
}

function updateToursList(q) {
  G.search = q;
  const nq = norm(q);
  const list = G.tours
    .filter(t => !nq || norm(t.name).includes(nq) || norm(t.city||'').includes(nq))
    .sort((a,b) => { const da=a.date?new Date(a.date).getTime():a.createdAt; const db=b.date?new Date(b.date).getTime():b.createdAt; return db-da; });
  const el = document.getElementById('tours-list');
  if (!el) { render(); return; }
  el.innerHTML = list.length === 0
    ? '<div class="empty"><i class="ti ti-trophy"></i><p>Nenhum torneio</p></div>'
    : list.map(t => {
        const vn = t.venueId ? ' · ' + esc(venueName(t.venueId)) : '';
        const id = t.id;
        return [
          '<div class="plr" onclick="openTour(\'' + id + '\')">',
            '<div style="flex:1">',
              '<div class="fx gap6 mb4"><strong>' + esc(t.name) + '</strong>' + stbadge(t) + '</div>',
              '<div class="muted small">' + (t.mode||'').toUpperCase() + ' · ' + esc(t.city||'—') + vn + ' · ' + t.players.length + ' jog.</div>',
            '</div>',
            '<div class="fx gap4">',
              '<button class="btn btn-xs" onclick="event.stopPropagation();exportTour(\'' + id + '\')"><i class="ti ti-download"></i></button>',
              '<button class="btn btn-xs btn-d" onclick="event.stopPropagation();delTour(\'' + id + '\')"><i class="ti ti-trash"></i></button>',
              '<i class="ti ti-chevron-right muted"></i>',
            '</div>',
          '</div>',
        ].join('');
      }).join('');
}


/* ════════════════════════════════════════════════════════
   RESTORED RENDER FUNCTIONS
════════════════════════════════════════════════════════ */

function getAllArchetypes() {
  const fromSettings = G.settings.archetypes || [];
  const fromTours = [];
  G.tours.forEach(t => t.players.forEach(p => {
    if (p.deckArchetype && !fromTours.includes(p.deckArchetype)) fromTours.push(p.deckArchetype);
  }));
  return [...new Set([...fromSettings, ...fromTours])].sort((a,b)=>a.localeCompare(b,'pt'));
}

function sortByDate(a, b) {
  const da = a.date ? new Date(a.date).getTime() : a.createdAt;
  const db = b.date ? new Date(b.date).getTime() : b.createdAt;
  return db - da;
}

function deletePlayer(id) {
  if (!requireAuth()) return;
  if (!confirm('Excluir jogador?')) return;
  G.players = G.players.filter(p => p.id !== id);
  saveAll(); SB.savePlayers(G.players).catch(()=>{});
  notify('Excluído'); render();
}

function deleteTournament(id) {
  delTour(id);
}

function renderVenueRows(list) {
  if (!list.length) return `<div class="empty"><i class="ti ti-building-store"></i><p>Nenhum local encontrado</p></div>`;
  return list.map(v => {
    const tourCount = G.tours.filter(t => t.venueId === v.id).length;
    return `<div class="plr" onclick="nav('vdetail',{vid:'${v.id}'})">
      <div class="av" style="background:var(--ib);color:var(--it);border-radius:8px">
        <i class="ti ti-building-store" style="font-size:16px"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div class="fx gap6 mb4">
          <strong>${esc(v.name)}</strong>
          ${v.nickname?`<span class="muted small">"${esc(v.nickname)}"</span>`:''}
          ${v.active===false?`<span class="badge bd">Inativo</span>`:''}
        </div>
        <div class="muted small">
          ${[v.city, v.state].filter(Boolean).join(' / ')}
          ${v.responsible?' · '+esc(v.responsible):''}
          ${tourCount>0?` · ${tourCount} torneio${tourCount!==1?'s':''}`: ''}
        </div>
      </div>
      <div class="fx gap4">
        <button class="btn btn-xs" onclick="event.stopPropagation();openVenueModal('${v.id}')"><i class="ti ti-edit"></i></button>
        <i class="ti ti-chevron-right muted"></i>
      </div>
    </div>`;
  }).join('');
}

function renderVenues() {
  const q = norm(G.search);
  const list = G.venues
    .filter(v => !q || norm(v.name).includes(q) || norm(v.city||'').includes(q) || norm(v.responsible||'').includes(q))
    .sort((a,b) => a.name.localeCompare(b.name,'pt'));
  return `
<div class="fx sb2 mb16">
  <div>
    <h1 class="mb4">Locais</h1>
    <div class="muted small">${G.venues.length} local${G.venues.length!==1?'is':''} cadastrado${G.venues.length!==1?'s':''}</div>
  </div>
  <button class="btn btn-p" onclick="openVenueModal(null)"><i class="ti ti-plus"></i> Novo local</button>
</div>
<div class="sw mb16">
  <i class="ti ti-search"></i>
  <input id="venues-search" placeholder="Buscar por nome, cidade..." value="${esc(G.search)}" oninput="updateVenuesList(this.value)">
</div>
<div class="card p0" id="venues-list">
  ${renderVenueRows(list)}
</div>`;
}

function renderVenueDetail() {
  const v = G.venues.find(x=>x.id===G.vid);
  if (!v) return `<div class="empty">Local não encontrado</div>`;
  const tours = G.tours.filter(t => t.venueId === v.id).sort(sortByDate);
  return `
<div class="fx gap12 mb16">
  <button class="btn btn-sm" onclick="nav('venues')"><i class="ti ti-arrow-left"></i> Voltar</button>
  <div class="av" style="width:48px;height:48px;font-size:20px;background:var(--ib);color:var(--it);border-radius:10px">
    <i class="ti ti-building-store"></i>
  </div>
  <div>
    <h1>${esc(v.name)}${v.nickname?` <span class="muted" style="font-size:14px">"${esc(v.nickname)}"</span>`:''}</h1>
    <div class="fx gap6 mt4">
      ${v.active===false?`<span class="badge bd">Inativo</span>`:`<span class="badge bs">Ativo</span>`}
      ${v.city?`<span class="badge bn">${esc(v.city)}${v.state?' / '+v.state:''}</span>`:''}
    </div>
  </div>
  <button class="btn btn-sm ml" onclick="openVenueModal('${v.id}')"><i class="ti ti-edit"></i> Editar</button>
</div>
<div class="g2 gap16 mb16">
  <div class="card">
    <h3 class="mb12">Informações</h3>
    <table>${[
      v.address&&['Endereço',esc(v.address)],
      (v.city||v.state)&&['Cidade',[esc(v.city||''),esc(v.state||'')].filter(Boolean).join(' / ')],
      v.zip&&['CEP',esc(v.zip)],
      v.responsible&&['Responsável',esc(v.responsible)],
      v.contact&&['Contato',esc(v.contact)],
      v.organizerName&&['Organizer',esc(v.organizerName)+(v.organizerPopId?' <span class="mono muted">ID: '+esc(v.organizerPopId)+'</span>':'')],
      v.notes&&['Observações',esc(v.notes)],
    ].filter(Boolean).map(([k,vv])=>`<tr><td class="muted" style="width:40%;padding:4px 0">${k}</td><td style="padding:4px 0">${vv}</td></tr>`).join('')}</table>
  </div>
  <div class="card">
    <h3 class="mb12">Estatísticas</h3>
    <div class="g2">
      <div class="well tc"><div class="sv">${tours.length}</div><div class="sl">Torneios</div></div>
      <div class="well tc"><div class="sv">${tours.reduce((s,t)=>s+t.players.length,0)}</div><div class="sl">Jogadores totais</div></div>
    </div>
  </div>
</div>
<h2 class="mb12">Torneios neste local</h2>
<div class="card p0">
${tours.length===0?`<div class="empty"><p>Nenhum torneio vinculado</p></div>`:
tours.map(t=>`<div class="plr" onclick="openTour('${t.id}')">
  <div style="flex:1"><div class="fx gap6 mb4"><strong>${esc(t.name)}</strong>${stbadge(t)}</div>
  <div class="muted small">${t.date||''} · ${t.players.length} jogadores</div></div>
  <i class="ti ti-chevron-right muted"></i>
</div>`).join('')}
</div>`;
}

function renderVenueModal() {
  const m = G.modal;
  const v = m.id ? G.venues.find(x=>x.id===m.id) : null;
  return `
<div class="mtitle"><i class="ti ti-building-store"></i> ${v?'Editar local':'Novo local'}</div>
<div class="g2">
  <div class="f"><label>Nome *</label><input id="vm-name" value="${esc(v?.name||'')}" autofocus></div>
  <div class="f"><label>Nome curto</label><input id="vm-nick" value="${esc(v?.nickname||'')}"></div>
</div>
<div class="f"><label>Endereço</label><input id="vm-addr" value="${esc(v?.address||'')}"></div>
<div class="g2">
  <div class="f"><label>Cidade</label><input id="vm-city" value="${esc(v?.city||'')}"></div>
  <div class="f"><label>Estado</label><input id="vm-state" value="${esc(v?.state||'')}"></div>
</div>
<div class="g2">
  <div class="f"><label>CEP</label><input id="vm-zip" value="${esc(v?.zip||'')}"></div>
  <div class="f"><label>Responsável</label><input id="vm-resp" value="${esc(v?.responsible||'')}"></div>
</div>
<div class="sep"></div>
<div class="lbl mb8">Organizer (TDF)</div>
<div class="g2">
  <div class="f"><label>Nome do organizador</label><input id="vm-org-name" value="${esc(v?.organizerName||'')}"></div>
  <div class="f"><label>Player ID (popid)</label><input id="vm-org-popid" value="${esc(v?.organizerPopId||'')}"></div>
</div>
<div class="g2">
  <div class="f"><label>Contato</label><input id="vm-contact" value="${esc(v?.contact||'')}"></div>
  <div class="f" style="justify-content:flex-end"><label class="fx gap6 mt4" style="cursor:pointer">
    <input type="checkbox" id="vm-active" ${v?.active===false?'':'checked'}> Ativo
  </label></div>
</div>
<div class="f mb16"><label>Observações</label><textarea id="vm-notes" style="height:60px">${esc(v?.notes||'')}</textarea></div>
${v?`<div class="mb12"><button class="btn btn-xs btn-d" onclick="deleteVenue('${v.id}')"><i class="ti ti-trash"></i> Excluir local</button></div>`:''}
<div class="fx gap6" style="justify-content:flex-end">
  <button class="btn" onclick="closeM()">Cancelar</button>
  <button class="btn btn-p" onclick="saveVenueModal('${m.id||''}')"><i class="ti ti-check"></i> Salvar</button>
</div>`;
}

function renderArchModal() {
  const m = G.modal;
  const name = m.name || '';
  return `
<div class="mtitle"><i class="ti ti-cards"></i> ${name?'Editar deck':'Novo deck'}</div>
<div class="f mb16">
  <label>Nome do deck *</label>
  <input id="arch-name" value="${esc(name)}" autofocus>
</div>
<div class="fx gap6" style="justify-content:flex-end">
  <button class="btn" onclick="closeM()">Cancelar</button>
  ${name?`<button class="btn btn-xs btn-d" onclick="deleteArchetype('${esc(name)}')"><i class="ti ti-trash"></i></button>`:''}
  <button class="btn btn-p" onclick="saveArchModal('${esc(name)}')"><i class="ti ti-check"></i> Salvar</button>
</div>`;
}

function renderCreateTour() {
  const d = G._ctd || {};
  const modes = [
    {id:'lc',  name:'League Challenge', desc:'Swiss sem top cut'},
    {id:'cup', name:'League Cup',       desc:'Swiss + top cut'},
    {id:'one', name:'Championship',     desc:'Premier Event'},
    {id:'cust',name:'Personalizado',    desc:'Config. livre'},
  ];
  return `
<div class="fx gap12 mb20">
  <button class="btn btn-sm" onclick="nav('tours')"><i class="ti ti-arrow-left"></i> Voltar</button>
  <h1>Novo torneio</h1>
</div>
<div style="max-width:580px">
<div class="card mb16">
  <h3 class="mb16">Informações</h3>
  <div class="f"><label>Nome *</label><input id="ct-name" placeholder="Liga Cup Rio — Maio 2025" value="${esc(d.name||'')}" oninput="G._ctd=G._ctd||{};G._ctd.name=this.value"></div>
  <div class="g2">
    <div class="f"><label>Cidade</label><input id="ct-city" value="${esc(d.city||'')}" oninput="G._ctd=G._ctd||{};G._ctd.city=this.value"></div>
    <div class="f"><label>Estado</label><input id="ct-state" value="${esc(d.state||'')}" oninput="G._ctd=G._ctd||{};G._ctd.state=this.value"></div>
  </div>
  <div class="f"><label>Data</label><input type="date" id="ct-date" value="${d.date||new Date().toISOString().slice(0,10)}" onchange="G._ctd=G._ctd||{};G._ctd.date=this.value"></div>
  <div class="f"><label>Local</label>
    <select id="ct-venue" onchange="G._ctd=G._ctd||{};G._ctd.venueId=this.value||null">
      <option value="">Selecionar local...</option>
      ${G.venues.filter(v=>v.active!==false).map(v=>`<option value="${v.id}" ${(d.venueId||'')=== v.id?'selected':''}>${esc(v.name)}${v.city?' — '+esc(v.city):''}</option>`).join('')}
    </select>
  </div>
</div>
<div class="card mb16">
  <h3 class="mb12">Formato</h3>
  <div class="cg mb16">
    ${modes.map(m=>`<div class="chip ${(d.mode||'cup')===m.id?'on':''}" onclick="setCTMode('${m.id}')">
      <strong>${m.name}</strong><div class="small muted">${m.desc}</div></div>`).join('')}
  </div>
  <div class="g2">
    <div class="f"><label>Rodadas Swiss</label>
      <select id="ct-rounds" onchange="onCTRoundsChange(this.value)">
        <option value="auto"   ${(!d.totalRounds||d.totalRounds==='auto')?'selected':''}>Automático (recomendado)</option>
        <option value="3"  ${ d.totalRounds===3 ?'selected':''}>3 rodadas</option>
        <option value="4"  ${ d.totalRounds===4 ?'selected':''}>4 rodadas</option>
        <option value="5"  ${ d.totalRounds===5 ?'selected':''}>5 rodadas</option>
        <option value="6"  ${ d.totalRounds===6 ?'selected':''}>6 rodadas</option>
        <option value="7"  ${ d.totalRounds===7 ?'selected':''}>7 rodadas</option>
        <option value="8"  ${ d.totalRounds===8 ?'selected':''}>8 rodadas</option>
        <option value="9"  ${ d.totalRounds===9 ?'selected':''}>9 rodadas</option>
        <option value="custom" ${d.totalRounds==='custom'?'selected':''}>Personalizado...</option>
      </select>
      ${(d.totalRounds && d.totalRounds!=='auto' && d.totalRounds!=='custom' && ![3,4,5,6,7,8,9].includes(Number(d.totalRounds)))
        ? `<input type="number" id="ct-rounds-custom" min="3" max="15" value="${d.totalRounds}" style="margin-top:6px">` : ''}
    </div>
    <div class="f"><label>Top Cut</label><select id="ct-cut" onchange="G._ctd=G._ctd||{};G._ctd.topCutSize=Number(this.value)">
      <option value="0" ${(d.topCutSize||0)===0?'selected':''}>Sem top cut</option>
      <option value="4" ${(d.topCutSize||0)===4?'selected':''}>Top 4</option>
      <option value="8" ${(d.topCutSize||0)===8?'selected':''}>Top 8</option>
      <option value="16" ${(d.topCutSize||0)===16?'selected':''}>Top 16</option>
    </select></div>
  </div>
  <div class="g2">
    <div class="f"><label>Tempo por rodada (min)</label><input type="number" id="ct-timer" min="10" max="90" value="${d.timerMinutes||50}" oninput="G._ctd=G._ctd||{};G._ctd.timerMinutes=Number(this.value)"></div>
    <div class="f"><label>Seed (vazio = aleatório)</label><input id="ct-seed" value="${d.seed||''}" oninput="G._ctd=G._ctd||{};G._ctd.seed=this.value"></div>
  </div>
</div>
<div class="card mb16">
  <h3 class="mb12">Divisões</h3>
  <div class="fxc gap12">
    <label class="fx gap6"><input type="checkbox" id="ct-sepdiv" ${(d.separateDivisions!==false)?'checked':''} onchange="G._ctd=G._ctd||{};G._ctd.separateDivisions=this.checked"> Pareamentos separados por divisão</label>
    <label class="fx gap6"><input type="checkbox" id="ct-divst"  ${(d.standingsByDiv!==false)?'checked':''} onchange="G._ctd=G._ctd||{};G._ctd.standingsByDiv=this.checked"> Standings separados por divisão</label>
    <label class="fx gap6"><input type="checkbox" id="ct-debug" ${d.debugMode?'checked':''} onchange="G._ctd=G._ctd||{};G._ctd.debugMode=this.checked"> Modo debug</label>
  </div>
</div>
<div class="card mb16">
  <h3 class="mb8">Jogadores</h3>
  <p class="muted small mb10">Opcional — pode adicionar após criar o torneio.</p>
  <div class="f"><label>Buscar banco de dados</label>
    <div class="fx gap6">
      <input id="ct-pq" placeholder="Nome, ID..." style="flex:1" oninput="renderCTPlayerSearch(this.value)">
      <button class="btn btn-sm" onclick="openPModal(null,true)"><i class="ti ti-plus"></i></button>
    </div>
  </div>
  <div id="ct-pres"></div>
  <div id="ct-player-panel">
  ${(d.players||[]).length>0?`
  <div class="sep" style="margin:8px 0"></div>
  <div class="lbl mb6">Selecionados <span id="ct-pcount" class="badge bn">${(d.players||[]).length} selecionados</span></div>
  ${(d.players||[]).map((p,i)=>`<div class="plr" style="padding:6px 10px">
    <span class="mono muted" style="min-width:20px;font-size:11px">${i+1}</span>
    <span style="flex:1;font-size:13px">${esc(p.name)}</span>
    ${dbadge(p.division)}
    <button class="ib" onclick="ctRemovePlayer('${p.id}')"><i class="ti ti-x"></i></button>
  </div>`).join('')}`:'<span id="ct-pcount" class="muted small">opcional</span>'}
  </div>
</div>
<button class="btn btn-p fw jc" style="padding:12px" onclick="createTour()">
  <i class="ti ti-player-play"></i> Criar torneio
</button>
</div>`;
}

function renderCTPlayerSearch(q) {
  const el = document.getElementById('ct-pres');
  if (!el) return;
  if (!q || q.length < 1) { el.innerHTML = ''; return; }
  G._ctd = G._ctd || {};
  const have = new Set((G._ctd.players||[]).map(p=>p.gid).filter(Boolean));
  const found = G.players.filter(p => !have.has(p.id) && (
    norm(p.name).includes(norm(q)) || norm(p.playerId||'').includes(norm(q))
  )).slice(0, 6);
  el.innerHTML = found.length === 0
    ? `<p class="muted small mt8">Sem resultados. <button class="btn btn-xs" onclick="openPModal(null,true)">Criar novo</button></p>`
    : `<div class="card p0 mt8">${found.map(p=>`
      <div class="plr" onclick="ctAddPlayer('${p.id}')">
        <div class="av" style="width:28px;height:28px;font-size:10px">${esc(initials(p.name))}</div>
        <div style="flex:1"><div>${esc(p.name)}</div><div class="muted small">${p.division}${p.playerId?' · '+p.playerId:''}</div></div>
        <i class="ti ti-plus muted"></i>
      </div>`).join('')}</div>`;
}

/* ── Tournament tabs ─────────────────────────────────── */
function renderTour() {
  const t = ct();
  if (!t) return `<div class="empty">Torneio não encontrado</div>`;
  const tabs = [
    { id:'reg',       icon:'ti-users',        label:'Registro' },
    { id:'rounds',    icon:'ti-layout-list',  label:'Rodada' },
    { id:'standings', icon:'ti-list-numbers', label:'Standings' },
    { id:'history',   icon:'ti-history',      label:'Histórico' },
    { id:'decklists', icon:'ti-cards',        label:'Decklists' },
    ...(t.topBracket?.length ? [{ id:'topcut', icon:'ti-tournament', label:'Top Cut' }] : []),
    ...(t.status==='finished' ? [{ id:'finished', icon:'ti-trophy', label:'Resultado' }] : []),
    { id:'debug',  icon:'ti-bug',      label:'Debug' },
    { id:'log',    icon:'ti-history',  label:'Log' },
    { id:'export', icon:'ti-download', label:'Exportar' },
  ];
  const rnd = t.rounds[t.currentRound-1];
  const done = rnd ? rnd.pairings.filter(p=>p.result!==null).length : 0;
  const total = rnd ? rnd.pairings.length : 0;
  let body = '';
  if      (G.tab==='reg')       body = renderReg(t);
  else if (G.tab==='rounds')    body = renderRounds(t);
  else if (G.tab==='standings') body = renderStandings(t);
  else if (G.tab==='history')   body = renderHistory(t);
  else if (G.tab==='decklists') body = renderDecklists(t);
  else if (G.tab==='topcut')    body = renderTopCut(t);
  else if (G.tab==='finished')  body = renderFinished(t);
  else if (G.tab==='debug')     body = renderDebug(t);
  else if (G.tab==='log')       body = renderLog(t);
  else if (G.tab==='export')    body = renderExport(t);
  else body = renderReg(t);
  return `
<div class="tb">
  <button class="btn btn-sm" onclick="nav('tours')"><i class="ti ti-arrow-left"></i></button>
  <strong>${esc(t.name)}</strong>
  ${stbadge(t)}
  <span class="badge bn">${t.players.length} jog.</span>
  ${t.venueId?`<span class="badge bn"><i class="ti ti-building-store"></i> ${esc(venueName(t.venueId))}</span>`:''}
  <button class="btn btn-xs" onclick="G.modal={type:'edit-tour'};render()" title="Editar torneio"><i class="ti ti-edit"></i></button>
  ${t.status==='rounds'?renderTimerBlock(t):''}
</div>
<div class="tabs">
  ${tabs.map(tb=>`<div class="tab ${G.tab===tb.id?'on':''}" onclick="G.tab='${tb.id}';render()">
    <i class="ti ${tb.icon}"></i>${tb.label}</div>`).join('')}
</div>
${t.status==='rounds'&&rnd&&total>0?`
<div style="padding:6px 16px;background:var(--s1);border-bottom:1px solid var(--bd)">
  <div class="fx sb2 mb4 small muted">
    <span>Rodada ${t.currentRound}/${t.settings.totalRounds} · ${done}/${total}</span>
    <span>${total-done} pendentes</span>
  </div>
  <div class="prog"><div class="prog-f" style="width:${total?Math.round(done/total*100):0}%"></div></div>
</div>`:''}
<div style="flex:1;overflow-y:auto;padding:20px">${body}</div>`;
}

function renderReg(t) {
  const n = t.players.length;
  const rec = recRounds(n), cut = recCut(n, t.settings.mode);
  const byDiv = DIVS.map(d=>({d,c:t.players.filter(p=>p.division===d).length})).filter(x=>x.c>0);
  return `
<div class="fx sb2 mb16">
  <div>
    <h2 class="mb4">Registro de jogadores</h2>
    <div class="fx gap6" id="reg-header-badges">
      ${byDiv.map(({d,c})=>`<span class="badge ${DC[d]}">${d[0]}: ${c}</span>`).join('')}
      ${n>0?`<span class="muted small">${rec} rodadas · ${cut?'Top '+cut:'Sem top cut'}</span>`:''}
    </div>
  </div>
  ${t.status==='registration'?`<button id="reg-start-btn" class="btn btn-p" ${n<2?'disabled':''} onclick="startTour()">
    <i class="ti ti-player-play"></i> Iniciar torneio</button>`:''}
</div>
${t.status==='registration'?`
<div class="well mb16 fx gap12" style="align-items:flex-start">
  <i class="ti ti-qrcode" style="font-size:20px;color:var(--it);flex-shrink:0;margin-top:2px"></i>
  <div style="flex:1;min-width:0">
    <div style="font-size:13px;font-weight:500;margin-bottom:4px">Link público para jogadores</div>
    <div class="muted small mb8">Compartilhe para que cada jogador veja sua mesa e standings em tempo real</div>
    <div class="fx gap6 wrap">
      <a href="player.html?tour=${t.id}" target="_blank" class="btn btn-xs btn-p"><i class="ti ti-external-link"></i> Abrir exemplo</a>
      <button class="btn btn-xs" onclick="copyTourLink('${t.id}')"><i class="ti ti-copy"></i> Copiar link base</button>
      <a href="rank.html" target="_blank" class="btn btn-xs"><i class="ti ti-medal"></i> Ranking público</a>
    </div>
  </div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">

  <!-- BANCO DE JOGADORES -->
  <div class="card p0" style="display:flex;flex-direction:column;max-height:520px">
    <div style="padding:12px 16px;border-bottom:1px solid var(--bd);flex-shrink:0">
      <div class="fx sb2 mb8">
        <h3>Banco de jogadores</h3>
        <button class="btn btn-xs" onclick="openPModal(null,true)"><i class="ti ti-plus"></i> Novo</button>
      </div>
      <div class="sw">
        <i class="ti ti-search"></i>
        <input id="reg-q" placeholder="Filtrar..." oninput="filterRegDB(this.value)">
      </div>
    </div>
    <div id="reg-db-list" style="overflow-y:auto;flex:1">
      ${renderRegDBList(t,'',0)}
    </div>
    <div style="padding:8px 16px;border-top:1px solid var(--bd);flex-shrink:0">
      <details>
        <summary class="muted small" style="cursor:pointer">Adicionar múltiplos (bulk)</summary>
        <div class="mt8">
          <textarea id="bulk-in" style="height:64px;width:100%" placeholder="João Silva&#10;Maria Santos"></textarea>
          <div class="fx gap8 mt6">
            <select id="bulk-div" style="flex:1">${DIVS.map(d=>`<option>${d}</option>`).join('')}</select>
            <button class="btn btn-sm" onclick="addBulk()"><i class="ti ti-upload"></i> Adicionar</button>
          </div>
        </div>
      </details>
    </div>
  </div>

  <!-- INSCRITOS NO TORNEIO -->
  <div class="card p0" style="display:flex;flex-direction:column;max-height:520px">
    <div style="padding:12px 16px;border-bottom:1px solid var(--bd);flex-shrink:0">
      <div class="fx sb2">
        <h3>Inscritos <span class="badge bn">${n}</span></h3>
        ${n>0?`<button class="btn btn-xs btn-d" onclick="if(confirm('Remover todos?')){mtour(t=>{t.players=[];});}" title="Limpar lista"><i class="ti ti-trash"></i></button>`:''}
      </div>
    </div>
    <div id="reg-player-list" style="overflow-y:auto;flex:1">
      ${n===0
        ?`<div class="empty"><i class="ti ti-users"></i><p>Clique nos jogadores ao lado para inscrever</p></div>`
        :t.players.map((p,i)=>`<div class="plr">
          <span class="mono muted" style="min-width:22px;font-size:11px">${i+1}</span>
          <span style="flex:1">${esc(p.name)}</span>${dbadge(p.division)}
          <button class="ib" onclick="removeFromTour('${p.id}')"><i class="ti ti-x"></i></button>
        </div>`).join('')}
    </div>
  </div>

</div>`:`
<div class="card p0">
${t.players.map((p,i)=>`<div class="plr">
  <span class="mono muted" style="min-width:24px">${i+1}</span>
  <span style="flex:1">${esc(p.name)}</span>${dbadge(p.division)}
  ${p.dropped?`<span class="badge bn">Dropped</span>`:''}
  ${p.dq?`<span class="badge bd">DQ</span>`:''}
</div>`).join('')}
</div>`}`;
}

function filterRegDB(q) {
  _regDBFilter = q;
  _regDBPage = 0;
  const t = ct(); if (!t) return;
  const el = document.getElementById('reg-db-list');
  if (el) el.innerHTML = renderRegDBList(t, q, 0);
}

function renderRegDBList(t, filter, page) {
  const PER_PAGE = 15;
  const q = norm(filter||'');
  const have = new Set(t.players.map(p=>p.gid).filter(Boolean));
  const found = G.players.filter(p => !have.has(p.id) && (!q || norm(p.name).includes(q) || norm(p.playerId||'').includes(q)));
  const pg = page||0;
  const slice = found.slice(pg*PER_PAGE, (pg+1)*PER_PAGE);
  if (!slice.length) return `<div class="empty"><p>Nenhum resultado</p></div>`;
  return slice.map(p=>`<div class="plr" onclick="addFromDB('${p.id}')">
    <div class="av" style="width:28px;height:28px;font-size:10px">${esc(initials(p.name))}</div>
    <div style="flex:1"><div>${esc(p.name)}</div><div class="muted small">${p.division}${p.playerId?' · '+p.playerId:''}</div></div>
    <i class="ti ti-plus muted"></i>
  </div>`).join('');
}

function renderRounds(t) {
  if (t.status==='registration') return `<div class="empty"><i class="ti ti-layout-list"></i><p>Inicie o torneio para ver os pareamentos</p></div>`;
  const rnd = t.rounds[t.currentRound-1];
  if (!rnd) return `<div class="empty">Nenhuma rodada ativa</div>`;
  const allDone = rnd.pairings.every(p=>p.result!==null);
  const isLast = t.currentRound >= t.settings.totalRounds;
  let html = '';
  if (t.settings.separateDivisions) {
    for (const div of DIVS) {
      const dp = rnd.pairings.filter(p => p.isBye ? pdiv(p.p1,t)===div : pdiv(p.p1,t)===div||pdiv(p.p2,t)===div);
      if (!dp.length) continue;
      html += `<div class="lbl mt12">${div}</div>`;
      html += dp.map(p=>pairingRow(p,t)).join('');
    }
  } else {
    html = rnd.pairings.map(p=>pairingRow(p,t)).join('');
  }
  return `
<div class="fx sb2 mb16">
  <div>
    <h2>Rodada ${t.currentRound} / ${t.settings.totalRounds}</h2>
    ${rnd.isSimulated?`<span class="badge bw mt4"><i class="ti ti-player-play"></i> Simulada</span>`:''}
  </div>
  <div class="fx gap6">
    <button class="btn btn-sm" onclick="printMatchSlips('${t.id}')"><i class="ti ti-printer"></i> Match Slips</button>
    <button class="btn btn-sm" onclick="printPairings('${t.id}')"><i class="ti ti-layout-list"></i> Pairings</button>
    <button class="btn btn-sm" onclick="simulateRound()"><i class="ti ti-dice"></i> Simular</button>
    ${allDone?`<button class="btn btn-p" onclick="advanceRound()">
      ${isLast?(t.settings.topCutSize>0?'Ir para Top Cut':'Finalizar'):`Rodada ${t.currentRound+1}`}
      <i class="ti ti-arrow-right"></i></button>`:
      `<button class="btn" disabled><i class="ti ti-hourglass"></i> Aguardando</button>`}
  </div>
</div>
${html}`;
}

function pairingRow(p, t) {
  const bye = p.p2==='BYE';
  const p1n = esc(pname(p.p1,t)), p2n = bye ? 'BYE' : esc(pname(p.p2,t));
  const p1d = pdiv(p.p1,t), p2d = bye ? '' : pdiv(p.p2,t);
  const r = p.result;
  const p1w=r===R.P1, p2w=r===R.P2, p1l=r===R.P2||r===R.DL, p2l=r===R.P1||r===R.DL;
  return `
<div class="pr">
  <div class="pt">${p.table||'—'}</div>
  <div class="pp ${p1w?'win':p1l?'lose':''}">
    ${dbadge(p1d)}<span style="flex:1;font-weight:${p1w?700:400}">${p1n}</span>
    ${p1w?'<i class="ti ti-crown" style="color:var(--st)"></i>':''}
  </div>
  <div class="pvs">vs</div>
  <div class="pp ${p2w?'win':p2l?'lose':''}">
    ${bye?`<span class="badge bi">BYE</span>`:
    `${dbadge(p2d)}<span style="flex:1;font-weight:${p2w?700:400}">${p2n}</span>
    ${p2w?'<i class="ti ti-crown" style="color:var(--st)"></i>':''}`}
  </div>
  <div class="pres">
    ${bye?'':r?`
      <div class="fx gap4">
        ${r===R.P1?`<span class="badge bs">P1</span>`:r===R.P2?`<span class="badge bd">P2</span>`:r===R.TIE?`<span class="badge bw">Emp</span>`:`<span class="badge bn">DL</span>`}
        <button class="ib" onclick="setRes('${p.id}',null)" title="Desfazer"><i class="ti ti-backspace"></i></button>
        <button class="ib" onclick="openJudge('${p.id}')" title="Juiz"><i class="ti ti-gavel"></i></button>
      </div>
      ${p.judgeNote?`<div class="small" style="color:var(--wt)"><i class="ti ti-gavel"></i> ${esc(p.judgeNote)}</div>`:''}`:`
    <div class="rg">
      <button class="rb rp1" onclick="setRes('${p.id}','${R.P1}')">P1</button>
      <button class="rb rtie" onclick="setRes('${p.id}','${R.TIE}')">Emp</button>
      <button class="rb rp2" onclick="setRes('${p.id}','${R.P2}')">P2</button>
      <button class="rb rdl"  onclick="setRes('${p.id}','${R.DL}')" title="Double Loss">DL</button>
    </div>`}
  </div>
</div>`;
}

function renderStandings(t) {
  const hasDeck = t.players.some(p=>p.deckArchetype);
  const header = `<div class="fx sb2 mb16">
    <h2>Standings</h2>
    <div class="fx gap6">
      ${hasDeck?`<button class="btn btn-sm" onclick="toggleDeckCol()" id="deck-toggle-btn">
        <i class="ti ti-${G._showDeck?'eye-off':'cards'}"></i> ${G._showDeck?'Ocultar deck':'Mostrar deck'}
      </button>`:''}
      <button class="btn btn-sm" onclick="printStandings('${t.id}')"><i class="ti ti-printer"></i> Imprimir</button>
    </div>
  </div>`;
  if (t.settings.standingsByDiv && t.settings.separateDivisions) {
    return header + DIVS.map(div => {
      const s = getStandings(t.players, t.rounds, div);
      if (!s.length) return '';
      return `<div class="lbl mb8">${div}</div>${standTable(s, t)}`;
    }).join('');
  }
  return header + standTable(getStandings(t.players, t.rounds), t);
}

function standTable(stand, t) {
  const cut = t.settings.topCutSize;
  const showDeck = G._showDeck;
  const hasDeck = stand.some(p => t.players.find(x=>x.id===p.id)?.deckArchetype);
  const cols = showDeck ? 8 : 7;
  return `<div class="card p0 mb16 tov">
<table>
  <thead><tr><th>#</th><th>Jogador</th>${showDeck?'<th>Deck</th>':''}<th>Pts</th><th>W/L/E</th><th>OWP%</th><th>OOWP%</th><th></th></tr></thead>
  <tbody>
    ${stand.map((p,i)=>{
      const tp = t.players.find(x=>x.id===p.id);
      return `
    ${i===cut&&cut>0?`<tr class="cutrow"><td colspan="${cols}"><div class="cutline"></div></td></tr>`:''}
    <tr style="opacity:${p.dropped?'.4':'1'}">
      <td class="mono" style="font-weight:${i<3&&!p.dropped?700:400}">
        ${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}
      </td>
      <td><div class="fx gap6">${esc(p.name||G.players.find(x=>x.id===p.gid)?.name||'?')} ${dbadge(p.division)}</div>
        ${p.dropped?'<div class="muted small">Dropped</div>':''}
      </td>
      ${showDeck?`<td><span class="muted small">${esc(tp?.deckArchetype||'—')}</span></td>`:''}
      <td class="mono" style="font-weight:700;font-size:15px">${p.mp}</td>
      <td class="mono">${p.w}/${p.l}/${p.t}</td>
      <td class="mono">${pct(p.owp)}</td>
      <td class="mono">${pct(p.oowp)}</td>
      <td>
        ${!p.dropped&&!p.dq&&t.status==='rounds'?`<button class="btn btn-xs btn-w" onclick="dropP('${p.id}')">Drop</button>`:''}
        ${p.dq?`<span class="badge bd">DQ</span>`:''}
      </td>
    </tr>`;
    }).join('')}
  </tbody>
</table></div>`;
}

function renderHistory(t) {
  if (!t.rounds.length) return `<div class="empty"><p>Nenhuma rodada completada</p></div>`;
  return `<h2 class="mb16">Histórico de rodadas</h2>
${t.rounds.map((rnd,ri) => `
  <div class="mb8">
    <div class="coll-hd ${ri===t.rounds.length-1?'open':''}" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
      <span>Rodada ${rnd.number}</span>
      <div class="fx gap8"><span class="muted small">${rnd.pairings.filter(p=>!p.isBye).length} mesas</span><i class="ti ti-chevron-down"></i></div>
    </div>
    <div class="coll-bd ${ri===t.rounds.length-1?'open':''}">
      <div class="tov"><table>
        <thead><tr><th>Mesa</th><th>J1</th><th>Resultado</th><th>J2</th></tr></thead>
        <tbody>${rnd.pairings.map(p=>{
          const bye=p.p2==='BYE';
          return `<tr>
            <td class="mono">${p.table||'—'}</td>
            <td>${esc(pname(p.p1,t))} ${dbadge(pdiv(p.p1,t))}</td>
            <td>${bye?`<span class="badge bi">BYE</span>`:
               p.result===R.P1?`<span class="badge bs">P1</span>`:
               p.result===R.P2?`<span class="badge bd">P2</span>`:
               p.result===R.TIE?`<span class="badge bw">Emp</span>`:
               p.result===R.DL?`<span class="badge bn">DL</span>`:
               `<span class="badge bn">—</span>`}
            </td>
            <td>${bye?'—':esc(pname(p.p2,t))}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>
  </div>`).join('')}`;
}

function renderTopCut(t) {
  if (!t.topBracket?.length) return `<div class="empty"><p>Top cut não iniciado</p></div>`;
  const last = t.topBracket[t.topBracket.length-1];
  const allDone = last.matches.every(m=>m.winner);
  const isFinal = last.matches.length===1;
  const cols = t.topBracket.map((rnd,ri)=>{
    const active = ri===t.topBracket.length-1;
    const name = rnd.matches.length===1?'Final':rnd.matches.length===2?'Semifinal':rnd.matches.length===4?'Quartas':'Fase '+(ri+1);
    return `<div class="bc"><div class="bct">${name}</div>
    ${rnd.matches.map(m=>`<div class="bm">
      <div class="bp ${m.winner==='p1'?'bwin':m.winner||!active?'bna':''}" onclick="${active&&!m.winner?`setTC('${m.id}','p1')`:''}">${m.seed1?`<span class="bps">${m.seed1}</span>`:''}<span class="bpn">${m.p1?esc(m.p1.name):'TBD'}</span>${m.winner==='p1'?'<i class="ti ti-crown" style="color:var(--st)"></i>':''}</div>
      <div class="bp ${m.winner==='p2'?'bwin':m.winner||!active?'bna':''}" onclick="${active&&!m.winner?`setTC('${m.id}','p2')`:''}">${m.seed2?`<span class="bps">${m.seed2}</span>`:''}<span class="bpn">${m.p2?esc(m.p2.name):'TBD'}</span>${m.winner==='p2'?'<i class="ti ti-crown" style="color:var(--st)"></i>':''}</div>
    </div>`).join('')}</div>`;
  }).join('');
  return `
<div class="fx sb2 mb16">
  <h2>Top ${t.settings.topCutSize}</h2>
  <button class="btn btn-p" ${allDone?'':'disabled'} onclick="advanceTC()">
    ${isFinal?'Finalizar torneio':'Próxima fase'} <i class="ti ti-arrow-right"></i>
  </button>
</div>
<div class="bracket">${cols}</div>`;
}

function renderFinished(t) {
  const stand = getStandings(t.players, t.rounds);
  return `
<div class="fx sb2 mb16"><h2>Resultado final</h2>
  <div class="fx gap6">
    ${t.players.some(p=>p.deckArchetype)?`<button class="btn btn-sm" onclick="toggleDeckCol()">
      <i class="ti ti-${G._showDeck?'eye-off':'cards'}"></i> ${G._showDeck?'Ocultar deck':'Mostrar deck'}
    </button>`:''}
    <button class="btn btn-sm" onclick="exportTour('${t.id}')"><i class="ti ti-download"></i> Exportar</button>
  </div>
</div>
<div class="sgrid mb16">
  <div class="sc"><div class="sv">${t.players.length}</div><div class="sl">Jogadores</div></div>
  <div class="sc"><div class="sv">${t.settings.totalRounds}</div><div class="sl">Rodadas</div></div>
  <div class="sc"><div class="sv">${t.settings.topCutSize||'—'}</div><div class="sl">Top cut</div></div>
  <div class="sc"><div class="sv">${esc(t.city||'—')}</div><div class="sl">Cidade</div></div>
</div>
${standTable(stand, t)}`;
}


/* ════════════════════════════════════════════════════════
   DECKLISTS TAB (torneio)
════════════════════════════════════════════════════════ */
function renderDecklists(t) {
  const allArchs = getAllArchetypes();
  const archCount = {};
  t.players.forEach(p => {
    if (p.deckArchetype) archCount[p.deckArchetype] = (archCount[p.deckArchetype]||0) + 1;
  });
  const total     = t.players.length;
  const withDeck  = t.players.filter(p=>p.deckArchetype).length;
  const withList  = t.players.filter(p=>p.deckList).length;
  const pending   = t.players.filter(p=>!p.deckArchetype);
  const archColors= ['#D85A30','#7F77DD','#1D9E75','#378ADD','#BA7517','#D4537E','#888780','#639922'];
  const archs     = Object.entries(archCount).sort((a,b)=>b[1]-a[1]);
  const colorMap  = {};
  archs.forEach(([name],i)=>{ colorMap[name]=archColors[i%archColors.length]; });

  return `
<div class="fx sb2 mb16">
  <div>
    <h2 class="mb4">Decklists</h2>
    <div class="fx gap6">
      <span class="badge bs">${withDeck}/${total} com deck</span>
      ${withList>0?`<span class="badge bn">${withList} com lista completa</span>`:''}
      ${pending.length>0?`<span class="badge bw">${pending.length} pendente${pending.length>1?'s':''}</span>`:''}
    </div>
  </div>
  <div class="fx gap6">
    <button class="btn btn-p btn-sm" onclick="openDeckModal(null)"><i class="ti ti-plus"></i> Registrar</button>
  </div>
</div>

${pending.length>0?`
<div class="well mb16" style="border:1px solid var(--wt)">
  <div class="fx gap8">
    <i class="ti ti-alert-triangle" style="color:var(--wt);flex-shrink:0"></i>
    <div>
      <div style="font-size:13px;font-weight:500;color:var(--wt)">Sem decklist: ${pending.map(p=>`<strong>${esc(p.name)}</strong>`).join(', ')}</div>
    </div>
  </div>
</div>`:''}

<div class="g2 gap16">
  <div>
    <div class="sw mb12">
      <i class="ti ti-search"></i>
      <input placeholder="Buscar jogador ou deck..." oninput="filterDeckList(this.value)">
    </div>
    <div class="card p0" id="deck-player-list">
      ${renderDeckPlayerList(t, '')}
    </div>
  </div>
  <div>
    <div class="card mb12">
      <h3 class="mb12">Meta do torneio</h3>
      ${archs.length===0?`<div class="empty" style="padding:16px"><p>Nenhum deck registrado</p></div>`
        :archs.map(([name,count])=>`
        <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:0.5px solid var(--bd)">
          <span style="width:10px;height:10px;border-radius:2px;background:${colorMap[name]||'#888'};flex-shrink:0"></span>
          <span style="flex:1;font-size:13px">${esc(name)}</span>
          <div style="width:70px;height:4px;background:var(--s2);border-radius:2px;overflow:hidden">
            <div style="width:${Math.round(count/archs[0][1]*100)}%;height:100%;background:${colorMap[name]||'#888'}"></div>
          </div>
          <span class="muted small" style="min-width:40px;text-align:right">${count}x (${Math.round(count/total*100)}%)</span>
          <button class="btn btn-xs" onclick="openArchModal('${esc(name)}')"><i class="ti ti-edit"></i></button>
        </div>`).join('')}
    </div>

  </div>
</div>`;
}

/* ════════════════════════════════════════════════════════
   EDITAR TORNEIO
════════════════════════════════════════════════════════ */
function renderEditTourModal() {
  const t = ct(); if (!t) return '';
  return `
<div class="mtitle"><i class="ti ti-edit"></i> Editar torneio</div>
<div class="f"><label>Nome *</label><input id="et-name" value="${esc(t.name)}"></div>
<div class="g2">
  <div class="f"><label>Cidade</label><input id="et-city" value="${esc(t.city||'')}"></div>
  <div class="f"><label>Estado</label><input id="et-state" value="${esc(t.state||'')}"></div>
</div>
<div class="f"><label>Data do evento</label><input type="date" id="et-date" value="${t.date||''}"></div>
<div class="f"><label>ID Sancionada</label><input id="et-sanction" value="${esc(t.sanctionedId||'')}" style="font-family:var(--mono)"></div>
<div class="f"><label>Local</label>
  <select id="et-venue">
    <option value="">Sem local</option>
    ${G.venues.filter(v=>v.active!==false).map(v=>`<option value="${v.id}" ${(t.venueId||'')=== v.id?'selected':''}>${esc(v.name)}${v.city?' — '+esc(v.city):''}</option>`).join('')}
  </select>
</div>
<div class="sep"></div>
<div class="g2">
  <div class="f"><label>Rodadas Swiss</label>
    <select id="et-rounds" ${t.status!=='registration'?'disabled title="Torneio em andamento"':''}>
      <option value="3"  ${t.settings.totalRounds===3 ?'selected':''}>3 rodadas</option>
      <option value="4"  ${t.settings.totalRounds===4 ?'selected':''}>4 rodadas</option>
      <option value="5"  ${t.settings.totalRounds===5 ?'selected':''}>5 rodadas</option>
      <option value="6"  ${t.settings.totalRounds===6 ?'selected':''}>6 rodadas</option>
      <option value="7"  ${t.settings.totalRounds===7 ?'selected':''}>7 rodadas</option>
      <option value="8"  ${t.settings.totalRounds===8 ?'selected':''}>8 rodadas</option>
      <option value="9"  ${t.settings.totalRounds===9 ?'selected':''}>9 rodadas</option>
    </select>
  </div>
  <div class="f"><label>Top Cut</label>
    <select id="et-cut" ${t.status!=='registration'?'disabled':''}>
      <option value="0" ${(t.settings.topCutSize||0)===0?'selected':''}>Sem top cut</option>
      <option value="4" ${t.settings.topCutSize===4?'selected':''}>Top 4</option>
      <option value="8" ${t.settings.topCutSize===8?'selected':''}>Top 8</option>
      <option value="16" ${t.settings.topCutSize===16?'selected':''}>Top 16</option>
    </select>
  </div>
</div>
<div class="g2">
  <div class="f"><label>Tempo por rodada (min)</label><input type="number" id="et-timer" min="10" max="90" value="${t.settings.timerMinutes||50}"></div>
  <div class="f"><label>Modo</label>
    <select id="et-mode">
      <option value="lc"   ${t.mode==='lc'  ?'selected':''}>League Challenge</option>
      <option value="cup"  ${t.mode==='cup' ?'selected':''}>League Cup</option>
      <option value="one"  ${t.mode==='one' ?'selected':''}>Championship</option>
      <option value="cust" ${t.mode==='cust'||!t.mode?'selected':''}>Personalizado</option>
    </select>
  </div>
</div>
<div class="fx gap6 mb0" style="justify-content:space-between;margin-top:8px">
  <button class="btn btn-xs btn-d" onclick="if(confirm('Excluir este torneio?'))delTour('${t.id}')"><i class="ti ti-trash"></i> Excluir</button>
  <div class="fx gap6">
    <button class="btn" onclick="closeM()">Cancelar</button>
    <button class="btn btn-p" onclick="saveEditTour()"><i class="ti ti-check"></i> Salvar</button>
  </div>
</div>`;
}

/* ════════════════════════════════════════════════════════
   TEMPORADAS
════════════════════════════════════════════════════════ */
function getSeasons() {
  // Derive seasons from tournament dates — monthly or annual
  const bySeason = {};
  G.tours.forEach(t => {
    const d = t.date ? new Date(t.date) : new Date(t.createdAt);
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    const label = d.toLocaleString('pt-BR',{month:'long',year:'numeric'});
    if (!bySeason[key]) bySeason[key] = { key, label, year:d.getFullYear(), month:d.getMonth()+1, tours:[] };
    bySeason[key].tours.push(t);
  });
  return Object.values(bySeason).sort((a,b)=>b.key.localeCompare(a.key));
}

function renderSeasons() {
  const seasons = getSeasons();
  if (!seasons.length) return `<div class="empty"><p>Nenhum torneio para agrupar</p></div>`;

  // Yearly summary
  const byYear = {};
  seasons.forEach(s => {
    if (!byYear[s.year]) byYear[s.year] = { tours:0, players:new Set(), finished:0 };
    byYear[s.year].tours += s.tours.length;
    s.tours.forEach(t => {
      t.players.forEach(p => byYear[s.year].players.add(p.gid||p.id));
      if (t.status==='finished') byYear[s.year].finished++;
    });
  });

  return `
<h2 class="mb16">Temporadas</h2>
${Object.entries(byYear).sort((a,b)=>b[0]-a[0]).map(([year, data])=>`
<div class="card mb8">
  <div class="fx sb2 mb12">
    <h3>${year}</h3>
    <div class="fx gap8">
      <span class="badge bn">${data.tours} torneios</span>
      <span class="badge bn">${data.players.size} jogadores únicos</span>
      <span class="badge bs">${data.finished} finalizados</span>
    </div>
  </div>
  <div class="g2 gap8">
    ${seasons.filter(s=>s.year===Number(year)).map(s=>`
    <div class="well">
      <div class="fx sb2 mb6">
        <span style="font-size:13px;font-weight:500;text-transform:capitalize">${s.label}</span>
        <span class="badge bn">${s.tours.length}</span>
      </div>
      ${s.tours.map(t=>`<div class="plr" style="padding:5px 0" onclick="openTour('${t.id}')">
        <div style="flex:1;min-width:0">
          <div class="small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name)}</div>
        </div>
        ${stbadge(t)}
      </div>`).join('')}
    </div>`).join('')}
  </div>
</div>`).join('')}`;
}

/* ════════════════════════════════════════════════════════
   CONTAGEM REGRESSIVA (próximo torneio)
════════════════════════════════════════════════════════ */
function getNextTournament() {
  const today = new Date(); today.setHours(0,0,0,0);
  return G.tours
    .filter(t => t.date && new Date(t.date) >= today && t.status === 'registration')
    .sort((a,b) => new Date(a.date) - new Date(b.date))[0] || null;
}

function renderCountdownCard() {
  const t = getNextTournament();
  if (!t) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const eventDate = new Date(t.date);
  const diff = Math.round((eventDate - today) / 86400000);
  const label = diff === 0 ? 'Hoje!' : diff === 1 ? 'Amanhã' : `em ${diff} dias`;
  const color = diff === 0 ? 'var(--st)' : diff <= 3 ? 'var(--wt)' : 'var(--it)';
  return `
<div class="card mb16" style="border-color:${color};cursor:pointer" onclick="openTour('${t.id}')">
  <div class="fx sb2">
    <div>
      <div class="lbl mb4" style="color:${color}"><i class="ti ti-calendar-event"></i> Próximo torneio</div>
      <div style="font-size:15px;font-weight:600">${esc(t.name)}</div>
      <div class="muted small mt4">${t.date} · ${t.players.length} inscritos${t.venueId?' · '+esc(venueName(t.venueId)):''}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:28px;font-weight:700;color:${color};line-height:1">${diff===0?'🎉':diff}</div>
      <div class="muted small">${diff===0?'':diff===1?'dia':'dias'}</div>
    </div>
  </div>
</div>`;
}

/* ════════════════════════════════════════════════════════
   RANKING GLOBAL (ELO modificado)
   K = 32 × fator_torneio
   Fator: lc=0.5 | cup=1.0 | one=2.0 | cust=0.75
   Rating inicial: 1500
════════════════════════════════════════════════════════ */
function calcElo() {
  const K_BASE = 32;
  const MODE_K = { lc:0.5, cup:1.0, one:2.0, cust:0.75 };
  const ratings = {};

  // Sort tournaments by date
  const sorted = [...G.tours]
    .filter(t => t.status==='finished' && t.rounds.length>0)
    .sort((a,b) => (a.date||a.createdAt) > (b.date||b.createdAt) ? 1 : -1);

  function getRating(id) {
    if (!ratings[id]) ratings[id] = { rating:1500, w:0, l:0, t:0, games:0, history:[] };
    return ratings[id];
  }
  function expScore(rA, rB) { return 1 / (1 + Math.pow(10, (rB-rA)/400)); }

  sorted.forEach(tour => {
    const K = K_BASE * (MODE_K[tour.mode] || 0.75);
    tour.rounds.forEach(rnd => {
      rnd.pairings.forEach(p => {
        if (p.isBye || p.result===null) return;
        const p1 = tour.players.find(x=>x.id===p.p1);
        const p2 = tour.players.find(x=>x.id===p.p2);
        if (!p1||!p2) return;

        // Use gid if available, else tournament-scoped id
        const id1 = p1.gid||p1.id, id2 = p2.gid||p2.id;
        if (!id1||!id2) return;

        const r1 = getRating(id1), r2 = getRating(id2);
        const exp1 = expScore(r1.rating, r2.rating);
        const exp2 = 1 - exp1;

        let s1=0, s2=0;
        if (p.result===R.P1)  { s1=1; s2=0; r1.w++; r2.l++; }
        else if (p.result===R.P2) { s1=0; s2=1; r1.l++; r2.w++; }
        else if (p.result===R.TIE){ s1=0.5; s2=0.5; r1.t++; r2.t++; }
        else return; // DL — não conta

        const delta1 = K*(s1-exp1), delta2 = K*(s2-exp2);
        r1.rating = Math.max(100, r1.rating + delta1);
        r2.rating = Math.max(100, r2.rating + delta2);
        r1.games++; r2.games++;
      });
    });
  });

  return ratings;
}

function renderRanking() {
  const ratings = calcElo();
  const players = G.players
    .map(gp => {
      const r = ratings[gp.id];
      if (!r || r.games < 3) return null;
      const gp2 = { ...gp, ...r };
      gp2.wr = r.games > 0 ? Math.round(r.w/r.games*100) : 0;
      return gp2;
    })
    .filter(Boolean)
    .sort((a,b) => b.rating - a.rating);

  const unranked = G.players.filter(gp => {
    const r = ratings[gp.id];
    return !r || r.games < 3;
  });

  return `
<div class="fx sb2 mb16">
  <div>
    <h1 class="mb4">Ranking Global</h1>
    <div class="muted small">ELO modificado · mínimo 3 partidas · K=32 (LC×0.5, Cup×1.0, Champ×2.0)</div>
  </div>
</div>
${players.length===0?`<div class="card"><div class="empty"><i class="ti ti-trophy"></i><p>Nenhum jogador rankeado ainda.<br><span class="small">São necessárias ao menos 3 partidas em torneios finalizados.</span></p></div></div>`:`
<div class="card p0 mb16 tov">
<table>
  <thead><tr><th>#</th><th>Jogador</th><th>ELO</th><th>W/L/E</th><th>WR%</th><th>Partidas</th></tr></thead>
  <tbody>
    ${players.map((p,i)=>`
    <tr style="cursor:pointer" onclick="nav('pdetail',{pid:'${p.id}'})">
      <td class="mono" style="font-weight:${i<3?700:400}">
        ${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}
      </td>
      <td><div class="fx gap6">${esc(p.name)} ${dbadge(p.division)}</div></td>
      <td class="mono" style="font-weight:700;font-size:15px">${Math.round(p.rating)}</td>
      <td class="mono">${p.w}/${p.l}/${p.t}</td>
      <td><span class="badge ${p.wr>=50?'bs':'bd'}">${p.wr}%</span></td>
      <td class="muted small">${p.games}</td>
    </tr>`).join('')}
  </tbody>
</table>
</div>`}
${unranked.length>0?`
<div class="muted small">
  <strong>${unranked.length}</strong> jogador${unranked.length!==1?'es':''} sem ranking (menos de 3 partidas)
</div>`:''}`;
}


function renderLog(t) {
  const log = [...(t.log||[])].reverse();
  return `
<div class="fx sb2 mb16">
  <h2>Histórico de alterações</h2>
  <span class="muted small">${log.length} entrada${log.length!==1?'s':''}</span>
</div>
${log.length===0
  ? '<div class="empty"><i class="ti ti-history"></i><p>Nenhum registro ainda</p></div>'
  : '<div class="card p0">' + [...(t.log||[])].reverse().map(e =>
      '<div class="plr" style="gap:12px;padding:8px 16px">' +
      '<span class="mono muted" style="font-size:11px;min-width:38px;flex-shrink:0">' + e.hhmm + '</span>' +
      '<span style="font-size:13px">' + esc(e.msg) + '</span>' +
      '</div>'
    ).join('') + '</div>'
}`;
}


function copyTourLink(tourId) {
  const base = location.origin + location.pathname.replace('index.html','').replace(/\/$/, '');
  const url  = base + '/player.html?tour=' + tourId;
  navigator.clipboard.writeText(url).then(
    () => notify('Link copiado! Cole no chat para os jogadores', 'ok'),
    () => notify('URL: ' + url, 'ok')
  );
}


function toggleDeckCol() {
  G._showDeck = !G._showDeck;
  render();
}

function loadOffline() {
  G.players  = DB.load(SK.PL, []);
  G.tours    = DB.load(SK.TN, []);
  G.venues   = DB.load('ptcg_venues_v3', []);
  G.settings = DB.load(SK.ST, { separateDivisions:true, standingsByDiv:true, timerMinutes:50, seed:'', debugMode:false });
  G.tours.forEach(t => { if(!t._timer) t._timer=(t.settings?.timerMinutes||50)*60; t._timerOn=false; });
  G.loading  = false;
  setSyncStatus('offline');
  notify('Rodando offline — dados do cache local', 'warn');
  render();
}

async function init() {
  // Restore auth session from localStorage
  try {
    const saved = JSON.parse(localStorage.getItem('ptcg_auth') || 'null');
    if (saved && saved.token) {
      G.auth = { token: saved.token, refreshToken: saved.refreshToken||null, email: saved.email||'' };
    }
  } catch(e) { G.auth = null; }

  G.loading = true;
  render(); // show spinner
  G.settings = DB.load(SK.ST, { separateDivisions:true, standingsByDiv:true, timerMinutes:50, seed:'', debugMode:false });

  // Se tem sessão salva, tenta refresh proativamente antes de qualquer request
  if (G.auth) {
    if (G.auth.refreshToken) {
      console.log('[init] Refreshing token before load...');
      await _sbRefreshToken();   // renova silenciosamente; se falhar, G.auth.token fica o expirado
    } else {
      // Sessão antiga sem refresh_token — limpa, vai como anon
      console.warn('[init] Sessão sem refresh_token, limpando auth');
      G.auth = null;
      localStorage.removeItem('ptcg_auth');
    }
  }

  try {
    setSyncStatus('syncing');
    // Load players and tournaments in parallel
    const [sbPlayers, sbTours, sbVenues] = await Promise.all([
      SB.loadPlayers(),
      SB.loadTournaments(),
      SB.loadVenues(),
    ]);

    G.players = (sbPlayers || []).map(SB.rowP);
    G.tours   = (sbTours   || []).map(SB.rowT);
    G.venues  = (sbVenues || []).map(SB.rowV);

    DB.save(SK.PL, G.players);
    DB.save(SK.TN, G.tours);
    DB.save('ptcg_venues_v3', G.venues);

    setSyncStatus('ok');

    // Inicia Realtime após load bem-sucedido
    SBRealtime.start();

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
