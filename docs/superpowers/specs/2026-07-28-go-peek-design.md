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
| `--fps <n\|max>` | fotogrammi campionati per secondo reale di video; `max` = frame rate della sorgente | `1` |
| `-h, --help` | | |

Almeno un `-i` è obbligatorio. La domanda è obbligatoria. `--low` e `--fps` maggiore di 1
insieme sono ammessi ma contraddittori: uno toglie dettaglio spaziale, l'altro ne aggiunge di
temporale. Lo script non lo impedisce, `SKILL.md` lo sconsiglia.

## Le due modalità

`--fps` non è una manopola con infinite posizioni: separa due usi che non condividono più
niente. Vanno pensati come modalità distinte, e `SKILL.md` deve presentarli così.

| | **normale** | **FBF** |
|---|---|---|
| `--fps` | 1 (default) | `max` |
| audio | **acceso** | tolto |
| rallentamento | nessuno | fino al frame rate sorgente |
| risoluzione temporale | 1 secondo | un fotogramma della sorgente |
| tetto per chiamata | ~3.600 secondi di video | ~4.000 fotogrammi |
| a cosa serve | seguire cosa succede | vedere come si muove |
| tipico | tutorial, registrazione di sessione, call | animazione di UI, micro-interazione |

La modalità normale è il comportamento nativo del modello: non tocchiamo il file, Gemini
campiona a 1 fps e tokenizza la traccia audio insieme ai fotogrammi. È la modalità giusta per
quasi tutto.

FBF esiste solo perché un'animazione di interfaccia dura 200-400 ms ed è invisibile a 1 fps.

**Il nome FBF è riservato a `--fps max`**, quando cioè vediamo davvero ogni fotogramma della
sorgente. I valori intermedi non sono FBF: `--fps 10` su una sorgente a 24 fps ne vede il 42%,
e in quella zona il modello inventa durate sotto la soglia di risoluzione invece di dichiarare
che non vede. Chiamarla "frame by frame" quando non lo è porta a fidarsi di quei numeri —
verificato sul campo il 2026-07-28, vedi sotto.

## FBF: vedere quello che un fotogramma al secondo nasconde

Gemini campiona il video a 1 frame al secondo, punto: non è configurabile e OpenRouter non
espone nessun parametro per cambiarlo. Un'animazione di interfaccia dura 200-400 ms, quindi a
quel campionamento è invisibile per costruzione — il modello la liquida come "appare
istantaneamente", che non è un'osservazione ma un artefatto del campionamento.

La leva è rallentare il video: distribuire 10 secondi su 240 fa sì che il campionamento a 1 fps
ne raccolga 240, cioè tutti quelli che la sorgente contiene. `--fps max` fa esattamente questo.

Il tetto fisico è il frame rate della sorgente: rallentare oltre non aggiunge un solo
fotogramma, duplica quelli che ci sono già e li paga. Per questo `max` esiste — ed è il valore
da usare, perché un numero scritto a mano è giusto solo per quel file.

Meccanica:

1. `ffprobe` legge durata e frame rate reali del video. `max` si risolve nel secondo.
2. Se `durata × n` supera il tetto in fotogrammi, errore prima di spendere, con i numeri in
   chiaro.
3. `ffmpeg` ricodifica con `setpts=<n>*PTS` e `-an`. L'audio viene buttato perché rallentato
   n volte non è più ascoltabile — è l'unico punto dell'intera skill in cui audio e video si
   separano, e lo imponiamo noi. Chi ha bisogno anche del parlato fa due chiamate: vedi
   "Video lunghi".
4. Alla domanda dell'utente lo script aggiunge l'istruzione di marcare ogni istante come
   `[t=<secondi>]` e ogni durata come `[d=<secondi>]`, in tempo-video.
5. Sulla risposta lo script riscrive i marcatori dividendo per `n`, e li stampa in
   millisecondi reali.

