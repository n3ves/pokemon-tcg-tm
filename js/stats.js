// Motor de estatísticas: OWP, OOWP, standings
import { R } from './config.js';

function calcStats(pid, rounds) {
  let w=0, l=0, t=0;
  for (const rnd of rounds) {
    for (const p of rnd.pairings) {
      if (p.result === null || p.result === undefined) continue;
      if (p.p2 === 'BYE' && p.p1 === pid) { w++; continue; }
      const is1 = p.p1 === pid, is2 = p.p2 === pid;
      if (!is1 && !is2) continue;
      if (p.result === R.TIE)                              { t++; }
      else if (p.result === R.DL)                          { l++; }
      else if ((p.result===R.P1&&is1)||(p.result===R.P2&&is2)) { w++; }
      else                                                 { l++; }
    }
  }
  const mp = w*3+t, gp = w+l+t, wr = gp > 0 ? w/gp : 0;
  return { w, l, t, mp, gp, wr };
}
function getOpps(pid, rounds) {
  const o = [];
  for (const rnd of rounds)
    for (const p of rnd.pairings) {
      if (p.p2 === 'BYE') continue;
      if (p.p1 === pid) o.push(p.p2);
      else if (p.p2 === pid) o.push(p.p1);
    }
  return o;
}
function buildOppMap(rounds) {
  const m = new Map();
  for (const rnd of rounds)
    for (const p of rnd.pairings) {
      if (p.p2 === 'BYE') continue;
      if (!m.has(p.p1)) m.set(p.p1, new Set());
      if (!m.has(p.p2)) m.set(p.p2, new Set());
      m.get(p.p1).add(p.p2);
      m.get(p.p2).add(p.p1);
    }
  return m;
}
// Count how many times player was P1 (went first)
function p1Count(pid, rounds) {
  let c = 0;
  for (const rnd of rounds)
    for (const p of rnd.pairings)
      if (p.p1 === pid && !p.isBye) c++;
  return c;
}
function owp(pid, rounds) {
  const o = getOpps(pid, rounds);
  if (!o.length) return 0;
  return o.map(id => Math.max(calcStats(id, rounds).wr, 0.25)).reduce((a,b)=>a+b,0) / o.length;
}
function oowp(pid, rounds) {
  const o = getOpps(pid, rounds);
  if (!o.length) return 0;
  return o.map(id => owp(id, rounds)).reduce((a,b)=>a+b,0) / o.length;
}
function getStandings(players, rounds, divFilter) {
  return players
    .filter(p => !p.dq && (!divFilter || p.division === divFilter))
    .map(p => ({ ...p, ...calcStats(p.id, rounds), owp: owp(p.id, rounds), oowp: oowp(p.id, rounds) }))
    .sort((a,b) => b.mp-a.mp || b.owp-a.owp || b.oowp-a.oowp || b.wr-a.wr || a.name.localeCompare(b.name));
}

/* ═══════════════════════════════════════════════════════════════
   SWISS ALGORITHM — Official Pokémon TCG Rules
   ---------------------------------------------------------------
   Rules implemented:
   1. Sort by match points (desc); randomise within same score
   2. BYE → lowest ranked who hasn't had one (or lowest overall)
   3. Group by score; float bottom of group to next if odd
   4. Within group: pair 1st-available vs next-available
   5. Rematch avoidance via backtracking (try all permutations
      within group before allowing rematch)
   6. P1 (going first) balanced: player with fewer P1s gets it;
      if equal, randomise
   7. All randomisation is seeded and reproducible
═══════════════════════════════════════════════════════════════ */
function generateSwiss(tournament) {
  const { players, rounds, settings } = tournament;
  const log = [];
  const roundNum = rounds.length + 1;

  const seedVal = settings.seed
    ? (Number(settings.seed) + roundNum * 1009) >>> 0
    : (Date.now() + roundNum * 1009) >>> 0;
  const rng = makeRNG(seedVal);

  log.push(`${'═'.repeat(56)}`);
  log.push(`RODADA ${roundNum}  |  Seed: ${seedVal}`);
  log.push(`${'═'.repeat(56)}`);

  const active = players.filter(p => !p.dropped && !p.dq);
  log.push(`Jogadores ativos: ${active.length}`);
  const oppMap = buildOppMap(rounds);

  let allPairings = [];
  let tableNum   = 1;

  if (settings.separateDivisions) {
    // ── Age Modified: divisões com menos de 2 jogadores ativos
    // são mescladas com Masters para pareamento (como no TOM).
    // Standings continuam separados pela divisão real do jogador.
    const MIN_DIV = 2;
    const divPools = {};
    for (const div of DIVS) divPools[div] = active.filter(p => p.division === div);

    const mergePool = []; // jogadores de divisões pequenas → vão para Masters
    for (const div of ['Juniors','Seniors']) {
      if (divPools[div].length > 0 && divPools[div].length < MIN_DIV) {
        log.push(`\n⚠ ${div} (${divPools[div].length} jogador) → Age Modified: mesclado com Masters`);
        mergePool.push(...divPools[div]);
        divPools[div] = [];
      }
    }
    divPools['Masters'].push(...mergePool);

    for (const div of DIVS) {
      if (!divPools[div].length) continue;
      const label = mergePool.length && div === 'Masters'
        ? `MASTERS + Age Modified (${divPools[div].length} jogadores)`
        : `${div.toUpperCase()} (${divPools[div].length} jogadores)`;
      log.push(`\n── ${label} ──`);
      const { pairs, divLog } = pairGroup(divPools[div], rounds, oppMap, rng, roundNum, log);
      log.push(...divLog);
      for (const p of pairs) if (!p.isBye) p.table = tableNum++;
      allPairings.push(...pairs);
    }
  } else {
    log.push(`\n── FIELD (${active.length} jogadores) ──`);
    const { pairs, divLog } = pairGroup(active, rounds, oppMap, rng, roundNum, log);
    log.push(...divLog);
    for (const p of pairs) if (!p.isBye) p.table = tableNum++;
    allPairings.push(...pairs);
  }

  allPairings.forEach(p => {
    p.id = p.id || uid();
    if (p.result === undefined) p.result = null;
    p.judgeNote = p.judgeNote || null;
  });

  log.push(`\n${'─'.repeat(40)}`);
  log.push(`Mesas: ${tableNum-1}  |  Byes: ${allPairings.filter(p=>p.isBye).length}`);

  return { pairings: allPairings, log, seed: seedVal };
}

