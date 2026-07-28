# go-peek — design

Data: 2026-07-28

## Obiettivo

Dare a Claude la capacità di guardare immagini e video senza pagarla a prezzo di modello di
frontiera. Un modello economico legge il media e restituisce testo; Claude ragiona sul testo.

Claude non ha input video sull'API, e le immagini gli costano ~2,4 cent l'una su Opus 5 —
ripagate a ogni turno successivo, perché l'immagine resta nella conversazione. Il testo no.
Motivazione estesa in [`docs/occhi-economici-per-claude.md`](../../occhi-economici-per-claude.md).

## Struttura

```
skills/go-peek/
  SKILL.md     # frontmatter name + description, poi uso
  peek.mjs     # CLI eseguibile, Node 18+
```

Stessa forma di `skills/bananao/`. Nessuna dipendenza npm, ma **ffmpeg deve essere presente
nel PATH** — vedi "Guardie e limiti" per il motivo e la deroga che comporta.

## Interfaccia CLI

```bash
peek.mjs "<domanda>" -i <media> [-i <media>...] [opzioni]
```

La domanda è posizionale, i media sono ripetibili con `-i` — identico a `bananao`.

| Flag | Valori | Default |
|---|---|---|
| `-i, --input <path\|url>` | path locale, URL http(s), link YouTube. Ripetibile. | — |
| `-o, --out <path>` | file su cui salvare la risposta; le cartelle mancanti vengono create | nessuno |
| `-m, --model <id>` | qualunque modello OpenRouter con input video o image | `google/gemini-2.5-flash-lite` |
| `--low` | booleano; invia `media_resolution: "MEDIA_RESOLUTION_LOW"` | risoluzione default del modello |
| `-h, --help` | | |

Almeno un `-i` è obbligatorio. La domanda è obbligatoria.

## Costruzione della richiesta

Endpoint: `POST https://openrouter.ai/api/v1/chat/completions`.

Un solo messaggio `user`, il cui `content` è un array: prima la domanda come `{"type":"text"}`,
poi un elemento per ogni `-i` nell'ordine in cui è stato passato.

Il tipo di elemento si decide così:

| Sorgente | Riconoscimento | Elemento |
|---|---|---|
| host `youtube.com` o `youtu.be` | host dell'URL | `video_url` con l'URL così com'è |
| altro URL http(s) con estensione video | estensione nel path | `video_url` con l'URL così com'è |
| altro URL http(s) | tutto il resto | `image_url` con l'URL così com'è |
| path locale con estensione video | estensione | `video_url` con data URL base64 |
| path locale con estensione immagine | estensione | `image_url` con data URL base64 |
| path locale con altra estensione | — | errore, exit 1 |

Un URL remoto senza estensione riconoscibile viene trattato come immagine: è il caso comune dei
CDN. Chi ha un video a un URL senza estensione lo scarica e passa il path locale.

Estensioni e MIME:

- immagini: `.png` `image/png`, `.jpg` `.jpeg` `image/jpeg`, `.webp` `image/webp`, `.gif` `image/gif`
- video: `.mp4` `video/mp4`, `.mpeg` `video/mpeg`, `.mov` `video/mov`, `.webm` `video/webm`

`--low` aggiunge `media_resolution: "MEDIA_RESOLUTION_LOW"` al livello top del body. Il valore
è l'enum di Gemini: la stringa `"low"` viene rifiutata con un 400 che elenca i valori ammessi.

Verificato contro l'API live il 2026-07-28: OpenRouter valida e inoltra il parametro, e sullo
stesso video di 9 secondi i token video passano da 2.630 a 710, fattore 3,7. Il link YouTube
viene instradato automaticamente su Google AI Studio, senza bisogno di forzare il provider.

Timeout: 300 secondi. Più alto dei 180 di `bananao` perché l'upload di un video pesante e
l'analisi di un'ora di girato stanno su scale diverse dalla generazione di un'immagine.

## Contratto I/O

