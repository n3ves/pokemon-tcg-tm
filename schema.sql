-- ════════════════════════════════════════════════════════════════
-- Pokémon TCG Tournament Manager — Schema Supabase
-- Versão: 3.0
-- Executar no: Supabase > SQL Editor > New query
-- ════════════════════════════════════════════════════════════════

-- ── Extensão UUID ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ════════════════════════════════════════════════════════════════
-- 1. JOGADORES (banco global de jogadores)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS players (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  name          TEXT        NOT NULL,
  nickname      TEXT,
  player_id     TEXT,                          -- ID oficial Pokémon
  birth_date    DATE,
  division      TEXT        CHECK (division IN ('Juniors','Seniors','Masters')),
  city          TEXT,
  state         TEXT,
  contact       TEXT,
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS players_name_idx      ON players (lower(name));
CREATE INDEX IF NOT EXISTS players_player_id_idx ON players (player_id);

-- ════════════════════════════════════════════════════════════════
-- 2. TORNEIOS
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tournaments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  name            TEXT        NOT NULL,
  city            TEXT,
  state           TEXT,
  date            DATE,
  mode            TEXT        CHECK (mode IN ('lc','cup','one','custom')),
  status          TEXT        DEFAULT 'registration'
                              CHECK (status IN ('registration','rounds','topcut','finished')),
  current_round   INTEGER     DEFAULT 0,

  -- Configurações do torneio (total_rounds, top_cut_size, timer, seed, flags...)
  settings        JSONB       NOT NULL DEFAULT '{}',

  -- Timer em segundos
  timer_seconds   INTEGER     DEFAULT 3000,

  -- Top cut bracket (estrutura JSON completa do bracket eliminatório)
  top_bracket     JSONB
);

CREATE INDEX IF NOT EXISTS tournaments_status_idx ON tournaments (status);

-- ════════════════════════════════════════════════════════════════
-- 3. JOGADORES DO TORNEIO (inscrições)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tournament_players (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  tournament_id   UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id       UUID        REFERENCES players(id) ON DELETE SET NULL,  -- referência global (pode ser null se criado na hora)

  -- Snapshot do jogador no momento da inscrição
  name            TEXT        NOT NULL,
  division        TEXT        CHECK (division IN ('Juniors','Seniors','Masters')),

  -- Estado no torneio
  dropped         BOOLEAN     DEFAULT FALSE,
  dq              BOOLEAN     DEFAULT FALSE,
  had_bye         BOOLEAN     DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS tp_tournament_idx ON tournament_players (tournament_id);
CREATE INDEX IF NOT EXISTS tp_player_idx     ON tournament_players (player_id);

-- Garante que um jogador global não apareça duas vezes no mesmo torneio
CREATE UNIQUE INDEX IF NOT EXISTS tp_unique_player_per_tournament
  ON tournament_players (tournament_id, player_id)
  WHERE player_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════
-- 4. RODADAS
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rounds (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  tournament_id   UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  number          INTEGER     NOT NULL,
  seed            BIGINT,                      -- seed usada no pareamento desta rodada
  pairing_log     TEXT[],                      -- log detalhado do algoritmo
  is_simulated    BOOLEAN     DEFAULT FALSE,

  UNIQUE (tournament_id, number)
);

CREATE INDEX IF NOT EXISTS rounds_tournament_idx ON rounds (tournament_id);

-- ════════════════════════════════════════════════════════════════
-- 5. PAREAMENTOS
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pairings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  round_id        UUID        NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  tournament_id   UUID        NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,

  table_number    INTEGER,

  -- player1 = quem está no lado P1 (vai primeiro)
  player1_id      UUID        REFERENCES tournament_players(id) ON DELETE CASCADE,
  -- player2 = NULL quando BYE
  player2_id      UUID        REFERENCES tournament_players(id) ON DELETE CASCADE,

  is_bye          BOOLEAN     DEFAULT FALSE,
  is_rematch      BOOLEAN     DEFAULT FALSE,   -- rematch forçado pelo algoritmo

  -- 'p1' | 'p2' | 'tie' | 'dl' | 'bye' | NULL (pendente)
  result          TEXT        CHECK (result IN ('p1','p2','tie','dl','bye') OR result IS NULL),

  judge_note      TEXT        -- anotação do juiz
);

