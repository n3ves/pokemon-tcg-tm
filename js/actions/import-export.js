import { DIVS, R } from '../config.js';
import { G, ct, nav, mtour, saveAll, DB, SK, SB } from '../state.js';
import { uid } from '../prng.js';
import { getStandings } from '../stats.js';
import { esc, notify, inferDiv, extractYear, tdfDateToISO } from '../utils.js';
import { render } from '../render/index.js';
import { getStandings } from '../stats.js';
import { parseTDF, generateTDF } from '../tdf.js';
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
export { exportTour, importTour, exportCSV, exportPlayerCSV,
          exportTDF, importTDF, blob, pick };
