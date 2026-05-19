import { DIVS, R, VER } from '../config.js';
import { G, ct, nav, syncStatus, syncError, setSyncStatus } from '../state.js';
import { getStandings, calcStats, p1Count } from '../stats.js';
import { esc, fmt, pct, dbadge, stbadge, pname, pdiv, notify } from '../utils.js';
import { uid } from '../prng.js';
import { SB_URL } from '../supabase.js';
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
export { renderSettings };
