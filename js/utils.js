// Helpers de formatação, badges, inferência de divisão
import { DC, R, DIVS } from './config.js';
import { G } from './state.js';

function closeM() { G.modal=null; render(); }

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

let notifTimer = null;
export function notify(msg, type='info') {
  G.notif = { msg, type };
  clearTimeout(notifTimer);
  notifTimer = setTimeout(()=>{ G.notif=null; render(); }, 3000);
  const el = document.getElementById('notif-slot');
  if (el) el.innerHTML = G.notif ? `<div class="notif ${G.notif.type}">${esc(G.notif.msg)}</div>` : '';
}

export { extractYear, calcAge, inferDiv, yearToTdfBirth, initials,
         esc, fmt, pct, dbadge, stbadge, pname, pdiv, notify };
