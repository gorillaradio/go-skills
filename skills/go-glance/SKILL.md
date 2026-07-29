---
name: go-glance
description: Use when the task requires knowing what an image shows — a screenshot, a photo, a mockup, an exported diagram, or a whole folder of images — and reading it directly would cost frontier-model vision tokens on every following turn. Delegates the looking to a cheap model and returns text. Not for videos (go-watch, go-scrub) and not for generating images (bananao).
---

# go-glance

Guarda immagini con un modello economico via OpenRouter e restituisce testo. Tu ragioni sul testo:
l'immagine non entra mai nella conversazione, quindi non viene ripagata a ogni turno.

**Contratto:** stdout = solo la risposta del modello. Modello, token e costo su stderr. Se stdout è
vuoto, non c'è stata nessuna analisi: exit 1 e messaggio su stderr.

## Quando NON usarla

| Serve | Usa invece |
|---|---|
| Capire cosa succede in un video | go-watch |
| Misurare un'animazione di UI | go-scrub |
| Generare un'immagine | bananao |
| Un dettaglio che richiede il massimo della vista | leggere l'immagine direttamente, pagandola |

## Uso

```bash
node ~/.claude/skills/go-glance/glance.mjs "<domanda>" -i <path|url|cartella> [-i ...]
```

```bash
# uno screenshot
node ~/.claude/skills/go-glance/glance.mjs "che errore mostra questa schermata? trascrivi il testo esatto" -i shot.png

# confronto tra più immagini (vengono etichettate col nome file)
node ~/.claude/skills/go-glance/glance.mjs "quale delle due ha più contrasto sul bottone primario?" -i a.png -i b.png

# una cartella intera (non ricorsiva, in ordine alfabetico)
node ~/.claude/skills/go-glance/glance.mjs "una riga di descrizione per ognuna" -i ./screenshots/
```

La domanda determina la qualità della risposta: chiedi cose specifiche e verificabili ("trascrivi il
testo del dialogo", "che colore ha la barra?"), non "descrivi l'immagine".

## Opzioni

| Flag | Valori | Default |
|---|---|---|
| `-i, --input <path\|url\|dir>` | png, jpg, webp, gif; URL http(s); cartella. Ripetibile. | — |
| `-m, --model <id>` | qualunque modello OpenRouter con input immagine | `google/gemini-2.5-flash-lite` |

Un'immagine costa ~258 token (~$0,00003): il costo è trascurabile, il punto è tenerla fuori dal
tuo contesto. I file locali sommati non possono superare i 40 MB per chiamata.

## Chiave API

`~/.config/go-skills/config.json`, `{"apiKey": "..."}`, chmod 600 — una sola chiave per tutta la
famiglia go-*. Se manca, lo script esce con codice 1 e stampa il comando esatto per configurarla:
**riportalo all'utente e fermati.** Non inventare una chiave, non chiederla in chat, non cercarla
altrove.

## Errori

| Uscita | Significato |
|---|---|
| exit 1 + istruzioni di setup | chiave assente o malformata |
| `HTTP 401` | chiave rifiutata → l'utente la rigenera su openrouter.ai/keys |
| `HTTP 402` | credito OpenRouter esaurito |
| `risposta tronca due volte di fila` | il ritentativo automatico è già avvenuto; riprova più tardi |
| `nessuna risposta entro 300s` | timeout di rete, riprova una volta sola |
