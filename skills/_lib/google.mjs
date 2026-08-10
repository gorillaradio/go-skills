// _lib/google.mjs — trasporto verso l'API Google Generative Language.
//
// Esiste accanto a openrouter.mjs per una ragione sola, verificata contro
// l'API live il 2026-08-10: OpenRouter **scarta in silenzio** `video_metadata`.
// Stesso video, quattro posizioni diverse del campo (dentro la content part,
// dentro video_url, top-level), sempre 182.034 prompt token identici al token.
// Senza offset non esiste analisi per capitoli: si paga il video intero ogni volta.
//
// Qui invece `start_offset`, `end_offset` e `fps` funzionano: lo stesso video da
// 616s è sceso a 7.709 token sul segmento 473-558s, e a 3.287 con fps 0.2.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { fail, note } from "./openrouter.mjs";

export const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload";
export const CONFIG = join(homedir(), ".config", "go-skills", "config.json");

// Flash riporta più dettagli del lite a parità esatta di token in ingresso.
// Ma nessuno dei due legge in modo affidabile il testo piccolo di un terminale:
// vedi NOTES.md, "Il testo a schermo non è affidabile". Costa ~4× in tempo.
//
// Gli alias non dicono a cosa puntano, ma la risposta sì: il campo
// `modelVersion` porta il nome vero. Verificato il 2026-08-11:
// gemini-flash-latest -> gemini-3.6-flash, gemini-flash-lite-latest ->
// gemini-3.5-flash-lite. Ricontrollarlo quando i conti non tornano.
export const DEFAULT_MODEL = "gemini-flash-latest";
export const CHEAP_MODEL = "gemini-flash-lite-latest";

// `mediaResolution` viene ignorato quando il video arriva come URL YouTube:
// token identici al default con MEDIA_RESOLUTION_HIGH, su lite e su 3.6-flash.
// Non è un knob su cui contare: l'unico che morde è fps.
export const TOKENS_PER_SECOND = 91; // misurato: 8.508 tok / 92s di segmento

const TIMEOUT_MS = 600_000;

const SETUP = `Configura la chiave Google una volta sola (stesso file della famiglia go-*).

1. Crea una chiave su https://aistudio.google.com/apikey
2. Aggiungila al file esistente come campo "geminiKey":

  python3 - <<'EOF'
  import json, os, getpass
  p = os.path.expanduser("~/.config/go-skills/config.json")
  d = json.load(open(p)) if os.path.exists(p) else {}
  d["geminiKey"] = getpass.getpass("Chiave Google AI Studio: ")
  json.dump(d, open(p, "w"))
  os.chmod(p, 0o600)
  print("-> salvata")
  EOF

Il free tier basta per l'uso normale, ma i dati inviati vengono usati da Google
per migliorare i prodotti: per video YouTube pubblici è irrilevante, per
registrazioni tue del tuo schermo no.`;