- **stdout**: solo il testo della risposta del modello.
- **stderr**: una riga con modello, token di input, token di output e costo.
- **`--out`**: scrive lo stesso testo sul file indicato; stdout resta invariato. Se il file
  esiste viene sovrascritto — a differenza di `bananao`, dove il file è un asset e la perdita
  sarebbe silenziosa, qui il contenuto è riproducibile rilanciando il comando.
- **errore**: stdout vuoto, messaggio su stderr, exit 1. Se non arriva testo, non c'è stata
  nessuna analisi.

## Chiave API

`~/.config/go-peek/config.json`, forma `{"apiKey": "..."}`, chmod 600. Fuori dalla cartella
della skill, che è pubblica e versionata.

Nessun fallback su variabile d'ambiente, e in particolare nessun fallback su
`OPENROUTER_API_KEY` generica: la chiave è dedicata perché la spesa sia isolata sulla dashboard
OpenRouter e la revoca sia chirurgica. Stessa scelta di `bananao`, stesso motivo.

Se manca o è malformata: exit 1 con il comando esatto da eseguire, stampato su stderr. Mai un
prompt interattivo — bloccherebbe l'agente che invoca lo script.

## Guardie e limiti

I due percorsi hanno limiti diversi, e vanno tenuti separati: **i file locali hanno un limite
di peso, gli URL remoti un limite di durata.** Sui secondi ffmpeg non può fare nulla, perché
il file non transita mai da qui.

### File locali: compressione sopra i 10 MB

Un video locale sopra i 10 MB viene ricodificato con ffmpeg in un file temporaneo, e viene
inviato quello. Sotto soglia passa intatto.

Verificato il 2026-07-28: una registrazione schermo di 30 secondi da 42,7 MB produce un body
base64 da 57 MB, e OpenRouter risponde **502 di Cloudflare dopo 100 secondi**, con una pagina
HTML invece di un errore API. È un fallimento lento e opaco: la guardia esiste per non
arrivarci.

Ricodificata a `scale=-2:1280, fps=2, crf 30`, la stessa registrazione pesa 914 KB — 47 volte
meno — e l'analisi riesce, leggendo senza errori il testo fine dell'interfaccia. Gemini
campiona il video a 1 frame al secondo: sopra i 2 fps e oltre i 1280px non c'è nulla che il
modello guardi, quindi la compressione non toglie segnale, toglie solo byte.

Se ffmpeg manca, lo script esce con codice 1 e stampa il comando di installazione. Somma dei
file locali comunque sopra i 10 MB dopo la compressione → errore prima di chiamare l'API.

**Questa è una deroga esplicita alla regola zero-dipendenze del repo**, e va annotata in
`CLAUDE.md` insieme al motivo: senza ffmpeg la skill non è utilizzabile sui file che le
persone hanno davvero, perché le registrazioni schermo stanno quasi tutte sopra soglia.

### URL remoti e YouTube: limite di durata

Nessun limite di peso — l'URL viene passato così com'è e il video non transita da qui.

| Vincolo | Valore |
|---|---|
| durata massima, risoluzione default | ~1 ora |
| durata massima, `--low` | ~3 ore |
| visibilità | solo video pubblici, no unlisted o privati |
| video per richiesta | max 10 (Gemini 2.5+) |

I numeri di durata sono di Google e coincidono con i token misurati: 298 token al secondo a
risoluzione default (266 video + 32 audio) riempiono 1.048.576 token in 59 minuti; 111 al
secondo con `--low` in 2,6 ore.

**Nessun controllo automatico della durata**: leggerla richiederebbe di scaricare il video o
di interrogare l'API di YouTube. Quando l'API risponde con un errore di contesto, lo script
aggiunge al messaggio il suggerimento di rilanciare con `--low`.

Oltre le ~3 ore non esiste soluzione dentro la skill: né OpenRouter né la documentazione
Gemini espongono un modo di ritagliare un intervallo attraverso questa forma di richiesta.
La via d'uscita è scaricare il video, tagliarlo con ffmpeg e passare il file locale.

## Errori

