// go-watch prep — metadati, capitoli e trascrizione di un video YouTube.
// Il video non viene mai scaricato: solo i metadati e la traccia audio, che
// go-listen trascrive per qualche centesimo. È il passo che rende quasi gratis
// tutto il resto, perché i capitoli si ricavano da qui invece che guardando.
//
// Tutto quello che scarica resta nella cartella di lavoro. Non è per la
// velocità: ogni rilancio senza cache è un'altra richiesta a YouTube, che dopo
// un po' risponde 429 e poi chiede di dimostrare di non essere un bot.

import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { fail, note } from "../_lib/openrouter.mjs";
import { loadGeminiKey, videoPart, CONFIG, API_BASE } from "../_lib/google.mjs";

const SKILL = "go-watch prep";
const die = (msg) => fail(SKILL, msg);

export function hasYtDlp() {
  const r = spawnSync("yt-dlp", ["--version"], { stdio: "ignore" });
  return !r.error && r.status === 0;
}

export function requireYtDlp() {
  if (!hasYtDlp()) die("yt-dlp non trovato nel PATH. Installa con:\n\n  brew install yt-dlp");
}

// Arrotondare prima di dividere, non dopo: con Math.round applicato ai soli
// secondi, 59.6 diventa 00:00 (i minuti erano già stati troncati a zero).
export const mmss = (s) => {
  const t = Math.round(s);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

// I sottotitoli automatici di YouTube sono a scorrimento: ogni cue ripete la
// riga precedente più una parola. Senza deduplica la trascrizione triplica.
export function vttToBlocks(vtt, blockSeconds = 15) {
  const out = [];
  let ts = null;
  for (const line of vtt.split(/\r?\n/)) {
    const m = /^(\d\d):(\d\d):(\d\d)\.\d\d\d --> /.exec(line);
    if (m) { ts = +m[1] * 3600 + +m[2] * 60 + +m[3]; continue; }
    const text = line.replace(/<[^>]+>/g, "").trim();
    if (!text || /^(WEBVTT|Kind:|Language:|NOTE)/.test(text)) continue;
    if (out.length && out[out.length - 1].text.includes(text)) continue;
    out.push({ ts, text });
  }
  const blocks = [];
  let start = out.length ? out[0].ts : 0;
  let buf = [];
  for (const { ts: t, text } of out) {
    if (t - start >= blockSeconds && buf.length) {
      blocks.push({ start, text: buf.join(" ") });
      buf = []; start = t;
    }
    buf.push(text);
  }
  if (buf.length) blocks.push({ start, text: buf.join(" ") });
  return blocks;
}

// Quale traccia scaricare, decisa su info.json invece che sul contenuto della
// cartella: scaricarne più d'una e poi prendere readdirSync()[0] significa
// affidarsi all'ordine del filesystem, che non è ordinato affatto — con manuali
// e automatici presenti insieme si finisce a pescare l'automatico per caso.
export function pickSubtitleTrack(info) {
  const preferred = [info.language, "en", "it"].filter(Boolean);
  for (const [table, kind] of [[info.subtitles, "manuali"], [info.automatic_captions, "automatici"]]) {
    const langs = Object.keys(table || {}).filter(l => l !== "live_chat");
    if (!langs.length) continue;
    for (const p of preferred) {
      // `-orig` è la traccia nella lingua parlata davvero, non una traduzione.
      const hit = langs.find(l => l === `${p}-orig`) || langs.find(l => l === p)
        || langs.find(l => l.startsWith(`${p}-`));
      if (hit) return { lang: hit, kind };
    }
    return { lang: langs.find(l => l.endsWith("-orig")) || langs[0], kind };
  }
  return null;
}

// Trascrizione dall'audio vero, non dai sottotitoli automatici di YouTube: qui
// la punteggiatura c'è, i termini tecnici sono giusti e i parlanti sono
// separati. Costa ~26 token al secondo di audio, qualche centesimo all'ora.
//
// L'm4a resta sul disco: è il pezzo più caro da riprendere, e senza cache ogni
// rilancio è un'altra richiesta a YouTube — che dopo un po' smette di
// rispondere e chiede di dimostrare di non essere un bot.
const TRANSCRIBE_PROMPT = `Trascrivi integralmente l'audio, verbatim, nella lingua originale.
Metti un marcatore di tempo [mm:ss] almeno ogni 15 secondi, e comunque a ogni cambio di parlante.
Se i parlanti sono più di uno etichettali (Parlante 1, Parlante 2, ...) in modo coerente.
Se un passaggio è incomprensibile scrivi [incomprensibile], non inventare.
Non riassumere e non commentare.`;

function transcribeAudio(dir, url, ytdlp) {
  const audio = join(dir, "audio.m4a");
  if (!existsSync(audio)) {
    if (!ytdlp) return null;
    const r = spawnSync("yt-dlp", [
      "--no-warnings", "-x", "--audio-format", "m4a", "-o", audio, url,
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (r.status !== 0 || !existsSync(audio)) {
      note(SKILL, `yt-dlp non riesce a scaricare l'audio:\n${(r.stderr || "").slice(-300)}`);
      return null;
    }
  }
  const listen = join(dirname(fileURLToPath(import.meta.url)), "..", "go-listen", "listen.mjs");
  const r = spawnSync(process.execPath, [listen, TRANSCRIBE_PROMPT, "-i", audio], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"],
  });
  if (r.status !== 0 || !r.stdout.trim()) {
    note(SKILL, "go-listen non ha prodotto una trascrizione, ripiego sui sottotitoli.");
    return null;
  }
  return parseTimestamped(r.stdout);
}

// Da "[mm:ss] testo" ai blocchi "[secondi] testo" che usa il resto della
// pipeline. Accetta anche [h:mm:ss]: dopo la prima ora i modelli passano a
// quella forma, e con il solo [mm:ss] tutto il resto collassava in un blocco.
// Il testo prima del primo marcatore, se c'è, parte da zero.
export function parseTimestamped(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const parts = line.split(/\[(?:(\d+):)?(\d+):(\d\d)\]/);
    if (parts.length === 1) {
      const t = line.trim();
      if (t && out.length) out[out.length - 1].text += " " + t;
      else if (t) out.push({ start: 0, text: t });
      continue;
    }
    if (parts[0].trim() && out.length) out[out.length - 1].text += " " + parts[0].trim();
    for (let i = 1; i < parts.length; i += 4) {
      const t = (parts[i + 3] || "").trim();
      const start = (+(parts[i] || 0)) * 3600 + +parts[i + 1] * 60 + +parts[i + 2];
      if (t) out.push({ start, text: t });
    }
  }
  return out.length ? out : null;
}

// Senza yt-dlp (o con YouTube che lo blocca, come dagli IP dei datacenter):
// Gemini scarica il video da sé dall'URL e ne trascrive l'audio. fps al minimo
// perché qui serve solo l'audio: ~29 token al secondo, misurato. Gli offset
// funzionano e i marcatori escono già assoluti (verificato su 600s).
//
// Il nemico è RECITATION: su contenuti protetti Gemini a volte si rifiuta di
// trascrivere verbatim e torna vuoto. È intermittente e dipende dalla
// lunghezza: lo stesso pezzo da 5 minuti passa, quello da 10 no. Quindi pezzi
// da 5 minuti, un ritentativo a temperatura alta, poi il pezzo si spezza in due
// fino a 1 minuto. Quello che resta scoperto viene segnato, non inventato.
const CHUNK_SECONDS = 300;
const MIN_CHUNK = 60;

async function transcribeOnce(url, s, e, apiKey, temperature) {
  const text = `${TRANSCRIBE_PROMPT}
Questo è il segmento che parte da ${mmss(s)}: i marcatori devono essere il tempo assoluto dall'inizio del video, non dall'inizio del segmento.`;
  const body = { contents: [{ parts: [videoPart(url, { start: s, end: e, fps: 0.05 }), { text }] }] };
  if (temperature !== undefined) body.generationConfig = { temperature };
  let r;
  try {
    r = await fetch(`${API_BASE}/gemini-flash-latest:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(600_000),
    });
  } catch (err) { return { reason: err?.message || String(err) }; }
  const raw = await r.text();
  if (!r.ok) {
    let detail = raw.slice(0, 300);
    try { detail = JSON.parse(raw)?.error?.message || detail; } catch { /* raw */ }
    if (r.status >= 500) return { reason: `HTTP ${r.status}` };
    die(`API Google: HTTP ${r.status}\n${detail}`);
  }
  const j = JSON.parse(raw);
  const c = j.candidates?.[0];
  const out = (c?.content?.parts || []).map(x => x.text || "").join("");
  const tokens = j.usageMetadata?.promptTokenCount ?? 0;
  if (c?.finishReason === "STOP" && out.trim()) return { text: out, tokens };
  return { reason: c?.finishReason || j.promptFeedback?.blockReason || "vuota", tokens };
}

async function transcribeRange(url, s, e, apiKey, stats) {
  for (const temperature of [undefined, 1.0]) {
    const r = await transcribeOnce(url, s, e, apiKey, temperature);
    stats.tokens += r.tokens || 0;
    if (r.text) return r.text;
    stats.last = r.reason;
  }
  if (e - s > MIN_CHUNK) {
    const m = Math.round((s + e) / 2);
    note(SKILL, `${mmss(s)}–${mmss(e)} rifiutato (${stats.last}), lo spezzo in due.`);
    const [x, y] = await Promise.all([transcribeRange(url, s, m, apiKey, stats), transcribeRange(url, m, e, apiKey, stats)]);
    return x + "\n" + y;
  }
  stats.gaps.push(`${mmss(s)}–${mmss(e)}`);
  return `[${mmss(s)}] [non trascritto: il modello ha rifiutato questo tratto (${stats.last})]`;
}

async function transcribeViaGemini(url, duration, apiKey) {
  const chunks = [];
  for (let s = 0; s < duration; s += CHUNK_SECONDS) chunks.push([s, Math.min(s + CHUNK_SECONDS, duration)]);
  note(SKILL, `trascrizione via Gemini dall'URL: ${chunks.length} pezzi da ${CHUNK_SECONDS / 60} min.`);
  const stats = { tokens: 0, gaps: [], last: null };
  const texts = await Promise.all(chunks.map(([s, e]) => transcribeRange(url, s, e, apiKey, stats)));
  note(SKILL, `trascrizione: ${stats.tokens} token in ingresso.`);
  if (stats.gaps.length) note(SKILL, `ATTENZIONE: tratti non trascritti: ${stats.gaps.join(", ")}.`);
  return parseTimestamped(texts.join("\n"));
}

// Metadati dalla YouTube Data API v3, quando yt-dlp non può. Chiave: il campo
// "youtubeKey" del config, se c'è, altrimenti la geminiKey (stesso progetto
// Google, basta attivarci la Data API). Restituisce la stessa forma di
// info.json di yt-dlp, per i campi che il resto della pipeline usa.
async function infoViaDataApi(id) {
  let key = null;
  try { key = JSON.parse(readFileSync(CONFIG, "utf8")).youtubeKey; } catch { /* sotto */ }
  key = key || loadGeminiKey(SKILL);
  if (!key) die(`yt-dlp non può leggere il video e manca una chiave Google per la YouTube Data API in ${CONFIG}.`);
  const r = await fetch(`https://youtube.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${id}`, {
    headers: { "x-goog-api-key": key },
  });
  const raw = await r.text();
  if (!r.ok) {
    let detail = raw.slice(0, 400);
    try { detail = JSON.parse(raw)?.error?.message || detail; } catch { /* raw */ }
    die(`YouTube Data API: HTTP ${r.status}\n${detail}\n\nServe la "YouTube Data API v3" attiva nel progetto della chiave, `
      + `e la chiave non deve essere ristretta ad altre API.`);
  }
  const v = JSON.parse(raw).items?.[0];
  if (!v) die(`la YouTube Data API non trova il video ${id} (privato o rimosso?).`);
  const d = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(v.contentDetails.duration) || [];
  const duration = (+(d[1] || 0)) * 86400 + (+(d[2] || 0)) * 3600 + (+(d[3] || 0)) * 60 + (+(d[4] || 0));
  const description = v.snippet.description || "";
  return {
    id, title: v.snippet.title, uploader: v.snippet.channelTitle, duration, description,
    language: v.snippet.defaultAudioLanguage || v.snippet.defaultLanguage,
    chapters: chaptersFromDescription(description, duration),
    _source: "youtube-data-api",
  };
}

// I capitoli dell'autore stanno nella descrizione: righe che iniziano con un
// tempo, la prima a 0:00, almeno tre, in ordine (le stesse regole di YouTube).
export function chaptersFromDescription(desc, duration) {
  const rows = [];
  for (const line of desc.split(/\r?\n/)) {
    const m = /^\s*[([]?((?:\d+:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|]?\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const t = m[1].split(":").reduce((a, x) => a * 60 + +x, 0);
    if (rows.length && t <= rows[rows.length - 1].start) continue;
    rows.push({ start: t, title: m[2] });
  }
  if (rows.length < 3 || rows[0].start !== 0) return [];
  return rows.map((r, i) => ({ start_time: r.start, end_time: rows[i + 1]?.start ?? duration, title: r.title }));
}

export async function prep(url, dir, { useSubs = false, id } = {}) {
  const ytdlp = hasYtDlp();
  if (!ytdlp) note(SKILL, "yt-dlp non trovato: metadati dalla YouTube Data API, trascrizione da Gemini.");
  mkdirSync(dir, { recursive: true });

  const infoPath = join(dir, "info.json");
  // La cartella prende il nome dall'id del video, ma un id non riconosciuto la
  // fa ricadere su un nome generico condiviso: senza questo controllo si
  // analizzerebbe il video della corsa precedente, in silenzio.
  let info = null;
  if (existsSync(infoPath)) {
    try {
      const cached = JSON.parse(readFileSync(infoPath, "utf8"));
      if (cached?.id && url.includes(cached.id)) info = cached;
      else note(SKILL, `${infoPath} è di un altro video: lo riscarico.`);
    } catch { /* riscarico */ }
  }
  // yt-dlp bloccato (dagli IP dei datacenter YouTube chiede di dimostrare di
  // non essere un bot) vale come yt-dlp assente: si passa all'API Google, e da
  // lì in poi niente più richieste a YouTube che fallirebbero comunque.
  let blocked = !ytdlp;
  if (!info && ytdlp) {
    const r = spawnSync("yt-dlp", ["--skip-download", "--no-warnings", "-J", url], {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status === 0 && r.stdout.trim()) {
      writeFileSync(infoPath, r.stdout);
      info = JSON.parse(r.stdout);
    } else {
      if (!id) die(`yt-dlp non riesce a leggere ${url}:\n${(r.stderr || "").slice(-400)}`);
      note(SKILL, `yt-dlp bloccato, passo alla YouTube Data API:\n${(r.stderr || "").trim().split("\n").pop().slice(0, 200)}`);
      blocked = true;
    }
  }
  if (!info) {
    if (!id) die(`senza yt-dlp servono link YouTube: non riconosco l'id in ${url}.`);
    info = await infoViaDataApi(id);
    writeFileSync(infoPath, JSON.stringify(info, null, 2));
  }
  if (info._source) blocked = true;

  const transcriptPath = join(dir, "transcript.txt");
  let blocks;
  if (existsSync(transcriptPath)) {
    blocks = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean).map(l => {
      const m = /^\[(\d+)\]\s*(.*)$/.exec(l);
      return { start: +m[1], text: m[2] };
    });
  } else if (!useSubs && (blocks = transcribeAudio(dir, url, !blocked))) {
    writeFileSync(transcriptPath, blocks.map(b => `[${b.start}] ${b.text}`).join("\n") + "\n");
  // Audio non scaricabile ma chiave Google presente: meglio Gemini dall'URL
  // che i sottotitoli automatici, che non hanno punteggiatura né parlanti.
  } else if (blocked || (!useSubs && loadGeminiKey(SKILL))) {
    const key = loadGeminiKey(SKILL, { required: true });
    blocks = await transcribeViaGemini(url, info.duration, key);
    if (!blocks) die("Gemini non ha prodotto una trascrizione.");
    writeFileSync(transcriptPath, blocks.map(b => `[${b.start}] ${b.text}`).join("\n") + "\n");
  } else {
    const track = pickSubtitleTrack(info);
    if (!track) {
      die(`nessun sottotitolo disponibile per ${url}.\n`
        + `Senza trascrizione non si possono ricavare i capitoli: usa go-listen sull'audio, `
        + `oppure la modalità diretta di go-watch se il video è corto.`);
    }
    const subDir = join(dir, "subs");
    mkdirSync(subDir, { recursive: true });
    const r = spawnSync("yt-dlp", [
      "--skip-download", "--no-warnings",
      track.kind === "manuali" ? "--write-subs" : "--write-auto-subs",
      "--sub-langs", track.lang, "--sub-format", "vtt",
      "-o", join(subDir, "s"), url,
    ], { encoding: "utf8" });
    const vtts = readdirSync(subDir).filter(f => f.endsWith(".vtt"));
    // Distinguere "non ci sono" da "non sono riuscito a prenderli": senza questo
    // un errore di rete manda a cercare una trascrizione che invece esiste.
    if (!vtts.length) {
      rmSync(subDir, { recursive: true, force: true });
      die(`yt-dlp non ha scaricato la traccia ${track.lang} (${track.kind}), che info.json dà per esistente`
        + `${r.status !== 0 ? ` — uscito con stato ${r.status}` : ""}:\n${(r.stderr || "").slice(-400)}`);
    }
    note(SKILL, `sottotitoli: ${track.lang} (${track.kind})`);
    blocks = vttToBlocks(readFileSync(join(subDir, vtts[0]), "utf8"));
    writeFileSync(transcriptPath, blocks.map(b => `[${b.start}] ${b.text}`).join("\n") + "\n");
    rmSync(subDir, { recursive: true, force: true });
  }

  // Capitoli dell'autore, se li ha messi: una base di partenza, non un risultato.
  // Li ha scritti sapendo com'è strutturato il video, ma anche per farsi trovare
  // nella barra del player — capitoli promozionali e blocchi da un quarto d'ora
  // vanno comunque verificati, divisi o fusi.
  const authored = (info.chapters || []).map(c => ({
    start: Math.round(c.start_time), end: Math.round(c.end_time), title: c.title,
  }));
  if (authored.length) writeFileSync(join(dir, "chapters-authored.json"), JSON.stringify(authored, null, 2));

  const words = blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
  return { info, blocks, words, authored, dir, transcriptPath };
}

export function report(r) {
  const { info, words, authored, dir, transcriptPath, blocks } = r;
  const lines = [
    `titolo:      ${info.title}`,
    `canale:      ${info.uploader}`,
    `durata:      ${mmss(info.duration)} (${info.duration}s)`,
    `trascrizione: ${transcriptPath} — ${blocks.length} blocchi, ${words} parole, ~${Math.round(words * 1.4)} token`,
    `descrizione: ${(info.description || "").length} caratteri in info.json`,
    "",
  ];
  if (authored.length) {
    lines.push(`capitoli dell'autore: ${authored.length} — ${join(dir, "chapters-authored.json")}`);
    for (const c of authored) lines.push(`  ${mmss(c.start)}–${mmss(c.end)}  ${c.title}`);
    lines.push("", "Prendi questi, aggiungi i campi visual/skippable e salva come chapters.json.");
  } else {
    lines.push("capitoli dell'autore: NESSUNO.", "",
      "Ricavali tu dalla trascrizione e salva chapters.json in questa cartella.");
  }
  return lines.join("\n") + "\n";
}

// Uso diretto: node prep.mjs <url> [dir]
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  if (!url) die("uso: prep.mjs <url-youtube> [cartella] [--subs]");
  // I live archiviati e gli shorts hanno URL diversi da /watch?v=, e sono
  // esattamente i video lunghi che si vogliono leggere invece di guardare:
  // senza queste forme finivano tutti nella stessa cartella "go-watch-video".
  const id = (url.match(/[?&]v=([\w-]{11})/)
    || url.match(/(?:youtu\.be|\/shorts|\/live|\/embed|\/v)\/([\w-]{11})/) || [])[1] || "video";
  const dir = (process.argv[3] && !process.argv[3].startsWith("--") && process.argv[3]) || `/tmp/go-watch-${id}`;
  const r = await prep(url, dir, { useSubs: process.argv.includes("--subs"), id: id === "video" ? null : id });
  note(SKILL, `cartella di lavoro: ${dir}`);
  process.stdout.write(report(r));
}
