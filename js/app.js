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

// Helpers de formatação, badges, inferência de divisão


function closeM() { G.modal=null; render(); }

function clearTourPlayers() {
  mtour(t => { t.players = []; });
}

/* Add player to tournament being created (before createTour) */
function ctAddPlayer(gid) {
  G._ctd = G._ctd || {};
  G._ctd.players = G._ctd.players || [];
  const gp = G.players.find(p => p.id === gid);
  if (!gp) return;
  if (G._ctd.players.some(p => p.gid === gid)) return notify('Já adicionado','warn');
  G._ctd.players.push({ id: uid(), gid, name: gp.name, division: gp.division, dropped:false, dq:false, hadBye:false });
  render();
}

function ctRemovePlayer(id) {
  if (!G._ctd) return;
  G._ctd.players = (G._ctd.players||[]).filter(p => p.id !== id);
  render();
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
function pname(id, t) { const p = (t||ct())?.players.find(x=>x.id===id); return p ? p.name : '?'; }
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

function renderHome() {
  const recent = [...G.tours].sort((a,b)=>b.createdAt-a.createdAt).slice(0,6);
  return `
<div class="mb20"><h1>Dashboard</h1><p class="muted mt4">Pokémon TCG Tournament Manager v${VER}</p></div>
<div class="sgrid mb20">
  <div class="sc"><div class="sv">${G.players.length}</div><div class="sl">Jogadores</div></div>
  <div class="sc"><div class="sv">${G.tours.length}</div><div class="sl">Torneios</div></div>
  <div class="sc"><div class="sv">${G.tours.filter(t=>t.status!=='finished'&&t.status!=='registration').length}</div><div class="sl">Ativos</div></div>
  <div class="sc"><div class="sv">${G.tours.filter(t=>t.status==='finished').length}</div><div class="sl">Finalizados</div></div>
</div>
<div class="g2 gap16">
  <div>
    <div class="fx sb2 mb12"><h2>Torneios recentes</h2><button class="btn btn-sm" onclick="nav('tours')"><i class="ti ti-list"></i> Ver todos</button></div>
    <div class="card p0">
      ${recent.length===0?`<div class="empty"><i class="ti ti-trophy"></i><p>Nenhum torneio ainda</p></div>`:
        recent.map(t=>`<div class="plr" onclick="openTour('${t.id}')">
          <div style="flex:1">
            <div class="fx gap6 mb4"><strong>${esc(t.name)}</strong>${stbadge(t)}</div>
            <div class="muted small">${esc(t.city||'')}${t.mode?' · '+t.mode.toUpperCase():''} · ${t.players.length} jogadores</div>
          </div><i class="ti ti-chevron-right muted"></i></div>`).join('')}
    </div>
  </div>
  <div>
    <div class="fx sb2 mb12"><h2>Ações rápidas</h2></div>
    <div class="fxc">
      <button class="btn btn-p fw jc" style="padding:12px" onclick="nav('ctour')"><i class="ti ti-plus"></i> Novo torneio</button>
      <button class="btn fw jc" style="padding:12px" onclick="nav('players')"><i class="ti ti-users"></i> Banco de jogadores</button>
      <button class="btn fw jc" style="padding:12px" onclick="importTour()"><i class="ti ti-upload"></i> Importar torneio (.json)</button>
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
  return `
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
  <input placeholder="Buscar nome, nickname, ID, cidade..." value="${esc(G.search)}" oninput="G.search=this.value;render()">
</div>
<div class="card p0">
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

function renderPDetail() {
  const gp = G.players.find(p => p.id === G.pid);
  if (!gp) return `<div class="empty">Jogador não encontrado</div>`;
  const participated = G.tours.filter(t => t.players.some(tp => tp.gid===gp.id));
  const age = calcAge(gp.birthDate);
  let tw=0,tl=0,tt=0;
  participated.forEach(t => {
    const tp=t.players.find(x=>x.gid===gp.id);
    if(!tp)return; const s=calcStats(tp.id,t.rounds); tw+=s.w;tl+=s.l;tt+=s.t;
  });
  return `
<div class="fx gap12 mb20">
  <button class="btn btn-sm" onclick="nav('players')"><i class="ti ti-arrow-left"></i> Voltar</button>
  <div class="av" style="width:50px;height:50px;font-size:17px">${esc(initials(gp.name))}</div>
  <div>
    <h1>${esc(gp.name)}${gp.nickname?` <span class="muted" style="font-size:15px">"${esc(gp.nickname)}"</span>`:''}</h1>
    <div class="fx gap6 mt4">${dbadge(gp.division)}${gp.playerId?`<span class="badge bn">ID: ${esc(gp.playerId)}</span>`:''}${age!==null?`<span class="badge bn">${age} anos</span>`:''}</div>
  </div>
  <button class="btn btn-sm ml" onclick="openPModal('${gp.id}')"><i class="ti ti-edit"></i> Editar</button>
</div>
<div class="g2 gap16 mb16">
  <div class="card">
    <h3 class="mb12">Informações</h3>
    <table>${[
      gp.playerId&&['Player ID',esc(gp.playerId)],
      gp.city&&['Cidade',esc(gp.city)+(gp.state?' / '+esc(gp.state):'')],
      gp.birthDate&&['Nascimento',(extractYear(gp.birthDate)||esc(gp.birthDate))+(age!==null?' ('+age+' anos)':'')],
      gp.contact&&['Contato',esc(gp.contact)],
      gp.notes&&['Observações',esc(gp.notes)],
    ].filter(Boolean).map(([k,v])=>`<tr><td class="muted" style="width:40%">${k}</td><td>${v}</td></tr>`).join('')}</table>
  </div>
  <div class="card">
    <h3 class="mb12">Estatísticas</h3>
    <div class="g2">
      <div class="well tc"><div class="sv">${participated.length}</div><div class="sl">Torneios</div></div>
      <div class="well tc"><div class="sv">${tw}</div><div class="sl">Vitórias</div></div>
      <div class="well tc"><div class="sv">${tl}</div><div class="sl">Derrotas</div></div>
      <div class="well tc"><div class="sv">${tt}</div><div class="sl">Empates</div></div>
    </div>
  </div>
</div>
<h2 class="mb12">Histórico de torneios</h2>
<div class="card p0">
${participated.length===0?`<div class="empty"><p>Nenhum torneio</p></div>`:
participated.map(t=>{
  const tp=t.players.find(x=>x.gid===gp.id);if(!tp)return'';
  const s=calcStats(tp.id,t.rounds);
  const st=getStandings(t.players,t.rounds);
  const pos=st.findIndex(x=>x.id===tp.id)+1;
  return `<div class="plr" onclick="openTour('${t.id}')">
    <div style="flex:1"><div class="fx gap6"><strong>${esc(t.name)}</strong>${stbadge(t)}</div>
    <div class="muted small mt4">${esc(t.city||'')} · ${t.rounds.length} rodadas</div></div>
    <div class="fx gap12"><span class="mono">${s.w}/${s.l}/${s.t}</span>${pos>0?`<span class="badge bn">#${pos}</span>`:''}</div>
  </div>`;
}).join('')}
</div>`;
}

function renderTours() {
  const q = norm(G.search);
  const list = G.tours
    .filter(t => !q || norm(t.name).includes(q) || norm(t.city||'').includes(q))
    .sort((a,b) => b.createdAt-a.createdAt);
  return `
<div class="fx sb2 mb16"><h1>Torneios</h1>
  <div class="fx gap6">
    <button class="btn btn-sm" onclick="importTDF()"><i class="ti ti-file-code"></i> Importar .tdf</button>
    <button class="btn btn-sm" onclick="importTour()"><i class="ti ti-upload"></i> Importar .json</button>
    <button class="btn btn-p btn-sm" onclick="nav('ctour')"><i class="ti ti-plus"></i> Novo</button>
  </div>
</div>
<div class="sw"><i class="ti ti-search"></i>
  <input placeholder="Buscar..." value="${esc(G.search)}" oninput="G.search=this.value;render()">
</div>
<div class="card p0">
${list.length===0?`<div class="empty"><i class="ti ti-trophy"></i><p>Nenhum torneio</p></div>`:
list.map(t=>`<div class="plr" onclick="openTour('${t.id}')">
  <div style="flex:1">
    <div class="fx gap6 mb4"><strong>${esc(t.name)}</strong>${stbadge(t)}</div>
    <div class="muted small">${t.mode?.toUpperCase()||'—'} · ${esc(t.city||'—')} · ${t.players.length} jogadores · ${t.rounds.length}/${t.settings.totalRounds} rodadas</div>
  </div>
  <div class="fx gap4">
    <button class="btn btn-xs" onclick="event.stopPropagation();exportTour('${t.id}')"><i class="ti ti-download"></i></button>
    <button class="btn btn-xs btn-d" onclick="event.stopPropagation();delTour('${t.id}')"><i class="ti ti-trash"></i></button>
    <i class="ti ti-chevron-right muted"></i>
  </div>
</div>`).join('')}
</div>`;
}
function renderCreateTour() {
  const d = G._ctd || {};
  const modes = [
    {id:'lc',  name:'League Challenge', desc:'Swiss sem top cut'},
    {id:'cup', name:'League Cup',       desc:'Swiss + top cut'},
    {id:'one', name:'Championship',     desc:'Premier Event'},
    {id:'custom',name:'Personalizado',    desc:'Config. livre'},
  ];
  return `
<div class="fx gap12 mb20">
  <button class="btn btn-sm" onclick="nav('tours')"><i class="ti ti-arrow-left"></i> Voltar</button>
  <h1>Novo torneio</h1>
</div>
<div style="max-width:580px">
<div class="card mb16">
  <h3 class="mb16">Informações</h3>
  <div class="f"><label>Nome *</label><input id="ct-name" placeholder="Liga Cup Rio — Maio 2025" value="${esc(d.name||'')}"></div>
  <div class="g2"><div class="f"><label>Cidade</label><input id="ct-city" value="${esc(d.city||'')}"></div>
  <div class="f"><label>Estado</label><input id="ct-state" value="${esc(d.state||'')}"></div></div>
  <div class="g2">
    <div class="f"><label>Data</label><input type="date" id="ct-date" value="${d.date||new Date().toISOString().slice(0,10)}"></div>
    <div class="f"><label>ID Sancionada</label><input id="ct-sanction" placeholder="##-##-######" value="${esc(d.sanctionedId||'')}" style="font-family:var(--mono)"></div>
  </div>
</div>
<div class="card mb16">
  <h3 class="mb12">Formato</h3>
  <div class="cg mb16">
    ${modes.map(m=>`<div class="chip ${(d.mode||'cup')===m.id?'on':''}" onclick="setCTMode('${m.id}')">
      <strong>${m.name}</strong><div class="small muted">${m.desc}</div></div>`).join('')}
  </div>
  <div class="g2">
    <div class="f">
      <label>Rodadas Swiss</label>
      <select id="ct-rounds" onchange="onCTRoundsChange(this.value)">
        <option value="auto" ${!d.totalRounds||d.totalRounds==='auto'?'selected':''}>Padrão (calculado pelo nº de jogadores)</option>
        <option value="3"  ${d.totalRounds===3?'selected':''}>3 rodadas  (4–8 jogadores)</option>
        <option value="4"  ${d.totalRounds===4?'selected':''}>4 rodadas  (9–16 jogadores)</option>
        <option value="5"  ${d.totalRounds===5?'selected':''}>5 rodadas  (17–32 jogadores)</option>
        <option value="6"  ${d.totalRounds===6?'selected':''}>6 rodadas  (33–64 jogadores)</option>
        <option value="7"  ${d.totalRounds===7?'selected':''}>7 rodadas  (65–128 jogadores)</option>
        <option value="8"  ${d.totalRounds===8?'selected':''}>8 rodadas  (129+ jogadores)</option>
        <option value="custom" ${d.totalRounds==='custom'?'selected':''}>Personalizado</option>
      </select>
      ${d.totalRounds==='custom'?'<input type="number" id="ct-rounds-custom" min="3" max="15" value="${d.customRounds||3}" style="margin-top:6px" placeholder="Mínimo 3">':''}
    </div>
    <div class="f"><label>Top Cut</label><select id="ct-cut">
      <option value="0" ${(d.topCutSize||0)===0?'selected':''}>Sem top cut</option>
      <option value="4" ${(d.topCutSize||0)===4?'selected':''}>Top 4</option>
      <option value="8" ${(d.topCutSize||0)===8?'selected':''}>Top 8</option>
      <option value="16"${(d.topCutSize||0)===16?'selected':''}>Top 16</option>
    </select></div>
  </div>
  <div class="well small muted mt4" style="padding:8px 12px">
    <i class="ti ti-info-circle"></i>
    Mínimo: <strong>4 jogadores</strong> e <strong>3 rodadas</strong>.
    No modo Padrão, o nº de rodadas é definido automaticamente ao iniciar o torneio com base no total de jogadores.
  </div>
  <div class="g2">
    <div class="f"><label>Tempo por rodada (min)</label><input type="number" id="ct-timer" min="10" max="90" value="${d.timerMinutes||50}"></div>
    <div class="f"><label>Seed (vazio = aleatório)</label><input id="ct-seed" placeholder="ex: 42" value="${d.seed||''}"></div>
  </div>
</div>
<div class="card mb16">
  <h3 class="mb12">Divisões</h3>
  <div class="fxc gap12">
    <label class="fx gap6"><input type="checkbox" id="ct-sepdiv" ${(d.separateDivisions!==false)?'checked':''}> Pareamentos separados por divisão</label>
    <label class="fx gap6"><input type="checkbox" id="ct-divst"  ${(d.standingsByDiv!==false)?'checked':''}> Standings separados por divisão</label>
  </div>
</div>
<div class="card mb16">
  <h3 class="mb12">Debug</h3>
  <label class="fx gap6"><input type="checkbox" id="ct-debug" ${d.debugMode?'checked':''}> Ativar modo debug (logs de pareamento detalhados)</label>
</div>
<div class="card mb16">
  <h3 class="mb12">Jogadores <span class="badge bn" id="ct-pcount">${(d.players||[]).length > 0 ? (d.players||[]).length + ' selecionados' : 'opcional'}</span></h3>
  <p class="muted small mb12">Você pode adicionar jogadores agora ou após criar o torneio.</p>
  <div class="fx gap6 mb8">
    <input id="ct-pq" placeholder="Buscar por nome ou ID..." style="flex:1" oninput="renderCTPlayerSearch(this.value)">
    <button class="btn btn-sm" onclick="openPModal(null,'ctour')"><i class="ti ti-plus"></i> Novo</button>
  </div>
  <div id="ct-pres"></div>
  ${(d.players||[]).length > 0 ? `
  <div class="sep"></div>
  <div class="lbl mb6">Selecionados</div>
  ${(d.players||[]).map((p,i)=>`<div class="plr" style="padding:6px 10px">
    <span class="mono muted" style="min-width:20px;font-size:11px">${i+1}</span>
    <span style="flex:1;font-size:13px">${esc(p.name)}</span>
    ${dbadge(p.division)}
    <button class="ib" onclick="ctRemovePlayer('${p.id}')"><i class="ti ti-x"></i></button>
  </div>`).join('')}` : ''}
</div>
<button class="btn btn-p fw jc" style="padding:12px" onclick="createTour()">
  <i class="ti ti-player-play"></i> Criar torneio
</button>
</div>`;
}

function onCTRoundsChange(val) {
  G._ctd = G._ctd || {};
  G._ctd.totalRounds = val === 'auto' ? 'auto' : val === 'custom' ? 'custom' : Number(val);
  // Re-render to show/hide custom input
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

function setCTMode(mode) {
  // Salva tudo que foi preenchido antes de re-renderizar
  G._ctd = G._ctd || {};
  G._ctd.name        = document.getElementById('ct-name')?.value || G._ctd.name || '';
  G._ctd.city        = document.getElementById('ct-city')?.value || G._ctd.city || '';
  G._ctd.state       = document.getElementById('ct-state')?.value || G._ctd.state || '';
  G._ctd.date        = document.getElementById('ct-date')?.value || G._ctd.date || '';
  G._ctd.sanctionedId= document.getElementById('ct-sanction')?.value || G._ctd.sanctionedId || '';
  G._ctd.totalRounds = Number(document.getElementById('ct-rounds')?.value) || G._ctd.totalRounds || 4;
  G._ctd.timerMinutes= Number(document.getElementById('ct-timer')?.value)  || G._ctd.timerMinutes || 50;
  G._ctd.seed        = document.getElementById('ct-seed')?.value || G._ctd.seed || '';
  G._ctd.separateDivisions = document.getElementById('ct-sepdiv')?.checked ?? G._ctd.separateDivisions ?? true;
  G._ctd.standingsByDiv    = document.getElementById('ct-divst')?.checked  ?? G._ctd.standingsByDiv    ?? true;
  G._ctd.debugMode         = document.getElementById('ct-debug')?.checked  ?? false;
  G._ctd.mode = mode;
  // Top cut: só muda se o modo define um valor padrão claro
  // 'custom' → preserva o que estava; outros têm default
  if (mode === 'lc') G._ctd.topCutSize = 0;
  else if (mode === 'cup') G._ctd.topCutSize = 8;
  else if (mode === 'one') G._ctd.topCutSize = 8;
  // 'custom': não altera — usuário escolhe manualmente
  render();
}

function renderTour() {
  const t = ct();
  if (!t) return `<div class="empty">Torneio não encontrado</div>`;

  const tabs = [
    { id:'reg',      icon:'ti-users',        label:'Registro' },
    { id:'rounds',   icon:'ti-layout-list',  label:'Rodada' },
    { id:'standings',icon:'ti-list-numbers', label:'Standings' },
    { id:'history',  icon:'ti-history',      label:'Histórico' },
    ...(t.topBracket?.length ? [{ id:'topcut', icon:'ti-tournament', label:'Top Cut' }] : []),
    ...(t.status==='finished' ? [{ id:'finished', icon:'ti-trophy', label:'Resultado final' }] : []),
    { id:'decklists',icon:'ti-cards',        label:'Decklists' },
    { id:'debug',    icon:'ti-bug',          label:'Debug' },
    { id:'export',   icon:'ti-download',     label:'Exportar' },
  ];

  const rnd = t.rounds[t.currentRound-1];
  const done = rnd ? rnd.pairings.filter(p=>p.result!==null).length : 0;
  const total = rnd ? rnd.pairings.length : 0;

  let body = '';
  if      (G.tab==='reg')       body = renderReg(t);
  else if (G.tab==='rounds')    body = renderRounds(t);
  else if (G.tab==='standings') body = renderStandings(t);
  else if (G.tab==='history')   body = renderHistory(t);
  else if (G.tab==='topcut')    body = renderTopCut(t);
  else if (G.tab==='finished')  body = renderFinished(t);
  else if (G.tab==='decklists') body = renderDecklists(t);
  else if (G.tab==='debug')     body = renderDebug(t);
  else if (G.tab==='export')    body = renderExport(t);

  return `
<div class="tb">
  <button class="btn btn-sm" onclick="nav('tours')"><i class="ti ti-arrow-left"></i></button>
  <strong>${esc(t.name)}</strong>
  ${stbadge(t)}
  <span class="badge bn">${t.players.length} jog.</span>
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

const REG_PAGE_SIZE = 15;

/* ── REGISTRATION ── */
function renderReg(t) {
  const n = t.players.length;
  const rec = recRounds(n), cut = recCut(n, t.settings.mode);
  const byDiv = DIVS.map(d=>({d, c:t.players.filter(p=>p.division===d).length})).filter(x=>x.c>0);
  const isReg = t.status === 'registration';

  return `
<div class="fx sb2 mb12">
  <div>
    <h2 class="mb4">Registro de jogadores</h2>
    <div class="fx gap6">
      ${byDiv.map(({d,c})=>`<span class="badge ${DC[d]}">${d[0]}: ${c}</span>`).join('')}
      ${n>0?`<span class="muted small">${rec} rodadas rec. · ${cut?'Top '+cut:'Sem top cut'}</span>`:''}
    </div>
  </div>
  <div class="fx gap6">
    <button class="btn btn-sm" onclick="openEditTourModal()"><i class="ti ti-edit"></i> Editar info</button>
    ${isReg?`<button class="btn btn-p" ${n<4?'disabled title="Mínimo 4 jogadores"':''} onclick="startTour()">
      <i class="ti ti-player-play"></i> Iniciar torneio</button>`:''}
  </div>
</div>

${isReg?`
<div style="display:grid;grid-template-columns:340px 1fr;gap:16px;align-items:start">

  <!-- Painel de busca + add -->
  <div class="fxc gap12">
    <div class="card">
      <h3 class="mb10">Adicionar jogador</h3>
      <div class="fx gap6 mb8">
        <input id="reg-q" placeholder="Nome ou Player ID..." style="flex:1"
          oninput="renderRegSearch(this.value)" onkeydown="if(event.key==='Enter')regSearchEnter()">
        <button class="btn btn-sm btn-p" onclick="openPModal(null,true)" title="Criar novo jogador">
          <i class="ti ti-plus"></i>
        </button>
      </div>
      <div id="reg-res"></div>
    </div>

    <div class="card">
      <h3 class="mb8">Banco de jogadores</h3>
      <div id="reg-db-list">${renderRegDBList(t, '', 0)}</div>
    </div>

    <div class="card">
      <h3 class="mb8">Adicionar vários (um por linha)</h3>
      <textarea id="bulk-in" style="height:72px" placeholder="João Silva&#10;Maria Santos"></textarea>
      <div class="fx gap8 mt8">
        <select id="bulk-div" style="flex:1">${DIVS.map(d=>`<option>${d}</option>`).join('')}</select>
        <button class="btn btn-sm" onclick="addBulk()"><i class="ti ti-upload"></i> Adicionar</button>
      </div>
    </div>
  </div>

  <!-- Lista de inscritos -->
  <div class="card p0">
    <div class="fx sb2" style="padding:12px 16px;border-bottom:1px solid var(--bd)">
      <h3>${n} inscrito${n!==1?'s':''}</h3>
      ${n>0?`<button class="btn btn-xs btn-d" onclick="if(confirm('Remover todos?'))clearTourPlayers()">
        <i class="ti ti-trash"></i> Limpar</button>`:''}
    </div>
    ${n===0
      ? `<div class="empty"><i class="ti ti-users"></i><p>Nenhum jogador ainda</p></div>`
      : t.players.map((p,i)=>`
        <div class="plr">
          <span class="mono muted" style="min-width:26px;font-size:11px">${i+1}</span>
          <span style="flex:1">${esc(p.name)}</span>
          ${dbadge(p.division)}
          ${p.playerId?`<span class="mono muted" style="font-size:10px">${esc(p.playerId)}</span>`:''}
          <button class="ib" onclick="removeFromTour('${p.id}')"><i class="ti ti-x"></i></button>
        </div>`).join('')}
  </div>

</div>`:`
<div class="card p0">
${t.players.map((p,i)=>`<div class="plr">
  <span class="mono muted" style="min-width:26px;font-size:11px">${i+1}</span>
  <span style="flex:1">${esc(p.name)}</span>${dbadge(p.division)}
  ${p.playerId?`<span class="mono muted" style="font-size:10px">${esc(p.playerId)}</span>`:''}
  ${p.dropped?`<span class="badge bn">Dropped</span>`:''}
  ${p.dq?`<span class="badge bd">DQ</span>`:''}
</div>`).join('')}
</div>`}`;
}

/* Lista paginada de todos os jogadores do banco */
function renderRegDBList(t, filter, page) {
  const have = new Set(t.players.map(p=>p.gid).filter(Boolean));
  const q = norm(filter||'').trim();
  const all = G.players
    .filter(p => !have.has(p.id) && (!q ||
      norm(p.name).includes(q) ||
      norm(p.playerId||'').includes(q)))
    .sort((a,b) => a.name.localeCompare(b.name, 'pt', {sensitivity:'base'}));

  const total = all.length;
  const pages = Math.ceil(total / REG_PAGE_SIZE) || 1;
  const pg = Math.max(0, Math.min(page, pages-1));
  const slice = all.slice(pg * REG_PAGE_SIZE, (pg+1) * REG_PAGE_SIZE);

  if (!total) return `<p class="muted small">Nenhum jogador no banco${q?' para "'+esc(q)+'"':''}.</p>`;

  return `
<div class="sw mb8" style="margin-bottom:10px">
  <i class="ti ti-search"></i>
  <input placeholder="Filtrar..." value="${esc(filter||'')}"
    oninput="refreshRegDB(this.value)" style="padding-left:34px;font-size:12px">
</div>
<div style="max-height:320px;overflow-y:auto;margin:0 -4px">
  ${slice.map(p=>`
  <div class="plr" style="padding:7px 10px;cursor:pointer" onclick="addFromDB('${p.id}')">
    <div style="flex:1;min-width:0">
      <div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</div>
      <div class="muted" style="font-size:10px">${p.division}${p.playerId?' · '+esc(p.playerId):''}</div>
    </div>
    ${dbadge(p.division)}
    <i class="ti ti-plus muted" style="font-size:14px;margin-left:4px"></i>
  </div>`).join('')}
</div>
${pages > 1 ? `
<div class="fx sb2 mt8" style="font-size:12px;color:var(--t2)">
  <button class="btn btn-xs" ${pg===0?'disabled':''} onclick="regDBPage(${pg-1})">
    <i class="ti ti-chevron-left"></i>
  </button>
  <span>${pg+1} / ${pages} · ${total} jogadores</span>
  <button class="btn btn-xs" ${pg>=pages-1?'disabled':''} onclick="regDBPage(${pg+1})">
    <i class="ti ti-chevron-right"></i>
  </button>
</div>` : `<p class="muted" style="font-size:11px;margin-top:6px">${total} jogador${total!==1?'es':''}</p>`}`;
}

// State for DB list
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

function regSearchEnter() {
  const q = document.getElementById('reg-q')?.value?.trim();
  if (!q) return;
  const t = ct(); if (!t) return;
  const have = new Set(t.players.map(p=>p.gid).filter(Boolean));
  const found = G.players.filter(p => !have.has(p.id) && (
    norm(p.name).startsWith(norm(q)) ||
    norm(p.playerId||'') === norm(q)
  ));
  if (found.length === 1) { addFromDB(found[0].id); document.getElementById('reg-q').value=''; }
}

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

/* ── ROUNDS ── */
function renderRounds(t) {
  if (t.status==='registration') return `<div class="empty"><i class="ti ti-layout-list"></i><p>Inicie o torneio para ver os pareamentos</p></div>`;
  const rnd = t.rounds[t.currentRound-1];
  if (!rnd) return `<div class="empty">Nenhuma rodada ativa</div>`;

  const allDone = rnd.pairings.every(p=>p.result!==null);
  const isLast = t.currentRound >= t.settings.totalRounds;

  // Lista única ordenada por mesa — BYEs no final
  const sorted = [...rnd.pairings].sort((a,b) => {
    if (a.isBye && !b.isBye) return 1;
    if (!a.isBye && b.isBye) return -1;
    return (a.table||0) - (b.table||0);
  });
  const html = sorted.map(p=>pairingRow(p,t)).join('');

  return `
<div class="fx sb2 mb16">
  <div>
    <h2>Rodada ${t.currentRound} / ${t.settings.totalRounds}</h2>
    ${rnd.isSimulated?`<span class="badge bw mt4"><i class="ti ti-player-play"></i> Simulada</span>`:''}

  </div>
  <div class="fx gap6">
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
    ${bye?'':r ? `
      <div class="fx gap4">
        ${r===R.P1?`<span class="badge bs">P1</span>`:r===R.P2?`<span class="badge bd">P2</span>`:r===R.TIE?`<span class="badge bw">Emp</span>`:`<span class="badge bn">DL</span>`}
        <button class="ib btn-xs" onclick="setRes('${p.id}',null)" title="Desfazer"><i class="ti ti-backspace"></i></button>
        <button class="ib btn-xs" onclick="openJudge('${p.id}')" title="Juiz"><i class="ti ti-gavel"></i></button>
      </div>
      ${p.judgeNote?`<div class="small" style="color:var(--wt)"><i class="ti ti-gavel"></i> ${esc(p.judgeNote)}</div>`:''}`:
    `<div class="rg">
      <button class="rb rp1" onclick="setRes('${p.id}','${R.P1}')">P1</button>
      <button class="rb rtie" onclick="setRes('${p.id}','${R.TIE}')">Emp</button>
      <button class="rb rp2" onclick="setRes('${p.id}','${R.P2}')">P2</button>
      <button class="rb rdl"  onclick="setRes('${p.id}','${R.DL}')" title="Double Loss">DL</button>
    </div>`}
  </div>
</div>`;
}

/* ── STANDINGS ── */
function renderStandings(t) {
  if (t.settings.standingsByDiv && t.settings.separateDivisions) {
    return DIVS.map(div => {
      const s = getStandings(t.players, t.rounds, div);
      if (!s.length) return '';
      return `<div class="lbl mb8">${div}</div>${standTable(s, t)}`;
    }).join('');
  }
  return standTable(getStandings(t.players, t.rounds), t);
}

function standTable(stand, t) {
  const cut = t.settings.topCutSize;
  return `<div class="card p0 mb16 tov">
<table>
  <thead><tr><th>#</th><th>Jogador</th><th>Pts</th><th>W/L/E</th><th>OWP%</th><th>OOWP%</th><th>P1cnt</th><th></th></tr></thead>
  <tbody>
    ${stand.map((p,i)=>`
    ${i===cut&&cut>0?`<tr class="cutrow"><td colspan="8"><div class="cutline"></div></td></tr>`:''}
    <tr style="opacity:${p.dropped?'.4':'1'}">
      <td class="mono" style="font-weight:${i<3&&!p.dropped?700:400}">
        ${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}
      </td>
      <td><div class="fx gap6">${esc(p.name)} ${dbadge(p.division)}</div>
        ${p.dropped?'<div class="muted small">Dropped</div>':''}
      </td>
      <td class="mono" style="font-weight:700;font-size:15px">${p.mp}</td>
      <td class="mono">${p.w}/${p.l}/${p.t}</td>
      <td class="mono">${pct(p.owp)}</td>
      <td class="mono">${pct(p.oowp)}</td>
      <td class="mono">${p1Count(p.id,t.rounds)}</td>
      <td>
        ${!p.dropped&&!p.dq&&t.status==='rounds'?`<button class="btn btn-xs btn-w" onclick="dropP('${p.id}')">Drop</button>`:''}
        ${p.dq?`<span class="badge bd">DQ</span>`:''}
      </td>
    </tr>`).join('')}
  </tbody>
</table></div>`;
}

/* ── HISTORY ── */
function renderHistory(t) {
  if (!t.rounds.length) return `<div class="empty"><p>Nenhuma rodada completada</p></div>`;
  return `<h2 class="mb16">Histórico de rodadas</h2>
${t.rounds.map((rnd,ri) => `
  <div class="mb8">
    <div class="coll-hd ${ri===t.rounds.length-1?'open':''}" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
      <span>Rodada ${rnd.number}${rnd.isSimulated?' <span class="badge bw">sim</span>':''}</span>
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
            <td>
              ${bye?`<span class="badge bi">BYE</span>`:
               p.result===R.P1?`<span class="badge bs">P1</span>`:
               p.result===R.P2?`<span class="badge bd">P2</span>`:
               p.result===R.TIE?`<span class="badge bw">Emp</span>`:
               p.result===R.DL?`<span class="badge bn">DL</span>`:
               `<span class="badge bn">—</span>`}
              ${p.isRematch?`<span class="badge bw" title="Rematch forçado">⚠R</span>`:''}
            </td>
            <td>${bye?'—':esc(pname(p.p2,t))}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>
  </div>`).join('')}`;
}

/* ── TOP CUT ── */
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
      <div class="bp ${m.winner==='p1'?'bwin':m.winner||!active?'bna':''}" onclick="${active&&!m.winner?`setTC('${m.id}','p1')`:''}">
        <span class="bps">${m.seed1||''}</span>
        <span class="bpn">${m.p1?esc(m.p1.name):'TBD'}</span>
        ${m.winner==='p1'?'<i class="ti ti-crown" style="color:var(--st)"></i>':''}
      </div>
      <div class="bp ${m.winner==='p2'?'bwin':m.winner||!active?'bna':''}" onclick="${active&&!m.winner?`setTC('${m.id}','p2')`:''}">
        <span class="bps">${m.seed2||''}</span>
        <span class="bpn">${m.p2?esc(m.p2.name):'TBD'}</span>
        ${m.winner==='p2'?'<i class="ti ti-crown" style="color:var(--st)"></i>':''}
      </div>
    </div>`).join('')}</div>`;
  }).join('');

  return `
<div class="fx sb2 mb16">
  <h2>Top ${t.settings.topCutSize}</h2>
  <button class="btn btn-p" ${allDone?'':'disabled'} onclick="advanceTC()">
    ${isFinal?'Finalizar torneio':'Próxima fase'} <i class="ti ti-arrow-right"></i>
  </button>
</div>
<p class="muted small mb16">Clique no nome do vencedor para avançá-lo.</p>
<div class="bracket">${cols}</div>`;
}

/* ── FINISHED ── */
function renderFinished(t) {
  const stand = getStandings(t.players, t.rounds);
  return `
<div class="fx sb2 mb16"><h2>Resultado final</h2>
  <button class="btn btn-sm" onclick="exportTour('${t.id}')"><i class="ti ti-download"></i> Exportar</button>
</div>
<div class="sgrid mb16">
  <div class="sc"><div class="sv">${t.players.length}</div><div class="sl">Jogadores</div></div>
  <div class="sc"><div class="sv">${t.settings.totalRounds}</div><div class="sl">Rodadas</div></div>
  <div class="sc"><div class="sv">${t.settings.topCutSize||'—'}</div><div class="sl">Top cut</div></div>
  <div class="sc"><div class="sv">${esc(t.city||'—')}</div><div class="sl">Cidade</div></div>
</div>
${standTable(stand, t)}`;
}

/* ── DEBUG ── */
/* ── DECKLISTS ── */
function getAllArchetypes() {
  // Coleta todos os arquétipos já usados em todos os torneios
  const set = new Set();
  G.tours.forEach(t => t.players.forEach(p => { if(p.deckArchetype) set.add(p.deckArchetype); }));
  return [...set].sort((a,b) => a.localeCompare(b, 'pt'));
}

function renderDecklists(t) {
  const registered = t.players.filter(p => p.deckArchetype);
  const pending    = t.players.filter(p => !p.deckArchetype);
  const allArchs   = getAllArchetypes();

  // Contagem de arquétipos neste torneio
  const archCount = {};
  registered.forEach(p => { archCount[p.deckArchetype] = (archCount[p.deckArchetype]||0)+1; });
  const archRanked = Object.entries(archCount).sort((a,b)=>b[1]-a[1]);
  const maxCount   = archRanked[0]?.[1] || 1;

  const archColors = [
    '#D85A30','#7F77DD','#1D9E75','#378ADD','#BA7517',
    '#D4537E','#888780','#639922','#993C1D','#534AB7',
  ];

  return `
<div class="fx sb2 mb16">
  <div>
    <h2 class="mb4">Decklists</h2>
    <div class="fx gap6">
      <span class="badge bs"><i class="ti ti-check"></i> ${registered.length} registradas</span>
      ${pending.length>0?`<span class="badge bn">${pending.length} pendentes</span>`:''}
    </div>
  </div>
  <button class="btn btn-p" onclick="openDeckModal(null)">
    <i class="ti ti-plus"></i> Registrar
  </button>
</div>

<div style="display:grid;grid-template-columns:1fr 280px;gap:16px;align-items:start">

  <!-- Lista de jogadores -->
  <div class="card p0">
    <div style="padding:10px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:10px">
      <h3 style="flex:1">Jogadores</h3>
      <input placeholder="Buscar..." style="width:160px;font-size:12px;padding:5px 10px"
        oninput="filterDeckList(this.value)">
    </div>
    <div id="deck-player-list">
      ${renderDeckPlayerList(t, '')}
    </div>
  </div>

  <!-- Sidebar: arquétipos + form rápido -->
  <div style="display:flex;flex-direction:column;gap:12px">

    ${archRanked.length > 0 ? `
    <div class="card">
      <div class="lbl mb10">Meta do torneio</div>
      ${archRanked.map(([name, count], i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:0.5px solid var(--bd)">
          <span style="width:10px;height:10px;border-radius:2px;background:${archColors[i%archColors.length]};flex-shrink:0"></span>
          <span style="flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</span>
          <div style="width:60px;height:5px;background:var(--s2);border-radius:3px;overflow:hidden">
            <div style="width:${Math.round(count/maxCount*100)}%;height:100%;background:${archColors[i%archColors.length]}"></div>
          </div>
          <span class="muted" style="font-size:12px;min-width:16px;text-align:right">${count}</span>
        </div>`).join('')}
    </div>` : ''}

    <div class="card">
      <div class="lbl mb10">Registro rápido</div>
      <div class="f mb8">
        <label>Jogador</label>
        <select id="deck-quick-player">
          <option value="">Selecionar...</option>
          ${pending.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}
          ${registered.map(p=>`<option value="${p.id}">${esc(p.name)} ✓</option>`).join('')}
        </select>
      </div>
      <div class="f mb12">
        <label>Arquétipo</label>
        <input id="deck-quick-arch" list="arch-datalist" placeholder="Charizard ex, Gardevoir ex...">
        <datalist id="arch-datalist">
          ${allArchs.map(a=>`<option value="${esc(a)}">`).join('')}
        </datalist>
      </div>
      <button class="btn btn-p fw jc" onclick="saveDeckQuick()">
        <i class="ti ti-check"></i> Salvar
      </button>
    </div>

  </div>
</div>`;
}

