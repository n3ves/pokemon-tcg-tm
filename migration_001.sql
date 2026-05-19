-- ════════════════════════════════════════════════════════════════
-- MIGRATION 001 — Adiciona coluna full_state em tournaments
-- Executar em: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════════

-- Coluna que armazena o estado completo do torneio (jogadores,
-- rodadas, pareamentos, bracket) como JSONB.
-- As colunas normalizadas (name, status, etc.) continuam para queries.
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS full_state JSONB DEFAULT '{}';

-- Garante permissões corretas para a publishable key
GRANT ALL ON players            TO anon, authenticated;
GRANT ALL ON tournaments        TO anon, authenticated;
GRANT ALL ON tournament_players TO anon, authenticated;
GRANT ALL ON rounds             TO anon, authenticated;
GRANT ALL ON pairings           TO anon, authenticated;
GRANT SELECT ON player_standings TO anon, authenticated;

-- Confirma
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'tournaments'
ORDER BY ordinal_position;
