import { DIVS, R, VER } from '../config.js';
import { G, ct, nav, syncStatus, syncError, setSyncStatus } from '../state.js';
import { getStandings, calcStats, p1Count } from '../stats.js';
import { esc, fmt, pct, dbadge, stbadge, pname, pdiv, notify } from '../utils.js';
import { uid } from '../prng.js';
import { SB_URL } from '../supabase.js';
function renderTours() {
  const q = G.search.toLowerCase();
  const list = G.tours
    .filter(t => !q || t.name.toLowerCase().includes(q) || (t.city||'').toLowerCase().includes(q))
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
  <div class="f"><label>Data</label><input type="date" id="ct-date" value="${d.date||new Date().toISOString().slice(0,10)}"></div>
</div>
<div class="card mb16">
  <h3 class="mb12">Formato</h3>
  <div class="cg mb16">
    ${modes.map(m=>`<div class="chip ${(d.mode||'cup')===m.id?'on':''}" onclick="setCTMode('${m.id}')">
      <strong>${m.name}</strong><div class="small muted">${m.desc}</div></div>`).join('')}
  </div>
  <div class="g2">
    <div class="f"><label>Rodadas Swiss</label><input type="number" id="ct-rounds" min="1" max="15" value="${d.totalRounds||4}"></div>
    <div class="f"><label>Top Cut</label><select id="ct-cut">
      <option value="0" ${(d.topCutSize||0)===0?'selected':''}>Sem top cut</option>
      <option value="4" ${(d.topCutSize||0)===4?'selected':''}>Top 4</option>
      <option value="8" ${(d.topCutSize||0)===8?'selected':''}>Top 8</option>
      <option value="16"${(d.topCutSize||0)===16?'selected':''}>Top 16</option>
    </select></div>
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
<button class="btn btn-p fw jc" style="padding:12px" onclick="createTour()">
  <i class="ti ti-player-play"></i> Criar e registrar jogadores
</button>
</div>`;
}

function setCTMode(mode) {
  G._ctd = G._ctd || {};
  G._ctd.mode = mode;
  G._ctd.topCutSize = mode==='lc' ? 0 : 8;
  G._ctd.totalRounds = 4;
  render();
}
export { renderTours, renderCreateTour, setCTMode };