function pairGroup(players, rounds, oppMap, rng, roundNum, parentLog) {
  const divLog = [];

  // Enrich with stats + P1 count for balancing
  const pool = players.map(p => ({
    ...p,
    ...calcStats(p.id, rounds),
    p1c: p1Count(p.id, rounds),
  }));

  // ── BYE ASSIGNMENT ──────────────────────────────────────
  let byePlayer = null;
  if (pool.length % 2 === 1) {
    // BYE priority: pior record → Jr/Sr antes de Masters no mesmo record
    const divByePrio = { Juniors: 0, Seniors: 1, Masters: 2 };
    const byeCandidates = [...pool].sort((a,b) =>
      a.mp - b.mp ||                                          // 1. pior record
      (divByePrio[a.division]??2) - (divByePrio[b.division]??2) || // 2. Jr/Sr antes de Masters
      rng() - 0.5                                             // 3. aleatoriedade
    );
    let byeIdx = byeCandidates.findIndex(p => !p.hadBye);
    if (byeIdx === -1) byeIdx = 0; // todos já tiveram bye → dá para o pior
    byePlayer = byeCandidates[byeIdx];
    const pi = pool.findIndex(p => p.id === byePlayer.id);
    pool.splice(pi, 1);
    divLog.push(`BYE → ${byePlayer.name}  (${byePlayer.mp}pts, hadBye=${byePlayer.hadBye})`);
  }

  // ── GROUP BY MATCH POINTS ───────────────────────────────
  const scoreMap = new Map();
  for (const p of pool) {
    if (!scoreMap.has(p.mp)) scoreMap.set(p.mp, []);
    scoreMap.get(p.mp).push(p);
  }
  const scores = [...scoreMap.keys()].sort((a,b) => b-a);

  // Dentro de cada grupo de pontuação:
  // Masters shuffled primeiro → Jr/Sr ao final (low seed, pareiam com pior Masters)
  for (const sc of scores) {
    const g = scoreMap.get(sc);
    const masters = shuffle(g.filter(p => p.division === 'Masters'), rng);
    const others  = shuffle(g.filter(p => p.division !== 'Masters'), rng);
    scoreMap.set(sc, [...masters, ...others]);
    divLog.push(`Grupo ${sc}pts [${scoreMap.get(sc).map(p=>p.name).join(', ')}]`);
  }

  // ── PAIR GROUPS WITH FLOATERS ───────────────────────────
  const allPairs = [];
  let floaters   = [];

  for (const sc of scores) {
    const group = [...floaters, ...scoreMap.get(sc)];
    floaters = [];

    if (floaters.length) divLog.push(`  Float→ grupo ${sc}pts: ${floaters.map(p=>p.name).join(',')}`);

    const { pairs, leftover } = pairWithBacktrack(group, oppMap, rng, divLog, false);
    allPairs.push(...pairs);
    floaters = leftover;
  }

  // Force-pair any leftover floaters (allow rematches)
  if (floaters.length >= 2) {
    divLog.push(`⚠ Pareamento forçado (rematches permitidos): [${floaters.map(p=>p.name).join(', ')}]`);
    const { pairs } = pairWithBacktrack(floaters, oppMap, rng, divLog, true);
    allPairs.push(...pairs);
  } else if (floaters.length === 1) {
    divLog.push(`⚠ Float sem par: ${floaters[0].name} → BYE extra`);
    allPairs.push({ id: uid(), p1: floaters[0].id, p2: 'BYE', result: R.BYE, isBye: true, table: null });
  }

  // ── P1/P2 BALANCE ───────────────────────────────────────
  for (const pair of allPairs) {
    if (pair.isBye) continue;
    const aP1c = pool.find(p=>p.id===pair.p1)?.p1c ?? 0;
    const bP1c = pool.find(p=>p.id===pair.p2)?.p1c ?? 0;
    // Player with fewer P1s goes first; if equal → random
    if (aP1c > bP1c || (aP1c === bP1c && rng() < 0.5)) {
      [pair.p1, pair.p2] = [pair.p2, pair.p1];
    }
  }

  // Add BYE pairing last
  if (byePlayer) {
    allPairs.push({ id: uid(), p1: byePlayer.id, p2: 'BYE', result: R.BYE, isBye: true, table: null });
  }

  return { pairs: allPairs, divLog };
}

