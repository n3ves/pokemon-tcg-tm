-- ════════════════════════════════════════════════════════════════
-- MIGRATION 005 — Políticas RLS: leitura pública, escrita autenticada
-- Executar em: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════════

-- ── Remove políticas públicas antigas ────────────────────────
DROP POLICY IF EXISTS "public_all_players"            ON players;
DROP POLICY IF EXISTS "public_all_tournaments"        ON tournaments;
DROP POLICY IF EXISTS "public_all_tournament_players" ON tournament_players;
DROP POLICY IF EXISTS "public_all_rounds"             ON rounds;
DROP POLICY IF EXISTS "public_all_pairings"           ON pairings;
DROP POLICY IF EXISTS "public_all_venues"             ON venues;

-- ── Leitura: qualquer um (anon + authenticated) ──────────────
CREATE POLICY "read_players"            ON players            FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read_tournaments"        ON tournaments        FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read_tournament_players" ON tournament_players FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read_rounds"             ON rounds             FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read_pairings"           ON pairings           FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read_venues"             ON venues             FOR SELECT TO anon, authenticated USING (true);

-- ── Escrita: somente autenticados ────────────────────────────
CREATE POLICY "write_players"           ON players            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "write_tournaments"       ON tournaments        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "write_tournament_players"ON tournament_players FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "write_rounds"            ON rounds             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "write_pairings"          ON pairings           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "write_venues"            ON venues             FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── Confirma ─────────────────────────────────────────────────
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
