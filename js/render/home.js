import { DIVS, R, VER } from '../config.js';
import { G, ct, nav, syncStatus, syncError, setSyncStatus } from '../state.js';
import { getStandings, calcStats, p1Count } from '../stats.js';
import { esc, fmt, pct, dbadge, stbadge, pname, pdiv, notify } from '../utils.js';
import { uid } from '../prng.js';
import { SB_URL } from '../supabase.js';
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
export { renderHome };
