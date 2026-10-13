import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db.js";
import { crc16 } from "../src/qiospay.js";

const unsigned = "00020101021153033605802ID5913WARUNG CONTOH6007JAKARTA6105123406304";
const staticQr = unsigned + crc16(unsigned);
const dir = mkdtempSync(path.join(tmpdir(), "qios-http-"));

process.env.PAYMENT_PROVIDER = "qiospay";
process.env.QIOSPAY_MERCHANT_CODE = "CP0xx";
process.env.QIOSPAY_API_KEY = "apikey";
process.env.QIOSPAY_CALLBACK_SECRET = "mysecret";
process.env.STATIC_QR_STRING = staticQr;
process.env.DEVICE_TOKEN = "device-token";
process.env.PUBLIC_BASE_URL = "https://toko.example.com";
process.env.TTS_API_KEY = "";
process.env.DATA_DIR = dir;

const { createApp } = await import("../src/server.js");
const db = openDatabase(dir);
const app = createApp(db);
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise((resolve) => server.close(resolve)));

async function callback(secret, data) {
  const res = await fetch(`${base}/qiospay/callback/${secret}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "success", data }),
  });
  return { status: res.status, body: await res.json() };
}

test("callback menolak secret, mengabaikan debet, dan tidak mengumumkan dua kali", async () => {
  const rejected = await callback("nope", {
    name: "JHON",
    amount: 1000,
    type: "CR",
    refid: 1,
    balance: "10",
  });
  assert.equal(rejected.status, 403);
  assert.deepEqual(rejected.body, {
    status: "reject",
    message: "Invalid secret key",
    data: null,
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM announcements").get().n, 0);

  const debet = await callback("mysecret", {
    name: "JHON",
    amount: 1000,
    type: "DB",
    refid: 2,
    balance: "10",
  });
  assert.equal(debet.status, 200);
  assert.equal(debet.body.status, "accept");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM announcements").get().n, 0);

  const charge = await fetch(`${base}/device/charge`, {
    method: "POST",
    headers: {
      authorization: "Bearer device-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ amount: 15000 }),
  });
  assert.equal(charge.status, 201);
  const created = await charge.json();
  assert.match(created.qr_string, /010212/);
  assert.match(created.qr_string, /540515000/);

  const paid = await callback("mysecret", {
    name: "JHON",
    nmid: "ID20233072912345",
    amount: 15000,
    type: "CR",
    fee: 0,
    refid: 295094156,
    issuer: "93600002",
    balance: "24100",
  });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.status, "accept");
  assert.equal(paid.body.data.refid, 295094156);
  const rows = db.prepare("SELECT order_id, amount FROM announcements").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].order_id, created.order_id);
  assert.equal(rows[0].amount, 15000);
  assert.equal(
    db.prepare("SELECT status FROM orders WHERE order_id = ?").get(created.order_id).status,
    "settlement",
  );

  const again = await callback("mysecret", {
    name: "JHON",
    amount: 15000,
    type: "CR",
    refid: 295094156,
    issuer: "93600002",
    balance: "24100",
  });
  assert.equal(again.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM announcements").get().n, 1);
});
