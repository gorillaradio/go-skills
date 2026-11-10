---
name: go-watch
description: Use when the task requires knowing what happens in a video — a screen recording, a tutorial, a demo, a recorded call, or a public YouTube link — including what is said on the audio track. Also use when the user wants a long YouTube video turned into a readable article they can read instead of watching. Claude has no video input; this delegates the watching to a cheap model and returns text. Not for frame-precise UI animation timing (go-scrub) and not for transcribing long audio (go-listen).
---

# go-watch

Due modi, che rispondono a due domande diverse.

| Domanda | Modo | Comando |
|---|---|---|
| "cosa succede in questo video?" | **diretto** | `watch.mjs "<domanda>" -i <video>` |
| "trasformami questo video in un articolo che leggo al posto di guardarlo" | **articolo** | `watch.mjs prep` → capitoli → `watch.mjs extract` → sintesi |

Il modo diretto è una chiamata sola su tutto il video. Il modo articolo guarda solo i
capitoli che lo meritano, ed è l'unico praticabile sopra i dieci minuti.

**Contratto:** stdout = il risultato utile. Diagnostica (token, tempo, capitoli saltati)
su stderr.

## Quando NON usarla

| Serve | Usa invece |
|---|---|
| Durate ed easing di un'animazione di UI (200-400 ms sono invisibili a 1 fps) | go-scrub |
| Solo la trascrizione del parlato | go-listen sull'audio |
| Un'immagine ferma | go-glance |
| Leggere con certezza testo piccolo a schermo — versioni, URL, output di terminale | go-scrub sui fotogrammi |

**Il testo piccolo a schermo viene sbagliato, e in modo plausibile.** Sullo stesso segmento
i modelli hanno letto `0.4.3` e `49.2` dove il fotogramma dice `1.49.2`, e hanno inventato
un URL. Non è un buco che si nota: è un numero verosimile che entra nell'articolo come
fatto. Se una versione o un comando contano davvero, vanno verificati sul fotogramma.

---

# Modo diretto

```bash
node ~/.claude/skills/go-watch/watch.mjs "<domanda>" -i <path|url|youtube> [--low] [-m modello]
```

Un secondo di video costa ~290 token (258 il fotogramma + 32 l'audio), ~111 con `--low`.
Nel contesto stanno ~1 ora di video, ~2,5 con `--low`.

**Ma il tetto di contesto non è il vero limite: lo è la diluizione.** Su un video da
10 minuti con una domanda specifica, la passata unica ha risposto che l'argomento non
veniva mai trattato — mentre c'era un capitolo intero dedicato. Sopra i dieci minuti,
o quando la domanda riguarda un punto preciso, passa al modo articolo.

File locali: sopra i 10 MB lo script comprime con ffmpeg; una traccia audio muta viene
rimossa (lasciata dentro fa inventare al modello una trascrizione); se la stima supera
il contesto si ferma **prima** di spendere.

---

# Modo articolo

Quattro passi. Due sono script, due li fai tu — non perché non siano automatizzabili, ma
perché segmentare e scrivere è esattamente il lavoro per cui l'utente paga già un modello
di frontiera. A Gemini si paga solo ciò che nessun altro può fare: guardare.

**I quattro passi li esegui di fila, senza fermarti.** Per l'utente questa resta una
richiesta sola: non riportargli i comandi da lanciare e non chiedere conferma fra un passo
e l'altro. Ti fermi solo se manca una chiave o se un capitolo viene rifiutato.

## 1. Prep — metadati, capitoli, trascrizione

```bash
node ~/.claude/skills/go-watch/watch.mjs prep "https://www.youtube.com/watch?v=XXXX" [--subs]
```

Scarica metadati e traccia audio — mai il video — in `/tmp/go-watch-<id>/`, fa trascrivere
l'audio da go-listen e stampa titolo, durata, capitoli dell'autore se ci sono, e il percorso
della trascrizione timestampata.

La trascrizione viene dall'audio, non dai sottotitoli automatici di YouTube: costa qualche
centesimo all'ora e in cambio ha punteggiatura, termini tecnici giusti e parlanti separati.
Con `--subs` si torna ai sottotitoli, che sono gratis ma peggiori; è anche il ripiego
automatico se l'audio non si scarica.

**Senza yt-dlp, o con YouTube che lo blocca** (dagli IP dei datacenter, cioè negli ambienti
cloud, chiede subito *"Sign in to confirm you're not a bot"*), `prep` non si ferma: prende
titolo, durata e capitoli dalla YouTube Data API v3 e fa trascrivere l'audio a Gemini
direttamente dall'URL, a pezzi da 10 minuti (~29 token/s, ~105k token l'ora). La Data API
usa il campo `youtubeKey` del config, o in mancanza la `geminiKey`: nel progetto Google
della chiave dev'essere attiva la "YouTube Data API v3". Il resto della pipeline non cambia.

