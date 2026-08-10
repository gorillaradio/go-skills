# go-watch — note di implementazione

Materiale di riferimento per chi mette le mani sulla skill. `SKILL.md` copre l'uso,
`CLAUDE.md` della repo tiene solo le trappole. Qui ci sono le misure che le giustificano.

Tutto misurato contro le API live il **2026-08-10**.

## OpenRouter scarta `video_metadata`

Provato su un video da 616s (`oy49gvlC4eE`) in quattro varianti, con
`google/gemini-2.5-flash-lite`:

| Variante | prompt token |
|---|---|
| baseline, nessun offset | 182.034 |
| `video_metadata` dentro la content part (snake_case) | 182.034 |
| `videoMetadata` dentro `video_url` (camelCase) | 182.034 |
| `video_metadata` top-level, come `media_resolution` | 182.034 |

Rifatto il 2026-08-10 con `google/gemini-3.6-flash`, chiedendo il segmento 316-376s:
**56.083 token in tutte le varianti**, baseline compresa. Gli offset restano ignorati; è
cambiato solo il costo del video intero, perché i modelli 3.x campionano a risoluzione
bassa di default — 91 tok/s, esattamente come sull'API Google. I 295 tok/s misurati prima
erano una caratteristica del 2.5, non di OpenRouter.

Non è una questione di fornitore. OpenRouter serve questo modello sia da **Google Vertex**
che da **Google AI Studio** — quest'ultimo è lo stesso backend dell'API diretta, dove gli
offset funzionano. Inchiodando la richiesta su ciascuno con
`provider: { order: [...], allow_fallbacks: false }`, il segmento 316-376s costa 56.080
token su AI Studio e 56.145 su Vertex: il video intero in entrambi i casi. Il campo viene
tolto da OpenRouter prima di inoltrare.

Identici al token, nessun errore, nessun avviso. Sull'API Google diretta lo stesso
segmento 473-558s costa 7.709 token — 7,3×, esattamente il rapporto tra 616s e 85s — e
con `fps: 0.2` scende a 3.287.

Un pass-through parziale su OpenRouter **esiste** però: `media_resolution` top-level passa
davvero (lo usa `watch.mjs --low`). Non dedurne che passi anche il resto.

## Il modello conta, la risoluzione no

Stesso segmento di 92 secondi, stesso prompt, **8.508 token in ingresso per entrambi**:

| Modello | Cosa ha estratto | Tempo |
|---|---|---|
| `gemini-flash-lite-latest` | il comando principale, la versione, il percorso | 4,4s |
| `gemini-flash-latest` | tutto il precedente + `cd ~`, il prompt della shell, l'output integrale del terminale con l'ASCII art, le alternative `brew` e `mise` | 18,4s |

Circa 4× in tempo e 3× per token, cioè frazioni di centesimo su 8.500 token.

`MEDIA_RESOLUTION_HIGH` su flash-lite **non fa niente**: token identici al default, il
parametro viene ignorato. `fps` invece funziona (raddoppiarlo raddoppia i token video) ma
rende poco: è l'ultimo knob da toccare, non il primo.

## Modelli e quote

- **`gemini-2.5-flash-lite` è chiuso ai nuovi account** sull'API Google diretta: HTTP 404,
  *"no longer available to new users"*. Su OpenRouter risponde ancora, per questo
  `openrouter.mjs` lo tiene come default. Sull'API diretta usare gli alias `-latest`.
- I modelli **pro** (`gemini-3-pro-preview`) hanno **zero quota** sul free tier: HTTP 429
  prima ancora di processare. Serve billing attivo.
- HTTP 503 su `gemini-flash-latest` capita: è transitorio, il ritentativo è nel codice.

## Costo per secondo

`gemini-flash-latest` sul video: **~91 token al secondo** (8.508 token per 92s). Molto meno
dei ~290 tok/s che si pagano su OpenRouter a risoluzione default, perché i modelli `-latest`
usano risoluzione bassa di default. Stesso video da 616s: 56.108 token sull'API diretta
contro 182.034 su OpenRouter.

C'è una **cache lato Google sul video già processato**: la prima chiamata su un video è
costata $0.0222, le tre successive $0.0027. Fare più domande sullo stesso video in sequenza
costa quasi niente dopo la prima — vale la pena raggruppare invece di spalmare.

## La segmentazione dalla sola trascrizione

