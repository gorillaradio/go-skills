#!/usr/bin/env node
// go-scrub — vede come si muove un'interfaccia, fotogramma per fotogramma.
// Gemini campiona 1 fotogramma al secondo, non configurabile: un'animazione
// da 200-400 ms a quel passo è invisibile. La leva è rallentare il video con
// setpts: rallentato N volte, il campionamento raccoglie N fotogrammi per
// secondo reale. Il tetto fisico è il frame rate della sorgente. Node 18+.

import { existsSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, extname, basename } from "node:path";
import {
  VIDEO_MIME, MAX_UPLOAD_BYTES,
  CONTEXT_TOKENS, RESPONSE_HEADROOM, TOKENS_PER_FRAME,
  fail, note, loadKey, toDataUrl, chat, costLine,
} from "../_lib/openrouter.mjs";
import { requireFfmpeg, probe, runFfmpeg } from "../_lib/ffmpeg.mjs";

const SKILL = "go-scrub";
const die = (msg) => fail(SKILL, msg);

// Non il 2.5-flash-lite delle altre skill: verificato il 2026-07-29 che sul
// mestiere di go-scrub — dire QUANDO succede qualcosa — il 2.5 risponde con
// tempi degeneri (inizio=0, fine=durata del video) su qualunque domanda,
// mentre il 3.1 localizza al fotogramma esatto. E tokenizza i fotogrammi a
// ~64 token invece di 258, quindi costa pure meno.
const DEFAULT_MODEL = "google/gemini-3.1-flash-lite";

const FRAME_BUDGET = Math.floor((CONTEXT_TOKENS - RESPONSE_HEADROOM) / TOKENS_PER_FRAME); // ~4.000

const USAGE = `go-scrub — vede le animazioni di UI fotogramma per fotogramma.

  scrub.mjs "<domanda>" -i <video locale> [opzioni]

Opzioni
  -i, --input <path>   Video locale. Solo file: il rallentamento richiede ffmpeg.
  --fps <n|max>        Fotogrammi campionati per secondo reale. Default: max,
                       cioè ogni fotogramma della sorgente — l'unico valore in
                       cui il modello non può inventare durate sotto soglia.
  -m, --model <id>     Default: ${DEFAULT_MODEL}
  -h, --help           Questo messaggio.

I tempi nella risposta escono in millisecondi reali ([t=…ms], [d=…ms]):
la conversione dal tempo del video rallentato la fa lo script, non il modello.

Esempio
  scrub.mjs "descrivi la transizione del menu: ordine, durate, easing" -i menu.mp4
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
        if (opts.input) die("un solo video per chiamata.");
        opts.input = value(); break;
      case "--fps": opts.fps = value(); break;
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
if (/^https?:\/\//i.test(opts.input)) {
  die("funziona solo su file locali: il rallentamento passa da ffmpeg. Scarica il video e ripassa il path.");
}

const path = resolve(opts.input);
if (!existsSync(path)) die(`video non trovato: ${path}`);
const ext = extname(path).toLowerCase();
if (!VIDEO_MIME[ext]) die(`formato non supportato "${ext || basename(path)}" (mp4, mpeg, mov, webm).`);

const apiKey = loadKey(SKILL);
const model = opts.model || DEFAULT_MODEL;

requireFfmpeg(SKILL);
const { duration, fps: srcFps, frames, hasVideo } = probe(SKILL, path);
if (!hasVideo) die(`${basename(path)} non ha una traccia video.`);
if (!Number.isFinite(duration) || !srcFps) die(`durata o frame rate non leggibili da ffprobe per ${path}.`);

// Risoluzione del fattore di rallentamento N = fotogrammi visti per secondo reale.
let n;
if (opts.fps === undefined || opts.fps === "max") {
  n = srcFps;
} else {
  n = Number.parseFloat(opts.fps);
  if (!Number.isFinite(n) || n <= 0) die(`--fps vuole un numero positivo o "max", non "${opts.fps}".`);
  if (n > srcFps) {
    note(SKILL, `--fps ${n} supera il frame rate della sorgente (${srcFps.toFixed(2)}): oltre non c'è niente da vedere, uso ${srcFps.toFixed(2)}.`);
    n = srcFps;
  }
}

const sampled = Math.min(Math.round(duration * n), frames ?? Infinity);
if (sampled > FRAME_BUDGET) {
  die(`${Math.round(duration)}s × ${n.toFixed(2)} fps = ${sampled} fotogrammi, oltre il tetto di ~${FRAME_BUDGET} per chiamata. `
    + `Taglia il video alla sola interazione che ti interessa (ffmpeg -ss <inizio> -t <durata>) o abbassa --fps — sapendo che sotto "max" le durate inferiori a ${Math.round(1000 / n)} ms non sono osservabili.`);
}

const tmp = mkdtempSync(join(tmpdir(), "go-scrub-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
const slowed = join(tmp, "slowed.mp4");
// L'audio rallentato N volte non è più ascoltabile: via. Chi vuole anche il
// parlato fa una seconda chiamata con go-listen.
runFfmpeg(SKILL, [
  "-i", path,
  "-vf", `setpts=${n}*PTS,scale=-2:min(1280\\,ih)`,
  "-an",
  "-c:v", "libx264", "-crf", "30", "-preset", "veryfast",
  slowed,
], "rallentamento");

const size = statSync(slowed).size;
if (size > MAX_UPLOAD_BYTES) {
  die(`il video rallentato pesa ${(size / 1e6).toFixed(1)} MB, oltre i ${MAX_UPLOAD_BYTES / 1e6} MB per chiamata. Taglia il video alla sola interazione che ti interessa.`);
}

// Il modello non deve sapere che il video è rallentato: informato del fattore
// sbaglia l'aritmetica (verificato il 2026-07-28). Marca i tempi in tempo-video,
// la conversione in tempo reale la facciamo noi sotto.
const question = `${opts.question}

Marca ogni istante rilevante come [t=<secondi>] e ogni durata come [d=<secondi>], in secondi del video, con i decimali. Se qualcosa non è osservabile nei fotogrammi, dichiaralo invece di stimarlo.`;

const { text, usage } = await chat(SKILL, {
  apiKey, model,
  content: [
    { type: "text", text: question },
    { type: "video_url", video_url: { url: toDataUrl(slowed, "video/mp4") } },
  ],
});

// Riscrittura dei marcatori in millisecondi reali. Un marcatore malformato
// resta intatto e viene segnalato: meglio visibile che convertito male.
const converted = text.replace(/\[([td])=\s*(\d+(?:[.,]\d+)?)\s*(?:s(?:ec)?)?\s*\]/g, (_, kind, num) => {
  const ms = Math.round((Number.parseFloat(num.replace(",", ".")) / n) * 1000);
  return `[${kind}=${ms}ms]`;
});
const leftover = (converted.match(/\[[td]=[^\]]*\]/g) || []).filter((m) => !/^\[[td]=\d+ms\]$/.test(m));
if (leftover.length) {
  note(SKILL, `${leftover.length} marcator${leftover.length === 1 ? "e" : "i"} non convertibil${leftover.length === 1 ? "e" : "i"}, lasciat${leftover.length === 1 ? "o" : "i"} in tempo-video: ${leftover.join(" ")}`);
}

costLine(SKILL, model, usage, `rallentato ${n.toFixed(n % 1 ? 2 : 0)}×, ~${sampled} fotogrammi, risoluzione ${Math.round(1000 / n)} ms`);
process.stdout.write(converted.endsWith("\n") ? converted : converted + "\n");
