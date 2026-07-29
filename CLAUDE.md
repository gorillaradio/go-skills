# go-skills — guida per Claude

Repo di **skill per Claude Code**, installate via symlink in `~/.claude/skills/`.
Non è un'applicazione: nessuna build, nessuna dipendenza runtime.

## Non confonderla con claude-plugins

Esistono due repo di skill, con due meccanismi diversi. Non spostare roba dall'una all'altra
senza capire quale meccanismo serve.

| | `gorillaradio/go-skills` (questa) | `gorillaradio-dev/claude-plugins` |
|---|---|---|
| Cos'è | skill "nude" | marketplace di plugin |
| Struttura | `skills/<nome>/SKILL.md` | `plugins/<plugin>/skills/<nome>/SKILL.md` + `marketplace.json` |
| Installazione | symlink in `~/.claude/skills/` | `extraKnownMarketplaces` + `enabledPlugins` |
| Invocazione | `/<nome>` | `/<plugin>:<nome>` |

## Struttura

```
skills/
  _lib/                 # codice condiviso dalla famiglia go-* (vedi sotto)
  bananao/
    SKILL.md            # frontmatter name + description, poi uso
    generate-image.mjs  # CLI eseguibile, zero dipendenze
  go-glance/            # immagini singole o cartelle
  go-watch/             # contenuto di un video, audio incluso
  go-scrub/             # animazioni di UI, fotogramma per fotogramma
  go-listen/            # audio: trascrizione e diarizzazione
```

## Convenzioni

- Una cartella per skill sotto `skills/<nome>/`, con `SKILL.md` e frontmatter `name` + `description`.
- La `description` dice **quando** usare la skill, non come funziona: è l'unica cosa che l'agente
  legge per decidere se caricarla. Niente riassunti del workflow lì dentro — l'agente seguirebbe il
  riassunto invece di leggere il corpo.
- Script senza dipendenze npm. Node stdlib o Python stdlib, nessun `npm install`.
  **Deroga: la famiglia `go-*` richiede `ffmpeg` nel PATH** — vedi sotto.
- Risultato utile su **stdout**, diagnostica su **stderr**, così l'output è catturabile con `$(...)`.
- Nessuna credenziale nella repo: **è pubblica**. Le chiavi stanno in `~/.config/`, chmod 600.
  `bananao` usa `~/.config/bananao/config.json`; la famiglia `go-*` un file unico, vedi sotto.

---

# La famiglia go-*

Quattro skill che danno a Claude occhi e orecchie economici, delegando a un modello a basso costo
via OpenRouter. Sono **quattro mestieri separati**, non quattro modalità di uno: `go-scrub` studia
come si muove un'interfaccia, `go-watch` capisce cosa succede in un video, `go-listen` trascrive,
`go-glance` guarda immagini. Design completo in `docs/superpowers/specs/`.

## Una chiave sola, con separazione opzionale

`~/.config/go-skills/config.json`, chmod 600. Un campo per skill più un default che vale per quelle
senza campo proprio.

Il senso: parti con la stessa chiave dappertutto e un solo passaggio di setup; il giorno che i costi
salgono e vuoi sapere **chi** li sta facendo salire, separi le chiavi editando quel file — senza
toccare percorsi, codice, né `settings.json`.

Resta valida la regola di `bananao`: **nessun fallback su `OPENROUTER_API_KEY` generica.** La chiave
deve restare isolata perché la spesa sia leggibile sulla dashboard e la revoca chirurgica.

`bananao` non si tocca: continua a usare il suo file. Migrarla sarebbe un cambio gratuito di una
cosa che funziona, e richiederebbe di aggiornare anche il `deny` in `settings.json`.

## ffmpeg è obbligatorio, ed è una deroga consapevole

Senza ffmpeg queste skill non sono utilizzabili sui file che le persone hanno davvero: le
registrazioni schermo superano quasi sempre il limite di caricamento, e vanno compresse prima di
essere spedite. Serve anche per rallentare i video (`go-scrub`), estrarre l'audio (`go-listen`) e
leggere durata e frame rate con `ffprobe`.

## L'unità distribuibile è la repo, non la cartella

Con `skills/_lib/` condivisa, `skills/go-watch/` copiata da sola non funziona più. Il symlink regge
— Node risolve al percorso reale, verificato — ma la copia no. `bananao` resta autonoma.

Nella lib va **solo il trasporto**: caricamento della chiave, chiamata a OpenRouter, riconoscimento
della risposta tronca con ritentativo, riga di token e costo, base64 e MIME. Ogni guardia specifica
resta nella skill che la usa.

## Ogni numero vive in un posto solo

