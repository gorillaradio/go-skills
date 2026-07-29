---
name: go-scrub
description: Use when the task requires seeing how a UI animation or micro-interaction actually moves — order, duration, easing of 200-400 ms transitions — from a local screen recording. Normal video analysis samples 1 frame per second and reports these as "appears instantly"; this skill slows the video so a cheap model sees every source frame, and returns timings in real milliseconds. For following what happens in a video use go-watch; for a still image use go-glance.
---

# go-scrub

Vede come si muove un'interfaccia, fotogramma per fotogramma. Il modello campiona 1 fotogramma al
secondo, fisso: un'animazione da 200-400 ms a quel passo non esiste. Lo script rallenta il video
con ffmpeg (`setpts`) così che il campionamento raccolga **tutti** i fotogrammi della sorgente,
poi riconverte i tempi della risposta in millisecondi reali.

**Contratto:** stdout = la risposta del modello con i tempi già convertiti in tempo reale
(`[t=417ms]`, `[d=200ms]`). La conversione la fa lo script, mai il modello. Diagnostica su stderr.
Se stdout è vuoto, nessuna analisi: exit 1. L'audio viene sempre rimosso (rallentato non è più
ascoltabile): per il parlato serve una chiamata separata a go-listen.

## Quando NON usarla

| Serve | Usa invece |
|---|---|
| Seguire cosa succede in un video (tutorial, sessione, call) | go-watch |
| Un video lungo — qui il tetto è ~4.000 fotogrammi, cioè ~2,5 min a 24 fps | taglia prima l'interazione con `ffmpeg -ss <inizio> -t <durata>` |
| Un link YouTube o un URL | scaricare il file: il rallentamento richiede il file locale |

## Uso

```bash
node ~/.claude/skills/go-scrub/scrub.mjs "<domanda>" -i <video locale> [--fps <n|max>]
```

```bash
# il caso tipico: un'interazione breve, registrata, tagliata al punto
node ~/.claude/skills/go-scrub/scrub.mjs \
  "descrivi la transizione di apertura del menu: ordine degli elementi, durata di ognuno, easing" \
  -i menu-open.mp4
```

## Opzioni

| Flag | Valori | Default |
|---|---|---|
| `-i, --input <path>` | mp4, mpeg, mov, webm, solo locali | — |
| `--fps <n\|max>` | fotogrammi visti per secondo reale | `max` = frame rate della sorgente |
| `-m, --model <id>` | qualunque modello OpenRouter con input video | `google/gemini-3.1-flash-lite` |

Il default **non** è il `2.5-flash-lite` delle altre skill: verificato che sul localizzare nel
tempo ("quando inizia?") il 2.5 risponde con tempi degeneri — inizio a 0, fine alla durata del
video — qualunque sia la domanda. Il 3.1 localizza al fotogramma esatto e tokenizza i fotogrammi
a ~64 token invece di 258, quindi costa anche meno. Se una risposta riporta tempi che coincidono
con l'inizio o la fine del video, è il segno di quella degenerazione: non fidarti, non è
un'osservazione.

## Fidarsi dei numeri: solo con `max`

**Sotto la risoluzione temporale il modello inventa invece di dichiarare il buco** — osservato:
a `--fps 10` (risoluzione 100 ms) riportava durate di 30-50 ms e ritardi di 5-15 ms, tutti
non osservabili, nonostante il prompt chiedesse di dichiarare i limiti. Regola di lettura:

- con `--fps max` la soglia di confabulazione coincide col limite fisico della sorgente: i numeri
  sono affidabili fino a un fotogramma (42 ms a 24 fps);
- con `--fps <n>` qualunque durata sotto `1000/n` ms va trattata come **non osservata**, anche se
  la risposta la riporta con sicurezza. La precisione è la cosa più facile da simulare.

`--fps <n>` esiste solo per abbassare il costo su video più lunghi. Costo col modello di default:
~64 token per fotogramma, ~1,6 centesimi ogni mille; l'intero tetto di ~4.000 fotogrammi costa
~6 centesimi (il tetto è calcolato prudenzialmente a 258 token/fotogramma).

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
| `X fotogrammi, oltre il tetto` | guardia locale, l'API non è stata chiamata: taglia il video o abbassa `--fps` |
| `N marcatori non convertibili` su stderr | quei tempi sono rimasti in tempo-video: dividili tu per il fattore indicato nella riga di costo |
| `HTTP 401` / `HTTP 402` | chiave rifiutata / credito esaurito |
| `risposta tronca due volte di fila` | il ritentativo automatico è già avvenuto; riprova più tardi |
| `nessuna risposta entro 300s` | timeout di rete, riprova una volta sola |
