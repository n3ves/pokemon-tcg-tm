-- ════════════════════════════════════════════════════════════════
-- MIGRATION 004 — Adiciona campos de organizer na tabela venues
-- Executar em: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════════

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS organizer_name  TEXT,   -- nome do organizador (para o TDF)
  ADD COLUMN IF NOT EXISTS organizer_popid TEXT;   -- Player ID (popid) do organizador

-- Confirma
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'venues'
ORDER BY ordinal_position;