Modello di default, prezzo per milione, token per fotogramma, token al secondo dell'audio: sono gli
stessi valori in quattro `SKILL.md`. Se vengono ricopiati, il giorno che ne cambia uno le altre tre
restano indietro e nessuno se ne accorge, perché l'agente legge una `SKILL.md` per volta.

Le costanti stanno nella lib, i fatti economici in un documento solo, e ogni `SKILL.md` ci rimanda.

---

# bananao

Genera immagini via OpenRouter. `SKILL.md` copre l'uso; qui sotto c'è solo ciò che non si deduce
leggendo il codice.

## L'API è quella dedicata, non chat/completions

**Non riportare lo script su `POST /chat/completions` con `modalities` e `image_config`.**
Quella forma gira in molte guide ed è la prima cosa che viene in mente, ma non è quella in uso qui.

Verificato empiricamente contro l'API live (28 luglio 2026):

| Forma vecchia (NON usare) | Forma attuale |
|---|---|
| `POST /api/v1/chat/completions` | `POST /api/v1/images/generations` |
| `messages: [...]` + `modalities: ["image","text"]` | `prompt` (string, richiesto) |
| `image_config.image_size` | `resolution` top-level: `512\|1K\|2K\|4K` |
| `image_config.aspect_ratio` | `aspect_ratio` top-level |
| `choices[0].message.images[0].image_url.url` (data URL) | `data[0].b64_json` + `data[0].media_type` |
| immagine di input come `image_url` nel content | `input_references[]`, max 14 |

`POST /api/v1/images/generations` con body `{}` risponde 400 con un ZodError che elenca i campi
richiesti: è il modo più veloce per ri-verificare lo schema se qualcosa smette di funzionare.

I parametri ammessi **cambiano da modello a modello** e sono leggibili a runtime:

```bash
curl -s https://openrouter.ai/api/v1/images/models \
  | jq '.data[] | select(.id=="google/gemini-3.1-flash-image") | .supported_parameters'
```

Es. `gemini-3.1-flash-lite-image` accetta **solo** `resolution: "1K"`, e tutti i modelli Google
attuali hanno `n` con max 1 — per questo non esiste un flag `--n`.

## Decisioni prese, con il perché

**Chiave solo da file, nessun fallback su variabile d'ambiente.** Scelta deliberata, non una
dimenticanza. Un fallback su `OPENROUTER_API_KEY` generica vanificherebbe lo scopo: la chiave è
dedicata a questa skill così che la spesa sia tracciabile sulla dashboard OpenRouter e la revoca sia
chirurgica. Se in futuro serve un override per CI, usare un nome dedicato (`BANANAO_OPENROUTER_KEY`),
mai quello generico.

**La chiave sta in `~/.config/bananao/config.json`, non nella cartella della skill.** Due motivi:
la cartella della skill è distribuibile e versionata (pubblica!), e un aggiornamento della repo
sovrascriverebbe il file.

**Default `google/gemini-3.1-flash-image`** (~$0.06/img). Il `2.5-flash-image` che gira in molte
guide come "Nano Banana" è di ottobre 2025 ed è superato. Il `lite` (~$0.03) è il fallback per asset
usa-e-getta, il `3-pro` (~$0.12) per quando la qualità conta.

**Lo script non chiede mai nulla in modo interattivo.** Se la chiave manca esce con codice 1 e
stampa il comando esatto da eseguire. Un prompt interattivo bloccherebbe l'agente che lo invoca.

## Buco noto nella protezione della chiave

In `~/.claude/settings.json` c'è:

```json
"permissions": { "deny": ["Read(~/.config/bananao/**)"] }
```

**Questo blocca solo il tool Read.** Un `cat ~/.config/bananao/config.json` via Bash passa.
Non tentare di chiuderlo aggiungendo deny su Bash: è whack-a-mole (`cat`, `grep`, `head`, `node -e`,
`python -c`…). Il meccanismo giusto è:

```json
"sandbox": { "credentials": { "files": [{ "path": "~/.config/bananao", "mode": "deny" }] } }
```

che però vale solo per i comandi sandboxati. Non ancora applicato — decisione aperta.

## TODO aperti

- [ ] **Test end-to-end mai eseguito.** Endpoint, schema di richiesta e parametri sono verificati
      contro l'API live; i path di errore del CLI sono esercitati (chiave assente, opzioni
      malformate, stdout vuoto su fallimento). Ma nessuna immagine è mai stata davvero generata,
      perché serve la chiave. Primo comando da lanciare:
      ```bash
      node ~/.claude/skills/bananao/generate-image.mjs "un pappagallo origami su fondo blu" -a 1:1 -s 1K -o /tmp/test-bananao.png
      ```
- [ ] Decidere se aggiungere `sandbox.credentials.files` (vedi sopra).
