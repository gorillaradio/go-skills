#!/usr/bin/env node
// go-listen — trascrive e diarizza l'audio: file audio o traccia estratta da
// un video. Manda solo audio, quindi i token dei fotogrammi sono zero: è la
// via economica sui contenuti lunghi (32 tok/s contro i 258 di un fotogramma).
// Node 18+.

import { existsSync, statSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, basename } from "node:path";
import {
  DEFAULT_MODEL, MAX_UPLOAD_BYTES,
  fail, note, loadKey, chat, costLine,
} from "../_lib/openrouter.mjs";
import { loadGeminiKey, uploadFile, generate, DEFAULT_MODEL as GOOGLE_MODEL } from "../_lib/google.mjs";
import { requireFfmpeg, probe, hasAudioStream, maxVolumeDb, SILENCE_DB, runFfmpeg } from "../_lib/ffmpeg.mjs";

const SKILL = "go-listen";
const die = (msg) => fail(SKILL, msg);

const DEFAULT_QUESTION = `Trascrivi integralmente l'audio, verbatim, nella lingua originale.
Marca il tempo come [mm:ss] a ogni cambio di parlante e a ogni pausa lunga.
Etichetta i parlanti (Parlante 1, Parlante 2, ...) in modo coerente.
Annota tra parentesi i suoni non verbali rilevanti (risate, squilli, musica).
Se un passaggio è incomprensibile scrivi [incomprensibile], non inventare.`;

const USAGE = `go-listen — trascrive e diarizza l'audio, anche estratto da un video.

  listen.mjs ["<domanda>"] -i <file audio o video> [opzioni]

Senza domanda: trascrizione verbatim con timestamp e parlanti etichettati.
Con domanda: quella (es. "riassumi la call e i punti decisi, con i timestamp").

Opzioni
  -i, --input <path>   File locale, audio o video (l'audio viene estratto).
  -m, --model <id>     Default: ${DEFAULT_MODEL}
  -h, --help           Questo messaggio.
`;

function parseArgs(argv) {
  const opts = {};
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) die(`l'opzione ${a} richiede un valore.`);
      return v;
    };
    switch (a) {
      case "-i": case "--input":
        if (opts.input) die("un solo file per chiamata.");
        opts.input = value(); break;
      case "-m": case "--model": opts.model = value(); break;
      case "-h": case "--help": process.stderr.write(USAGE); process.exit(0);
      default:
        if (a.startsWith("-")) die(`opzione sconosciuta "${a}"\n\n${USAGE}`);
        words.push(a);
    }
  }
  opts.question = words.join(" ").trim();
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.input) die(`serve un -i con il file.\n\n${USAGE}`);
if (/^https?:\/\//i.test(opts.input)) {
  die("funziona solo su file locali (l'audio va estratto e ricodificato). Per un video su YouTube usa go-watch; altrimenti scarica il file e ripassa il path.");
}

const path = resolve(opts.input);
if (!existsSync(path)) die(`file non trovato: ${path}`);

// L'API Google è la strada principale: l'audio si carica con la Files API,
// quindi niente tetto dei 40 MB e niente base64 nel body. OpenRouter resta il
// ripiego per chi ha solo quella chiave.
const geminiKey = loadGeminiKey(SKILL);
const orKey = geminiKey ? null : loadKey(SKILL);
// Non il lite: sullo stesso minuto di audio ha messo un timestamp per ogni
// parola, ignorando il formato chiesto. Flash rispetta [mm:ss] e le etichette.
const model = opts.model || (geminiKey ? GOOGLE_MODEL : DEFAULT_MODEL);

requireFfmpeg(SKILL);
if (!hasAudioStream(path)) die(`${basename(path)} non ha una traccia audio.`);

// Una traccia muta non è "poco segnale": induce il modello a inventare una
// trascrizione completa e credibile (osservato il 2026-07-28 su silenzio
// digitale). Qui è un errore, non una degradazione.
const db = maxVolumeDb(SKILL, path);
if (db < SILENCE_DB) {
  die(`la traccia audio è muta (max_volume ${db} dB): non c'è niente da trascrivere. Spedirla produrrebbe una trascrizione inventata.`);
}

const { duration } = probe(SKILL, path);

// Ricodifica sempre in mp3 mono: percorso unico, formato garantito per il
// campo "format" dell'API, e il parlato non perde nulla. Su OpenRouter 64 kbps
// stanno in 40 MB fino a ~80 minuti, oltre si scende a 32; su Google il tetto
// è 2 GB per file, quindi non serve degradare mai.
let bitrate = "64k";
if (!geminiKey && Number.isFinite(duration) && duration * 8000 > MAX_UPLOAD_BYTES) bitrate = "32k";

const tmp = mkdtempSync(join(tmpdir(), "go-listen-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
const mp3 = join(tmp, "audio.mp3");
runFfmpeg(SKILL, ["-i", path, "-vn", "-ac", "1", "-c:a", "libmp3lame", "-b:a", bitrate, mp3], "estrazione audio");

const size = statSync(mp3).size;
if (!geminiKey && size > MAX_UPLOAD_BYTES) {
  die(`anche a ${bitrate} l'mp3 pesa ${(size / 1e6).toFixed(1)} MB, oltre i ${MAX_UPLOAD_BYTES / 1e6} MB per chiamata su OpenRouter. `
    + `Configura la geminiKey (la Files API regge 2 GB), oppure taglia l'audio in parti (ffmpeg -ss <inizio> -t <durata>).`);
}
if (Number.isFinite(duration)) {
  note(SKILL, `audio: ${(duration / 60).toFixed(1)} min, mp3 ${bitrate} mono, ${(size / 1e6).toFixed(1)} MB`);
}

let text;
if (geminiKey) {
  const uri = await uploadFile(SKILL, { apiKey: geminiKey, path: mp3, mimeType: "audio/mpeg" });
  const r = await generate(SKILL, {
    apiKey: geminiKey, model,
    parts: [
      { text: opts.question || DEFAULT_QUESTION },
      { file_data: { file_uri: uri, mime_type: "audio/mpeg" } },
    ],
  });
  text = r.text;
  note(SKILL, `${model} · ${r.promptTokens} tok in · ${r.outputTokens} tok out · ${r.seconds.toFixed(0)}s`);
} else {
  const r = await chat(SKILL, {
    apiKey: orKey, model,
    content: [
      { type: "text", text: opts.question || DEFAULT_QUESTION },
      { type: "input_audio", input_audio: { data: readFileSync(mp3).toString("base64"), format: "mp3" } },
    ],
  });
  text = r.text;
  costLine(SKILL, model, r.usage);
}
process.stdout.write(text.endsWith("\n") ? text : text + "\n");
