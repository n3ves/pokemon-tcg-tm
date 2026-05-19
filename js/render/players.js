import { DIVS, R, VER } from '../config.js';
import { G, ct, nav, syncStatus, syncError, setSyncStatus } from '../state.js';
import { getStandings, calcStats, p1Count } from '../stats.js';
import { esc, fmt, pct, dbadge, stbadge, pname, pdiv, notify } from '../utils.js';
import { uid } from '../prng.js';
import { SB_URL } from '../supabase.js';
import { openPModal } from '../actions/players.js';
function renderPlayers() {
  const q = G.search.toLowerCase();
  const list = G.players.filter(p =>
    !q || p.name.toLowerCase().includes(q) ||
    (p.nickname||'').toLowerCase().includes(q) ||
    (p.playerId||'').toLowerCase().includes(q) ||
    (p.city||'').toLowerCase().includes(q)
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
export { renderPlayers, renderPDetail };
