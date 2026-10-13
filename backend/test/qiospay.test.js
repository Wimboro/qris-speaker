import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import {
  callbackPayment,
  crc16,
  dynamicQris,
  expireDynamicOrders,
  fetchMutations,
  mutationPayment,
  parseJakarta,
  pickDynamicOrder,
  primeSeen,
  recordCredit,
  secretMatches,
  seenPrimed,
} from "../src/qiospay.js";

const unsigned = "00020101021153033605802ID5913WARUNG CONTOH6007JAKARTA6105123406304";
const staticQr = unsigned + crc16(unsigned);

function tempDb() {
  return openDatabase(mkdtempSync(path.join(tmpdir(), "qios-")));
}

function insertPending(db, orderId, amount, createdAt) {
  db.prepare(`
    INSERT INTO orders (
      order_id, gross_amount, status, fraud_status, qr_string, source, created_at, updated_at
    ) VALUES (?, ?, 'pending', NULL, 'qr', 'dynamic', ?, ?)
  `).run(orderId, amount, createdAt, createdAt);
}

test("CRC16 contoh 123456789", () => {
  assert.equal(crc16("123456789"), "29B1");
});

test("QR dinamis menyisipkan tag 54 dan mengganti penanda statis", () => {
  const qr = dynamicQris(staticQr, 15000);
  const body = qr.slice(0, -4);
  assert.match(body, /010212/);
  assert.doesNotMatch(body, /010211/);
  assert.match(body, /540515000/);
  assert.equal(qr.slice(-4), crc16(body));
  assert.ok(body.indexOf("540515000") < body.indexOf("5802ID"));
});

test("tanpa nominal QR statis dikembalikan apa adanya", () => {
  assert.equal(dynamicQris(staticQr), staticQr);
  assert.equal(dynamicQris(staticQr, null), staticQr);
});

test("secret callback sama dengan path di contoh PHP", () => {
  assert.equal(secretMatches("mysecret", "mysecret"), true);
  assert.equal(secretMatches("nope", "mysecret"), false);
  assert.equal(secretMatches("mysecret", ""), false);
});

test("waktu mutasi dan callback dibaca sebagai WIB", () => {
  assert.equal(parseJakarta("2024-07-03 22:38:07"), Date.parse("2024-07-03T15:38:07.000Z"));
  assert.equal(parseJakarta("17/06/2025 18:52"), Date.parse("2025-06-17T11:52:00.000Z"));
});

test("order dinamis kedaluwarsa tidak dipilih", () => {
  const fresh = new Date(Date.now() - 60 * 1000).toISOString();
  const stale = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  assert.equal(pickDynamicOrder([{ order_id: "lama", created_at: stale }], Date.now()), null);
  assert.equal(
    pickDynamicOrder(
      [
        { order_id: "baru", created_at: fresh },
        { order_id: "lebih-lama", created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() },
      ],
      Date.now(),
    ).order_id,
    "lebih-lama",
  );
});

test("mutasi sukses dan gagal", async () => {
  const rows = await fetchMutations({
    merchantCode: "CP0",
    apiKey: "key",
    fetchImpl: async (url) => {
      assert.equal(url, "https://qiospay.id/api/mutasi/qris/CP0/key");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          data: [{ date: "2024-07-03 22:38:07", amount: "13000", type: "CR", balance: "1893938" }],
        }),
      };
    },
  });
  assert.equal(rows[0].amount, 13000);
  assert.equal(rows[0].type, "CR");
  const empty = await fetchMutations({
    merchantCode: "CP0",
    apiKey: "key",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "error", message: "Data not found" }),
    }),
  });
  assert.deepEqual(empty, []);
  await assert.rejects(
    () => fetchMutations({
      merchantCode: "CP0",
      apiKey: "bad",
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        json: async () => ({ status: "error", messages: "salah" }),
      }),
    }),
    /salah/,
  );
});

test("callback dan mutasi dengan saldo sama memakai satu order", () => {
  const db = tempDb();
  const ts = new Date().toISOString();
  insertPending(db, "qris-1", 13000, ts);
  const first = recordCredit(db, callbackPayment({
    data: { amount: 13000, type: "CR", refid: 9, issuer: "111", balance: "100" },
  }));
  const second = recordCredit(db, mutationPayment({
    amount: "13000",
    type: "CR",
    issuer_reff: "222",
    balance: "100",
    date: "2024-07-03 22:38:07",
  }));
  assert.equal(first.action, "recorded");
  assert.equal(first.orderId, "qris-1");
  assert.equal(second.action, "duplicate");
  assert.equal(second.orderId, "qris-1");
  assert.equal(db.prepare("SELECT status FROM orders WHERE order_id = ?").get("qris-1").status, "settlement");
});

test("mutasi tanpa kunci yang sama menempel pada QR dinamis yang baru lunas", () => {
  const db = tempDb();
  const ts = new Date().toISOString();
  insertPending(db, "qris-2", 9000, ts);
  const shifted = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const stamp = shifted.toISOString().slice(0, 19).replace("T", " ");
  const first = recordCredit(db, callbackPayment({
    data: { amount: 9000, type: "CR", refid: 4, issuer: "111" },
  }));
  const second = recordCredit(db, mutationPayment({
    amount: "9000",
    type: "CR",
    issuer_reff: "222",
    date: stamp,
  }));
  assert.equal(first.orderId, "qris-2");
  assert.equal(second.action, "duplicate");
  assert.equal(second.orderId, "qris-2");
});

