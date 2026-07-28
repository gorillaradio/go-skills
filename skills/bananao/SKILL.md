---
name: bananao
description: Use when the task needs a raster image that does not exist yet — a hero or section background, a placeholder photo, a texture, an avatar, an illustration, an OG or social card, a mockup asset — or when an existing image must be restyled, extended, or composited from reference images. Not for diagrams, flowcharts, data charts, or icons that belong in SVG.
---

# bananao

Genera immagini via OpenRouter e le scrive su disco. Uno script CLI, zero dipendenze, Node 18+.

**Contratto:** lo script stampa **solo il path assoluto del file** su stdout. Modello e costo vanno su
stderr. Dove collocare il file nel progetto è una decisione tua, non della skill: passa `--out` con il
path che serve.

## Quando NON usarla

| Serve | Usa invece |
|---|---|
| Diagrammi, flowchart, architetture | Mermaid o SVG a mano |
| Grafici di dati | Una libreria di charting |
| Icone | Un set esistente (lucide, heroicons) o SVG |
| Un'immagine già presente nel progetto | Il file che c'è già |

Ogni chiamata costa denaro reale (~$0.06 con il modello di default). Non rigenerare per iterare sul
CSS: genera una volta, poi lavora sul file.

## Uso

```bash
node ~/.claude/skills/bananao/generate-image.mjs "<prompt>" [opzioni]
```

Il prompt è posizionale. Descrivi soggetto, stile, luce e composizione — i prompt vaghi danno
risultati generici.

```bash
# background per una hero section
node ~/.claude/skills/bananao/generate-image.mjs \
  "paesaggio montano all'alba, nebbia bassa nelle valli, toni freddi, fotografia" \
  --aspect-ratio 21:9 --resolution 2K --out public/img/hero-mountains.png
```

Cattura il path per usarlo subito:

```bash
IMG=$(node ~/.claude/skills/bananao/generate-image.mjs "texture di carta riciclata, macro" -a 1:1 -o src/assets/paper.png)
```

## Opzioni

| Flag | Valori | Default |
|---|---|---|
| `-o, --out <path>` | path del file; le cartelle mancanti vengono create | `<slug-del-prompt>.png` nella cwd |
| `-a, --aspect-ratio <ar>` | `1:1` `1:4` `1:8` `2:3` `3:2` `3:4` `4:1` `4:3` `4:5` `5:4` `8:1` `9:16` `16:9` `21:9` | scelta del modello |
| `-s, --resolution <r>` | `512` `1K` `2K` `4K` (alias `--size`) | scelta del modello |
| `-m, --model <id>` | vedi sotto | `google/gemini-3.1-flash-image` |
| `-i, --input <path\|url>` | immagine di riferimento, ripetibile, max 14 | nessuna |

Senza `--out` il nome viene dallo slug del prompt e non sovrascrive mai: se il file esiste aggiunge
`-2`, `-3`, ecc.

## Editing e riferimenti

`--input` passa immagini esistenti al modello. Accetta path locali (png, jpg, webp, gif) e URL http(s).

```bash
# edit di un'immagine esistente
node ~/.claude/skills/bananao/generate-image.mjs "cambia la stagione in inverno, neve sui rilievi" \
  -i public/img/hero-mountains.png -o public/img/hero-winter.png

# composizione da più riferimenti
node ~/.claude/skills/bananao/generate-image.mjs "il prodotto della prima immagine nell'ambiente della seconda" \
  -i product.png -i room.jpg -o public/img/product-in-situ.png
```

## Modelli

| Modello | Costo/img | Quando |
|---|---|---|
| `google/gemini-3.1-flash-image` | ~$0.06 | default, buon rapporto qualità/prezzo |
| `google/gemini-3.1-flash-lite-image` | ~$0.03 | placeholder e asset usa-e-getta, solo `1K` |
| `google/gemini-3-pro-image` | ~$0.12 | quando la qualità conta davvero |

I valori ammessi per `--aspect-ratio` e `--resolution` cambiano da modello a modello. Per verificarli:

```bash
curl -s https://openrouter.ai/api/v1/images/models \
  | jq '.data[] | select(.id=="google/gemini-3-pro-image") | .supported_parameters'
```

## Chiave API

Sta in `~/.config/bananao/config.json`, `{"apiKey": "..."}`, chmod 600. Fuori dalla cartella della
skill, così gli aggiornamenti non la toccano.

Se manca, lo script esce con codice 1 e stampa il comando esatto per configurarla — **riportalo
all'utente e fermati**. Non inventare una chiave, non chiederla in chat, non cercarla altrove: quel
file è volutamente non leggibile dall'agente.

## Errori

| Uscita | Significato |
|---|---|
| exit 1 + istruzioni di setup | chiave assente o malformata |
| `HTTP 401` | chiave rifiutata → l'utente la rigenera su openrouter.ai/keys |
| `HTTP 402` | credito OpenRouter esaurito |
| `HTTP 400` con nome di un campo | valore non valido per `--aspect-ratio` o `--resolution` su quel modello |
| `nessuna risposta entro 180s` | timeout di rete, riprova una volta sola |

In caso di errore stdout resta vuoto: se non ricevi un path, il file non è stato creato. Non
proseguire assumendo che esista.