function renderDeckPlayerList(t, filter) {
  const q = norm(filter || '');
  const players = q
    ? t.players.filter(p => norm(p.name).includes(q) || norm(p.deckArchetype||'').includes(q))
    : t.players;

  if (!players.length) return `<div class="empty"><p>Nenhum jogador encontrado</p></div>`;

  const archColors = ['#D85A30','#7F77DD','#1D9E75','#378ADD','#BA7517','#D4537E','#888780','#639922'];
  const archColorMap = {};
  let ci = 0;
  t.players.forEach(p => {
    if(p.deckArchetype && !archColorMap[p.deckArchetype])
      archColorMap[p.deckArchetype] = archColors[ci++ % archColors.length];
  });

  return players.map((p,i) => `
    <div class="plr" style="padding:10px 16px">
      <span class="muted mono" style="min-width:24px;font-size:11px">${t.players.indexOf(p)+1}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500">${esc(p.name)}</div>
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
    </div>`).join('');
}

function filterDeckList(q) {
  const t = ct(); if (!t) return;
  const el = document.getElementById('deck-player-list');
  if (el) el.innerHTML = renderDeckPlayerList(t, q);
}

function saveDeckQuick() {
  const pid  = document.getElementById('deck-quick-player')?.value;
  const arch = document.getElementById('deck-quick-arch')?.value?.trim();
  if (!pid)  return notify('Selecione um jogador','warn');
  if (!arch) return notify('Informe o arquétipo','warn');
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
  <label>Arquétipo</label>
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
  // Check rematches across all rounds
  const rematches = [];
  for (const rnd of t.rounds)
    for (const p of rnd.pairings)
      if (p.isRematch) rematches.push(`R${rnd.number}: ${pname(p.p1,t)} vs ${pname(p.p2,t)}`);

  if (!issues.length && !rematches.length)
    return `<span class="badge bs"><i class="ti ti-check"></i> Nenhum problema encontrado</span>`;

  return `
${issues.map(i=>`<div class="badge bd mb4"><i class="ti ti-alert-circle"></i> ${esc(i)}</div>`).join('')}
${rematches.map(r=>`<div class="badge bw mb4"><i class="ti ti-alert-triangle"></i> Rematch forçado: ${esc(r)}</div>`).join('')}`;
}

