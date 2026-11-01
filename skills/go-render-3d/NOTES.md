# go-render-3d — note di implementazione

Materiale di riferimento per chi mette le mani sulla skill. `SKILL.md` copre l'uso,
`CLAUDE.md` della repo tiene solo le trappole. Qui ci sono le prove che giustificano le scelte.

## Ambiente verificato

Tutto quello che segue è stato provato il **1 novembre 2026** su macOS (Apple Silicon) con
**F3D 4.0.0** da Homebrew (VTK 9.7.1, build del 20 ottobre 2026). `brew install f3d` scarica
circa 1,3 GB, perché VTK si porta dietro Qt, e ha impiegato circa 7 minuti.

`f3d --list-readers` su questa build: STL, OBJ e PLY sono nativi, 3MF passa da `assimp`,
STEP da `occt`. Sono tutti presenti.

Modelli di prova, presi dalla repo `hacked-salmon` (scaricati da Makerworld):
`obj_1_Shelf bracket.stl`, `SKADIS DRIVER SHELF SMALL type A.stl`, `BOOK-STAND.stl`
(il rialzo per la Billy) e `drawer_handle_10cm.3mf`.

## La documentazione di F3D

Pagine lette: `OPTIONS`, `CONFIGURATION_FILE` e `SUPPORTED_FORMATS` su f3d.app, tutte
etichettate "Version: 4.0". La pagina `USAGE` non esiste (404).

**L'esempio nella pagina `CONFIGURATION_FILE` usa nomi di opzioni superati.** `timer`,
`progress`, `bar`, `denoise` e `samples` in 4.0 si chiamano `fps`, `loading-progress`,
`coloring-scalar-bar`, `raytracing-denoise` e `raytracing-samples`. Lo stesso esempio scrive
`"anti-aliasing": true`, mentre in 4.0 quell'opzione è una stringa (`fxaa`, `ssaa`, `taa`,
`none`). I nomi vanno presi dalla pagina `OPTIONS` o da `f3d --help`, non dall'esempio.

## Cosa è stato verificato sul programma

**`--resolution` decide anche la dimensione del PNG.** La documentazione la descrive come
dimensione della finestra e non lo dice esplicitamente. Con `2048,2048` il file esce
2048×2048 (controllato con `sips`).

**Il render è deterministico.** Lo stesso comando lanciato tre volte produce PNG identici
pixel per pixel (`magick compare -metric AE` restituisce 0).

**F3D esce con codice 0 anche quando non carica il modello e non scrive niente.** Per questo
lo script cancella il PNG prima del render e poi controlla che esista: è l'unico segnale
affidabile.

**`--config=<percorso>` sostituisce la configurazione predefinita, non si aggiunge.** Quella
di Homebrew attiva griglia, assi, il nome del file in sovrimpressione e lo sfondo grigio
scuro. Si vede subito se le opzioni non arrivano a F3D, come nella trappola di zsh più sotto.

**Lo sfondo trasparente funziona.** Con `--no-background` il pixel d'angolo vale
`srgba(0,0,0,0)`. Anche i colori dello sfondo sono stati controllati sul pixel d'angolo:
grigio `0.5` dà 128, `#3366CC` dà `51,102,204`.

## Camera: perché `--camera-direction`

Sono stati provati due modi per ottenere la vista 3/4.

**Azimut ed elevazione (`--camera-azimuth-angle=45 --camera-elevation-angle=35`):
scartati.** F3D calcola lo zoom automatico sulla vista frontale e solo dopo ruota la camera.
Un pezzo alto e profondo come il supporto SKADIS esce dal bordo superiore con lo zoom
predefinito (0,9). Con `--camera-zoom-factor=0.7` entra, ma a quel punto la staffa, che è
piatta, occupa poco più di metà del quadro. Non esiste un unico valore che vada bene per
entrambi.

**`--camera-direction`: adottato.** Lo zoom automatico viene calcolato sulla direzione
scelta, e tutti i pezzi di prova escono interi e con margine, in tutte e quattro le viste.

