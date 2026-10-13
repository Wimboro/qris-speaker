import { timingSafeEqual } from "node:crypto";
import { rupiah } from "./db.js";

export const QR_TTL_MS = 15 * 60 * 1000;
export const LINK_MS = 2 * 60 * 1000;
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const PRIMED_KEY = "primed";

export function crc16(value) {
  let crc = 0xffff;
  for (let i = 0; i < value.length; i++) {
    crc ^= value.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function dynamicQris(staticQr, amount) {
  const raw = String(staticQr || "").trim();
  if (!raw) throw fail("STATIC_QR_STRING kosong", 500);
  if (amount == null || amount === "") return raw;
  const nominal = String(amount);
  if (!/^[1-9]\d*$/.test(nominal)) throw fail("nominal tidak valid", 400);
  if (raw.length < 8) throw fail("QRIS statis tidak valid", 500);
  const base = raw.slice(0, -4).replace("010211", "010212");
  const splitAt = base.indexOf("5802ID");
  if (splitAt < 0) throw fail("QRIS statis tidak berisi kode negara", 500);
  const tag = `54${String(nominal.length).padStart(2, "0")}${nominal}`;
  const body = `${base.slice(0, splitAt).trim()}${tag}5802ID${base.slice(splitAt + 6).trim()}`;
  return body + crc16(body);
}

export function secretMatches(received, expected) {
  const left = Buffer.from(String(received || ""));
  const right = Buffer.from(String(expected || ""));
  if (!right.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function parseJakarta(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    return Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]) - JAKARTA_OFFSET_MS;
  }
  match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    return Date.UTC(+match[3], +match[2] - 1, +match[1], +match[4], +match[5], +(match[6] || 0)) - JAKARTA_OFFSET_MS;
  }
  return null;
}

function blank(value) {
  if (value == null) return "";
  return String(value).trim();
}

export function callbackPayment(body) {
  const data = body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return {
    amount: rupiah(data.amount),
    type: String(data.type || "").toUpperCase(),
    refid: blank(data.refid),
    issuerReff: blank(data.issuer),
    buyerReff: blank(data.buyer_reff),
    balance: blank(data.balance),
    paidAt: parseJakarta(data.time) ?? Date.now(),
  };
}

export function callbackView(body) {
  const data = body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return {
    name: data.name ?? null,
    nmid: data.nmid ?? null,
    amount: data.amount ?? null,
    type: data.type ?? null,
    fee: data.fee ?? null,
    refid: data.refid ?? null,
    issuer: data.issuer ?? null,
    balance: data.balance ?? null,
    time: data.time ?? null,
  };
}

export function mutationPayment(row) {
  if (!row || typeof row !== "object") return null;
  return {
    amount: rupiah(row.amount),
    type: String(row.type || "").toUpperCase(),
    refid: blank(row.refid),
    issuerReff: blank(row.issuer_reff),
    buyerReff: blank(row.buyer_reff),
    balance: blank(row.balance),
    paidAt: parseJakarta(row.date) ?? Date.now(),
  };
}

function paymentRef(value) {
  const text = blank(value);
  if (!text || /^\d+$/.test(text)) return "";
  return text;
}

export function creditKeys(payment) {
  const keys = [];
  if (payment.refid) keys.push(`ref:${payment.refid}`);
  const issuerReff = paymentRef(payment.issuerReff);
  if (issuerReff) {
    keys.push(`issuer:${issuerReff}`);
    if (issuerReff !== payment.refid) keys.push(`ref:${issuerReff}`);
  }
  if (payment.buyerReff) keys.push(`buyer:${payment.buyerReff}`);
  if (payment.balance) keys.push(`bal:${payment.amount}:${payment.balance}`);
  if (!keys.length && payment.paidAt) keys.push(`row:${payment.paidAt}:${payment.amount}`);
  return keys;
}

export function mutationUrl(merchantCode, apiKey) {
  return `https://qiospay.id/api/mutasi/qris/${encodeURIComponent(merchantCode)}/${encodeURIComponent(apiKey)}`;
}

