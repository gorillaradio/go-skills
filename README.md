# go-skills

Skill per Claude Code, condivise fra i progetti gorillaradio.

Repo di skill "nude": ogni skill è una cartella sotto `skills/` con un `SKILL.md`, installata via
symlink in `~/.claude/skills/`. Non è un marketplace di plugin — per quello vedi
[`gorillaradio-dev/claude-plugins`](https://github.com/gorillaradio-dev/claude-plugins).

## Skill

| Skill | Cosa fa |
|---|---|
| [`bananao`](skills/bananao/) | Genera immagini via OpenRouter e le scrive su disco |
| [`go-glance`](skills/go-glance/) | Guarda immagini — singole, multiple o una cartella — e restituisce testo |
| [`go-watch`](skills/go-watch/) | Racconta il contenuto di un video, audio incluso, anche link YouTube |
| [`go-scrub`](skills/go-scrub/) | Misura le animazioni di UI fotogramma per fotogramma, in millisecondi reali |
| [`go-listen`](skills/go-listen/) | Trascrive e diarizza l'audio, anche estratto da un video |
| [`report-open`](skills/report-open/) | Apre un documento in un reader desktop e ne posiziona la finestra (macOS) |

La famiglia `go-*` dà a Claude occhi e orecchie economici: un modello a basso costo via OpenRouter
guarda o ascolta il media e restituisce testo, Claude ragiona solo sul testo. Il media non entra mai
nella conversazione, quindi non viene ripagato a ogni turno.

`report-open` sta fuori da quella famiglia: non delega niente a un modello, serve a far leggere un
documento all'umano invece di stamparlo nel terminale.

## Installazione

Clona la repo dove preferisci, poi crea i symlink dalla cartella clonata:

```bash
git clone https://github.com/gorillaradio/go-skills.git
```

```bash
cd go-skills && for s in bananao go-glance go-watch go-scrub go-listen; do
  ln -s "$(pwd)/skills/$s" ~/.claude/skills/$s
done
```

Per aggiornare basta un `git pull` nella repo: i symlink seguono.

**L'unità distribuibile è la repo, non la singola cartella.** Le skill `go-*` condividono
`skills/_lib/`: una cartella `go-*` copiata altrove da sola non funziona. Il symlink invece regge,
perché Node risolve gli import al percorso reale. `_lib/` non va symlinkata: non è una skill.

### Requisiti

- **Node 18+** per tutti gli script (zero dipendenze npm).
- **ffmpeg e ffprobe nel PATH** per `go-watch`, `go-scrub` e `go-listen` sui file locali
  (`brew install ffmpeg`). Servono per comprimere, rallentare, estrarre l'audio e rilevare le
  tracce mute. È una deroga consapevole alla regola zero-dipendenze: senza ffmpeg queste skill
  non funzionano sui file che le persone hanno davvero.

## Chiavi e sicurezza

Nessuna skill di questa repo contiene credenziali: **la repo è pubblica.** Le chiavi stanno in
`~/.config/`, permessi `600`, fuori dalle cartelle delle skill — così gli aggiornamenti non le
sovrascrivono e non finiscono nel repo.

- `bananao` → `~/.config/bananao/config.json` (vedi il suo [SKILL.md](skills/bananao/SKILL.md))
- famiglia `go-*` → `~/.config/go-skills/config.json`, un'unica chiave per tutte.

Setup da terminale. Il secondo comando chiede la chiave con `read -s`, così non resta né a video
né nella history della shell (incollarla dentro un comando ce la lascerebbe):

```bash
mkdir -p ~/.config/go-skills
```

```bash
read -s "?Incolla la chiave OpenRouter (sk-or-v1-…): " KEY && \
printf '{"apiKey":"%s"}' "$KEY" > ~/.config/go-skills/config.json && \
chmod 600 ~/.config/go-skills/config.json && unset KEY && echo " → chiave salvata"
```

Verifica — deve rispondere `-rw-------` (permessi 600, solo il tuo utente la legge):

```bash
ls -l ~/.config/go-skills/config.json
```

Regole, tutte deliberate:

- **Chiave dedicata, creata apposta su [openrouter.ai/keys](https://openrouter.ai/keys).** Mai
  riusare una chiave generica e mai un fallback su `OPENROUTER_API_KEY`: la chiave dedicata rende
  la spesa leggibile sulla dashboard OpenRouter e la revoca chirurgica.
- **Mettile un tetto di spesa** (credit limit) sulla dashboard OpenRouter: è la vera rete di
  sicurezza. I costi normali sono minimi — millesimi di dollaro a chiamata, ~10 centesimi per
  un'ora di video — ma il tetto protegge da loop e sbagli.
- **Se la chiave manca, gli script non chiedono nulla**: escono con codice 1 stampando il comando
  di setup. L'agente deve riportarlo all'utente e fermarsi, mai inventare o cercare la chiave.

## Fidarsi dell'output: le tre regole

1. **stdout vuoto = nessuna analisi.** Gli script stampano il risultato solo su stdout e la
   diagnostica su stderr; in caso di errore stdout resta vuoto ed escono con codice 1. Se non
   arriva testo, non c'è niente da cui ragionare.
2. **Il silenzio produce invenzioni.** Un audio muto spedito al modello genera una trascrizione
   completa, circostanziata e interamente falsa. Le skill lo rilevano da sole (`go-listen` rifiuta,
   `go-watch` rimuove la traccia) — ma la lezione generale resta: la precisione apparente non è
   affidabilità.
3. **Sotto la risoluzione temporale i numeri sono inventati.** In `go-scrub`, durate inferiori a
   `1000/fps` ms vanno trattate come non osservate; il default `--fps max` esiste perché è l'unico
   valore in cui la soglia di invenzione coincide col limite fisico della sorgente. Tempi che
   coincidono con inizio o fine del video sono un segno di degenerazione, non un'osservazione.

Le guardie sui costi girano **prima** di spendere: stima dei token sui file locali, tetto di
~4.000 fotogrammi per chiamata, compressione automatica sopra i 10 MB, limite di 40 MB per upload.
I dettagli, gli errori e i limiti di ogni skill stanno nel suo `SKILL.md`.

## Convenzioni

- Una cartella per skill sotto `skills/<nome>/`, con `SKILL.md` e frontmatter `name` + `description`.
- La `description` descrive **quando** usare la skill, non come funziona: è ciò che l'agente legge per
  decidere se caricarla.
- Gli script sono senza dipendenze npm (Node stdlib o Python stdlib). Unica deroga: ffmpeg nel PATH
  per la famiglia `go-*`, vedi Requisiti.
- Gli script stampano il risultato utile su **stdout** e la diagnostica su **stderr**, così l'output è
  catturabile con `$(...)`.
- Il codice comune alla famiglia `go-*` vive in `skills/_lib/` e contiene solo il trasporto (chiave,
  chiamata HTTP, riga di costo, base64/MIME, ffmpeg); ogni guardia specifica resta nella skill che
  la usa.
