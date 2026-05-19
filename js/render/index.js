import { DIVS, R, VER } from '../config.js';
import { G, ct, nav, syncStatus, syncError, setSyncStatus } from '../state.js';
import { getStandings, calcStats, p1Count } from '../stats.js';
import { esc, fmt, pct, dbadge, stbadge, pname, pdiv, notify } from '../utils.js';
import { uid } from '../prng.js';
import { SB_URL } from '../supabase.js';
import { renderHome } from './home.js';
import { renderPlayers, renderPDetail } from './players.js';
import { renderTours, renderCreateTour } from './tournaments.js';
import { renderTour } from './tournament.js';
import { renderSettings } from './settings.js';
import { renderModal } from './modal.js';

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

export { render };