**`camera-view-up` scritto in `set.json` sposta l'inquadratura.** Con `"camera-view-up":
"+Z"` nel file di configurazione la staffa usciva spostata in basso a destra. La stessa
opzione passata da riga di comando per la vista dall'alto non dà problemi. Il perché non è
stato capito. In `set.json` quell'opzione non va messa.

**La centratura è sul centro del volume del pezzo, non sulla sua forma visibile.** Un pezzo
asimmetrico, nella vista 3/4, appare un po' spostato: la staffa, per esempio, verso sinistra.
Per una centratura esatta bisognerebbe ritagliare il PNG dopo il render, per esempio con
ImageMagick (`-trim` più un bordo fisso). Non è stato fatto perché aggiungerebbe una
dipendenza.

## Orientamento: l'opzione `-u`

Un file 3D contiene l'orientamento in cui il pezzo si stampa o in cui è stato disegnato nel
CAD, non quello in cui si usa. Il rialzo per la Billy lo mostra bene:

- **Nell'STL** è centrato sull'origine (Z va da −60 a +60) e l'asse verticale è Y. Con Z in
  alto, il piano a fessure esce verticale.
- **Nel 3MF** la trasformazione di Bambu Studio (`1 0 0 0 0 1 0 -1 0`) porta Y su Z: sul
  piatto il pezzo sta capovolto, con le gambe in su.
- **Nell'uso**, come nella foto del prodotto, il piano a fessure sta sopra. Si ottiene con
  `-u -Y`.

Dal file non si può ricavare l'orientamento d'uso, quindi lo sceglie chi lancia il render.

Per ogni asse lo script fissa tre vettori: U (l'alto), F (dove guarda la camera frontale) e
S (dove guarda quella laterale), con S = −(F × U) perché le viste non escano specchiate. La
vista 3/4 guarda nella direzione F + S − U, quella dall'alto guarda −U con F come alto
dell'immagine. Con `+Z` le direzioni sono esattamente quelle precedenti all'introduzione di
`-u`: i render della staffa, rifatti in tutte e quattro le viste, sono identici pixel per
pixel.

## I 3MF di Bambu Studio

I 3MF salvati da Bambu Studio, cioè quelli di Makerworld, tengono la geometria in
`3D/Objects/object_N.model`. Il file principale `3D/3dmodel.model` la richiama con
`<component p:path=...>`, un meccanismo dell'estensione Production di 3MF. Il lettore 3MF di
F3D (assimp) non lo segue e si ferma con:

```
Assimp error: Validation failed: aiScene::mNumMeshes is 0. At least one mesh must be there
```

Verificato su `drawer_handle_10cm.3mf`. Non c'è soluzione dentro F3D: serve l'STL.

## Le scelte del set

- **2048×2048 quadrato, sfondo bianco predefinito**: decisi con l'utente.
- **SSAA**: è il supersampling. Rispetto a nessun antialiasing non cambia l'inquadratura. Non
  è stato confrontato a vista con FXAA. TAA è escluso, perché la documentazione dice che non
  funziona con `--output`.
- **Ambient occlusion sì**: sul supporto SKADIS dà profondità ai pioli e alle cavità.
- **Tone mapping no**: nel confronto scuriva il pezzo senza aggiungere dettaglio.
- **Ombre**: in F3D 4.0 non esiste nessuna opzione per le ombre.

## La trappola di zsh nei test a mano

In zsh una variabile non tra virgolette non viene divisa in più argomenti. Con
`A="--no-config --up=+Z"` e poi `f3d modello.stl $A`, F3D riceve un unico argomento, lo
prende per un secondo file da caricare e applica la configurazione predefinita: in alto
compare "(1/2)". Lo script gira in bash e non ha questo problema. Per le prove a mano
conviene usare `bash -c` con un array.

## Mai provato

- File STEP, OBJ e PLY: risultano supportati da `--list-readers`, ma nessun render è stato
  fatto.
- Assi `±X` e `-Z` di `-u`: sono stati provati solo `+Z` e `-Y`.
- Modelli molto grandi, o composti da molti oggetti.
- Linux e `--rendering-backend`.
