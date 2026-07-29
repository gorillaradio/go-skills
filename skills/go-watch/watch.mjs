#!/usr/bin/env node
// go-watch — racconta il contenuto di un video (audio incluso) con un modello
// economico via OpenRouter. Accetta file locali, URL e link YouTube. Node 18+.

import { existsSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, extname, basename } from "node:path";
import {
  DEFAULT_MODEL, VIDEO_MIME, MAX_UPLOAD_BYTES,
  CONTEXT_TOKENS, RESPONSE_HEADROOM,
  TOKENS_PER_FRAME, TOKENS_PER_FRAME_LOW, TOKENS_PER_AUDIO_SECOND,
  fail, note, loadKey, toDataUrl, mimeFor, chat, costLine,
} from "../_lib/openrouter.mjs";
import { requireFfmpeg, probe, hasAudioStream, maxVolumeDb, SILENCE_DB, runFfmpeg } from "../_lib/ffmpeg.mjs";

const SKILL = "go-watch";
const die = (msg) => fail(SKILL, msg);

// Sopra questa soglia il file viene ricodificato prima di partire: il modello
// campiona 1 fotogramma al secondo e non vede oltre i 1280px, quindi la
// compressione toglie byte, non segnale.
const COMPRESS_ABOVE_BYTES = 10 * 1024 * 1024;

const USAGE = `go-watch — racconta cosa succede in un video, audio incluso.

  watch.mjs "<domanda>" -i <path|url|youtube> [opzioni]

Opzioni
  -i, --input <path|url>  Video locale, URL http(s) o link YouTube (pubblico). Uno solo.
  --low                   MEDIA_RESOLUTION_LOW: ~1/3 dei token video, audio invariato.
                          Serve sui video lunghi; toglie dettaglio spaziale fine.
  -m, --model <id>        Default: ${DEFAULT_MODEL}
  -h, --help              Questo messaggio.

Esempi
  watch.mjs "cosa fa l'utente in questa registrazione? timestamp per ogni passo" -i rec.mov
  watch.mjs "riassumi il talk e trascrivi le domande del pubblico" -i https://youtu.be/XXXX --low
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
        if (opts.input) die("un solo video per chiamata: per confrontarne due, due chiamate.");
        opts.input = value(); break;
      case "--low": opts.low = true; break;
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
if (!opts.question) die(`domanda mancante.\n\n${USAGE}`);
if (!opts.input) die(`serve un -i con il video.\n\n${USAGE}`);

const apiKey = loadKey(SKILL);
const model = opts.model || DEFAULT_MODEL;
const hint400 = "Se l'errore riguarda il contesto il video è troppo lungo: riprova con --low, o passa da go-listen per l'audio e chiama go-watch solo sui segmenti che contano.";

let videoUrl;

if (/^https?:\/\//i.test(opts.input)) {
  // URL e YouTube: nessun limite di peso (il file non transita da qui) ma
  // limite di durata: ~1 ora a risoluzione default, ~2,5 con --low.
  videoUrl = opts.input;
} else {
  const path = resolve(opts.input);
  if (!existsSync(path)) die(`video non trovato: ${path}`);
  const ext = extname(path).toLowerCase();
  if (!VIDEO_MIME[ext]) die(`formato non supportato "${ext || basename(path)}" (mp4, mpeg, mov, webm).`);

  requireFfmpeg(SKILL);
  const { duration, hasVideo } = probe(SKILL, path);
  if (!hasVideo) die(`${basename(path)} non ha una traccia video: usa go-listen.`);
  if (!Number.isFinite(duration)) die(`durata non leggibile da ffprobe per ${path}.`);

  // Una traccia muta costa 32 tok/s e fa inventare una trascrizione: via.
  let stripAudio = false;
  if (hasAudioStream(path)) {
    const db = maxVolumeDb(SKILL, path);
    if (db < SILENCE_DB) {
      stripAudio = true;
      note(SKILL, `traccia audio muta (max_volume ${db} dB): la rimuovo prima di spedire.`);
    }
  } else {
    stripAudio = true; // niente da tenere, e -an rende l'intento esplicito
  }

  // Guardia sul contesto, prima di spendere.
  const perSecond = (opts.low ? TOKENS_PER_FRAME_LOW : TOKENS_PER_FRAME)
    + (stripAudio ? 0 : TOKENS_PER_AUDIO_SECOND);
  const estimate = Math.round(duration * perSecond);
  const budget = CONTEXT_TOKENS - RESPONSE_HEADROOM;
  if (estimate > budget) {
    die(`${Math.round(duration)}s × ${perSecond} tok/s ≈ ${estimate} token, oltre il tetto di ~${budget}. `
      + (opts.low
        ? `Taglia il video con ffmpeg, o usa go-listen sull'audio intero e go-watch sui segmenti che contano.`
        : `Riprova con --low, taglia il video, o usa go-listen sull'audio intero e go-watch sui segmenti che contano.`));
  }

  let sendPath = path;
  const size = statSync(path).size;
  if (size > COMPRESS_ABOVE_BYTES || stripAudio) {
    const tmp = mkdtempSync(join(tmpdir(), "go-watch-"));
    process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
    sendPath = join(tmp, "video.mp4");
    const args = ["-i", path];
    if (size > COMPRESS_ABOVE_BYTES) {
      args.push("-vf", "scale=-2:min(1280\\,ih),fps=2", "-c:v", "libx264", "-crf", "30", "-preset", "veryfast");
    } else {
      args.push("-c:v", "copy");
    }
    args.push(stripAudio ? "-an" : "-c:a");
    if (!stripAudio) args.push("aac", "-b:a", "96k");
    args.push(sendPath);
    runFfmpeg(SKILL, args, "compressione");
    if (size > COMPRESS_ABOVE_BYTES) {
      note(SKILL, `compressione: ${(size / 1e6).toFixed(1)} MB → ${(statSync(sendPath).size / 1e6).toFixed(1)} MB`);
    }
  }

  const finalSize = statSync(sendPath).size;
  if (finalSize > MAX_UPLOAD_BYTES) {
    die(`anche compresso il video pesa ${(finalSize / 1e6).toFixed(1)} MB, oltre i ${MAX_UPLOAD_BYTES / 1e6} MB per chiamata. `
      + `Taglialo in segmenti (ffmpeg -ss <inizio> -t <durata>), una chiamata per segmento.`);
  }
  videoUrl = toDataUrl(sendPath, sendPath === path ? mimeFor(path, VIDEO_MIME) : "video/mp4");
}

const content = [
  { type: "text", text: opts.question },
  { type: "video_url", video_url: { url: videoUrl } },
];

const { text, usage } = await chat(SKILL, {
  apiKey, model, content, hint400,
  mediaResolution: opts.low ? "MEDIA_RESOLUTION_LOW" : undefined,
});
costLine(SKILL, model, usage, opts.low ? "low" : undefined);
process.stdout.write(text.endsWith("\n") ? text : text + "\n");