**La conversione la fa lo script, non il modello.** Verificato il 2026-07-28: informato del
fattore di rallentamento, `gemini-2.5-flash-lite` sbaglia l'aritmetica — ha scritto "30
secondi reali (6 secondi video)" su un video rallentato 5 volte, dove 6 secondi video sono
1,2 reali. Il modello non deve sapere che il video è rallentato.

Un marcatore malformato viene lasciato intatto e segnalato su stderr: meglio un tempo non
convertito e visibile che una conversione silenziosamente sbagliata.

Guadagno misurato sullo stesso video di 10 secondi a 24 fps, stessa domanda:

| | `--fps 1` | `--fps 5` | `--fps 10` | `--fps max` (24) |
|---|---|---|---|---|
| fotogrammi visti | 10 | 50 | 100 | 240 |
| dei 240 della sorgente | 4% | 21% | 42% | 100% |
| risoluzione temporale | 1 s | 200 ms | 100 ms | 42 ms |
| token video | 2.580 | 12.900 | 25.800 | ~62.000 |
| costo | $0,0016 | $0,0025 | $0,0043 | ~$0,007 |

A `--fps 1` la transizione del contatore risultava "appare istantaneamente"; a `--fps 5`
diventa "scorrimento verticale di ~200 ms con frenata in uscita", che è la descrizione corretta.

### Il modello confabula sotto la risoluzione

Osservato il 2026-07-28 sulla passata a `--fps 10`, dove la risoluzione reale era 100 ms: il
modello ha riportato durate di 30-50 ms, ritardi di 5-15 ms tra un elemento e l'altro, e
timestamp a 11,5 secondi su un video che ne dura 10. Nessuno di quei valori è osservabile; li
ha inventati invece di dichiarare il buco, **nonostante il prompt gli chiedesse esplicitamente
di dichiararlo**.

Conseguenza per `SKILL.md`: ogni durata inferiore a `1/fps` secondi va trattata come non
osservata, e chi legge la risposta deve saperlo. È la ragione per cui `--fps max` è il valore
da preferire — non per il dettaglio in più, ma perché è l'unico in cui la soglia di
confabulazione coincide con il limite fisico della sorgente.

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

### Risposte tronche

Una risposta HTTP 200 non basta a dire che l'analisi è riuscita. Osservato il 2026-07-28: una
richiesta è tornata con testo interrotto a metà frase, `finish_reason` assente, `usage` a zero
e costo zero. Rilanciata identica ha funzionato. Non è un errore di rete e non è un 4xx: è una
risposta formalmente valida e monca, che uno script ingenuo stampa come buona.

Lo script la riconosce da `finish_reason !== "stop"` oppure `usage.prompt_tokens === 0`, e
riprova **una volta sola**. Se anche il secondo tentativo è tronco, esce con codice 1 senza
stampare niente su stdout — coerente con la regola che stdout vuoto significa nessuna analisi.

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

### Il tetto si conta in fotogrammi

L'unità giusta non è il minuto, è il fotogramma: il modello ne guarda uno per volta, e ognuno
costa **258 token** — misurato esatto su due passate indipendenti, 12.900 token per 50
fotogrammi e 25.800 per 100. È lo stesso costo di una singola immagine, il che ha senso: un
fotogramma è un'immagine.

Da lì il tetto si ricava dividendo la context window per il costo di un fotogramma:

| modalità | costo per secondo di video | tetto |
|---|---|---|
| FBF (audio tolto) | 258 × fps | ~4.000 fotogrammi |
| normale (audio acceso) | 258 + 32 = 290 | ~3.600 secondi, cioè ~1 ora |
| normale con `--low` | 79 + 32 = 111 | ~2,5 ore |

Circa **2,6 centesimi ogni mille fotogrammi**. Il tetto lasciato è al netto dello spazio per la
domanda e per una risposta lunga.

**Nessuno di questi numeri va scritto nel codice.** Il frame rate lo dà `ffprobe` sul file, la
context window è un campo che l'API dei modelli espone, e così il tetto si ricalcola da sé se
si cambia modello con `-m`, invece di restare fermo su un valore giusto solo per
`2.5-flash-lite`. L'unica costante è il 258, e anche quella va trattata come stima prudente,
non come legge.

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

