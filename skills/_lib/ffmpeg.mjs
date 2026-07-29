// _lib/ffmpeg.mjs — ffmpeg/ffprobe condivisi dalla famiglia go-*.
// ffmpeg nel PATH è una deroga esplicita alla regola zero-dipendenze del repo:
// senza, le skill non funzionano sui file veri (le registrazioni schermo
// superano quasi sempre il limite di caricamento e vanno compresse).

import { spawnSync } from "node:child_process";
import { fail } from "./openrouter.mjs";

// Sotto questo massimo di volume la traccia è considerata muta. Il silenzio
// digitale sta a -91 dB; il parlato basso non scende sotto i -40.
export const SILENCE_DB = -50;

export function requireFfmpeg(skill) {
  for (const bin of ["ffmpeg", "ffprobe"]) {
    const r = spawnSync(bin, ["-version"], { stdio: "ignore" });
    if (r.error || r.status !== 0) {
      fail(skill, `${bin} non trovato nel PATH. Installa con:\n\n  brew install ffmpeg`);
    }
  }
}

export function probe(skill, path) {
  const r = spawnSync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=r_frame_rate,nb_frames",
      "-show_entries", "format=duration",
      "-of", "json",
      path,
    ],
    { encoding: "utf8" },
  );
  if (r.error || r.status !== 0) {
    fail(skill, `ffprobe non riesce a leggere ${path}:\n${(r.stderr || "").slice(-400)}`);
  }
  const j = JSON.parse(r.stdout);
  const duration = Number.parseFloat(j.format?.duration);
  const stream = j.streams?.[0];
  let fps;
  if (stream?.r_frame_rate) {
    const [num, den] = stream.r_frame_rate.split("/").map(Number);
    if (den) fps = num / den;
  }
  const frames = Number(stream?.nb_frames)
    || (Number.isFinite(duration) && fps ? Math.round(duration * fps) : undefined);
  return { duration, fps, frames, hasVideo: Boolean(stream) };
}

export function hasAudioStream(path) {
  const r = spawnSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", path],
    { encoding: "utf8" },
  );
  return r.status === 0 && r.stdout.trim().length > 0;
}

// Una traccia muta costa 32 token al secondo e induce il modello a inventare
// una trascrizione completa e credibile (osservato il 2026-07-28). Va rilevata
// prima di spedire.
export function maxVolumeDb(skill, path) {
  const r = spawnSync(
    "ffmpeg",
    ["-i", path, "-map", "0:a:0", "-af", "volumedetect", "-vn", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const m = (r.stderr || "").match(/max_volume:\s*(-?[\d.]+)\s*dB/);
  if (!m) fail(skill, `impossibile misurare il volume audio di ${path}.`);
  return Number.parseFloat(m[1]);
}

export function runFfmpeg(skill, args, what) {
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    fail(skill, `ffmpeg fallito (${what}):\n${(r.stderr || "").slice(-400)}`);
  }
}
