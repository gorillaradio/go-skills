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

I numeri qui sotto sono misurati sull'API il 28 luglio 2026, non stimati. Il video costa
~330 token al secondo: ~300 di immagine più ~30 di audio, perché la traccia audio viene
tokenizzata anche quando non la chiedi. Con il flag di bassa risoluzione i token immagine
scendono a ~80 al secondo, l'audio resta dov'è, e il totale va a ~110.

| Cosa guardi | Chi guarda | Token in | Costo unitario | Quantità per $1 |
|---|---|---|---|---|
| 1 immagine | Flash-Lite | 258 | 0,015 cent | ~6.900 |
| video 60 sec | Flash-Lite | 19.800 | 0,21 cent | ~480 |
| video 3 min | Flash-Lite | 59.400 | 0,61 cent | ~165 |
| video 3 min, bassa ris. | Flash-Lite | 19.800 | 0,21 cent | ~480 |
| video 50 min | Flash-Lite | 990.000 | 9,9 cent | ~10 |
| video 1 ora, bassa ris. | Flash-Lite | 396.000 | 4,0 cent | ~25 |
| video 2,5 ore, bassa ris. | Flash-Lite | 990.000 | 9,9 cent | ~10 |
| 1 immagine full-res | Opus 5 | 4.784 | 2,4 cent | 41 |
| 1 immagine full-res | Fable 5 | 4.784 | 4,8 cent | 20 |

Costi calcolati a $0,10 per milione di token in ingresso e $0,40 in uscita, ipotizzando
risposte da 300 token. Su Opus e Fable conto solo l'ingresso, perché la risposta la
pagheresti comunque.

C'è un soffitto oltre il quale non è questione di soldi: la context window è di 1.048.576
token, quindi a risoluzione piena si arriva a **53 minuti di video** e non un secondo di più.
La bassa risoluzione non è un'ottimizzazione di costo, è l'unico modo di guardare qualcosa di
lungo — porta il tetto a circa 2,5 ore. Oltre, va tagliato in pezzi.

Sulle immagini vale il ragionamento opposto: costano così poco in ingresso che il peso sta
tutto nella risposta, dove 300 token di descrizione valgono quattro volte l'immagine
guardata. Lì la leva non è la risoluzione, è quanto lunga chiedi la descrizione. Che è anche
la ragione per cui la domanda che fai agli occhi conta più del modello che usi: chiedi
timestamp, testo a schermo, stacchi, cosa succede nei primi tre secondi, non "descrivi il
video". E quando un singolo frame decide davvero qualcosa, quello lo mandi a Claude e paghi
i 2,4 cent — tutto il resto passa dagli occhi economici.

---

Fonte: [`sources/articolo_gemini_eyes.md`](sources/articolo_gemini_eyes.md)