// Ritorna la chiave, oppure null se assente: chi chiama decide se ripiegare su
// OpenRouter o fermarsi. Un file JSON rotto invece è sempre un errore.
export function loadGeminiKey(skill, { required = false } = {}) {
  if (!existsSync(CONFIG)) {
    if (required) fail(skill, `nessuna chiave trovata in ${CONFIG}\n\n${SETUP}`);
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {
    fail(skill, `${CONFIG} non è JSON valido.\n\n${SETUP}`);
  }
  const key = parsed?.geminiKey;
  if (typeof key !== "string" || !key.trim()) {
    if (required) fail(skill, `campo "geminiKey" mancante in ${CONFIG}\n\n${SETUP}`);
    return null;
  }
  return key.trim();
}

// Una parte video con gli offset. `fps` è opzionale: default 1.0, range (0, 24].
export function videoPart(url, { start, end, fps } = {}) {
  const meta = {};
  if (start !== undefined) meta.start_offset = `${Math.round(start)}s`;
  if (end !== undefined) meta.end_offset = `${Math.round(end)}s`;
  if (fps !== undefined) meta.fps = fps;
  const part = { file_data: { file_uri: url } };
  if (Object.keys(meta).length) part.video_metadata = meta;
  return part;
}

// Carica un file con la Files API e aspetta che sia utilizzabile. Serve per
// l'audio lungo: qui il limite è 2 GB per file invece dei 40 MB scarsi che
// regge un base64 dentro il body, e il file non paga la codifica in più.
export async function uploadFile(skill, { apiKey, path, mimeType }) {
  const bytes = readFileSync(path);
  const start = await fetch(`${UPLOAD_BASE}/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: basename(path) } }),
  });
  const target = start.headers.get("x-goog-upload-url");
  if (!target) fail(skill, `la Files API non ha aperto l'upload (HTTP ${start.status}):\n${(await start.text()).slice(0, 300)}`);

  const done = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: bytes,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!done.ok) fail(skill, `upload fallito (HTTP ${done.status}):\n${(await done.text()).slice(0, 300)}`);

  // Un file appena caricato resta PROCESSING per qualche secondo; usarlo prima
  // che sia ACTIVE fa fallire la generateContent con un 400 poco parlante.
  let file = (await done.json()).file;
  for (let i = 0; file.state === "PROCESSING" && i < 120; i++) {
    await new Promise(r => setTimeout(r, 2000));
    file = await (await fetch(`${API_BASE.replace("/models", "")}/${file.name}`, {
      headers: { "x-goog-api-key": apiKey },
    })).json();
  }
  if (file.state !== "ACTIVE") fail(skill, `il file caricato è in stato ${file.state}, non utilizzabile.`);
  return file.uri;
}

// Una chiamata, con un solo ritentativo sui 503 (il modello sotto carico è
// transitorio; 429 no, è quota esaurita e ritentare non serve a niente).
export async function generate(skill, { apiKey, model, parts, temperature, json = false, mediaResolution }) {
  const body = { contents: [{ parts }] };
  if (json || temperature !== undefined || mediaResolution) {
    body.generationConfig = {};
    if (json) body.generationConfig.responseMimeType = "application/json";
    if (temperature !== undefined) body.generationConfig.temperature = temperature;
    if (mediaResolution) body.generationConfig.mediaResolution = mediaResolution;
  }
  const payload = JSON.stringify(body);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = process.hrtime.bigint();
    let response;
    try {
      response = await fetch(`${API_BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err?.name === "TimeoutError"
        ? `nessuna risposta entro ${TIMEOUT_MS / 1000}s`
        : err?.message || String(err);
      fail(skill, `chiamata all'API Google fallita (${reason}).`);
    }
    const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
    const raw = await response.text();

    if (!response.ok) {
      if (response.status === 503 && attempt === 1) {
        note(skill, `${model} sotto carico (503), ritento una volta.`);
        continue;
      }
      let detail = raw.slice(0, 500);
      try { detail = JSON.parse(raw)?.error?.message || detail; } catch { /* raw */ }
      const hint = {
        404: `\n\nQuel modello non è più servito ai nuovi account. Prova ${DEFAULT_MODEL} o ${CHEAP_MODEL}.`,
        429: `\n\nQuota del free tier esaurita (i modelli "pro" spesso non ne hanno affatto).\nControlla su https://ai.dev/rate-limit, o attiva il billing sulla chiave.`,
        400: `\n\nSe l'errore parla di contesto, il segmento è troppo lungo: spezzalo o abbassa fps.`,
      }[response.status] || "";
      fail(skill, `API Google: HTTP ${response.status}\n${detail}${hint}`);
    }

    const p = JSON.parse(raw);
    const cand = p.candidates?.[0];
    const text = (cand?.content?.parts || []).map(x => x.text || "").join("");
    if (!text.trim()) {
      if (attempt === 1) { note(skill, "risposta vuota, ritento una volta."); continue; }
      fail(skill, "risposta vuota due volte di fila: nessuna analisi.");
    }
    // STOP è l'unico esito che garantisce un estratto intero. MAX_TOKENS lo
    // tronca a metà frase, SAFETY e RECITATION lo tagliano senza lasciare
    // traccia nel testo: accettarli significa perdere informazione in silenzio,
    // cioè fallire il requisito per cui esiste tutta la pipeline.
    const reason = cand?.finishReason;
    if (reason && reason !== "STOP") {
      const hint = reason === "MAX_TOKENS"
        ? "Il capitolo è troppo denso per una risposta sola: spezzalo in due."
        : "Il modello ha interrotto la generazione da sé: riprova, o spezza il capitolo.";
      fail(skill, `risposta incompleta (finishReason=${reason}), ${text.length} caratteri scritti.\n${hint}`);
    }
    const u = p.usageMetadata || {};
    return { text, seconds, promptTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0 };
  }
}
