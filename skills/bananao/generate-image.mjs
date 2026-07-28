#!/usr/bin/env node
// bananao — genera immagini via OpenRouter (Images API).
// Scrive un file su disco e stampa il path assoluto su stdout. Zero dipendenze, Node 18+.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname, extname, basename } from "node:path";

const API = "https://openrouter.ai/api/v1/images/generations";
const CONFIG = join(homedir(), ".config", "bananao", "config.json");
const DEFAULT_MODEL = "google/gemini-3.1-flash-image";
const TIMEOUT_MS = 180_000;
const MAX_REFS = 14;

const EXT_BY_MIME = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const USAGE = `bananao — genera un'immagine e stampa il path del file.

  generate-image.mjs "<prompt>" [opzioni]

Opzioni
  -o, --out <path>            File di output. Default: <slug-del-prompt>.png nella cwd.
  -a, --aspect-ratio <ar>     1:1 1:4 1:8 2:3 3:2 3:4 4:1 4:3 4:5 5:4 8:1 9:16 16:9 21:9
  -s, --resolution <r>        512 | 1K | 2K | 4K   (alias: --size)
  -m, --model <id>            Default: ${DEFAULT_MODEL}
  -i, --input <path|url>      Immagine di riferimento per editing. Ripetibile, max ${MAX_REFS}.
  -h, --help                  Questo messaggio.

I valori ammessi per --aspect-ratio e --resolution dipendono dal modello:
  curl -s https://openrouter.ai/api/v1/images/models | jq '.data[] | select(.id=="<model>") | .supported_parameters'

Esempi
  generate-image.mjs "paesaggio montano all'alba, nebbia" -a 21:9 -s 2K -o public/hero.png
  generate-image.mjs "rendi la stagione invernale" -i public/hero.png -o public/hero-winter.png
`;

const SETUP = `Configura la chiave una volta sola.

1. Crea una chiave dedicata su https://openrouter.ai/keys
2. Esegui (sostituendo sk-or-v1-XXXX con la tua chiave):

  mkdir -p ~/.config/bananao && \\
  printf '{"apiKey":"sk-or-v1-XXXX"}' > ~/.config/bananao/config.json && \\
  chmod 600 ~/.config/bananao/config.json
`;

function die(msg, code = 1) {
  process.stderr.write(msg.endsWith("\n") ? msg : msg + "\n");
  process.exit(code);
}

function loadKey() {
  if (!existsSync(CONFIG)) die(`bananao: nessuna chiave API trovata in ${CONFIG}\n\n${SETUP}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {
    die(`bananao: ${CONFIG} non è JSON valido.\n\n${SETUP}`);
  }
  const key = parsed?.apiKey;
  if (typeof key !== "string" || !key.trim()) {
    die(`bananao: campo "apiKey" mancante o vuoto in ${CONFIG}\n\n${SETUP}`);
  }
  return key.trim();
}

function parseArgs(argv) {
  const opts = { inputs: [] };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) die(`bananao: l'opzione ${a} richiede un valore.`);
      return v;
    };
    switch (a) {
      case "-o": case "--out": opts.out = value(); break;
      case "-a": case "--aspect-ratio": opts.aspectRatio = value(); break;
      case "-s": case "--resolution": case "--size": opts.resolution = value(); break;
      case "-m": case "--model": opts.model = value(); break;
      case "-i": case "--input": opts.inputs.push(value()); break;
      case "-h": case "--help": process.stdout.write(USAGE); process.exit(0);
      default:
        if (a.startsWith("-")) die(`bananao: opzione sconosciuta "${a}"\n\n${USAGE}`);
        words.push(a);
    }
  }
  opts.prompt = words.join(" ").trim();
  return opts;
}

function slugify(text) {
  const s = text
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return s || "image";
}

function freePath(path) {
  if (!existsSync(path)) return path;
  const ext = extname(path);
  const stem = ext ? path.slice(0, -ext.length) : path;
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!existsSync(candidate)) return candidate;
  }
}

function toReference(src) {
  if (/^https?:\/\//i.test(src)) return { type: "image_url", image_url: { url: src } };
  const path = resolve(src);
  if (!existsSync(path)) die(`bananao: immagine di input non trovata: ${path}`);
  const mime = MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mime) die(`bananao: formato di input non supportato "${extname(path) || basename(path)}" (png, jpg, webp, gif).`);
  return {
    type: "image_url",
    image_url: { url: `data:${mime};base64,${readFileSync(path).toString("base64")}` },
  };
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.prompt) die(`bananao: prompt mancante.\n\n${USAGE}`);
if (opts.inputs.length > MAX_REFS) {
  die(`bananao: massimo ${MAX_REFS} immagini di input, ne hai passate ${opts.inputs.length}.`);
}

const apiKey = loadKey();
const model = opts.model || DEFAULT_MODEL;

const body = { model, prompt: opts.prompt };
if (opts.aspectRatio) body.aspect_ratio = opts.aspectRatio;
if (opts.resolution) body.resolution = opts.resolution;
if (opts.inputs.length) body.input_references = opts.inputs.map(toReference);

let response;
try {
  response = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
} catch (err) {
  const reason = err?.name === "TimeoutError"
    ? `nessuna risposta entro ${TIMEOUT_MS / 1000}s`
    : err?.message || String(err);
  die(`bananao: chiamata a OpenRouter fallita (${reason}).`);
}

const raw = await response.text();
let payload;
try {
  payload = JSON.parse(raw);
} catch {
  die(`bananao: risposta non-JSON da OpenRouter (HTTP ${response.status}):\n${raw.slice(0, 400)}`);
}

if (!response.ok) {
  const detail = payload?.error?.message || payload?.message || raw.slice(0, 600);
  const hint = response.status === 401
    ? `\n\nLa chiave in ${CONFIG} è stata rifiutata. Verificala su https://openrouter.ai/keys`
    : "";
  die(`bananao: OpenRouter ha risposto HTTP ${response.status}\n${detail}${hint}`);
}

const image = payload?.data?.[0];
if (!image?.b64_json) {
  die(`bananao: nessuna immagine nella risposta. Payload:\n${JSON.stringify(payload).slice(0, 600)}`);
}

const mediaType = image.media_type || "image/png";
const outPath = opts.out
  ? resolve(opts.out)
  : freePath(resolve(`${slugify(opts.prompt)}${EXT_BY_MIME[mediaType] || ".png"}`));

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, Buffer.from(image.b64_json, "base64"));

const cost = payload?.usage?.cost;
process.stderr.write(
  `bananao: ${model}${cost !== undefined ? ` · $${Number(cost).toFixed(4)}` : ""}\n`
);
process.stdout.write(outPath + "\n");