/* ── EXPORT TAB ── */
function renderExport(t) {
  const canExportTDF = t.status === 'finished' || t.rounds.length > 0;
  return `
<h2 class="mb16">Exportar / Importar</h2>

<div class="card mb16" style="border:2px solid var(--it)">
  <div class="fx gap8 mb8">
    <span class="badge bi" style="font-size:13px;padding:4px 12px"><i class="ti ti-file-code"></i> TOM Data File (.tdf)</span>
    <span class="badge bn small">Formato oficial Pokémon</span>
  </div>
  <p class="muted small mb12">Gera o arquivo <strong>.tdf</strong> compatível com o TOM e o sistema de reporte oficial da Pokémon. Inclui jogadores, rodadas, resultados e standings por divisão.</p>
  <div class="fx gap8">
    <button class="btn btn-p" ${canExportTDF?'':'disabled'} onclick="exportTDF('${t.id}')">
      <i class="ti ti-download"></i> Exportar .tdf
    </button>
    <button class="btn" onclick="importTDF()">
      <i class="ti ti-upload"></i> Importar .tdf
    </button>
    ${!canExportTDF?`<span class="muted small">Finalize pelo menos 1 rodada para exportar</span>`:''}
  </div>
</div>

<div class="g2 gap16">
  <div class="card">
    <h3 class="mb8">Backup completo (.json)</h3>
    <p class="muted small mb12">Salva todos os dados internos do sistema.</p>
    <button class="btn" onclick="exportTour('${t.id}')"><i class="ti ti-download"></i> Baixar .json</button>
  </div>
  <div class="card">
    <h3 class="mb8">Restaurar backup</h3>
    <p class="muted small mb12">Carrega um backup .json exportado anteriormente.</p>
    <button class="btn" onclick="importTour()"><i class="ti ti-upload"></i> Carregar .json</button>
  </div>
  <div class="card">
    <h3 class="mb8">Standings (.csv)</h3>
    <p class="muted small mb12">Classificação atual exportada para planilha.</p>
    <button class="btn" onclick="exportCSV('${t.id}')"><i class="ti ti-table"></i> Baixar CSV</button>
  </div>
  <div class="card">
    <h3 class="mb8">Lista de jogadores (.csv)</h3>
    <p class="muted small mb12">Todos os jogadores inscritos no torneio.</p>
    <button class="btn" onclick="exportPlayerCSV('${t.id}')"><i class="ti ti-users"></i> Baixar CSV</button>
  </div>
</div>`;
}

