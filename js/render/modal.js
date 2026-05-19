import { DIVS, R, VER } from '../config.js';
import { G, ct, nav, syncStatus, syncError, setSyncStatus } from '../state.js';
import { getStandings, calcStats, p1Count } from '../stats.js';
import { esc, fmt, pct, dbadge, stbadge, pname, pdiv, notify } from '../utils.js';
import { uid } from '../prng.js';
import { SB_URL } from '../supabase.js';
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
export { renderModal };
