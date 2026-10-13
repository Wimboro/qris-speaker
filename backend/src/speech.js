import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { kalimatNominal } from "./terbilang.js";

function isWav(bytes) {
  return (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WAVE"
  );
}

function mp3ToWav(bytes, destPath) {
  const dir = mkdtempSync(path.join(tmpdir(), "qris-"));
  const src = path.join(dir, "in.mp3");
  try {
    writeFileSync(src, bytes);
    const ffmpeg = spawnSync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-i", src, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", destPath],
      { encoding: "utf8" },
    );
    if (ffmpeg.error) throw new Error("ffmpeg tidak terpasang");
    if (ffmpeg.status !== 0) throw new Error(ffmpeg.stderr || "ffmpeg gagal mengubah suara");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function renderSpeech(amount, destPath) {
  const url = process.env.TTS_URL || "http://127.0.0.1:20128/v1/audio/speech";
  const apiKey = process.env.TTS_API_KEY || "";
  if (!apiKey) throw new Error("TTS_API_KEY belum diisi");
  const body = {
    model: process.env.TTS_MODEL || "gemini/gemini-3.1-flash-tts-preview/Rasalgethi",
    input: kalimatNominal(amount),
    response_format: "wav",
  };
  if (process.env.TTS_LANGUAGE) body.language = process.env.TTS_LANGUAGE;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`TTS menolak (${response.status}) ${detail.slice(0, 180)}`.trim());
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (isWav(bytes)) {
    writeFileSync(destPath, bytes);
    return;
  }
  mp3ToWav(bytes, destPath);
}