test("baris awal yang cocok dengan QR dinamis tetap dicatat", () => {
  const db = tempDb();
  const created = new Date(Date.now() - 60 * 1000).toISOString();
  insertPending(db, "qris-156", 156, created);
  const shifted = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const stamp = shifted.toISOString().slice(0, 19).replace("T", " ");
  const payment = mutationPayment({
    amount: "156",
    type: "CR",
    issuer_reff: "AX4UR5CN1MGN",
    buyer_reff: "AX4UR5CN1MGN",
    balance: "337",
    date: stamp,
  });
  primeSeen(db, [payment]);
  const result = recordCredit(db, payment);
  assert.equal(result.action, "recorded");
  assert.equal(result.orderId, "qris-156");
  assert.equal(db.prepare("SELECT status FROM orders WHERE order_id = ?").get("qris-156").status, "settlement");
});

test("scan statis yang baru tidak ditelan tanda awal", () => {
  const db = tempDb();
  const shifted = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const stamp = shifted.toISOString().slice(0, 19).replace("T", " ");
  const payment = mutationPayment({
    amount: "23",
    type: "CR",
    issuer_reff: "AX4U1MKASDYE",
    buyer_reff: "AX4U1MKASDYE",
    balance: "600",
    date: stamp,
  });
  primeSeen(db, [payment]);
  const result = recordCredit(db, payment, Date.now() - 15 * 60 * 1000);
  assert.equal(result.action, "recorded");
  assert.equal(result.amount, 23);
  const row = db.prepare("SELECT source, status FROM orders WHERE order_id = ?").get(result.orderId);
  assert.equal(row.source, "static");
  assert.equal(row.status, "settlement");
});

test("debet dan riwayat awal tidak membuat pembayaran baru", () => {
  const db = tempDb();
  assert.equal(recordCredit(db, callbackPayment({
    data: { amount: 1000, type: "DB", refid: 1, balance: "5" },
  })).action, "ignored");
  const payment = mutationPayment({
    amount: "5000",
    type: "CR",
    balance: "9",
    issuer_reff: "abc",
    date: "2024-07-03 22:38:07",
  });
  primeSeen(db, [payment]);
  assert.equal(seenPrimed(db), true);
  assert.equal(recordCredit(db, payment).action, "duplicate");
});

test("mutasi setelah 15 menit tidak menutup order dinamis", () => {
  const db = tempDb();
  const old = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  insertPending(db, "qris-lama", 8000, old);
  const result = recordCredit(db, callbackPayment({
    data: { amount: 8000, type: "CR", refid: 3, balance: "1" },
  }));
  assert.equal(result.action, "recorded");
  assert.notEqual(result.orderId, "qris-lama");
  assert.equal(db.prepare("SELECT status FROM orders WHERE order_id = ?").get("qris-lama").status, "pending");
  expireDynamicOrders(db);
  assert.equal(db.prepare("SELECT status FROM orders WHERE order_id = ?").get("qris-lama").status, "expire");
});

test("callback dari bank yang sama tidak menelan nominal lain", () => {
  const db = tempDb();
  const created = new Date().toISOString();
  insertPending(db, "qris-27", 27, created);
  const shifted = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const [date, time] = shifted.toISOString().slice(0, 16).split("T");
  const [year, month, day] = date.split("-");
  const stamp = `${day}/${month}/${year} ${time}`;
  const first = recordCredit(db, callbackPayment({
    data: { amount: 29, type: "CR", refid: "AX4U1MKAT0ZV", issuer: "93600002", balance: "665", time: stamp },
  }));
  const second = recordCredit(db, callbackPayment({
    data: { amount: 27, type: "CR", refid: "AX4U1MKAT1RR", issuer: "93600002", balance: "692", time: stamp },
  }));
  assert.equal(first.action, "recorded");
  assert.notEqual(first.orderId, "qris-27");
  assert.equal(second.action, "recorded");
  assert.equal(second.orderId, "qris-27");
  assert.equal(db.prepare("SELECT status FROM orders WHERE order_id = ?").get("qris-27").status, "settlement");
});

test("kunci yang tertaut ke nominal lain tetap menutup QR dinamis", () => {
  const db = tempDb();
  const created = new Date().toISOString();
  insertPending(db, "qris-27", 27, created);
  db.prepare(`
    INSERT INTO orders (
      order_id, gross_amount, status, fraud_status, qr_string, source, created_at, updated_at
    ) VALUES ('qios-ref-AX29', 29, 'settlement', NULL, NULL, 'static', ?, ?)
  `).run(created, created);
  db.prepare(`
    INSERT INTO qios_seen (event_key, order_id, created_at) VALUES ('ref:AX4U1MKAT1RR', 'qios-ref-AX29', ?)
  `).run(created);
  const shifted = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const stamp = shifted.toISOString().slice(0, 19).replace("T", " ");
  const payment = {
    amount: "27",
    type: "CR",
    issuer_reff: "AX4U1MKAT1RR",
    buyer_reff: "AX4U1MKAT1RR",
    balance: "692",
    date: stamp,
  };
  const result = recordCredit(db, mutationPayment(payment));
  assert.equal(result.action, "recorded");
  assert.equal(result.orderId, "qris-27");
  const again = recordCredit(db, mutationPayment(payment));
  assert.equal(again.action, "duplicate");
  assert.equal(again.orderId, "qris-27");
});
