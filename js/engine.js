'use strict';
// ─── Stats engine ────────────────────────────────────────────
// Motor de estatísticas: OWP, OOWP, standings

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

// ─── Swiss algorithm + Top Cut ───────────────────────────────
// Algoritmo Swiss oficial Pokémon TCG + Top Cut



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

/* ═══════════════════════════════════════════════════════════════
   TOP CUT — Official seeding 1v(n), 2v(n-1), etc.
═══════════════════════════════════════════════════════════════ */

function buildTopCut(standings, cutSize) {
  const cut = standings.slice(0, cutSize);
  const matches = [];
  for (let i = 0; i < Math.floor(cutSize/2); i++) {
    matches.push({
      id: uid(), seed1: i+1, seed2: cutSize-i,
      p1: { ...cut[i] }, p2: { ...cut[cutSize-1-i] }, winner: null,
    });
  }
  return [{ round: 1, matches }];
}
function advanceBracket(bracket) {
  const last = bracket[bracket.length-1];
  if (last.matches.length === 1) return null;
  const winners = last.matches.map(m => m.winner==='p1' ? m.p1 : m.p2);
  const next = [];
  for (let i = 0; i < winners.length; i+=2)
    if (i+1 < winners.length)
      next.push({ id: uid(), p1: winners[i], p2: winners[i+1], winner: null, seed1: null, seed2: null });
  return [...bracket, { round: bracket.length+1, matches: next }];
}

// ─── TDF import/export ───────────────────────────────────────
// TDF Engine — import/export formato oficial TOM





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