CREATE INDEX IF NOT EXISTS pairings_round_idx      ON pairings (round_id);
CREATE INDEX IF NOT EXISTS pairings_tournament_idx ON pairings (tournament_id);
CREATE INDEX IF NOT EXISTS pairings_p1_idx         ON pairings (player1_id);
CREATE INDEX IF NOT EXISTS pairings_p2_idx         ON pairings (player2_id);

-- ════════════════════════════════════════════════════════════════
-- 6. TRIGGER — updated_at automático
-- ════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER players_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tournaments_updated_at
  BEFORE UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER pairings_updated_at
  BEFORE UPDATE ON pairings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ════════════════════════════════════════════════════════════════
-- 7. VIEWS ÚTEIS
-- ════════════════════════════════════════════════════════════════

-- Standings view (pontos e W/L/T por jogador por torneio)
CREATE OR REPLACE VIEW player_standings AS
SELECT
  tp.id                                         AS tp_id,
  tp.tournament_id,
  tp.name,
  tp.division,
  tp.dropped,
  tp.dq,
  tp.had_bye,

  -- Vitórias (P1 venceu e player é P1, ou P2 venceu e player é P2, ou BYE)
  COUNT(*) FILTER (
    WHERE (p.result='p1' AND p.player1_id=tp.id)
       OR (p.result='p2' AND p.player2_id=tp.id)
       OR (p.result='bye' AND p.player1_id=tp.id)
  )                                             AS wins,

  -- Derrotas
  COUNT(*) FILTER (
    WHERE (p.result='p2' AND p.player1_id=tp.id)
       OR (p.result='p1' AND p.player2_id=tp.id)
       OR (p.result='dl')
  )                                             AS losses,

  -- Empates
  COUNT(*) FILTER (WHERE p.result='tie')        AS ties,

  -- Match Points (W*3 + T*1)
  (
    COUNT(*) FILTER (
      WHERE (p.result='p1' AND p.player1_id=tp.id)
         OR (p.result='p2' AND p.player2_id=tp.id)
         OR (p.result='bye' AND p.player1_id=tp.id)
    ) * 3
    +
    COUNT(*) FILTER (WHERE p.result='tie')
  )                                             AS match_points,

  -- Contagem de P1 (balanceamento)
  COUNT(*) FILTER (WHERE p.player1_id=tp.id AND NOT p.is_bye) AS p1_count

FROM tournament_players tp
LEFT JOIN pairings p
  ON (p.player1_id=tp.id OR p.player2_id=tp.id)
GROUP BY tp.id, tp.tournament_id, tp.name, tp.division, tp.dropped, tp.dq, tp.had_bye;

-- ════════════════════════════════════════════════════════════════
-- 8. ROW LEVEL SECURITY
-- Desativado por padrão para desenvolvimento.
-- Ative e configure quando adicionar autenticação.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE players            DISABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments        DISABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_players DISABLE ROW LEVEL SECURITY;
ALTER TABLE rounds             DISABLE ROW LEVEL SECURITY;
ALTER TABLE pairings           DISABLE ROW LEVEL SECURITY;

-- ════════════════════════════════════════════════════════════════
-- 9. GRANT para a role anon (necessário para a publishable key)
-- ════════════════════════════════════════════════════════════════
GRANT ALL ON players            TO anon, authenticated;
GRANT ALL ON tournaments        TO anon, authenticated;
GRANT ALL ON tournament_players TO anon, authenticated;
GRANT ALL ON rounds             TO anon, authenticated;
GRANT ALL ON pairings           TO anon, authenticated;
GRANT SELECT ON player_standings TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════
-- 10. DADOS DE EXEMPLO (opcional — remova se não quiser)
-- ════════════════════════════════════════════════════════════════
/*
INSERT INTO players (name, nickname, division, city, state) VALUES
  ('João Silva',   'JSilva', 'Masters', 'Rio de Janeiro', 'RJ'),
  ('Maria Santos', 'Mari',   'Masters', 'São Paulo',      'SP'),
  ('Pedro Lima',   'Pedrão', 'Seniors', 'Rio de Janeiro', 'RJ'),
  ('Ana Costa',    'Aninha', 'Juniors', 'Curitiba',       'PR');
*/
