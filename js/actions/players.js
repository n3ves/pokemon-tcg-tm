import { DIVS, R } from '../config.js';
import { G, ct, nav, mtour, saveAll, DB, SK, SB } from '../state.js';
import { uid } from '../prng.js';
import { getStandings } from '../stats.js';
import { esc, notify, inferDiv, extractYear, tdfDateToISO } from '../utils.js';
import { render } from '../render/index.js';
import { SB } from '../supabase.js';
import { addFromDB } from './registration.js';
function openPModal(id, addToTour=false) { G.modal={type:'player',id,addToTour}; render(); }

function savePlayer(id, addToTourId) {
  const name = document.getElementById('m-name')?.value?.trim();
  if (!name) return notify('Nome é obrigatório','err');
  const dup = G.players.find(p=>p.name.toLowerCase()===name.toLowerCase()&&p.id!==id);
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
        p.name.toLowerCase() === name.toLowerCase()
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
export { openPModal, savePlayer, delPlayer, exportPlayers,
          importPlayersFile, importPlayersTOM, autoDivM };