| Uscita | Significato |
|---|---|
| exit 1 + istruzioni di setup | chiave assente o malformata |
| exit 1 + comando di installazione | ffmpeg non trovato nel PATH |
| `HTTP 401` | chiave rifiutata → rigenerare su openrouter.ai/keys |
| `HTTP 402` | credito esaurito, o superato il tetto di spesa della chiave |
| `HTTP 400` con menzione del contesto | video troppo lungo → suggerire `--low` |
| `HTTP 400` altro | media non accettato da quel modello |
| `HTTP 502` con corpo HTML | richiesta troppo pesante: è il fallimento che la compressione evita |
| `nessuna risposta entro 300s` | timeout di rete, riprovare una volta sola |
| input locale ancora sopra i 10 MB dopo la compressione | guardia locale, l'API non viene chiamata |

## Modelli

| Modello | $/M in | $/M out | Quando |
|---|---|---|---|
| `google/gemini-2.5-flash-lite` | 0,10 | 0,40 | default, il più economico che vede video |
| `google/gemini-3.1-flash-lite` | 0,25 | 1,50 | quando il testimone perde dettagli |
| `google/gemini-3.5-flash-lite` | 0,30 | 2,50 | ultimo gradino prima di pagare Claude |

Il video viene campionato a 1 frame al secondo: ~300 token per secondo a risoluzione default,
~100 in bassa. Una singola immagine sono 258 token.

**L'audio del video viene tokenizzato a parte** e `--low` non lo riduce: sul video di prova
sono 292 token per 9 secondi, cioè ~32 al secondo. Vale ~11% in più sull'input rispetto al
solo conteggio dei frame, e in bassa risoluzione diventa la voce dominante. Le stime in
`docs/occhi-economici-per-claude.md` non lo includono.

## Verifica manuale

Il repo non ha infrastruttura di test. La verifica è una checklist da eseguire a mano.

Percorsi di errore, eseguibili senza spendere:

1. Nessun argomento → usage, exit 1.
2. Domanda senza `-i` → errore, exit 1.
3. `-i` con path inesistente → errore che nomina il path, exit 1.
4. `-i` con estensione non supportata → errore che nomina l'estensione, exit 1.
5. Config assente → istruzioni di setup, exit 1.
6. `PATH` senza ffmpeg → comando di installazione, exit 1.
7. In ognuno dei casi sopra: stdout vuoto.

Percorsi che spendono, in ordine di costo crescente:

8. Una immagine locale, domanda semplice → testo su stdout, riga di costo su stderr.
9. Un URL di immagine remoto → stesso risultato.
10. Più immagini in una chiamata → la risposta le distingue.
11. Un video locale breve e sotto i 10 MB → la risposta contiene timestamp, e stderr non
    riporta nessuna compressione.
11b. Un video locale sopra i 10 MB → stderr riporta la compressione con peso prima e dopo, e
    l'analisi riesce. **Già verificato il 2026-07-28** su una registrazione schermo di 30
    secondi: 42,7 MB → 914 KB, $0,0015, testo dell'interfaccia letto correttamente. Senza
    compressione la stessa richiesta prende un 502 dopo 100 secondi.
12. Un link YouTube → funziona. **Già verificato il 2026-07-28**: 9 secondi, $0,0007, provider
    Google AI Studio scelto automaticamente.
13. `--low` sullo stesso video: i token video devono scendere di circa un fattore 3. **Già
    verificato**: 2.630 → 710.

## Fuori scope

Deliberatamente non fanno parte di questa versione:

- **Audio e PDF.** I modelli li accettano, ma non c'è un caso d'uso ora.
- **Estrazione di singoli frame** da un video. La compressione con ffmpeg c'è, il taglio no:
  serve solo a chi ha già deciso quale istante conta, e chi lo sa lo estrae da sé.
- **Download di video da YouTube** per aggirare il limite delle 3 ore. Richiederebbe `yt-dlp`,
  una seconda dipendenza, per un caso che oggi non si presenta.
- **Modalità batch** su una cartella di file. Lo fa già la shell con un `for`.
- **Cache delle descrizioni.** Utile solo se si rianalizzano gli stessi media, cosa che oggi
  non succede.
