// go-watch extract — un estratto per capitolo, guardando solo i capitoli che
// lo meritano. I capitoli `skippable` non vengono mai spediti; quelli senza
// `visual` si risolvono con la trascrizione già in mano, a costo zero.

import { readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync, rmSync, statSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fail, note, loadKey, toDataUrl, chat, MAX_UPLOAD_BYTES, TOKENS_PER_VIDEO_SECOND } from "../_lib/openrouter.mjs";
import { loadGeminiKey, generate, videoPart, DEFAULT_MODEL, TOKENS_PER_SECOND } from "../_lib/google.mjs";
import { requireFfmpeg } from "../_lib/ffmpeg.mjs";
import { mmss, requireYtDlp } from "./prep.mjs";

const SKILL = "go-watch extract";
const die = (msg) => fail(SKILL, msg);

// Sul ripiego serve un flash, non il lite: il lite parafrasa dove flash
// trascrive. Gli alias `-latest` dell'API Google **non esistono** su OpenRouter
// (HTTP 400 "is not a valid model ID"): qui i modelli sono versionati, e questo
// è il flash più recente con `video` fra le input_modalities.
const OR_VIDEO_MODEL = "google/gemini-3.6-flash";

export const CHAPTER_PROMPT = `Guarda questo segmento e riportane il contenuto per chi non lo vedrà.

- ogni passo, in ordine, senza saltare i passaggi intermedi;
- ogni comando digitato o mostrato a schermo, trascritto alla lettera in blocchi di codice,
  incluso l'output del terminale;
- ogni URL, nome di pacchetto, versione, percorso, numero o etichetta visibile;
- ogni cosa detta a voce che non si deduce dalle immagini: avvertenze, prerequisiti,
  motivazioni, opinioni;
- distingui ciò che è mostrato a schermo da ciò che è solo affermato a voce;
- se qualcosa è illeggibile o ambiguo, scrivilo come tale invece di ricostruirlo;
- se qualcosa non è rendibile a parole — un'animazione, un movimento di interfaccia, un
  confronto visivo — dichiaralo su una riga a sé che inizia con "DA VEDERE mm:ss —",
  seguita dal perché guardarlo aggiunge qualcosa. Sei l'unico che il video l'ha visto:
  chi scriverà l'articolo non può indovinarlo.

Non riassumere e non commentare: questo testo è materia prima per una sintesi successiva.
Rispondi in italiano.`;

// I blocchi durano ~15s, quindi un confine di capitolo cade quasi sempre dentro
// un blocco. Prendere solo i blocchi che iniziano dopo `start` perde l'attacco
// del capitolo — spesso la frase che dice di cosa si parla. Si include quindi
// anche il blocco che contiene `start`: meglio una frase ripetuta al bordo
// (la scarta chi scrive l'articolo) che una persa.
function transcriptSlice(dir, start, end) {
  const lines = readFileSync(join(dir, "transcript.txt"), "utf8").split("\n");
  const stamped = [];
  for (const l of lines) {
    const m = /^\[(\d+)\]\s*(.*)$/.exec(l);
    if (m) stamped.push({ ts: +m[1], text: m[2] });
  }
  let from = 0;
  for (let i = 0; i < stamped.length; i++) if (stamped[i].ts <= start) from = i;
  return stamped.slice(from).filter(b => b.ts < end).map(b => b.text).join(" ");
}

