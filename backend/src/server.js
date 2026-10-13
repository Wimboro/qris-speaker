import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";
import { openDatabase, rupiah } from "./db.js";
import { signature, signaturesMatch, signedFields } from "./midtrans.js";
import {
  callbackSignature,
  createQrisInquiry,
  signaturesMatch as duitkuSignaturesMatch,
  transactionStatus,
} from "./duitku.js";
import {
  callbackPayment,
  callbackView,
  dynamicQris,
  expireDynamicOrders,
  fetchMutations,
  primeSeen,
  recordCredit,
  secretMatches,
  seenPrimed,
} from "./qiospay.js";
import { renderSpeech } from "./speech.js";

function loadEnvFile() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || "";
const IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === "true";
const DEVICE_TOKEN = process.env.DEVICE_TOKEN || "";
const STATIC_QR = process.env.STATIC_QR_STRING || "";
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const DUITKU_MERCHANT = process.env.DUITKU_MERCHANT_CODE || "";
const DUITKU_KEY = process.env.DUITKU_API_KEY || "";
const DUITKU_PRODUCTION = process.env.DUITKU_IS_PRODUCTION === "true";
const DUITKU_METHOD = process.env.DUITKU_PAYMENT_METHOD || "SP";
const DUITKU_EMAIL = process.env.DUITKU_EMAIL || "";
const DUITKU_NAME = process.env.DUITKU_CUSTOMER_NAME || "";
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || "duitku";
const QIOSPAY_MERCHANT = process.env.QIOSPAY_MERCHANT_CODE || "";
const QIOSPAY_KEY = process.env.QIOSPAY_API_KEY || "";
const QIOSPAY_SECRET = process.env.QIOSPAY_CALLBACK_SECRET || "";
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const AUDIO_DIR = path.join(DATA_DIR, "audio");

function requireEnv() {
  const missing = [];
  if (!DEVICE_TOKEN) missing.push("DEVICE_TOKEN");
  if (!PUBLIC_BASE) missing.push("PUBLIC_BASE_URL");
  if (PAYMENT_PROVIDER === "qiospay") {
    if (!QIOSPAY_MERCHANT) missing.push("QIOSPAY_MERCHANT_CODE");
    if (!QIOSPAY_KEY) missing.push("QIOSPAY_API_KEY");
    if (!QIOSPAY_SECRET) missing.push("QIOSPAY_CALLBACK_SECRET");
    if (!STATIC_QR || !STATIC_QR.includes("5802ID")) missing.push("STATIC_QR_STRING");
  } else {
    if (!SERVER_KEY) missing.push("MIDTRANS_SERVER_KEY");
    if (!DUITKU_MERCHANT) missing.push("DUITKU_MERCHANT_CODE");
    if (!DUITKU_KEY) missing.push("DUITKU_API_KEY");
    if (!DUITKU_EMAIL) missing.push("DUITKU_EMAIL");
    if (!DUITKU_NAME) missing.push("DUITKU_CUSTOMER_NAME");
  }
  if (missing.length) {
    console.error(`Variabel env belum diisi: ${missing.join(", ")}`);
    process.exit(1);
  }
}

