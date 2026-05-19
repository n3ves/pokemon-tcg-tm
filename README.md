# Pokémon TCG Tournament Manager

Sistema web para gerenciamento de torneios Pokémon TCG — substituto do TOM (Tournament Operations Manager).

## Estrutura

```
index.html              # Shell HTML (14 linhas)
css/
  style.css             # Todos os estilos
js/
  config.js             # Constantes: DIVS, R, SK, VER, SB_URL/KEY
  prng.js               # PRNG seeded (Mulberry32), uid(), isUUID()
  state.js              # Estado global (G), navegação, storage/sync
  stats.js              # OWP, OOWP, standings, calcStats
  swiss.js              # Algoritmo Swiss + Top Cut
  supabase.js           # Cliente REST Supabase, mapeamento de dados
  tdf.js                # Import/Export formato .tdf (TOM oficial)
  utils.js              # Helpers: esc(), fmt(), dbadge(), inferDiv()...
  main.js               # Init + expõe funções no window
  render/
    index.js            # render() principal
    home.js             # Dashboard
    players.js          # Banco de jogadores + detalhe
    tournaments.js      # Lista + criação de torneios
    tournament.js       # Torneio: rodadas, standings, histórico, debug, export
    settings.js         # Configurações globais + organizer
    modal.js            # Modais (jogador, juiz)
  actions/
    players.js          # CRUD jogadores, import players.xml
    tournaments.js      # CRUD torneios
    registration.js     # Registro de jogadores no torneio
    results.js          # Lançamento de resultados, edição de juiz
    advance.js          # Avançar rodada, top cut
    timer.js            # Timer de rodada
    simulation.js       # Simular rodada/torneio completo, debug
    settings.js         # Salvar configs, reload Supabase
    import-export.js    # JSON, CSV, TDF import/export
```

## Deploy

### Netlify (recomendado)
Arraste a pasta inteira para [netlify.com/drop](https://netlify.com/drop).

### Local
```bash
python3 -m http.server 8080
# Abra http://localhost:8080
```

> ⚠️ Precisa de servidor HTTP — ES modules não funcionam com `file://`

## Supabase

Variáveis configuradas em `js/config.js`:
- `SB_URL` — URL do projeto
- `SB_KEY` — Publishable key

Migration necessária: `migration_001.sql`
Schema completo: `schema.sql`

## Funcionalidades

- Algoritmo Swiss oficial Pokémon TCG com backtracking
- Age Modified (divisões pequenas mescladas com Masters)
- BYE: prioridade para pior record → Jr/Sr antes de Masters
- Import/Export `.tdf` compatível com TOM v1.74
- Import `players.xml` do banco local do TOM
- Banco de jogadores persistente (Supabase)
- Standings separados por divisão (configurável)
- Modo debug com log detalhado de pareamentos
- Simulação de torneios para testes
