// TDF Engine — import/export formato oficial TOM
import { DIVS, R } from './config.js';
import { uid } from './prng.js';
import { calcStats, getStandings } from './stats.js';
import { inferDiv, extractYear } from './utils.js';
import { G } from './state.js';

function parseTDF(xmlStr) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(xmlStr, 'application/xml');
  const err    = doc.querySelector('parsererror');
  if (err) throw new Error('XML inválido: ' + err.textContent.slice(0,120));

  // ── Tournament metadata ──────────────────────────────────
  const dataEl   = doc.querySelector('data');
  const name     = dataEl?.querySelector('name')?.textContent?.trim()    || 'Torneio Importado';
  const city     = dataEl?.querySelector('city')?.textContent?.trim()    || '';
  const state    = dataEl?.querySelector('state')?.textContent?.trim()   || '';
  const orgEl    = dataEl?.querySelector('organizer');
  const orgName  = orgEl?.getAttribute('name')                           || '';
  const orgPopId = orgEl?.getAttribute('popid')                          || '';
  const timerMin = parseInt(dataEl?.querySelector('roundtime')?.textContent||'50') || 50;
  const dateRaw  = dataEl?.querySelector('startdate')?.textContent?.trim() || '';
  const date     = tdfDateToISO(dateRaw);
  const mode     = doc.querySelector('tournament')?.getAttribute('mode')?.toLowerCase() || 'custom';

  // ── Players ──────────────────────────────────────────────
  // userid → { internalId, playerId, name, birthDate, division }
  const uidMap = new Map();

  for (const pel of doc.querySelectorAll('players > player')) {
    const userId    = pel.getAttribute('userid') || uid();
    const firstName = pel.querySelector('firstname')?.textContent?.trim() || '';
    const lastName  = pel.querySelector('lastname')?.textContent?.trim()  || '';
    const bdRaw     = pel.querySelector('birthdate')?.textContent?.trim() || '';
    // TDF has 02/27/YYYY — store only the year
    const birthYear = bdRaw ? String(extractYear(tdfDateToISO(bdRaw))||'') : '';
    const division  = inferDiv(birthYear);
    const fullName  = [firstName, lastName].filter(Boolean).join(' ');

    uidMap.set(userId, {
      id:       uid(),
      gid:      null,
      playerId: userId,
      name:     fullName,
      division,
      birthDate: birthYear,
      dropped:  false,
      dq:       false,
      hadBye:   false,
    });
  }

  // Try to link to global player DB by playerId or name
  for (const tp of uidMap.values()) {
    const gp = G.players.find(p =>
      (p.playerId && p.playerId === tp.playerId) ||
      p.name.toLowerCase() === tp.name.toLowerCase()
    );
    if (gp) {
      tp.gid      = gp.id;
      tp.division = gp.division; // respect global DB division
    }
  }

  // ── Override division from <pods> category ───────────────
  // The pod category is authoritative for division assignment
  for (const podEl of doc.querySelectorAll('pods > pod')) {
    const cat = parseInt(podEl.getAttribute('category') ?? '2');
    const div = TDF_CAT_DIV[cat] || 'Masters';
    for (const pEl of podEl.querySelectorAll('subgroups player')) {
      const uid2 = pEl.getAttribute('userid');
      const tp = uidMap.get(uid2);
      if (tp) tp.division = div;
    }
  }

  // ── Rounds ───────────────────────────────────────────────
  // Collect all rounds across all pods (deduplicate by number)
  const roundMap = new Map(); // number → { number, pairings[], ... }

  for (const podEl of doc.querySelectorAll('pods > pod')) {
    for (const rndEl of podEl.querySelectorAll('rounds > round')) {
      const number = parseInt(rndEl.getAttribute('number'));
      if (!roundMap.has(number)) {
        roundMap.set(number, {
          id:        uid(),
          number,
          pairings:  [],
          pairingLog:[],
          timestamp: Date.now(),
        });
      }
      const rnd = roundMap.get(number);

      for (const mEl of rndEl.querySelectorAll('matches > match')) {
        const outcomeAttr = parseInt(mEl.getAttribute('outcome') ?? '0');
        const p1UserId    = mEl.querySelector('player1')?.getAttribute('userid');
        const p2UserId    = mEl.querySelector('player2')?.getAttribute('userid');
        const tableNum    = parseInt(mEl.querySelector('tablenumber')?.textContent || '0') || null;

        const tp1 = p1UserId ? uidMap.get(p1UserId) : null;
        const tp2 = p2UserId ? uidMap.get(p2UserId) : null;
        if (!tp1) continue;

        const isBye  = !tp2;
        const result = isBye ? R.BYE : (TDF_OUT_TO_R[outcomeAttr] || null);

        rnd.pairings.push({
          id:        uid(),
          p1:        tp1.id,
          p2:        isBye ? 'BYE' : tp2.id,
          table:     tableNum,
          result,
          isBye,
          isRematch: false,
          judgeNote: null,
        });
      }
    }
  }

  const rounds = [...roundMap.values()].sort((a,b) => a.number - b.number);

  // ── Mark had_bye from rounds ─────────────────────────────
  const players = [...uidMap.values()];
  for (const rnd of rounds) {
    for (const p of rnd.pairings) {
      if (p.isBye) {
        const pl = players.find(x => x.id === p.p1);
        if (pl) pl.hadBye = true;
      }
    }
  }

  // ── Dropped players (from <standings type="dnf">) ────────
  for (const dnfEl of doc.querySelectorAll('standings pod[type="dnf"] player')) {
    const userId = dnfEl.getAttribute('id');
    const tp = userId ? uidMap.get(userId) : null;
    if (tp) tp.dropped = true;
  }

  // ── Determine status ─────────────────────────────────────
  const tdfStage   = parseInt(doc.querySelector('tournament')?.getAttribute('stage') || '0');
  const hasResults = rounds.some(r => r.pairings.some(p => p.result !== null));
  const allDone    = rounds.length > 0 && rounds.every(r => r.pairings.every(p => p.result !== null));
  const status     = (tdfStage >= 5 || allDone) ? 'finished' : hasResults ? 'rounds' : 'registration';

  const totalRounds = rounds.length || 3;

  return {
    id:           uid(),
    createdAt:    Date.now(),
    name,
    city,
    state,
    date,
    mode:         'custom',
    status,
    currentRound: rounds.length,
    players,
    rounds,
    topBracket:   null,
    settings: {
      totalRounds,
      topCutSize:        0,
      timerMinutes:      timerMin,
      seed:              '',
      separateDivisions: true,
      standingsByDiv:    true,
      debugMode:         false,
      // preserve organizer info
      organizerName:  orgName,
      organizerPopId: orgPopId,
    },
    _timer:   timerMin * 60,
    _timerOn: false,
  };
}