**Nessun controllo automatico della durata su questo percorso**: leggerla richiederebbe di
scaricare il video o di interrogare l'API di YouTube. È la differenza con i file locali, dove
`ffprobe` — che arriva con ffmpeg, già obbligatorio — permette di stimare i token prima di
spendere. Quando l'API risponde con un errore di contesto, lo script aggiunge al messaggio il
suggerimento di rilanciare con `--low`.

Oltre le ~3 ore non esiste soluzione dentro la skill: né OpenRouter né la documentazione
Gemini espongono un modo di ritagliare un intervallo attraverso questa forma di richiesta.
La via d'uscita è scaricare il video, tagliarlo con ffmpeg e passare il file locale.

### Video lunghi: taglio e ricucitura

Sui **file locali** il tetto si aggira: `ffmpeg` taglia in segmenti sotto soglia, una chiamata
per segmento, e lo script somma l'offset di inizio ai timestamp di ogni risposta prima di
concatenarle. Sugli URL remoti no, perché il file non passa da qui.

Un segmento non sa niente degli altri, e da lì vengono i due problemi veri:

**Il taglio spezza le frasi.** Qualche secondo di sovrapposizione tra un segmento e il
successivo, e i duplicati si scartano in fase di ricucitura. Da notare che la sovrapposizione
serve al parlato e alle azioni lunghe, non alle animazioni: un video abbastanza lungo da
richiedere il taglio non è mai un'analisi di micro-interazioni. Taglio e FBF non si incontrano
mai.

**Ciò che dura tutto il video viene ridescritto da capo a ogni segmento.** Non c'è ricucitura
meccanica che lo risolva: o la fusione la fa chi legge gli N testi — cioè Claude, che è già lì
per questo — oppure serve un secondo giro sul modello. Lo script concatena e dichiara i
confini; non pretende di sintetizzare.

### La strategia migliore sui video lunghi: due chiamate

Il taglio è il rimedio, non la prima scelta. Su un video lungo conviene sfruttare il fatto che
**l'audio regge molto più del video**: 9,5 ore per richiesta contro l'ora scarsa dei fotogrammi,
a 32 token al secondo contro 258.

Quindi:

1. Una chiamata sul solo audio, intero, senza tagli. Ne esce una trascrizione continua con
   timestamp, diarizzazione dei parlanti e suoni non verbali — la spina dorsale del contenuto,
   senza confini artificiali e senza problema di fusione.
2. Guidati da quei timestamp, una o poche chiamate video sui soli segmenti che contano
   davvero per il visivo.

Un'ora di audio costa ~1,7 centesimi. È la parte a buon mercato, e regge il filo del discorso
che il taglio del video spezzerebbe.

**Verificato il 2026-07-28.** La traccia estratta con ffmpeg in mp3 e inviata come
`{"type":"input_audio","input_audio":{"data":"<base64>","format":"mp3"}}` passa senza problemi:
su 30 secondi di parlato, `video_tokens` a **zero** e 775 token audio. È il punto che regge
tutta la strategia — mandando la sola traccia non si paga un solo fotogramma.

I timestamp escono in formato SRT **con i millisecondi** (`0:00:00.911 --> 0:00:01.871`), non
in MM:SS come dichiara la documentazione Google. Per sincronizzare sottotitoli è più che
sufficiente: l'idea che serva un ASR dedicato sotto il secondo va abbandonata, almeno a
livello di segmento.

Su una trascrizione **il costo è dominato dall'output**, non dall'input: 815 token in ingresso
contro ~4.250 in uscita nella prova. Un'ora di audio costa quindi ~1,7 centesimi, non 1,2.

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
| risposta tronca due volte di fila | vedi "Risposte tronche" |
| `durata × --fps` oltre il tetto di contesto | guardia locale via ffprobe, l'API non viene chiamata |
| `nessuna risposta entro 300s` | timeout di rete, riprovare una volta sola |
| input locale ancora sopra i 10 MB dopo la compressione | guardia locale, l'API non viene chiamata |