/* Backtracking pairer:
   Tries all permutations within a group to find a pairing with
   zero rematches. Falls back to minimum-rematch if impossible.
   For large groups uses greedy with swap-retry (performance). */
function pairWithBacktrack(group, oppMap, rng, divLog, forceRematch) {
  if (group.length === 0) return { pairs: [], leftover: [] };
  if (group.length === 1) return { pairs: [], leftover: group };

  // For groups ≤ 8 use full backtracking; larger → greedy+swap
  if (group.length <= 8) {
    const result = backtrack(group, oppMap, [], 0);
    if (result) {
      result.pairs.forEach(p => {
        const nameA = group.find(x=>x.id===p.p1)?.name||'?';
        const nameB = group.find(x=>x.id===p.p2)?.name||'?';
        divLog.push(`  ${nameA} × ${nameB}${p.isRematch?' ⚠REMATCH':''}`);
      });
      return { pairs: result.pairs, leftover: result.leftover };
    }
  }

  // Greedy with swap for large groups
  return greedyPair(group, oppMap, rng, divLog, forceRematch);
}

function backtrack(pool, oppMap, pairs, rematchCount) {
  if (pool.length === 0) return { pairs, leftover: [], rematch: rematchCount };
  if (pool.length === 1) return { pairs, leftover: pool, rematch: rematchCount };

  const first = pool[0];
  const rest  = pool.slice(1);
  const firstOpps = oppMap.get(first.id) || new Set();

  let best = null;

  for (let i = 0; i < rest.length; i++) {
    const partner  = rest[i];
    const isRem    = firstOpps.has(partner.id);
    const newPool  = rest.filter((_,j) => j !== i);
    const newPair  = { id: uid(), p1: first.id, p2: partner.id, result: null, isRematch: isRem, isBye: false, table: null };
    const result   = backtrack(newPool, oppMap, [...pairs, newPair], rematchCount + (isRem?1:0));
    if (!result) continue;
    if (!best || result.rematch < best.rematch) {
      best = result;
      if (best.rematch === 0) break; // optimal found
    }
  }
  return best;
}

function greedyPair(group, oppMap, rng, divLog, forceAll) {
  const pairs = [], leftover = [];
  const used  = new Set();

  for (let i = 0; i < group.length; i++) {
    if (used.has(group[i].id)) continue;
    const p1    = group[i];
    const p1opp = oppMap.get(p1.id) || new Set();
    let partner = null, isRematch = false;

    // Try clean match first
    for (let j = i+1; j < group.length; j++) {
      if (!used.has(group[j].id) && !p1opp.has(group[j].id)) { partner = group[j]; break; }
    }
    // Allow rematch if forced
    if (!partner && forceAll) {
      for (let j = i+1; j < group.length; j++) {
        if (!used.has(group[j].id)) { partner = group[j]; isRematch = true; break; }
      }
    }

    if (partner) {
      used.add(p1.id); used.add(partner.id);
      pairs.push({ id: uid(), p1: p1.id, p2: partner.id, result: null, isRematch, isBye: false, table: null });
      divLog.push(`  ${p1.name} × ${partner.name}${isRematch?' ⚠REMATCH':''}`);
    } else {
      leftover.push(p1);
      divLog.push(`  Float↓: ${p1.name}`);
    }
  }
  return { pairs, leftover };
}

export { calcStats, getOpps, buildOppMap, p1Count, owp, oowp, getStandings };
