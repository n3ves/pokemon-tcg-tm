-- ════════════════════════════════════════════════════════════════
-- MIGRATION 002 — Ativar RLS com políticas públicas
-- Resolve: "Tabela de acesso público" no Supabase Security Advisor
--
-- Estratégia atual: app sem autenticação de usuário
-- Política: anon key tem acesso total (equivale ao comportamento atual)
-- Quando adicionar autenticação, substituir por políticas por usuário
-- ════════════════════════════════════════════════════════════════

-- ── Ativar RLS em todas as tabelas ──────────────────────────
ALTER TABLE players            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds             ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairings           ENABLE ROW LEVEL SECURITY;

-- ── Criar políticas de acesso público (anon + authenticated) ─
-- players
CREATE POLICY "public_all_players"
  ON players FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- tournaments
CREATE POLICY "public_all_tournaments"
  ON tournaments FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- tournament_players
CREATE POLICY "public_all_tournament_players"
  ON tournament_players FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- rounds
CREATE POLICY "public_all_rounds"
  ON rounds FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- pairings
CREATE POLICY "public_all_pairings"
  ON pairings FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ── Confirmar ───────────────────────────────────────────────
SELECT
  tablename,
  rowsecurity AS rls_ativo,
  (SELECT count(*) FROM pg_policies WHERE tablename = t.tablename) AS politicas
FROM pg_tables t
WHERE schemaname = 'public'
  AND tablename IN ('players','tournaments','tournament_players','rounds','pairings')
ORDER BY tablename;