function tokensMatch(received) {
  const left = Buffer.from(received || "");
  const right = Buffer.from(DEVICE_TOKEN);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function deviceAuth(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : req.get("x-device-token") || "";
  if (!tokensMatch(token)) {
    res.status(401).json({ error: "token perangkat ditolak" });
    return;
  }
  next();
}

function nowIso() {
  return new Date().toISOString();
}

function safeName(orderId) {
  return String(orderId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "order";
}

export function createApp(db) {
  const app = express();
  app.use(express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/device/config", deviceAuth, (_req, res) => {
    res.json({
      static_qr_string: STATIC_QR,
      poll_interval_ms: 2000,
    });
  });

  app.post("/device/charge", deviceAuth, async (req, res) => {
    const amount = rupiah(req.body?.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > 99_999_999) {
      res.status(400).json({ error: "nominal tidak valid" });
      return;
    }
    const orderId = `qris-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    if (PAYMENT_PROVIDER === "qiospay") {
      let qrString;
      try {
        qrString = dynamicQris(STATIC_QR, amount);
      } catch (error) {
        res.status(error.status || 500).json({ error: error.message });
        return;
      }
      const ts = nowIso();
      db.prepare(`
        INSERT INTO orders (
          order_id, gross_amount, status, fraud_status, qr_string, source, created_at, updated_at
        ) VALUES (?, ?, 'pending', NULL, ?, 'dynamic', ?, ?)
      `).run(orderId, amount, qrString, ts, ts);
      console.log(`charge ${orderId} amount ${amount}`);
      res.status(201).json({
        order_id: orderId,
        gross_amount: amount,
        qr_string: qrString,
        qr_url: "",
        status: "pending",
      });
      return;
    }
    try {
      const charge = await createQrisInquiry({
        merchantCode: DUITKU_MERCHANT,
        apiKey: DUITKU_KEY,
        isProduction: DUITKU_PRODUCTION,
        paymentMethod: DUITKU_METHOD,
        email: DUITKU_EMAIL,
        customerName: DUITKU_NAME,
        callbackUrl: `${PUBLIC_BASE}/duitku/callback`,
        returnUrl: `${PUBLIC_BASE}/duitku/return`,
        orderId,
        amount,
      });
      const ts = nowIso();
      db.prepare(`
        INSERT INTO orders (
          order_id, gross_amount, status, fraud_status, qr_string, source, created_at, updated_at
        ) VALUES (?, ?, 'pending', NULL, ?, 'dynamic', ?, ?)
      `).run(charge.orderId, amount, charge.qrString, ts, ts);
      if (charge.paymentUrl) console.log(`charge ${charge.orderId} payment_url ${charge.paymentUrl}`);
      else console.log(`charge ${charge.orderId} amount ${amount}`);
      res.status(201).json({
        order_id: charge.orderId,
        gross_amount: amount,
        qr_string: charge.qrString,
        qr_url: charge.paymentUrl,
        status: "pending",
      });
    } catch (error) {
      console.error(`charge gagal: ${error.message}`);
      res.status(error.status || 502).json({ error: error.message });
    }
  });

  app.get("/device/events", deviceAuth, (req, res) => {
    if (PAYMENT_PROVIDER === "qiospay") expireDynamicOrders(db);
    const requested = String(req.query.order_id || "");
    const order = requested
      ? db.prepare(`
          SELECT order_id, status, fraud_status, gross_amount, qr_string
          FROM orders WHERE order_id = ?
        `).get(requested)
      : db.prepare(`
          SELECT order_id, status, fraud_status, gross_amount, qr_string
          FROM orders
          WHERE source = 'dynamic' AND status = 'pending'
          ORDER BY created_at DESC LIMIT 1
        `).get();
    const announcements = db.prepare(`
      SELECT id, order_id, amount, wav_path
      FROM announcements
      WHERE acked = 0
      ORDER BY id ASC
    `).all().map((row) => ({
      id: row.id,
      order_id: row.order_id,
      amount: row.amount,
      audio_url: row.wav_path ? `/device/audio/${row.id}` : "",
    }));
    res.json({ order: order || null, announcements });
  });

  app.get("/device/audio/:id", deviceAuth, (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare("SELECT wav_path FROM announcements WHERE id = ?").get(id);
    if (!row?.wav_path) {
      res.status(404).json({ error: "audio tidak ada" });
      return;
    }
    const file = path.resolve(row.wav_path);
    const root = path.resolve(AUDIO_DIR);
    if (!file.startsWith(`${root}${path.sep}`)) {
      res.status(404).json({ error: "audio tidak ada" });
      return;
    }
    res.sendFile(file);
  });

  app.post("/device/announcements/:id/ack", deviceAuth, (req, res) => {
    const id = Number(req.params.id);
    db.prepare("UPDATE announcements SET acked = 1 WHERE id = ?").run(id);
    res.json({ ok: true });
  });

  app.post("/midtrans/notification", async (req, res) => {
    const fields = signedFields(req.rawBody, req.body);
    const expected = signature(
      fields.orderId,
      fields.statusCode,
      fields.grossAmount,
      SERVER_KEY,
    );
    if (!fields.orderId || !signaturesMatch(req.body?.signature_key, expected)) {
      res.status(403).json({ error: "signature ditolak" });
      return;
    }
    const status = String(req.body.transaction_status || "").toLowerCase();
    const fraud = String(req.body.fraud_status || "").toLowerCase();
    const amount = rupiah(fields.grossAmount);
    if (amount === null) {
      res.status(400).json({ error: "gross_amount tidak valid" });
      return;
    }
    const ts = nowIso();
    const existing = db.prepare("SELECT source, qr_string FROM orders WHERE order_id = ?").get(fields.orderId);
    db.prepare(`
      INSERT INTO orders (
        order_id, gross_amount, status, fraud_status, qr_string, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        gross_amount = excluded.gross_amount,
        status = excluded.status,
        fraud_status = excluded.fraud_status,
        updated_at = excluded.updated_at
    `).run(
      fields.orderId,
      amount,
      status,
      fraud || null,
      existing?.qr_string || null,
      existing?.source || "static",
      ts,
      ts,
    );
    console.log(`notify ${fields.orderId} ${status} ${amount}`);
    if (status === "settlement" && fraud === "accept") {
      await announce(db, fields.orderId, amount);
    }
    res.json({ ok: true });
  });

  app.get("/duitku/return", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  app.post("/duitku/callback", async (req, res) => {
    const merchantCode = String(req.body?.merchantCode || "");
    const amountRaw = req.body?.amount == null ? "" : String(req.body.amount);
    const orderId = String(req.body?.merchantOrderId || "");
    const resultCode = String(req.body?.resultCode || "");
    const expected = callbackSignature(merchantCode, amountRaw, orderId, DUITKU_KEY);
    if (
      !orderId ||
      merchantCode !== DUITKU_MERCHANT ||
      !duitkuSignaturesMatch(req.body?.signature, expected)
    ) {
      res.status(403).json({ error: "signature ditolak" });
      return;
    }
    const existing = db.prepare(`
      SELECT source, gross_amount FROM orders WHERE order_id = ?
    `).get(orderId);
    console.log(`notify ${orderId} ${resultCode} ${amountRaw}`);
    if (!existing || existing.source !== "dynamic") {
      res.json({ ok: true });
      return;
    }
    const ts = nowIso();
    if (resultCode === "00") {
      let statusCode = "";
      try {
        const status = await transactionStatus({
          merchantCode: DUITKU_MERCHANT,
          apiKey: DUITKU_KEY,
          isProduction: DUITKU_PRODUCTION,
          orderId,
        });
        statusCode = status.statusCode;
      } catch (error) {
        console.error(`status duitku gagal ${orderId}: ${error.message}`);
        res.status(502).json({ error: error.message });
        return;
      }
      if (statusCode !== "00") {
        res.status(502).json({ error: "status belum success" });
        return;
      }
      db.prepare(`
        UPDATE orders SET status = 'settlement', updated_at = ? WHERE order_id = ?
      `).run(ts, orderId);
      await announce(db, orderId, existing.gross_amount);
    } else if (resultCode === "01") {
      db.prepare(`
        UPDATE orders SET status = 'expire', updated_at = ? WHERE order_id = ?
      `).run(ts, orderId);
    }
    res.json({ ok: true });
  });

  app.post("/qiospay/callback/:secret", async (req, res) => {
    if (PAYMENT_PROVIDER !== "qiospay") {
      res.status(404).json({ error: "tidak ada" });
      return;
    }
    if (!secretMatches(req.params.secret, QIOSPAY_SECRET)) {
      res.status(403).json({ status: "reject", message: "Invalid secret key", data: null });
      return;
    }
    const view = callbackView(req.body);
    const payment = callbackPayment(req.body);
    const result = payment?.type === "CR" ? recordCredit(db, payment) : null;
    res.json({
      status: "accept",
      message: "Data received successfully",
      data: view,
    });
    if (result?.action === "recorded") {
      console.log(`notify ${result.orderId} CR ${result.amount}`);
      await announce(db, result.orderId, result.amount);
    }
  });

  return app;
}

async function announce(db, orderId, amount) {
  const existing = db.prepare("SELECT id FROM announcements WHERE order_id = ?").get(orderId);
  if (existing) return;
  mkdirSync(AUDIO_DIR, { recursive: true });
  const dest = path.join(AUDIO_DIR, `${safeName(orderId)}.wav`);
  let wavPath = null;
  try {
    await renderSpeech(amount, dest);
    wavPath = dest;
  } catch (error) {
    console.error(`suara gagal ${orderId}: ${error.message}`);
  }
  try {
    db.prepare(`
      INSERT INTO announcements (order_id, amount, wav_path, created_at)
      VALUES (?, ?, ?, ?)
    `).run(orderId, amount, wavPath, nowIso());
  } catch (error) {
    if (!String(error.message).includes("UNIQUE")) throw error;
  }
}

function startedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function startMutationPoll(db) {
  const announceAfter = Date.now() - 15 * 60 * 1000;
  const tick = async () => {
    const found = [];
    try {
      expireDynamicOrders(db);
      const payments = await fetchMutations({
        merchantCode: QIOSPAY_MERCHANT,
        apiKey: QIOSPAY_KEY,
      });
      const first = !seenPrimed(db);
      if (first) {
        primeSeen(db, payments);
        console.log(`mutasi qiospay awal ${payments.length} baris`);
      }
      for (const payment of payments) {
        if (payment.type !== "CR") continue;
        const result = recordCredit(db, payment, announceAfter);
        if (result.action !== "recorded") continue;
        console.log(`notify ${result.orderId} CR ${result.amount}`);
        found.push(result);
      }
    } catch (error) {
      console.error(`mutasi qiospay gagal: ${error.message}`);
    } finally {
      setTimeout(tick, 5000);
    }
    for (const result of found) await announce(db, result.orderId, result.amount);
  };
  setTimeout(tick, 1000);
}

if (startedDirectly()) {
  requireEnv();
  const database = openDatabase(DATA_DIR);
  const app = createApp(database);
  if (PAYMENT_PROVIDER === "qiospay") startMutationPoll(database);
  app.listen(PORT, "0.0.0.0", () => {
    if (PAYMENT_PROVIDER === "qiospay") {
      console.log(`qris-speaker mendengar di :${PORT} (qiospay)`);
      return;
    }
    const midtransMode = IS_PRODUCTION ? "production" : "sandbox";
    const duitkuMode = DUITKU_PRODUCTION ? "production" : "sandbox";
    console.log(`qris-speaker mendengar di :${PORT} (midtrans ${midtransMode}, duitku ${duitkuMode})`);
  });
}