export async function fetchMutations({ merchantCode, apiKey, fetchImpl = fetch }) {
  const response = await fetchImpl(mutationUrl(merchantCode, apiKey), {
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.ok && payload.status === "error" && payload.message === "Data not found") {
    return [];
  }
  if (!response.ok || payload.status !== "success" || !Array.isArray(payload.data)) {
    throw new Error(payload.messages || payload.message || `QiosPay menolak mutasi (${response.status})`);
  }
  return payload.data.map(mutationPayment).filter(Boolean);
}

export function pickDynamicOrder(orders, paidAt) {
  let chosen = null;
  for (const order of orders) {
    const created = Date.parse(order.created_at);
    if (!Number.isFinite(created)) continue;
    if (paidAt + LINK_MS < created) continue;
    if (paidAt > created + QR_TTL_MS) continue;
    if (!chosen || created < Date.parse(chosen.created_at)) chosen = order;
  }
  return chosen;
}

export function expireDynamicOrders(db, now = Date.now()) {
  const cutoff = new Date(now - QR_TTL_MS).toISOString();
  db.prepare(`
    UPDATE orders
    SET status = 'expire', updated_at = ?
    WHERE source = 'dynamic' AND status = 'pending' AND created_at < ?
  `).run(new Date(now).toISOString(), cutoff);
}

function remember(db, keys, orderId, ts) {
  const insert = db.prepare(`
    INSERT INTO qios_seen (event_key, order_id, created_at) VALUES (?, ?, ?)
    ON CONFLICT(event_key) DO UPDATE SET
      order_id = excluded.order_id,
      created_at = excluded.created_at
    WHERE excluded.order_id != ''
  `);
  for (const key of keys) insert.run(key, orderId, ts);
}

export function seenPrimed(db) {
  return Boolean(db.prepare("SELECT 1 FROM qios_seen WHERE event_key = ?").get(PRIMED_KEY));
}

export function primeSeen(db, payments) {
  const ts = new Date().toISOString();
  db.exec("BEGIN");
  try {
    for (const payment of payments) remember(db, creditKeys(payment), "", ts);
    remember(db, [PRIMED_KEY], "", ts);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function orderIdFromKey(key) {
  const clean = String(key).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60);
  return `qios-${clean || "bayar"}`;
}

export function recordCredit(db, payment, announcePrimedAfter = 0) {
  if (!payment || payment.type !== "CR" || !Number.isInteger(payment.amount) || payment.amount < 1) {
    return { action: "ignored" };
  }
  const keys = creditKeys(payment);
  if (!keys.length) return { action: "ignored" };
  const paidAt = payment.paidAt || Date.now();
  const ts = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const find = db.prepare("SELECT order_id FROM qios_seen WHERE event_key = ?");
    const amountOf = db.prepare("SELECT gross_amount FROM orders WHERE order_id = ?");
    let primedOnly = false;
    let duplicateId = "";
    for (const key of keys) {
      const seen = find.get(key);
      if (!seen) continue;
      if (!seen.order_id) {
        primedOnly = true;
        continue;
      }
      const linked = amountOf.get(seen.order_id);
      if (linked && Number(linked.gross_amount) === payment.amount) {
        duplicateId = seen.order_id;
        break;
      }
    }
    if (duplicateId) {
      remember(db, keys, duplicateId, ts);
      db.exec("COMMIT");
      return { action: "duplicate", orderId: duplicateId };
    }
    const pending = db.prepare(`
      SELECT order_id, created_at FROM orders
      WHERE source = 'dynamic' AND status = 'pending' AND gross_amount = ?
    `).all(payment.amount);
    const matched = pickDynamicOrder(pending, paidAt);
    let orderId = matched?.order_id || "";
    const primedFresh = primedOnly && paidAt >= announcePrimedAfter && announcePrimedAfter > 0;
    if (!orderId && primedOnly && !primedFresh) {
      db.exec("COMMIT");
      return { action: "duplicate" };
    }
    if (orderId) {
      db.prepare(`
        UPDATE orders SET status = 'settlement', updated_at = ? WHERE order_id = ? AND status = 'pending'
      `).run(ts, orderId);
    } else {
      const recent = db.prepare(`
        SELECT order_id, created_at FROM orders
        WHERE source = 'dynamic' AND status = 'settlement' AND gross_amount = ? AND updated_at >= ?
        ORDER BY updated_at DESC LIMIT 1
      `).get(payment.amount, new Date(Date.now() - LINK_MS).toISOString());
      if (recent && pickDynamicOrder([recent], paidAt)) {
        orderId = recent.order_id;
        remember(db, keys, orderId, ts);
        db.exec("COMMIT");
        return { action: "duplicate", orderId };
      }
      orderId = orderIdFromKey(keys[0]);
      db.prepare(`
        INSERT INTO orders (
          order_id, gross_amount, status, fraud_status, qr_string, source, created_at, updated_at
        ) VALUES (?, ?, 'settlement', NULL, NULL, 'static', ?, ?)
      `).run(orderId, payment.amount, ts, ts);
    }
    remember(db, keys, orderId, ts);
    db.exec("COMMIT");
    return { action: "recorded", orderId, amount: payment.amount };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
