#!/usr/bin/env node
// go-glance — guarda immagini (file, URL o cartelle) con un modello economico
// via OpenRouter e stampa la risposta testuale su stdout. Node 18+.

import { existsSync, statSync, readdirSync } from "node:fs";
import { resolve, join, extname, basename } from "node:path";
import {
  DEFAULT_MODEL, IMAGE_MIME, VIDEO_MIME, MAX_UPLOAD_BYTES,
  fail, loadKey, toDataUrl, chat, costLine,
} from "../_lib/openrouter.mjs";

const SKILL = "go-glance";
const die = (msg) => fail(SKILL, msg);

const USAGE = `go-glance — guarda immagini e stampa la risposta su stdout.

  glance.mjs "<domanda>" -i <path|url|cartella> [-i ...] [opzioni]

Opzioni
  -i, --input <path|url|dir>  Immagine, URL http(s) o cartella (non ricorsiva). Ripetibile.
  -m, --model <id>            Default: ${DEFAULT_MODEL}
  -h, --help                  Questo messaggio.

Esempi
  glance.mjs "cosa mostra questo screenshot?" -i shot.png
  glance.mjs "quale di queste ha il contrasto migliore?" -i a.png -i b.png
  glance.mjs "descrivi ogni immagine in una riga" -i ./screenshots/
`;

function parseArgs(argv) {
  const opts = { inputs: [] };
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) die(`l'opzione ${a} richiede un valore.`);
      return v;
    };
    switch (a) {
      case "-i": case "--input": opts.inputs.push(value()); break;
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

function expand(src) {
  if (/^https?:\/\//i.test(src)) return [{ url: src, label: src, bytes: 0 }];
  const path = resolve(src);
  if (!existsSync(path)) die(`input non trovato: ${path}`);
  if (statSync(path).isDirectory()) {
    const files = readdirSync(path)
      .filter((f) => IMAGE_MIME[extname(f).toLowerCase()])
      .sort()
      .map((f) => join(path, f));
    if (!files.length) die(`nessuna immagine in ${path}`);
    return files.map(local);
  }
  return [local(path)];
}

function local(path) {
  const ext = extname(path).toLowerCase();
  if (VIDEO_MIME[ext]) die(`${basename(path)} è un video: usa go-watch (o go-scrub per le animazioni di UI).`);
  const mime = IMAGE_MIME[ext];
  if (!mime) die(`formato non supportato "${ext || basename(path)}" (png, jpg, webp, gif).`);
  return { url: toDataUrl(path, mime), label: basename(path), bytes: statSync(path).size };
}

const opts = parseArgs(process.argv.slice(2));
if (!opts.question) die(`domanda mancante.\n\n${USAGE}`);
if (!opts.inputs.length) die(`serve almeno un -i.\n\n${USAGE}`);

const items = opts.inputs.flatMap(expand);
const totalBytes = items.reduce((sum, it) => sum + it.bytes, 0);
if (totalBytes > MAX_UPLOAD_BYTES) {
  die(`i file locali pesano ${(totalBytes / 1e6).toFixed(1)} MB, oltre i ${MAX_UPLOAD_BYTES / 1e6} MB per chiamata. Dividi in più chiamate.`);
}

const apiKey = loadKey(SKILL);
const model = opts.model || DEFAULT_MODEL;

const content = [{ type: "text", text: opts.question }];
for (const [idx, item] of items.entries()) {
  if (items.length > 1) content.push({ type: "text", text: `[immagine ${idx + 1}: ${item.label}]` });
  content.push({ type: "image_url", image_url: { url: item.url } });
}

const { text, usage } = await chat(SKILL, { apiKey, model, content });
costLine(SKILL, model, usage, `${items.length} immagin${items.length === 1 ? "e" : "i"}`);
process.stdout.write(text.endsWith("\n") ? text : text + "\n");
