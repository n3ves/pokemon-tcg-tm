import { DIVS, R, VER } from '../config.js';
import { G, ct, nav, syncStatus, syncError, setSyncStatus } from '../state.js';
import { getStandings, calcStats, p1Count } from '../stats.js';
import { esc, fmt, pct, dbadge, stbadge, pname, pdiv, notify } from '../utils.js';
import { uid } from '../prng.js';
import { SB_URL } from '../supabase.js';
import { buildOppMap } from '../stats.js';
import { advanceBracket } from '../swiss.js';
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

/* ── REGISTRATION ── */
function renderReg(t) {
  const n = t.players.length;
  const rec = recRounds(n), cut = recCut(n, t.settings.mode);
  const byDiv = DIVS.map(d=>({d, c:t.players.filter(p=>p.division===d).length})).filter(x=>x.c>0);

  return `
<div class="fx sb2 mb16">
  <div>
    <h2 class="mb4">Registro de jogadores</h2>
    <div class="fx gap6">
      ${byDiv.map(({d,c})=>`<span class="badge ${DC[d]}">${d[0]}: ${c}</span>`).join('')}
      ${n>0?`<span class="muted small">${rec} rodadas rec. · ${cut?'Top '+cut:'Sem top cut'}</span>`:''}
    </div>
  </div>
  ${t.status==='registration'?`<button class="btn btn-p" ${n<2?'disabled':''} onclick="startTour()">
    <i class="ti ti-player-play"></i> Iniciar torneio</button>`:''}
</div>
${t.status==='registration'?`
<div class="g2 gap16">
  <div class="card">
    <h3 class="mb12">Adicionar</h3>
    <div class="f"><label>Buscar banco de dados</label>
      <div class="fx gap6">
        <input id="reg-q" placeholder="Nome, ID..." style="flex:1" oninput="renderRegSearch(this.value)">
        <button class="btn btn-sm" onclick="openPModal(null,true)"><i class="ti ti-plus"></i></button>
      </div>
    </div>
    <div id="reg-res"></div>
    <div class="sep"></div>
    <p class="muted small mb8">Múltiplos (um por linha):</p>
    <textarea id="bulk-in" style="height:80px" placeholder="João Silva&#10;Maria Santos"></textarea>
    <div class="fx gap8 mt8">
      <select id="bulk-div">${DIVS.map(d=>`<option>${d}</option>`).join('')}</select>
      <button class="btn btn-sm" onclick="addBulk()"><i class="ti ti-upload"></i> Adicionar</button>
    </div>
  </div>
  <div class="card p0" style="max-height:420px;overflow-y:auto">
    ${n===0?`<div class="empty"><i class="ti ti-users"></i><p>Nenhum jogador</p></div>`:
    t.players.map((p,i)=>`<div class="plr">
      <span class="mono muted" style="min-width:24px">${i+1}</span>
      <span style="flex:1">${esc(p.name)}</span>${dbadge(p.division)}
      <button class="ib" onclick="removeFromTour('${p.id}')"><i class="ti ti-x"></i></button>
    </div>`).join('')}
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

function renderRegSearch(q) {
  const el = document.getElementById('reg-res');
  if (!el) return;
  if (!q || q.length < 2) { el.innerHTML=''; return; }
  const t = ct();
  const have = new Set(t.players.map(p=>p.gid).filter(Boolean));
  const found = G.players.filter(p => !have.has(p.id) && (
    p.name.toLowerCase().includes(q.toLowerCase()) ||
    (p.playerId||'').toLowerCase().includes(q.toLowerCase())
  )).slice(0,5);
  el.innerHTML = found.length===0
    ? `<p class="muted small mt8">Sem resultados. <button class="btn btn-xs" onclick="openPModal(null,true)">Criar novo</button></p>`
    : `<div class="card p0 mt8">${found.map(p=>`
      <div class="plr" onclick="addFromDB('${p.id}')">
        <div class="av" style="width:28px;height:28px;font-size:10px">${esc(initials(p.name))}</div>
        <div style="flex:1"><div>${esc(p.name)}</div><div class="muted small">${p.division}${p.playerId?' · '+p.playerId:''}</div></div>
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
export { renderTour, renderReg, renderRegSearch, renderRounds, pairingRow,
          renderTimerBlock, renderStandings, standTable, renderHistory,
          renderTopCut, renderFinished, renderDebug, validatePairings, renderExport };
