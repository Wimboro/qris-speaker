import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";

const DIGIT = [null, "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan"];
const pageDir = path.dirname(new URL(import.meta.url).pathname);
const PAGE = readFileSync(path.join(pageDir, "uji.html"), "utf8");
const DEVICE_PAGE = readFileSync(path.join(pageDir, "perangkat.html"), "utf8");

function below1000(n) {
  const out = [];
  if (n >= 100) {
    const hundreds = Math.floor(n / 100);
    if (hundreds === 1) out.push("seratus");
    else out.push(DIGIT[hundreds], "ratus");
    n %= 100;
  }
  if (n >= 20) {
    out.push(DIGIT[Math.floor(n / 10)], "puluh");
    n %= 10;
    if (n) out.push(DIGIT[n]);
  } else if (n >= 12) out.push(DIGIT[n - 10], "belas");
  else if (n === 11) out.push("sebelas");
  else if (n === 10) out.push("sepuluh");
  else if (n > 0) out.push(DIGIT[n]);
  return out;
}

export function kataParts(amount) {
  const parts = ["bunyi koin"];
  let rest = amount;
  const scales = [
    [1_000_000_000, "miliar", null],
    [1_000_000, "juta", "sejuta"],
    [1000, "ribu", "seribu"],
  ];
  for (const [value, word, alone] of scales) {
    const quote = Math.floor(rest / value);
    rest %= value;
    if (!quote) continue;
    if (quote === 1 && alone) parts.push(alone);
    else parts.push(...below1000(quote), word);
  }
  if (rest) parts.push(...below1000(rest));
  parts.push("rupiah", "diterima");
  return parts;
}

function jakartaStamp(ms) {
  const shifted = new Date(ms + 7 * 60 * 60 * 1000);
  const [date, time] = shifted.toISOString().slice(0, 16).split("T");
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year} ${time}`;
}

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function runUji({
  base,
  secret,
  token,
  amount,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  timeoutMs = 25000,
}) {
  if (!Number.isInteger(amount) || amount < 1 || amount > 99_999_999) throw fail("nominal tidak valid", 400);
  if (!base || !secret || !token) throw fail("PUBLIC_BASE_URL, callback, atau token perangkat kosong", 500);
  const ref = `uji-speaker-${amount}-${now().toString(36)}`;
  const orderId = `qios-ref-${ref}`;
  const response = await fetchImpl(`${base.replace(/\/$/, "")}/qiospay/callback/${secret}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: {
        amount,
        type: "CR",
        refid: ref,
        balance: String(900000 + (now() % 10000)),
        time: jakartaStamp(now()),
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status !== "accept") {
    throw fail(body.message || `callback ditolak (${response.status})`, 502);
  }
  const headers = { authorization: `Bearer ${token}` };
  const started = now();
  let queued = false;
  while (now() - started < timeoutMs) {
    await sleep(1000);
    const events = await fetchImpl(`${base.replace(/\/$/, "")}/device/events`, { headers });
    const json = await events.json().catch(() => ({}));
    const hit = (json.announcements || []).some((row) => row.order_id === orderId);
    if (hit) queued = true;
    if (queued && !hit) {
      return { amount, orderId, phrase: kataParts(amount).join(", "), queued: true, acked: true };
    }
  }
  return { amount, orderId, phrase: kataParts(amount).join(", "), queued, acked: false };
}

export function createUjiApp(options) {
  const app = express();
  app.use(express.json());
  app.get("/", (_req, res) => {
    res.type("html").send(PAGE);
  });
  app.get("/perangkat", (_req, res) => {
    res.type("html").send(DEVICE_PAGE);
  });
  app.get("/api/siap", (_req, res) => {
    const ready = Boolean(options.base && options.secret && options.token);
    res.json({ ok: ready });
  });
  app.post("/api/uji", async (req, res) => {
    try {
      const amount = Number(req.body?.amount);
      const result = await runUji({ ...options, amount });
      res.json(result);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });
  return app;
}

function startedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (startedDirectly()) {
  const port = Number(process.env.UJI_PORT || 3040);
  const app = createUjiApp({
    base: process.env.PUBLIC_BASE_URL || "",
    secret: process.env.QIOSPAY_CALLBACK_SECRET || "",
    token: process.env.DEVICE_TOKEN || "",
  });
  app.listen(port, "127.0.0.1", () => {
    console.log(`uji speaker di http://127.0.0.1:${port}`);
  });
}