Su un video da 44 minuti senza capitoli, 12.483 token di trascrizione:

| Modello | Capitoli | Tempo | Esito |
|---|---|---|---|
| `gemini-flash-lite-latest` | 11 | 3,4s | ha lasciato un blocco unico da **10m12s** e ha attaccato il verdetto finale al capitolo precedente |
| `gemini-flash-latest` | 14 | 15,1s | nessun blocco sopra i 7 minuti; entrambi i confini mancanti verificati come reali nella trascrizione |

Su cinque confini controllati a mano contro la trascrizione, gli scarti sono di **1-5
secondi**. Irrilevanti, tanto più che conviene allargare di qualche secondo per non
tagliare una frase a metà.

Nella pratica questo lavoro lo fa l'agente e non un modello esterno (vedi `CLAUDE.md`),
ma i numeri restano utili se un giorno si volesse automatizzare il passaggio.

## Diluizione

Su un video da 10 minuti, alla domanda "quali svantaggi vengono menzionati?" la passata
unica sull'intero video ha risposto che **non ne vengono menzionati** — mentre c'era un
capitolo intero dedicato, 85 secondi su 616. Mirando quel capitolo, li elenca correttamente.

È la ragione per cui il targeting per capitoli non è un'ottimizzazione di costo.

## Verifica degli estratti

Controllati contro i fotogrammi veri, scaricati con `yt-dlp --download-sections` ed estratti
con ffmpeg. Su una decina di dettagli precisi — comandi, versioni, percorsi, output del
terminale, righe del README mostrate a schermo — **un solo errore**: una maiuscola in un
percorso (`/mnt/c/users/` invece di `/mnt/c/Users/`).

Il modello usa correttamente anche la valvola "segnalalo come incerto invece di
ricostruirlo" prevista dal prompt.

**Non generalizzare da questo risultato.** Su un altro segmento, con testo di terminale più
piccolo, gli stessi modelli hanno inventato numeri di versione e URL: vedi più sotto, "Il
testo a schermo non è affidabile". Qui il testo era grande.

## La deduplica dei sottotitoli automatici è giusta com'è

`vttToBlocks` scarta una riga se la precedente la contiene. È stata contestata come
invertita, su un caso costruito a mano (`hello` seguito da `hello world` produrrebbe
`hello hello world`). **Quel caso non esiste nell'output di yt-dlp**: il formato reale è
"riga precedente ripetuta per intero + riga nuova", che il controllo con `includes`
gestisce esattamente.

Verificato sui sottotitoli veri di `oy49gvlC4eE` contro un'implementazione a suffisso: 4.518
parole grezze → 1.512 con entrambe, output **byte-identico** (8.628 caratteri). Prima di
riscriverla, rifare quel confronto su un file vero.

## Perché la scelta della traccia non guarda i file

`readdirSync` non ordina niente: l'ordine è quello del filesystem. Scaricare più tracce e
prendere `vtts[0]` significa pescare a caso fra manuale e automatico. La traccia si decide
su `info.json`, che contiene già `subtitles` e `automatic_captions`, e se ne scarica una
sola. Le tracce `-orig` sono quelle nella lingua parlata davvero, non traduzioni: hanno la
precedenza sull'equivalente tradotto.

`orig` da solo non è una wildcard yt-dlp e non matcha `de-orig` — era una stringa morta
nella vecchia lista di lingue. Il danno era limitato perché YouTube espone auto-traduzioni
inglesi per quasi tutto, quindi `en.*` pescava comunque.

## Proposte scartate, e perché

Una revisione esterna ha proposto di irrobustire `chapters.json` con `schemaVersion`,
`sourceId`, un enum `mode` al posto di `visual`/`skippable`, `skipKind`/`reason`
obbligatori e un `manifest.json`. **Scartate.** Quel file è un contratto fra l'agente e sé
stesso, scritto e riletto a secondi di distanza in `/tmp`: non c'è evoluzione di schema da
gestire né un produttore terzo da cui difendersi. `visual && skippable` non è ambiguo:
`skippable` vince, ed è la lettura semanticamente giusta.

È sopravvissuto un solo pezzo di quella lista, ed è entrato per un'altra ragione: il
controllo dei buchi fra capitoli. Non per robustezza, ma perché un buco è contenuto che
sparisce senza che nessuno lo dica — cioè il modo silenzioso di fallire il requisito per
cui esiste tutta la skill.

