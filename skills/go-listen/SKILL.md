---
name: go-listen
description: Use when the task requires a transcript of speech with timestamps and speaker labels — from an audio file, a voice memo, or the audio track of a local video (it gets extracted automatically). Frames are never sent, so an hour costs about 2 cents and up to ~9 hours fit in one call. Not for describing what is visible on screen (go-watch) and not for remote URLs.
---

# go-listen

Trascrive e diarizza l'audio con un modello economico via OpenRouter. Manda **solo audio**: zero
token di fotogrammi, 32 token al secondo. È la via giusta anche sui video lunghi — l'audio regge
~9 ore per chiamata contro l'ora scarsa dei fotogrammi, a ~1,7 centesimi l'ora.

**Contratto:** stdout = solo la trascrizione (o la risposta alla domanda). Diagnostica su stderr.
Se stdout è vuoto, nessuna analisi: exit 1.

## Quando NON usarla

| Serve | Usa invece |
|---|---|
| Cosa si vede sullo schermo | go-watch |
| Un video su YouTube | go-watch (il file non è scaricabile da qui) |
| Un'animazione di UI | go-scrub |

## Uso

```bash
node ~/.claude/skills/go-listen/listen.mjs ["<domanda>"] -i <file audio o video>
```

Senza domanda fa la trascrizione verbatim: timestamp `[mm:ss]`, parlanti etichettati, suoni non
verbali tra parentesi. Con una domanda risponde a quella:

```bash
# trascrizione completa di un video (l'audio viene estratto e ricodificato da solo)
node ~/.claude/skills/go-listen/listen.mjs -i registrazione-call.mp4

# domanda mirata
node ~/.claude/skills/go-listen/listen.mjs \
  "elenca le decisioni prese e chi le ha proposte, con i timestamp" -i standup.m4a
```

Strategia sui video lunghi: prima go-listen sull'audio intero (la spina dorsale del contenuto,
con i timestamp), poi go-watch solo sui segmenti che contano per il visivo.

## Opzioni

| Flag | Valori | Default |
|---|---|---|
| `-i, --input <path>` | qualunque file locale con una traccia audio (mp3, m4a, wav, mp4, mov, …) | — |
| `-m, --model <id>` | qualunque modello OpenRouter con input audio | `google/gemini-2.5-flash-lite` |

## Cautele di lettura

- **Traccia muta = errore, non trascrizione vuota.** Un audio silenzioso spedito al modello
  produce una trascrizione completa, circostanziata e **interamente inventata** (osservato su
  silenzio digitale: venti battute con esitazioni e timestamp al millisecondo). Lo script misura
  il volume prima e rifiuta di spedire una traccia muta.
- La precisione apparente non è affidabilità: timestamp al millisecondo e dettagli minuti sono
  la cosa più facile da simulare. Tratta i timestamp come indicativi al secondo.
- La diarizzazione è dichiarata da Google ma la resa va giudicata caso per caso: su audio con
  parlanti sovrapposti verificane la coerenza prima di costruirci sopra.

## Chiave API

`~/.config/go-skills/config.json`, `{"apiKey": "..."}`, chmod 600 — una sola chiave per tutta la
famiglia go-*. Se manca, lo script esce con codice 1 e stampa il comando esatto per configurarla:
**riportalo all'utente e fermati.** Non inventare una chiave, non chiederla in chat, non cercarla
altrove.

## Errori

| Uscita | Significato |
|---|---|
| exit 1 + istruzioni di setup | chiave assente o malformata |
| exit 1 + comando di installazione | ffmpeg non nel PATH |
| `la traccia audio è muta` | non c'è parlato da trascrivere; qualunque output sarebbe inventato |
| `non ha una traccia audio` | il file è solo video |
| `oltre i 40 MB per chiamata` | più di ~2,7 ore: taglia con `ffmpeg -ss <inizio> -t <durata>`, una chiamata per parte |
| `HTTP 401` / `HTTP 402` | chiave rifiutata / credito esaurito |
| `risposta tronca due volte di fila` | il ritentativo automatico è già avvenuto; riprova più tardi |
| `nessuna risposta entro 300s` | timeout di rete, riprova una volta sola |
