# bananao — note di implementazione

Materiale di riferimento per chi mette le mani sulla skill. `SKILL.md` copre l'uso,
`CLAUDE.md` della repo tiene solo le trappole. Qui ci sono i dettagli che le giustificano.

## Lo schema dell'API dedicata

Verificato empiricamente contro l'API live il **28 luglio 2026**:

| Forma vecchia (NON usare) | Forma attuale |
|---|---|
| `POST /api/v1/chat/completions` | `POST /api/v1/images/generations` |
| `messages: [...]` + `modalities: ["image","text"]` | `prompt` (string, richiesto) |
| `image_config.image_size` | `resolution` top-level: `512\|1K\|2K\|4K` |
| `image_config.aspect_ratio` | `aspect_ratio` top-level |
| `choices[0].message.images[0].image_url.url` (data URL) | `data[0].b64_json` + `data[0].media_type` |
| immagine di input come `image_url` nel content | `input_references[]`, max 14 |

`POST /api/v1/images/generations` con body `{}` risponde 400 con un ZodError che elenca i
campi richiesti: è il modo più veloce per ri-verificare lo schema se qualcosa smette di
funzionare.

I parametri ammessi **cambiano da modello a modello** e sono leggibili a runtime:

```bash
curl -s https://openrouter.ai/api/v1/images/models \
  | jq '.data[] | select(.id=="google/gemini-3.1-flash-image") | .supported_parameters'
```

Es. `gemini-3.1-flash-lite-image` accetta **solo** `resolution: "1K"`, e tutti i modelli
Google attuali hanno `n` con max 1 — per questo non esiste un flag `--n`.

## Decisioni prese, con il perché

**Chiave solo da file, nessun fallback su variabile d'ambiente.** Scelta deliberata, non una
dimenticanza. Un fallback su `OPENROUTER_API_KEY` generica vanificherebbe lo scopo: la chiave
è dedicata a questa skill così che la spesa sia tracciabile sulla dashboard OpenRouter e la
revoca sia chirurgica. Se in futuro serve un override per CI, usare un nome dedicato
(`BANANAO_OPENROUTER_KEY`), mai quello generico.

**La chiave sta in `~/.config/bananao/config.json`, non nella cartella della skill.** Due
motivi: la cartella della skill è distribuibile e versionata (pubblica!), e un aggiornamento
della repo sovrascriverebbe il file.

**Default `google/gemini-3.1-flash-image`** (~$0.06/img). Il `2.5-flash-image` che gira in
molte guide come "Nano Banana" è di ottobre 2025 ed è superato. Il `lite` (~$0.03) è il
fallback per asset usa-e-getta, il `3-pro` (~$0.12) per quando la qualità conta.

**Lo script non chiede mai nulla in modo interattivo.** Se la chiave manca esce con codice 1
e stampa il comando esatto da eseguire. Un prompt interattivo bloccherebbe l'agente che lo
invoca.

## Buco noto nella protezione della chiave

In `~/.claude/settings.json` c'è:

```json
"permissions": { "deny": ["Read(~/.config/bananao/**)"] }
```

**Questo blocca solo il tool Read.** Un `cat ~/.config/bananao/config.json` via Bash passa.
Non tentare di chiuderlo aggiungendo deny su Bash: è whack-a-mole (`cat`, `grep`, `head`,
`node -e`, `python -c`…). Il meccanismo giusto è:

```json
"sandbox": { "credentials": { "files": [{ "path": "~/.config/bananao", "mode": "deny" }] } }
```

che però vale solo per i comandi sandboxati. Non ancora applicato — decisione aperta.

## Non ancora provato

**Test end-to-end mai eseguito.** Endpoint, schema di richiesta e parametri sono verificati
contro l'API live; i path di errore del CLI sono esercitati (chiave assente, opzioni
malformate, stdout vuoto su fallimento). Ma nessuna immagine è mai stata davvero generata,
perché serve la chiave. Primo comando da lanciare:

```bash
node ~/.claude/skills/bananao/generate-image.mjs "un pappagallo origami su fondo blu" -a 1:1 -s 1K -o /tmp/test-bananao.png
```
