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
  bananao/
    SKILL.md            # frontmatter name + description, poi uso
    NOTES.md            # misure, schemi API, decisioni: solo se ci metti le mani
    generate-image.mjs  # CLI eseguibile, zero dipendenze
```

## Convenzioni

- Una cartella per skill sotto `skills/<nome>/`, con `SKILL.md` e frontmatter `name` + `description`.
- La `description` dice **quando** usare la skill, non come funziona: è l'unica cosa che l'agente
  legge per decidere se caricarla. Niente riassunti del workflow lì dentro — l'agente seguirebbe il
  riassunto invece di leggere il corpo.
- Script senza dipendenze (Node stdlib o Python stdlib). Nessun `npm install`.
- Risultato utile su **stdout**, diagnostica su **stderr**, così l'output è catturabile con `$(...)`.
- Nessuna credenziale nella repo: **è pubblica**. Le chiavi vivono in `~/.config/<skill>/`, chmod 600.

## Dove va cosa

Tre file, tre lettori diversi. Sbagliare posto significa o non essere letti, o far pagare a
ogni sessione qualcosa che serviva a una sola.

| File | Chi lo legge | Cosa ci va |
|---|---|---|
| `SKILL.md` | l'agente che **usa** la skill | come si invoca, opzioni, errori, limiti operativi |
| `skills/<nome>/NOTES.md` | chi **modifica** la skill | misure, schemi delle API, confronti tra modelli, cosa non è mai stato provato |
| questo `CLAUDE.md` | **ogni** sessione aperta nella repo | solo le trappole: le cose che si sbaglierebbero senza saperlo, in poche righe |

Questo file viene caricato in ogni sessione, anche quando la skill in questione non c'entra
niente. Se una cosa serve solo a chi sta lavorando su quella skill, va in `NOTES.md`.

---

# Trappole per skill

Poche righe ciascuna, con il rimando. Se ti serve il perché, è in `NOTES.md`.

## bananao — `skills/bananao/NOTES.md`

- **L'API è `POST /api/v1/images/generations`, non `chat/completions`.** La forma con
  `messages` + `modalities` gira in molte guide, è la prima che viene in mente ed è sbagliata.
- **Nessun fallback su `OPENROUTER_API_KEY`.** È deliberato: chiave dedicata = spesa
  tracciabile e revoca chirurgica.
- Il test end-to-end non è mai stato eseguito.

## go-watch — `skills/go-watch/NOTES.md`

- **Gli offset non passano da OpenRouter.** `video_metadata` viene scartato in silenzio, in
  tutte le posizioni: stessi token identici, nessun errore. Per guardare un capitolo senza
  pagare il video intero serve l'API Google diretta; il ripiego su OpenRouter esiste, ma
  deve ritagliare il segmento con yt-dlp e costa ~3×. `media_resolution` invece passa — non
  generalizzare da quello.
- **Il testo piccolo a schermo viene letto male, da tutti i modelli provati.** Versioni e URL
  escono verosimili ma sbagliati (`0.4.3` e `49.2` dove il fotogramma dice `1.49.2`).
  `MEDIA_RESOLUTION_HIGH` non aiuta: sull'URL YouTube viene ignorato, token identici. Se un
  numero conta, si verifica sul fotogramma.
- **Per i capitoli con testo a schermo serve un flash, non il lite.** A parità esatta di
  token in ingresso il lite parafrasa dove flash riporta.
- **Segmentare e scrivere restano al modello host.** Non delegarli a uno script o a un
  modello economico: sono ~12k token di testo, già coperti dall'abbonamento, e il lite li fa
  peggio (sulla segmentazione ha lasciato un blocco indivisibile da dieci minuti). A Gemini
  si paga solo ciò che nessun altro può fare, cioè guardare. Questo non vieta un wrapper che
  orchestri i passi meccanicamente: vieta di spostare il giudizio.
- **Il targeting per capitoli non è un'ottimizzazione di costo, è correttezza.** La passata
  unica su un video da 10 minuti ha risposto che un argomento non veniva mai trattato,
  mentre aveva un capitolo dedicato.
- **Su OpenRouter gli alias `-latest` non esistono.** `google/gemini-flash-latest` risponde
  HTTP 400 anche se una lettura veloce del catalogo lo lascia credere: lì i modelli sono
  versionati (`google/gemini-3.6-flash`). E il ripiego ritaglia il segmento, che riparte da
  00:00: i timestamp vanno riportati al video intero dicendolo nel prompt.