**Tutto quello che scarica resta nella cartella e viene riusato.** Non è per la velocità: a
forza di rilanci YouTube risponde `429`, poi *"Sign in to confirm you're not a bot"*, e la
pipeline si ferma al primo passo. Se devi rifare delle prove sullo stesso video, lavora sui
file già scaricati.

## 2. Capitoli — li ricavi tu

Se `chapters-authored.json` esiste, **parti da quello**: l'autore li ha scritti sapendo
com'è strutturato il video. Ma sono una base, non un risultato — servono anche a farsi
trovare nella barra del player, quindi capita di trovarci voci promozionali da saltare e
blocchi da un quarto d'ora che contengono tre argomenti. Verifica sulla trascrizione, e
spezza o fondi dove serve. Poi aggiungi i due campi.

Se non ci sono, leggi `transcript.txt` e ricavali. Su un video da 44 minuti sono ~12k
token di lettura, e i confini vengono a 1-5 secondi da quelli veri. Segnali utili:
i cambi di argomento nel parlato, e — sui video con schermate — i cambi di scena, che
trovi gratis con `ffmpeg -i seg.mp4 -vf "select='gt(scene,0.3)',showinfo" -f null -`.

Scrivi `chapters.json` nella cartella di lavoro:

```json
[
  {"start": 0, "end": 112, "title": "Intro", "visual": false, "skippable": false},
  {"start": 112, "end": 168, "title": "Sponsor", "visual": false, "skippable": true},
  {"start": 168, "end": 335, "title": "I benchmark", "visual": true, "skippable": false}
]
```

- `skippable` — sponsor, autopromozione, inviti a iscriversi. Solo roba oggettivamente
  estranea al contenuto: uno `skippable` non lascia traccia nemmeno come trascrizione, e
  una digressione che ti sembra inutile può essere il pezzo che interessa a chi legge.
  Nel dubbio, `false` e `visual: false`: costa zero.
- `visual` — serve vedere lo schermo (codice, demo, UI, grafici) oppure basta il parlato.
  Nel dubbio su un video divulgativo, `false`: per una faccia che parla i fotogrammi non
  aggiungono niente e costano ~91 token al secondo.

Copri tutta la durata senza buchi: un buco è contenuto che sparisce senza che nessuno lo
dica. Lo script avverte se ne trova, ma non li chiude al posto tuo. Un capitolo `visual`
sopra i ~50 minuti viene rifiutato: spezzalo.

## 3. Extract — un estratto per capitolo

```bash
node ~/.claude/skills/go-watch/watch.mjs extract "https://www.youtube.com/watch?v=XXXX" /tmp/go-watch-XXXX
```

Scrive un file per capitolo in `extracts/`. I capitoli `skippable` non costano niente,
quelli non `visual` vengono risolti dalla trascrizione, gli altri vanno a Gemini con gli
offset. Rilanciare non rispende: i file già presenti sono cache (`--force` per rifare).

**La cache guarda solo il nome del file.** Se cambi i confini di un capitolo, il modello o
`--fps` e vuoi rifarlo, serve `--force`: altrimenti ti riprende l'estratto vecchio. Gli
estratti rimasti orfani da un `chapters.json` rivisto vengono invece cancellati da soli.

Opzioni: `-m <modello>` (default `gemini-flash-latest`), `--fps N` (default 1.0, range
fino a 24 — alzarlo serve solo se a schermo compaiono cose che durano meno di un secondo).

## 4. Articolo — lo scrivi tu

Leggi tutti i file in `extracts/`, più `info.json` (titolo, canale, durata) e
`chapters.json` (i range saltati). Poi scrivi l'articolo con questo prompt.

