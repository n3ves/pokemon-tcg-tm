// Algoritmo Swiss oficial Pokémon TCG + Top Cut
import { DIVS, R } from './config.js';
import { makeRNG, shuffle, uid } from './prng.js';
import { calcStats, buildOppMap, p1Count, getStandings } from './stats.js';

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

export { generateSwiss, buildTopCut, advanceBracket };