## Modelli

| Modello | $/M in | $/M out | Quando |
|---|---|---|---|
| `google/gemini-2.5-flash-lite` | 0,10 | 0,40 | default, il più economico che vede video |
| `google/gemini-3.1-flash-lite` | 0,25 | 1,50 | quando il testimone perde dettagli |
| `google/gemini-3.5-flash-lite` | 0,30 | 2,50 | ultimo gradino prima di pagare Claude |

Il video viene campionato a 1 frame al secondo, e un fotogramma costa 258 token a risoluzione
default, ~79 in bassa — gli stessi 258 di una singola immagine.

**L'audio viaggia col video senza che nessuno lo chieda.** Mandando un mp4, Gemini tokenizza
fotogrammi e traccia audio nella stessa richiesta: è il motivo per cui ogni prova riportava
token audio che non avevamo domandato, 292 sul video di YouTube e 775 sulla registrazione
schermo. Costa 32 token al secondo, `--low` non lo riduce, e l'unico modo di non pagarlo è
toglierlo noi con ffmpeg — cosa che facciamo solo in FBF.

Non è un sottoprodotto: Gemini fa trascrizione verbatim con timestamp al millisecondo in
formato SRT, diarizzazione dei parlanti, riconoscimento di suoni non verbali e del tono. Regge
9,5 ore per richiesta contro l'ora scarsa del video, e un'ora costa ~1,7 centesimi. Per
confronto, Whisper via API di OpenAI costa 36 centesimi l'ora: una pipeline audio separata ha
senso solo in locale, e non per risparmiare.

Una parte di **solo audio** si invia come `input_audio` e non costa nessun fotogramma —
verificato, vedi "Video lunghi".

Le stime in `docs/occhi-economici-per-claude.md` includono l'audio; quelle dell'articolo di
partenza no.

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
14. `--fps 5` su un video con animazioni di interfaccia: i token video salgono di ~5 volte e la
    risposta descrive transizioni che a `--fps 1` risultavano istantanee. **Già verificato il
    2026-07-28** su un video di 10 secondi: 2.580 → 12.900 token, e la transizione del
    contatore passa da "appare istantaneamente" a "scorrimento verticale di ~200 ms".
15. `--fps 5` su un video di 15 minuti → guardia via ffprobe, nessuna chiamata di rete.
16. Marcatori `[t=]` e `[d=]` riscritti correttamente: un `[d=1.0]` in un video a `--fps 5`
    deve uscire come 200 ms.
17. `--fps max` su una sorgente di frame rate noto: i fotogrammi analizzati devono coincidere
    con `nb_frames` di ffprobe. Sul video di prova a 24 fps sono 240.
18. Parte di solo audio via `input_audio`. **Già verificato il 2026-07-28** su 30 secondi di
    parlato: `video_tokens` a zero, 775 token audio, $0,0018, trascrizione con timestamp al
    millisecondo.
19. Taglio e ricucitura su un file locale oltre il tetto: gli offset dei timestamp del secondo
    segmento devono essere sommati correttamente, e i confini dichiarati nell'output.

## Fuori scope

Deliberatamente non fanno parte di questa versione:

- **PDF.** I modelli lo accettano, ma non c'è un caso d'uso ora.
- **Sintesi automatica dei segmenti** dopo il taglio. Lo script concatena e dichiara i confini;
  fondere i pezzi in un racconto unico lo fa chi legge, che è già Claude.
- **Estrazione di singoli frame** da un video. La compressione e il rallentamento con ffmpeg ci
  sono, il taglio a un istante no: serve a chi ha già deciso quale istante conta, e chi lo sa
  lo estrae da sé.
- **Download di video da YouTube** per aggirare il limite delle 3 ore. Richiederebbe `yt-dlp`,
  una seconda dipendenza, per un caso che oggi non si presenta.
- **Modalità batch** su una cartella di file. Lo fa già la shell con un `for`.
- **Cache delle descrizioni.** Utile solo se si rianalizzano gli stessi media, cosa che oggi
  non succede.
