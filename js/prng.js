// PRNG seeded (Mulberry32) + helpers de ID
function makeRNG(seed) {
  let s = (seed >>> 0) || 0xCAFEBABE;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function uid() {
  // Gera UUID v4 válido para Supabase
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
function isUUID(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s||''));
}
// Migra IDs antigos (curtos) para UUID antes de enviar ao Supabase
function migrateIDs() {
  const map = new Map(); // oldId → newUUID
  G.players = G.players.map(p => {
    if (isUUID(p.id)) return p;
    const nid = uid(); map.set(p.id, nid);
    return { ...p, id: nid };
  });
  G.tours = G.tours.map(t => {
    const tid = isUUID(t.id) ? t.id : uid();
    if (!isUUID(t.id)) map.set(t.id, tid);
    return {
      ...t,
      id: tid,
      players: (t.players||[]).map(tp => ({
        ...tp,
        gid: map.get(tp.gid) || tp.gid,
      })),
    };
  });
  if (map.size > 0) {
    DB.save(SK.PL, G.players);
    DB.save(SK.TN, G.tours);
    console.log(`[migrateIDs] ${map.size} IDs migrados para UUID`);
  }
}

export { makeRNG, shuffle, uid, isUUID, migrateIDs };
