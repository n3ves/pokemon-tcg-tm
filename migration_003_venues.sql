-- ════════════════════════════════════════════════════════════════
-- MIGRATION 003 — Tabela de locais (venues)
-- Executar em: Supabase Dashboard → SQL Editor → New query
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS venues (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),

  name         TEXT        NOT NULL,
  nickname     TEXT,                        -- nome curto, ex: "Liga Lavender"
  address      TEXT,
  city         TEXT,
  state        TEXT,
  zip          TEXT,
  contact      TEXT,                        -- e-mail ou telefone do responsável
  responsible  TEXT,                        -- nome do responsável
  notes        TEXT,
  active       BOOLEAN     DEFAULT TRUE     -- para filtrar locais inativos
);

-- Índices
CREATE INDEX IF NOT EXISTS venues_city_idx  ON venues (city);
CREATE INDEX IF NOT EXISTS venues_active_idx ON venues (active);

-- updated_at automático
CREATE TRIGGER venues_updated_at
  BEFORE UPDATE ON venues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_all_venues"
  ON venues FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Adiciona coluna venue_id na tabela tournaments (FK para venues)
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS venue_id UUID REFERENCES venues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tournaments_venue_idx ON tournaments (venue_id);

-- Permissões
GRANT ALL ON venues TO anon, authenticated;

-- Confirma
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('venues','tournaments')
  AND column_name IN ('id','name','city','active','venue_id')
ORDER BY table_name, column_name;