```
Hai in input gli estratti di un video, capitolo per capitolo, più la trascrizione dei
capitoli che non è servito guardare. Non hai visto il video: quella è l'unica fonte.

Scrivi un articolo in italiano su ciò di cui il video parla.

Un articolo, non un resoconto del video. Chi legge vuole sapere le cose, non sapere
cosa è successo al minuto sette. Non scrivere mai "nel video", "l'autore mostra",
"successivamente": scrivi la cosa. La sola eccezione sono le opinioni e le esperienze
personali, che vanno attribuite perché senza attribuzione diventerebbero false.

## L'ossatura la detta l'argomento, non la scaletta

I capitoli servono a te per non perdere pezzi, non al lettore. Segui il filo del discorso:
metti vicine le cose che vanno insieme anche se nel video sono lontane, fondi in un'unica
sezione i capitoli che sono un solo ragionamento spezzato in due, e spezza un capitolo che
contiene due argomenti distinti. I titoli delle sezioni li scrivi tu, dicono cosa c'è
dentro, e non ricalcano quelli dei capitoli.

Metti i timestamp perché chi vuole andare a vedere sappia dove: uno accanto al titolo se la
sezione viene da un punto solo, altrimenti in fondo alla sezione, tutti quelli che servono.
Sono un riferimento, non la struttura: se ti accorgi che stai scegliendo dove tagliare le
sezioni per averne uno solo per titolo, stai lasciando che sia la scaletta a comandare.

## Si deve leggere

Prosa distesa, frasi che si legano. Un elenco puntato solo dove il contenuto è davvero un
elenco: comandi, opzioni, specifiche. Se stai per scrivere tre punti elenco di fila che
sono in realtà un ragionamento, quello è un paragrafo.

Apri entrando nel merito, non annunciando l'argomento. Chiudi quando le cose sono dette:
nessun paragrafo di conclusione che ripete quanto sopra.

## Prima dell'articolo

Un blocco di intestazione:

    # {titolo del tuo articolo}
    *Da {titolo del video} — {canale}, {durata}*

Poi due o tre righe che dicono di cosa si tratta e se vale la pena, così chi legge decide
in dieci secondi. Poi, solo se serve:

- **Da vedere davvero:** i timestamp che gli estratti dichiarano non rendibili a parole.
  Non indovinarli: tu il video non l'hai visto. Se nessun estratto lo dice, la riga non si
  scrive — ed è il caso normale.
- **Sponsor:** i range da saltare, se ci sono.

## Cosa entra e cosa no

Entra ogni informazione: numeri, versioni, prezzi, comandi, URL, percorsi. I comandi e
l'output del terminale verbatim in blocchi di codice, mai parafrasati. E il perché delle
cose: se una cosa non funziona e viene spiegato il motivo, il motivo è l'informazione.

Non entrano saluti, sponsor, inviti a iscriversi, esitazioni, riformulazioni della stessa
frase, e le anticipazioni: se annuncia che tra poco mostrerà una cosa, scrivi la cosa e
butta l'annuncio. Se qualcosa è detto tre volte, va scritto una volta sola, nel punto
dell'articolo in cui serve.

## Fatti, opinioni, incertezze

I fatti verificabili si scrivono asciutti. Le valutazioni si attribuiscono. Le incertezze
dichiarate restano tali: se ammette di non aver provato qualcosa, quella riga vale quanto
le altre. Se due parti si contraddicono, dillo invece di scegliere tu quale vale.

## Divieti

Non aggiungere niente che non sia negli estratti, nemmeno se lo sai per certo. Non
completare un comando che sembra troncato. Se un estratto segnala qualcosa come illeggibile,
quell'incertezza va conservata.

## Lunghezza

Nessun bersaglio. L'articolo è finito quando le informazioni sono esaurite. Il criterio è
che ogni frase porti qualcosa che non c'era già nella frase prima: se la togli e non si
perde niente, andava tolta. Un video lungo e povero fa un articolo corto, ed è giusto così.
```

## Cosa aspettarsi

Su un video da 44 minuti senza capitoli: 12k token per la segmentazione, 225k per gli
undici capitoli guardati, 7 minuti e mezzo di chiamate in sequenza. Due capitoli risolti
dalla sola trascrizione e uno sponsor saltato, cioè quasi quattro minuti di video mai
pagati. Ne è uscito un articolo da sei minuti di lettura.

---

## Chiavi API

Entrambe in `~/.config/go-skills/config.json`, chmod 600:

| Campo | Serve per | Se manca |
|---|---|---|
| `geminiKey` | modo articolo (API Google diretta) | ripiega su OpenRouter ritagliando i segmenti con yt-dlp |
| `apiKey` | modo diretto (OpenRouter) e ripiego | il modo diretto non funziona |

Il ripiego funziona (provato), ma ignora `--fps` e deve caricare il segmento intero: sopra
gli ~8 minuti sfonda i 40 MB e la guardia lo ferma prima di scaricare. È un paracadute, non
un'alternativa.

Se una chiave manca lo script esce con codice 1 e stampa il comando esatto per
configurarla: **riportalo all'utente e fermati.** Non inventare una chiave, non chiederla
in chat, non cercarla altrove.

Il free tier Google basta per l'uso normale, ma **i dati inviati vengono usati per
migliorare i prodotti Google**. Per video YouTube pubblici è irrilevante; se un giorno la
pipeline venisse puntata su registrazioni private, non lo è.

## Errori

| Uscita | Significato |
|---|---|
| exit 1 + istruzioni di setup | chiave assente o malformata |
| exit 1 + comando di installazione | `ffmpeg` o `yt-dlp` non nel PATH |
| `nessun sottotitolo disponibile` | senza trascrizione non si ricavano capitoli: go-listen, o modo diretto se è corto |
| `HTTP 404` sul modello | quel modello non è più servito ai nuovi account: usa `gemini-flash-latest` |
| `HTTP 429` | quota del free tier esaurita (i modelli "pro" spesso non ne hanno affatto) |
| `HTTP 503` | modello sotto carico: il ritentativo è già avvenuto, riprova più tardi |
| `capitolo troppo lungo` | guardia locale, l'API non è stata chiamata: spezza il capitolo |
| `risposta incompleta (finishReason=…)` | l'estratto sarebbe stato troncato a metà: `MAX_TOKENS` vuole un capitolo più corto, gli altri un altro tentativo |
| `ATTENZIONE: … scoperti` | buco fra due capitoli: contenuto che sparirebbe in silenzio, chiudilo |
