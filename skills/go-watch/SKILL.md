---
name: go-watch
description: Use when the task requires knowing what happens in a video — a screen recording, a tutorial, a demo, a recorded call, or a public YouTube link — including what is said on the audio track. Claude has no video input; this delegates the watching to a cheap model and returns a text account. Not for frame-precise UI animation timing (go-scrub) and not for transcribing long audio (go-listen).
---

# go-watch

Racconta il contenuto di un video, audio incluso, con un modello economico via OpenRouter.
Il modello campiona **1 fotogramma al secondo** (fisso, non configurabile) e ascolta la traccia
audio: va benissimo per seguire cosa succede, non per misurare come si muove.

**Contratto:** stdout = solo la risposta del modello. Diagnostica (compressione, audio muto,
token, costo) su stderr. Se stdout è vuoto, nessuna analisi: exit 1.

## Quando NON usarla

| Serve | Usa invece |
|---|---|
| Durate ed easing di un'animazione di UI (200-400 ms sono invisibili a 1 fps) | go-scrub |
| Solo la trascrizione del parlato, o un video oltre l'ora | go-listen sull'audio |
| Un'immagine ferma | go-glance |

## Uso

```bash
node ~/.claude/skills/go-watch/watch.mjs "<domanda>" -i <path|url|youtube> [opzioni]
```

```bash
# registrazione schermo: chiedi timestamp, li restituisce
node ~/.claude/skills/go-watch/watch.mjs \
  "elenca i passi dell'utente con timestamp, e trascrivi ogni messaggio di errore" -i rec.mov

# YouTube (solo video pubblici; il file non transita da qui)
node ~/.claude/skills/go-watch/watch.mjs "di cosa parla e quali demo mostra?" -i https://youtu.be/XXXX
```

## Opzioni

| Flag | Valori | Default |
|---|---|---|
| `-i, --input <path\|url>` | mp4, mpeg, mov, webm; URL http(s); link YouTube. Uno solo. | — |
| `--low` | riduce i token video di ~3× (`MEDIA_RESOLUTION_LOW`); l'audio non cambia | risoluzione default |
| `-m, --model <id>` | qualunque modello OpenRouter con input video | `google/gemini-2.5-flash-lite` |

## Limiti e costi

Un secondo di video costa ~290 token (258 il fotogramma + 32 l'audio), ~111 con `--low`.
Nel contesto stanno quindi **~1 ora di video** a risoluzione default, **~2,5 ore con `--low`**.
Un'ora costa ~10 centesimi, ~4 con `--low`.

- **File locali:** sopra i 10 MB lo script comprime da solo con ffmpeg (a 1 fps di campionamento
  la compressione toglie byte, non segnale). Una traccia audio muta viene rilevata e rimossa
  prima di spedire — lasciata dentro fa inventare al modello una trascrizione. Se il video supera
  il tetto, lo script si ferma **prima** di spendere.
- **URL e YouTube:** nessun limite di peso ma nessuna guardia preventiva sulla durata (il file
  non transita da qui). Se l'API risponde che il contesto è pieno, riprova con `--low`.

**Video oltre il tetto: due chiamate, non il taglio.** L'audio regge ~9 ore contro l'ora scarsa
dei fotogrammi. Prima `go-listen` sull'audio intero (trascrizione continua con timestamp), poi
`go-watch` con `ffmpeg -ss <inizio> -t <durata>` sui soli segmenti che contano per il visivo.

## Chiave API

`~/.config/go-skills/config.json`, `{"apiKey": "..."}`, chmod 600 — una sola chiave per tutta la
famiglia go-*. Se manca, lo script esce con codice 1 e stampa il comando esatto per configurarla:
**riportalo all'utente e fermati.** Non inventare una chiave, non chiederla in chat, non cercarla
altrove.

## Errori

| Uscita | Significato |
|---|---|
| exit 1 + istruzioni di setup | chiave assente o malformata |
| exit 1 + comando di installazione | ffmpeg non nel PATH (serve solo per i file locali) |
| stima token oltre il tetto | guardia locale, l'API non è stata chiamata: segui il suggerimento stampato |
| `HTTP 400` che menziona il contesto | video remoto troppo lungo → `--low`, o strategia a due chiamate |
| `HTTP 401` / `HTTP 402` | chiave rifiutata / credito esaurito |
| `risposta tronca due volte di fila` | il ritentativo automatico è già avvenuto; riprova più tardi |
| `nessuna risposta entro 300s` | timeout di rete, riprova una volta sola |
