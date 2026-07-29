// _lib/openrouter.mjs — trasporto condiviso della famiglia go-*.
// Chiave, chiamata chat/completions con ritentativo sulle risposte tronche,
// riga di costo, base64 e MIME. Le guardie specifiche stanno nelle skill.

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname } from "node:path";

export const API = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
export const CONFIG = join(homedir(), ".config", "go-skills", "config.json");

// Misurati sull'API live il 2026-07-28, per la famiglia gemini flash.
export const CONTEXT_TOKENS = 1_048_576;
export const TOKENS_PER_FRAME = 258; // un fotogramma a risoluzione default
export const TOKENS_PER_FRAME_LOW = 79; // con MEDIA_RESOLUTION_LOW
export const TOKENS_PER_AUDIO_SECOND = 32; // --low non lo riduce
export const RESPONSE_HEADROOM = 16_384; // spazio lasciato a domanda e risposta

// Un body oltre ~57 MB muore con un 502 di Cloudflare dopo 100 secondi.
// Il base64 pesa 4/3 del file: 40 MB di file sono il limite prudente.
export const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

const TIMEOUT_MS = 300_000;

export const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
export const VIDEO_MIME = {
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mov": "video/mov",
  ".webm": "video/webm",
};

const SETUP = `Configura la chiave una volta sola (vale per tutta la famiglia go-*).

1. Crea una chiave dedicata su https://openrouter.ai/keys
2. Esegui nel tuo terminale; la chiave viene chiesta con read -s,
   così non resta né a video né nella history della shell:

  mkdir -p ~/.config/go-skills
  read -s "?Incolla la chiave OpenRouter (sk-or-v1-...): " KEY && \\
  printf '{"apiKey":"%s"}' "$KEY" > ~/.config/go-skills/config.json && \\
  chmod 600 ~/.config/go-skills/config.json && unset KEY && echo " -> chiave salvata"
`;

export function fail(skill, msg) {
  process.stderr.write(`${skill}: ${msg}`.trimEnd() + "\n");
  process.exit(1);
}

export function note(skill, msg) {
  process.stderr.write(`${skill}: ${msg}\n`);
}

export function loadKey(skill) {
  if (!existsSync(CONFIG)) fail(skill, `nessuna chiave API trovata in ${CONFIG}\n\n${SETUP}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {
    fail(skill, `${CONFIG} non è JSON valido.\n\n${SETUP}`);
  }
  const key = parsed?.apiKey;
  if (typeof key !== "string" || !key.trim()) {
    fail(skill, `campo "apiKey" mancante o vuoto in ${CONFIG}\n\n${SETUP}`);
  }
  return key.trim();
}

export function toDataUrl(path, mime) {
  return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
}

export function mimeFor(path, table) {
  return table[extname(path).toLowerCase()];
}

// Una chiamata, con riconoscimento della risposta tronca e un solo ritentativo.
// Osservato il 2026-07-28: HTTP 200 con testo interrotto, finish_reason assente
// e usage a zero. Formalmente valida, di fatto monca. Rilanciata ha funzionato.
export async function chat(skill, { apiKey, model, content, mediaResolution, hint400 }) {
  const body = {
    model,
    messages: [{ role: "user", content }],
    usage: { include: true },
  };
  if (mediaResolution) body.media_resolution = mediaResolution;
  const json = JSON.stringify(body);

  for (let attempt = 1; attempt <= 2; attempt++) {
    let response;
    try {
      response = await fetch(API, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: json,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err?.name === "TimeoutError"
        ? `nessuna risposta entro ${TIMEOUT_MS / 1000}s`
        : err?.message || String(err);
      fail(skill, `chiamata a OpenRouter fallita (${reason}).`);
    }

    const raw = await response.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      if (response.status === 502) {
        fail(skill, `OpenRouter ha risposto 502: la richiesta è quasi certamente troppo pesante.`);
      }
      fail(skill, `risposta non-JSON da OpenRouter (HTTP ${response.status}):\n${raw.slice(0, 400)}`);
    }

    if (!response.ok) {
      const detail = payload?.error?.message || payload?.message || raw.slice(0, 600);
      let hint = "";
      if (response.status === 401) hint = `\n\nLa chiave in ${CONFIG} è stata rifiutata. Verificala su https://openrouter.ai/keys`;
      else if (response.status === 402) hint = `\n\nCredito OpenRouter esaurito, o superato il tetto di spesa della chiave.`;
      else if (response.status === 400 && hint400 && /context|token/i.test(detail)) hint = `\n\n${hint400}`;
      fail(skill, `OpenRouter ha risposto HTTP ${response.status}\n${detail}${hint}`);
    }

    const choice = payload?.choices?.[0];
    const text = typeof choice?.message?.content === "string" ? choice.message.content : "";
    const usage = payload?.usage;
    const truncated = !text.trim() || choice?.finish_reason !== "stop" || !usage || usage.prompt_tokens === 0;
    if (!truncated) return { text, usage };
    if (attempt === 1) {
      note(skill, `risposta tronca (finish_reason=${choice?.finish_reason ?? "assente"}), ritento una volta.`);
    }
  }
  fail(skill, "risposta tronca due volte di fila: nessuna analisi.");
}

export function costLine(skill, model, usage, extra) {
  const cost = usage?.cost !== undefined ? ` · $${Number(usage.cost).toFixed(4)}` : "";
  const tokens = usage ? ` · ${usage.prompt_tokens} tok in · ${usage.completion_tokens} tok out` : "";
  note(skill, `${model}${tokens}${cost}${extra ? ` · ${extra}` : ""}`);
}