Scartata anche la proposta di ammorbidire il prompt dell'articolo in "ogni informazione
**sostanziale**": delegherebbe al modello il giudizio su cosa è sostanziale, che è
esattamente il meccanismo con cui i riassunti perdono i dettagli.

## Il testo a schermo non è affidabile

**È il limite più serio della skill, ed è stato scoperto tardi.** Segmento 316-376s di
`oy49gvlC4eE`, dove il terminale mostra `brew install mole`. Confrontato con il fotogramma
vero, che dice `mole 1.49.2`, `ghcr.io/v2/homebrew/core/mole/manifests/1.49.2`,
`64 files, 9.6MB`:

| Percorso | Versione | URL | Dimensioni |
|---|---|---|---|
| Google, link YouTube | **0.4.3** | **`ghr.ic.ht/1/homebrew/...`** | 7 files, 11.2MB |
| Google, link YouTube (altra chiamata) | **49.2** | `ghcr.io/...manifests/49.2` | 8 files, 7.3MB |
| Google, link YouTube + `MEDIA_RESOLUTION_HIGH` | **49.2** | idem | 8 files, 11.2MB |
| Google, file caricato + `MEDIA_RESOLUTION_HIGH` | 1.49.2 | `ghcr.io/...manifests/1.49.2` | — |
| OpenRouter, ritaglio caricato | 1.49.2 | `ghcr.io/...manifests/1.49.2` | 5 files, 8.6MB |

Le prime tre righe sono **lo stesso modello**: `gemini-flash-latest` risolve a
`gemini-3.6-flash`, verificato leggendo il campo `modelVersion` nella risposta. Le
differenze fra loro non sono differenze di modello, sono la stessa chiamata che sbaglia in
modo diverso ogni volta — il che è peggio, perché toglie anche la difesa di rifare la
chiamata e confrontare.

Nessuno lo legge giusto per intero a risoluzione bassa, e gli errori sono **plausibili**:
non un buco, ma un numero di versione inventato che entra nell'articolo come se fosse un
fatto. Un estratto
precedente aveva dato l'impressione opposta (vedi "Verifica degli estratti"): era un
segmento con testo più grande, non una capacità del modello.

`MEDIA_RESOLUTION_HIGH` non cambia niente — token identici al default, 5.677 in entrambi i
casi — perché quando il video arriva come URL YouTube il parametro viene ignorato. `fps`
invece morde, ma alza il numero di fotogrammi, non la risoluzione di ciascuno.

**Non provato:** ritagliare il segmento e caricarlo come file (la strada del ripiego) è
l'unico caso in cui la lettura è venuta giusta, ma è un campione solo. Se il testo a schermo
conta, la strada da esplorare è quella, o `go-scrub` sui fotogrammi.

## Il ripiego su OpenRouter, eseguito

Esercitato il 2026-08-10 su un capitolo da 60s, con la `geminiKey` rimossa da una copia del
config. **Funziona**, dopo due correzioni che solo l'esecuzione ha rivelato:

- **Gli alias `-latest` non esistono su OpenRouter.** `google/gemini-flash-latest` →
  HTTP 400 *"is not a valid model ID"*, benché comparisse in una lettura frettolosa del
  catalogo. Lì i modelli sono versionati: `google/gemini-3.6-flash`.
- **I timestamp uscivano relativi al ritaglio.** Il segmento riparte da 00:00, quindi il
  modello scriveva `DA VEDERE 00:32` per un istante che nel video è 05:48. Il percorso
  Google non ha il problema: con gli offset il modello vede il tempo vero. Risolto dicendolo
  nel prompt del solo ripiego.

Costo misurato: **5.744 token per 60s** di segmento 720p, cioè 98 tok/s — 66 del fotogramma
a risoluzione bassa più 32 dell'audio. Non sono i 295 tok/s dell'URL YouTube passato a
OpenRouter: quello è un altro percorso, con modelli più vecchi a risoluzione piena.

Il limite vero del ripiego non sono i token ma l'upload: **4,8 MB per minuto** a 720p, quindi
i 40 MB si sfondano intorno agli otto minuti. C'è una guardia che lo dice prima di scaricare.

## Non ancora provato

- **Video non YouTube.** `prep.mjs` dipende da yt-dlp per metadati e sottotitoli. Per un
  file locale servirebbe go-listen per la trascrizione, e il passo dei capitoli andrebbe
  ripensato.