function generateTDF(t) {
  const X  = escXML;
  const ln = [];          // output lines
  const ts = nowTdfTs();

  // ── Helper: get userId for a tournament-player ───────────
  function getUserId(tp) {
    const gp = G.players.find(x => x.id === tp.gid);
    return tp.playerId || gp?.playerId || String(tp.id).slice(0,6).toUpperCase();
  }

  // ── Build userId→tp lookup ───────────────────────────────
  const tpById = new Map(t.players.map(p => [p.id, p]));

  // ── Organizer ────────────────────────────────────────────
  // Organizer: prefer tournament-level, fallback to global settings
  const orgName    = t.settings.organizerName    || G.settings.organizerName    || '';
  const orgPopId   = t.settings.organizerPopId   || G.settings.organizerPopId   || '';
  const orgCountry = t.settings.organizerCountry || G.settings.organizerCountry || 'Brazil';

  // ── Determine tournament-level stage ────────────────────
  const tStage = t.status === 'finished' ? 5 : t.status === 'rounds' ? 3 : 1;

  ln.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  ln.push(`<tournament type="2" stage="${tStage}" version="1.74" gametype="TRADING_CARD_GAME" mode="CUSTOM">`);
  ln.push(`\t<data>`);
  ln.push(`\t\t<name>${X(t.name)}</name>`);
  ln.push(`\t\t<id></id>`);
  ln.push(`\t\t<city>${X(t.city||'')}</city>`);
  ln.push(`\t\t<state>${X(t.state||'')}</state>`);
  ln.push(`\t\t<country>${X(orgCountry)}</country>`);
  ln.push(`\t\t<roundtime>${t.settings.timerMinutes||50}</roundtime>`);
  ln.push(`\t\t<finalsroundtime>75</finalsroundtime>`);
  ln.push(`\t\t<organizer popid="${X(orgPopId)}" name="${X(orgName)}"/>`);
  ln.push(`\t\t<startdate>${isoToTdfDate(t.date)}</startdate>`);
  ln.push(`\t\t<lessswiss>false</lessswiss>`);
  ln.push(`\t\t<autotablenumber>true</autotablenumber>`);
  ln.push(`\t\t<overflowtablestart>1</overflowtablestart>`);
  ln.push(`\t</data>`);
  ln.push(`\t<timeelapsed>0</timeelapsed>`);

  // ── Players ──────────────────────────────────────────────
  ln.push(`\t<players>`);
  for (const tp of t.players) {
    const gp        = G.players.find(x => x.id === tp.gid);
    const birthDate = gp?.birthDate || tp.birthDate || '';
    const nameParts = tp.name.trim().split(/\s+/);
    const firstName = nameParts[0]  || '';
    const lastName  = nameParts.slice(1).join(' ') || '';
    const userId    = getUserId(tp);
    const bdTdf     = yearToTdfBirth(birthDate);

    ln.push(`\t\t<player userid="${X(userId)}">`);
    ln.push(`\t\t\t<firstname>${X(firstName)}</firstname>`);
    ln.push(`\t\t\t<lastname>${X(lastName)}</lastname>`);
    ln.push(`\t\t\t<birthdate>${bdTdf}</birthdate>`);
    ln.push(`\t\t\t<starter>true</starter>`);
    ln.push(`\t\t\t<creationdate>${ts}</creationdate>`);
    ln.push(`\t\t\t<lastmodifieddate>${ts}</lastmodifieddate>`);
    ln.push(`\t\t</player>`);
  }
  ln.push(`\t</players>`);

  // ── Pods — one per division (only non-empty) ─────────────
  ln.push(`\t<pods>`);
  for (const div of DIVS) {
    const dp = t.players.filter(p => p.division === div);
    if (!dp.length) continue;
    const cat = TDF_DIV_CAT[div];
    const dpIdSet = new Set(dp.map(p => p.id));

    ln.push(`\t\t<pod category="${cat}" stage="0">`);
    ln.push(`\t\t\t<poddata>`);
    ln.push(`\t\t\t\t<startingtable>1</startingtable>`);
    ln.push(`\t\t\t\t<playoff3rd4th>false</playoff3rd4th>`);
    ln.push(`\t\t\t\t<subgroupcount>1</subgroupcount>`);
    ln.push(`\t\t\t</poddata>`);
    ln.push(`\t\t\t<subgroups>`);
    ln.push(`\t\t\t\t<subgroup number="1">`);
    ln.push(`\t\t\t\t\t<players>`);
    for (const tp of dp)
      ln.push(`\t\t\t\t\t\t<player userid="${X(getUserId(tp))}" />`);
    ln.push(`\t\t\t\t\t</players>`);
    ln.push(`\t\t\t\t</subgroup>`);
    ln.push(`\t\t\t</subgroups>`);

    // ── Rounds for this division ─────────────────────────
    ln.push(`\t\t\t<rounds>`);
    for (const rnd of t.rounds) {
      // Only include pairings where at least one player is in this division
      const divPairings = rnd.pairings.filter(p =>
        dpIdSet.has(p.p1) || (p.p2 !== 'BYE' && dpIdSet.has(p.p2))
      );
      if (!divPairings.length) continue;

      const isLastRound = rnd.number === t.rounds.length;
      const rndStage    = isLastRound ? 8 : 6;

      ln.push(`\t\t\t\t<round number="${rnd.number}" type="2" stage="${rndStage}" >`);
      ln.push(`\t\t\t\t\t<timeleft>2997</timeleft>`);
      ln.push(`\t\t\t\t\t<matches>`);

      for (const pair of divPairings) {
        if (pair.isBye) continue; // BYEs don't appear as matches in TDF
        const tp1 = tpById.get(pair.p1);
        const tp2 = tpById.get(pair.p2);
        if (!tp1 || !tp2) continue;

        const outcome = TDF_R_TO_OUT[pair.result] ?? 1;

        ln.push(`\t\t\t\t\t\t<match outcome="${outcome}">`);
        ln.push(`\t\t\t\t\t\t\t<player1 userid="${X(getUserId(tp1))}"/>`);
        ln.push(`\t\t\t\t\t\t\t<player2 userid="${X(getUserId(tp2))}"/>`);
        ln.push(`\t\t\t\t\t\t\t<timestamp>${ts}</timestamp>`);
        ln.push(`\t\t\t\t\t\t\t<tablenumber>${pair.table||1}</tablenumber>`);
        ln.push(`\t\t\t\t\t\t</match>`);
      }

      ln.push(`\t\t\t\t\t</matches>`);
      ln.push(`\t\t\t\t</round>`);
    }
    ln.push(`\t\t\t</rounds>`);
    ln.push(`\t\t</pod>`);
  }
  ln.push(`\t</pods>`);

  // ── Standings ────────────────────────────────────────────
  ln.push(`\t<standings>`);
  for (const div of DIVS) {
    const cat      = TDF_DIV_CAT[div];
    const divStand = getStandings(t.players, t.rounds, div);
    const dropped  = t.players.filter(p => p.division===div && p.dropped);

    // Finished (completed, not dropped)
    ln.push(`\t\t<pod category="${cat}" type="finished">`);
    divStand.filter(p => !p.dropped).forEach((p, i) => {
      ln.push(`\t\t\t<player id="${X(getUserId(p))}" place="${i+1}" />`);
    });
    ln.push(`\t\t</pod>`);

    // DNF (dropped / did not finish)
    ln.push(`\t\t<pod category="${cat}" type="dnf">`);
    dropped.forEach(p => {
      ln.push(`\t\t\t<player id="${X(getUserId(p))}" />`);
    });
    ln.push(`\t\t</pod>`);
  }
  ln.push(`\t</standings>`);

  // ── Finals options ───────────────────────────────────────
  ln.push(`\t<finalsoptions>`);
  for (const div of DIVS) {
    const dp = t.players.filter(p => p.division === div);
    if (!dp.length) continue;
    const cat = TDF_DIV_CAT[div];
    ln.push(`\t\t<categorycut key="${cat}">`);
    ln.push(`\t\t\t<options><value>${t.settings.topCutSize||0}</value></options>`);
    ln.push(`\t\t\t<cut>${t.settings.topCutSize||0}</cut>`);
    ln.push(`\t\t\t<playercount>${dp.filter(p=>!p.dropped).length}</playercount>`);
    ln.push(`\t\t\t<paired3rd4th>false</paired3rd4th>`);
    ln.push(`\t\t</categorycut>`);
  }
  ln.push(`\t</finalsoptions>`);
  ln.push(`</tournament>`);

  return ln.join('\n');
}

