-- ════════════════════════════════════════════════════════════════
-- MIGRATION 006 — Habilita Realtime nas tabelas principais
-- Executar em: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════════

-- Habilita replicação para as tabelas que o app escuta em tempo real
ALTER PUBLICATION supabase_realtime ADD TABLE players;
ALTER PUBLICATION supabase_realtime ADD TABLE tournaments;
ALTER PUBLICATION supabase_realtime ADD TABLE venues;

-- Confirma quais tabelas estão na publicação
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;
