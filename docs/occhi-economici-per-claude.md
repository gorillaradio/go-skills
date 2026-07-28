Sto implementando una cosa per farci analizzare immagini e video a volume senza che i costi
esplodano. Il problema è che Claude i video non li vede proprio — sull'API l'input video non
esiste — e le immagini gli costano care: una full-res su Opus 5 sono ~2,4 cent, e siccome
l'immagine resta nella conversazione la ripaghi a ogni turno successivo. Venti turni con
dieci immagini non sono dieci addebiti, sono duecento.

L'idea è separare chi guarda da chi ragiona. Gemini 2.5 Flash-Lite via OpenRouter fa da
occhi: legge immagini e video (mp4, mov, webm, anche link YouTube pubblici) e restituisce
testo. Claude riceve solo il testo e ragiona su quello. Flash-Lite non è un modello
intelligente e non deve esserlo: è un testimone, non un giudice. Tecnicamente è un tool
solo, che Claude chiama da sé quando incontra qualcosa di visivo.

| Cosa guardi | Chi guarda | Token in | Token out | Costo unitario | Quantità per $1 |
|---|---|---|---|---|---|
| 1 immagine | Flash-Lite | 258 | 300 | 0,015 cent | ~6.900 |
| 1 immagine (descrizione lunga) | Flash-Lite | 258 | 600 | 0,027 cent | ~3.800 |
| video 60 sec | Flash-Lite | 18.000 | 300 | 0,19 cent | ~520 |
| video 3 min | Flash-Lite | 54.000 | 300 | 0,55 cent | ~180 |
| video 1 ora (default) | Flash-Lite | 1.080.000 | 300 | 10,8 cent | ~9 |
| video 1 ora (bassa ris.) | Flash-Lite | 360.000 | 300 | 3,6 cent | ~27 |
| 1 immagine full-res | Opus 5 | 4.784 | — | 2,4 cent | 41 |
| 1 immagine full-res | Fable 5 | 4.784 | — | 4,8 cent | 20 |

Due letture della tabella: sulle immagini il costo sta quasi tutto nell'output, la
descrizione pesa quattro volte quello che guardi, quindi la leva è quanto lunga la chiedi.
Sui video si inverte, l'input domina e la leva è la risoluzione — bassa contro default è un
fattore 3. Poi due regole pratiche: la domanda che fai agli occhi conta più del modello
(timestamp, testo a schermo, stacchi, cosa succede nei primi tre secondi, non "descrivi il
video"), e quando un singolo frame decide davvero qualcosa quello lo mandi a Claude e paghi
i 2,4 cent. Tutto il resto passa dagli occhi economici.

---

Fonte: [`sources/articolo_gemini_eyes.md`](sources/articolo_gemini_eyes.md)