/* ── UI wrappers ─────────────────────────────────────────── */
function exportTDF(id) {
  const t = G.tours.find(x=>x.id===id) || ct();
  if (!t) return;
  try {
    const xml      = generateTDF(t);
    const safeName = t.name.replace(/[^a-z0-9]/gi,'-').toLowerCase();
    blob(xml, `${safeName}-${t.date||'torneio'}.tdf`, 'application/xml');
    notify('TDF exportado com sucesso', 'ok');
  } catch(e) {
    notify('Erro ao gerar TDF: ' + e.message, 'err');
  }
}

function importTDF() {
  pick('.tdf,.xml', xmlStr => {
    try {
      const t = parseTDF(xmlStr);

      // Upsert global players from TDF (add to DB if not there)
      let newPlayers = 0;
      for (const tp of t.players) {
        if (tp.gid) continue; // already linked
        const exists = G.players.find(p =>
          (tp.playerId && p.playerId === tp.playerId) ||
          p.name.toLowerCase() === tp.name.toLowerCase()
        );
        if (!exists) {
          const gp = {
            id:        uid(),
            createdAt: Date.now(),
            name:      tp.name,
            nickname:  '',
            playerId:  tp.playerId || '',
            birthDate: tp.birthDate || '',
            division:  tp.division,
            city:      '',
            state:     '',
            contact:   '',
            notes:     'Importado via TDF',
          };
          G.players.push(gp);
          tp.gid = gp.id;
          newPlayers++;
        } else {
          tp.gid = exists.id;
        }
      }

      if (!G.tours.find(x => x.id === t.id)) G.tours.push(t);
      saveAll();

      const msg = `TDF importado: ${t.players.length} jogadores, ${t.rounds.length} rodadas` +
                  (newPlayers ? ` (${newPlayers} adicionados ao banco)` : '');
      notify(msg, 'ok');
      openTour(t.id);
    } catch(e) {
      notify('Erro ao importar TDF: ' + e.message, 'err');
      console.error(e);
    }
  });
}

export { parseTDF, generateTDF, exportTDF, importTDF,
         tdfDateToISO, isoToTdfDate, yearToTdfBirth: undefined };
