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
  peek.mjs     # CLI eseguibile, zero dipendenze, Node 18+
```

Stessa forma di `skills/bananao/`.

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
| `--low` | nessuno, è un booleano; invia `media_resolution: "low"` | risoluzione default del modello |
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

`--low` aggiunge `media_resolution: "low"` al livello top del body. Il parametro è nativo di
Gemini e non è documentato da OpenRouter, che però dichiara di inoltrare anche parametri fuori
dalla propria lista. **Non verificato** — vedi "Verifica manuale".

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

**Somma dei file locali oltre 20 MB → errore prima di chiamare l'API.** Il limite di Google è
sull'intera richiesta inline, non sul singolo file, e il base64 gonfia del 33%. Il messaggio
suggerisce di tagliare o comprimere il video, o di passare meno immagini per chiamata.

**Durata del video: nessun controllo automatico.** Servirebbe `ffprobe`, cioè una dipendenza
esterna, contro la regola del repo. La regola operativa sta in `SKILL.md`: oltre ~50 minuti
serve `--low`, perché a risoluzione default un'ora fa ~1.080.000 token contro una context
window di 1.048.576. Quando l'API risponde con un errore di contesto, lo script aggiunge al
messaggio il suggerimento di rilanciare con `--low`.

## Errori

| Uscita | Significato |
|---|---|
| exit 1 + istruzioni di setup | chiave assente o malformata |
| `HTTP 401` | chiave rifiutata → rigenerare su openrouter.ai/keys |
| `HTTP 402` | credito esaurito, o superato il tetto di spesa della chiave |
| `HTTP 400` con menzione del contesto | video troppo lungo → suggerire `--low` |
| `HTTP 400` altro | media non accettato da quel modello |
| `nessuna risposta entro 300s` | timeout di rete, riprovare una volta sola |
| input locale oltre 20 MB complessivi | guardia locale, l'API non viene chiamata |

## Modelli

| Modello | $/M in | $/M out | Quando |
|---|---|---|---|
| `google/gemini-2.5-flash-lite` | 0,10 | 0,40 | default, il più economico che vede video |
| `google/gemini-3.1-flash-lite` | 0,25 | 1,50 | quando il testimone perde dettagli |
| `google/gemini-3.5-flash-lite` | 0,30 | 2,50 | ultimo gradino prima di pagare Claude |

Il video viene campionato a 1 frame al secondo: ~300 token per secondo a risoluzione default,
~100 in bassa. Una singola immagine sono 258 token.

## Verifica manuale

Il repo non ha infrastruttura di test. La verifica è una checklist da eseguire a mano.

Percorsi di errore, eseguibili senza spendere:

1. Nessun argomento → usage, exit 1.
2. Domanda senza `-i` → errore, exit 1.
3. `-i` con path inesistente → errore che nomina il path, exit 1.
4. `-i` con estensione non supportata → errore che nomina l'estensione, exit 1.
5. File locali per un totale sopra i 20 MB → guardia, nessuna chiamata di rete.
6. Config assente → istruzioni di setup, exit 1.
7. In ognuno dei casi sopra: stdout vuoto.

Percorsi che spendono, in ordine di costo crescente:

8. Una immagine locale, domanda semplice → testo su stdout, riga di costo su stderr.
9. Un URL di immagine remoto → stesso risultato.
10. Più immagini in una chiamata → la risposta le distingue.
11. Un video locale breve (< 30s) → la risposta contiene timestamp.
12. Un link YouTube → funziona, e conferma il provider Google AI Studio.
13. **`--low` sullo stesso video del punto 11**: confrontare i token di input riportati su
    stderr con e senza il flag. Attesa: circa un terzo. Se il numero non cambia, OpenRouter non
    inoltra `media_resolution` — in quel caso rimuovere il flag e documentare in `SKILL.md` che
    i video oltre ~50 minuti non sono analizzabili.

## Fuori scope

Deliberatamente non fanno parte di questa versione:

- **Audio e PDF.** I modelli li accettano, ma non c'è un caso d'uso ora.
- **Estrazione di frame con ffmpeg.** Aggiungerebbe una dipendenza esterna.
- **Modalità batch** su una cartella di file. Lo fa già la shell con un `for`.
- **Cache delle descrizioni.** Utile solo se si rianalizzano gli stessi media, cosa che oggi
  non succede.