/* ── TIMER (inline topbar) ── */
function renderTimerBlock(t) {
  const s = t._timer||0;
  const cls = s<300?'tc2':s<600?'tw':'';
  return `<div class="fx gap6 ml">
    <span class="timer ${cls}" id="tmr">${fmt(s)}</span>
    <button class="btn btn-sm" onclick="toggleTimer()" id="tmrbtn"><i class="ti ti-${t._timerOn?'player-pause':'player-play'}"></i></button>
    <button class="btn btn-sm" onclick="resetTimer()"><i class="ti ti-refresh"></i></button>
  </div>`;
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

<div class="card mb16" style="border-color:var(--st)">
  <div class="fx gap8 mb12">
    <i class="ti ti-id-badge" style="color:var(--st);font-size:20px"></i>
    <h3>Organizer</h3>
  </div>
  <p class="muted small mb12">Estas informações aparecem no arquivo <strong>.tdf</strong> exportado para o sistema da Pokémon.</p>
  <div class="g2">
    <div class="f"><label>Nome completo</label><input id="st-org-name" value="${esc(s.organizerName||'')}" placeholder="Nome do organizador"></div>
    <div class="f"><label>Player ID (popid)</label><input id="st-org-popid" value="${esc(s.organizerPopId||'')}" placeholder="ex: 5036475"></div>
  </div>
  <div class="g2">
    <div class="f"><label>Cidade</label><input id="st-org-city" value="${esc(s.organizerCity||'')}" placeholder="Rio de Janeiro"></div>
    <div class="f"><label>País</label><input id="st-org-country" value="${esc(s.organizerCountry||'Brazil')}" placeholder="Brazil"></div>
  </div>
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
  let body = '';

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
<div class="fx gap6" style="justify-content:flex-end;margin-top:4px">
  <button class="btn" onclick="closeM()">Cancelar</button>
  <button class="btn btn-p" onclick="saveEditTour()"><i class="ti ti-check"></i> Salvar</button>
</div>`;
  }

  if (m.type === 'deck') { body = renderDeckModal(); }

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
  else if (G.view==='tours')   content = renderTours();
  else if (G.view==='ctour')   content = renderCreateTour();
  else if (G.view==='tournament') content = renderTour();
  else if (G.view==='settings') content = renderSettings();

  const syncIndicator = `
    <div class="fx gap6" style="margin-left:auto;align-items:center">
      <span class="sync-dot ${syncStatus}" id="sync-dot"></span>
      <span id="sync-lbl" style="font-size:11px;color:var(--t2)" title="${esc(syncError)}">
        ${syncStatus==='ok'?'Sincronizado':syncStatus==='syncing'?'Salvando…':syncStatus==='error'?'Erro sync':'Offline'}
      </span>
    </div>`;

  app.innerHTML = `
  ${!isTour ? `<div class="tb">
    <strong style="font-size:15px"><i class="ti ti-pokeball"></i> TCG Tournament Manager</strong>
    <span class="badge bn" style="font-size:10px">v${VER}</span>
    ${syncIndicator}
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
  const name = document.getElementById('ct-name')?.value?.trim();
  if (!name) return notify('Nome é obrigatório','err');
  const d = G._ctd||{};
  const t = {
    id: uid(), createdAt: Date.now(),
    name, city: document.getElementById('ct-city')?.value?.trim()||'',
    state: document.getElementById('ct-state')?.value?.trim()||'',
    date: document.getElementById('ct-date')?.value||'',
    sanctionedId: document.getElementById('ct-sanction')?.value?.trim()||'',
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
  saveAll(); render();
  // Clear search
  const inp=document.getElementById('reg-q'); if(inp){inp.value='';} const r=document.getElementById('reg-res'); if(r)r.innerHTML='';
  notify(`${gp.name} adicionado`,'ok');
  // Refresh DB list without full re-render
  setTimeout(()=>{
    const t2=ct();
    const el=document.getElementById('reg-db-list');
    if(el&&t2) el.innerHTML=renderRegDBList(t2,_regDBFilter,_regDBPage);
  },50);
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
  saveAll(); notify(`${added} jogador${added!==1?'es':''} adicionado${added!==1?'s':''}`,'ok'); render();
}

function removeFromTour(pid) {
  mtour(t=>{ t.players=t.players.filter(p=>p.id!==pid); });
}

function startTour() {
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
  t.currentRound=1; t.status='rounds'; t._timer=t.settings.timerMinutes*60;
  G.lastLog=log; G.tab='rounds';
  saveAll(); render();
}

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

function advanceRound() {
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
  openEditTourModal, saveEditTour,
  clearTourPlayers, ctAddPlayer, ctRemovePlayer, renderCTPlayerSearch,
  regDBPage, refreshRegDB, regSearchEnter,
  openDeckModal, saveDeckModal, saveDeckQuick, clearDeck, filterDeckList,
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