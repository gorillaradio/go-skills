# Occhi economici per Claude

Nota interna. Cosa sto implementando e perché.

## Il problema

Claude non vede i video. Non è una questione di piano o di prezzo: sull'API di Claude
l'input video non esiste.

Le immagini le vede, ma guardare costa. Un'immagine full-res su Opus 5 sono 4.784 token,
cioè ~2,4 cent. E l'immagine resta nella conversazione: viene rimandata a ogni turno
successivo. Venti turni con dieci immagini non sono dieci addebiti, sono duecento.

## La soluzione

Separare chi guarda da chi ragiona.

Gemini 2.5 Flash-Lite via OpenRouter fa da occhi: legge immagini e video (mp4, mov, webm,
anche link YouTube pubblici) e restituisce testo. Claude riceve solo il testo e ragiona su
quello. Il testo pesa poco e continua a pesare poco a ogni turno — che è il punto.

Flash-Lite non è un modello intelligente, e non deve esserlo. È un testimone, non un
giudice.

## I numeri

Tariffe Flash-Lite: $0,10/M input, $0,40/M output. Il video viene campionato a 1 frame al
secondo, ~300 token per secondo di girato a risoluzione default, ~100 in bassa.

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

Su Opus e Fable conto solo l'input, perché il costo della risposta lo pagheresti comunque.

Due cose da leggere nella tabella:

- **Sulle immagini il peso sta nell'output.** La descrizione costa quattro volte quello che
  guardi. Guardando solo l'input verrebbero 38.000 immagini per dollaro invece di 6.900.
  La leva è la lunghezza della descrizione che chiedi.
- **Sui video si inverte.** L'input domina, l'output è rumore. Lì la leva è la risoluzione:
  bassa contro default è un fattore 3.

## Il wiring

Un tool solo. Uno script che chiama l'endpoint chat completions di OpenRouter: gli passi
file e domanda, ti torna la descrizione. Claude lo invoca da sé quando incontra qualcosa di
visivo.

```bash
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{
    "model": "google/gemini-2.5-flash-lite",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "text", "text": "descrivi questo video shot by shot: timestamp, testo a schermo, stacchi, cosa succede nei primi 3 secondi"},
        {"type": "video_url", "video_url": {"url": "data:video/mp4;base64,..."}}
      ]
    }]
  }'
```

## Le due regole che contano

**La domanda pesa più del modello.** Chiedi timestamp, testo a schermo, stacchi,
inquadrature, struttura dell'hook. Non "descrivi il video". Più stretta è la domanda, più
utile è il testimone.

**Il frame che decide lo paghi.** Flash-Lite perde le sfumature che un modello di frontiera
coglierebbe. Quando un singolo fotogramma decide davvero qualcosa, quello va a Claude e
costa 2,4 cent. Tutto il resto passa dagli occhi economici.

## Perché

Analizzare sequenze di immagini e video a volume. Non esiste versione di quei conti che
regga se a guardare è un modello di frontiera.

---

Fonte: [`sources/articolo_gemini_eyes.md`](sources/articolo_gemini_eyes.md)