// Un solo listener per tutto il processo: registrarne uno per capitolo fa
// scattare il warning di Node oltre i dieci. Serve "exit" e non un finally,
// perché die() chiama process.exit() e i finally non li esegue affatto.
const tmpDirs = new Set();
process.on("exit", () => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

// Ripiego su OpenRouter: gli offset lì vengono scartati, quindi il segmento va
// ritagliato prima. Costa una passata di rete e di encoding per capitolo.
function cutSegment(url, start, end) {
  requireYtDlp();
  requireFfmpeg(SKILL);
  const tmp = mkdtempSync(join(tmpdir(), "go-watch-seg-"));
  tmpDirs.add(tmp);
  const out = join(tmp, "seg.mp4");
  const r = spawnSync("yt-dlp", [
    "--no-warnings", "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]",
    "--download-sections", `*${start}-${end}`, "--force-keyframes-at-cuts",
    "--merge-output-format", "mp4", "-o", out, url,
  ], { encoding: "utf8" });
  if (r.status !== 0 || !existsSync(out)) {
    die(`yt-dlp non riesce a ritagliare ${start}-${end}s:\n${(r.stderr || "").slice(-400)}`);
  }
  return { path: out, cleanup: () => { tmpDirs.delete(tmp); rmSync(tmp, { recursive: true, force: true }); } };
}

export async function extractChapters({ url, dir, chapters, model, fps, force = false }) {
  const outDir = join(dir, "extracts");
  mkdirSync(outDir, { recursive: true });

  const geminiKey = loadGeminiKey(SKILL);
  const orKey = geminiKey ? null : loadKey(SKILL); // se manca anche questa, esce qui
  if (!geminiKey) {
    note(SKILL, "nessuna geminiKey: ripiego su OpenRouter ritagliando i segmenti con yt-dlp (più lento, ~3× i token).");
    if (fps !== undefined) note(SKILL, "--fps non ha effetto sul ripiego: il campionamento lo decide il modello.");
  }

  const written = [];
  let totalTokens = 0, totalSeconds = 0;

  for (const [i, c] of chapters.entries()) {
    const name = `${String(i).padStart(2, "0")}-${(c.title || "capitolo").toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}.md`;
    const path = join(outDir, name);
    const head = `# ${mmss(c.start)}–${mmss(c.end)} · ${c.title}`;

    if (c.skippable) { note(SKILL, `SALTA  ${mmss(c.start)} ${c.title}`); continue; }
    if (existsSync(path) && !force) { note(SKILL, `CACHE  ${mmss(c.start)} ${c.title}`); written.push(path); continue; }

    if (!c.visual) {
      writeFileSync(path, `${head}\n\n*solo trascrizione*\n\n${transcriptSlice(dir, c.start, c.end)}\n`);
      note(SKILL, `TESTO  ${mmss(c.start)} ${c.title}`);
      written.push(path);
      continue;
    }

    let text, promptTokens = 0, seconds = 0;
    if (geminiKey) {
      const r = await generate(SKILL, {
        apiKey: geminiKey, model,
        parts: [{ text: CHAPTER_PROMPT }, videoPart(url, { start: c.start, end: c.end, fps })],
      });
      ({ text, promptTokens, seconds } = r);
    } else {
      const seg = cutSegment(url, c.start, c.end);
      try {
        if (statSync(seg.path).size > MAX_UPLOAD_BYTES) {
          die(`il segmento ${mmss(c.start)}–${mmss(c.end)} pesa troppo per OpenRouter: spezza il capitolo.`);
        }
        // Il segmento ritagliato riparte da zero, quindi i timestamp uscirebbero
        // riferiti al file: "DA VEDERE 00:32" invece di 05:48. Sul percorso
        // Google non serve — con gli offset il modello vede il tempo vero.
        const rebase = `\n\nQuesto è un ritaglio: il suo istante 00:00 è ${mmss(c.start)} del video intero.`
          + ` Ogni timestamp che scrivi va riferito al video intero, non al ritaglio.`;
        const t0 = process.hrtime.bigint();
        const r = await chat(SKILL, {
          apiKey: orKey, model: model.startsWith("google/") ? model : OR_VIDEO_MODEL,
          content: [
            { type: "text", text: CHAPTER_PROMPT + rebase },
            { type: "video_url", video_url: { url: toDataUrl(seg.path, "video/mp4") } },
          ],
          hint400: "Segmento troppo lungo per il contesto: spezza il capitolo in due.",
        });
        seconds = Number(process.hrtime.bigint() - t0) / 1e9;
        text = r.text;
        promptTokens = r.usage?.prompt_tokens ?? 0;
      } finally { seg.cleanup(); }
    }

    totalTokens += promptTokens; totalSeconds += seconds;
    writeFileSync(path, `${head}\n\n*${promptTokens} tok · ${seconds.toFixed(0)}s*\n\n${text.trim()}\n`);
    note(SKILL, `VISTO  ${mmss(c.start)} ${c.title} — ${promptTokens} tok, ${seconds.toFixed(0)}s`);
    written.push(path);
  }

  // Gli estratti di una corsa precedente non sopravvivono a un chapters.json
  // rivisto: cambiando i confini cambiano gli indici, e il passo che scrive
  // l'articolo legge tutta la cartella. Un .md orfano diventa contenuto
  // duplicato o stantio nell'articolo, senza che nessuno se ne accorga.
  const keep = new Set(written.map(p => p.split("/").pop()));
  for (const f of readdirSync(outDir)) {
    if (f.endsWith(".md") && !keep.has(f)) {
      unlinkSync(join(outDir, f));
      note(SKILL, `rimosso estratto orfano: ${f}`);
    }
  }

  note(SKILL, `totale: ${totalTokens} token di video, ${totalSeconds.toFixed(0)}s di chiamate.`);
  return written;
}

// Uso diretto: node extract.mjs <url> <dir> [-m modello] [--fps N] [--force]
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const url = argv[0], dir = argv[1];
  if (!url || !dir) die("uso: extract.mjs <url-youtube> <cartella> [-m modello] [--fps N] [--force]");
  const opt = (flag, def) => {
    const i = argv.indexOf(flag);
    return i === -1 ? def : argv[i + 1];
  };
  const chaptersPath = join(dir, "chapters.json");
  if (!existsSync(chaptersPath)) {
    die(`manca ${chaptersPath}.\nRicava i capitoli dalla trascrizione (o parti da chapters-authored.json) `
      + `e salvali con i campi start, end, title, visual, skippable.`);
  }
  const rawFps = opt("--fps", undefined);
  const fps = rawFps === undefined ? undefined : Number(rawFps);
  if (fps !== undefined && !(Number.isFinite(fps) && fps > 0 && fps <= 24)) {
    die(`--fps ${rawFps} non è valido: serve un numero in (0, 24].`);
  }

  // Sul ripiego il limite vero non sono i token ma i 40 MB di upload: un
  // segmento 720p pesa ~4,8 MB al minuto, quindi si sfonda intorno agli otto.
  // Meglio dirlo prima di scaricare mezz'ora di video per poi buttarla.
  const viaGoogle = !!loadGeminiKey(SKILL);
  const rate = viaGoogle ? TOKENS_PER_SECOND * (fps ?? 1) : TOKENS_PER_VIDEO_SECOND;
  const maxSeconds = viaGoogle ? Infinity : 7 * 60;

  const chapters = JSON.parse(readFileSync(chaptersPath, "utf8"));
  for (const c of chapters) {
    if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.end <= c.start) {
      die(`capitolo non valido: ${JSON.stringify(c)} — servono start ed end in secondi, con end > start.`);
    }
    if (!c.visual || c.skippable) continue;
    const cost = Math.round((c.end - c.start) * rate);
    if (cost > 300_000) {
      die(`il capitolo "${c.title}" dura ${mmss(c.end - c.start)} (~${cost} token): spezzalo prima di guardarlo.`);
    }
    if (c.end - c.start > maxSeconds) {
      die(`il capitolo "${c.title}" dura ${mmss(c.end - c.start)}: sul ripiego OpenRouter il segmento va caricato intero `
        + `e sopra i ~8 minuti sfonda il limite di 40 MB. Spezzalo, o configura la geminiKey.`);
    }
  }

  // Un buco fra due capitoli è contenuto che sparisce senza che nessuno lo
  // dica: è il modo silenzioso di fallire il requisito di completezza.
  const duration = existsSync(join(dir, "info.json"))
    ? JSON.parse(readFileSync(join(dir, "info.json"), "utf8")).duration : null;
  const sorted = [...chapters].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].start - sorted[i - 1].end;
    if (gap > 5) note(SKILL, `ATTENZIONE: ${mmss(gap)} scoperti fra "${sorted[i - 1].title}" e "${sorted[i].title}".`);
  }
  if (sorted.length && duration && duration - sorted[sorted.length - 1].end > 5) {
    note(SKILL, `ATTENZIONE: ${mmss(duration - sorted[sorted.length - 1].end)} scoperti in coda al video.`);
  }

  const written = await extractChapters({
    url, dir, chapters, fps,
    model: opt("-m", DEFAULT_MODEL),
    force: argv.includes("--force"),
  });
  process.stdout.write(written.join("\n") + "\n");
}
