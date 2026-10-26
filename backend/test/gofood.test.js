import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db.js";

const dir = mkdtempSync(path.join(tmpdir(), "gofood-http-"));

process.env.PAYMENT_PROVIDER = "midtrans";
process.env.MIDTRANS_SERVER_KEY = "server-key";
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

function post(body, token = "device-token") {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}/gofood/notification`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("menolak token, mengantrekan QRIS sekali, dan mengabaikan GoFood delivery", async () => {
  const rejected = await post({
    order_id: "tx-1",
    amount: 15000,
    payment_type: "QRIS",
    transaction_source: "gopay_instore",
    transaction_status: "settlement",
  }, "");
  assert.equal(rejected.status, 401);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM announcements").get().n, 0);

  const paid = await post({
    order_id: "tx-1",
    amount: 15000,
    payment_type: "qris",
    transaction_source: "gopay_instore",
    transaction_status: "settlement",
  });
  assert.equal(paid.status, 200);
  assert.deepEqual(await paid.json(), { ok: true, announced: true });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM announcements").get().n, 1);
  assert.equal(db.prepare("SELECT amount FROM announcements WHERE order_id = 'tx-1'").get().amount, 15000);

  const again = await post({
    order_id: "tx-1",
    amount: 15000,
    payment_type: "QRIS",
    transaction_source: "",
    transaction_status: "settlement",
  });
  assert.equal(again.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM announcements").get().n, 1);

  const delivery = await post({
    order_id: "tx-food",
    amount: 32000,
    payment_type: "GOPAY",
    transaction_source: "goresto_online",
    transaction_status: "settlement",
  });
  assert.equal(delivery.status, 200);
  assert.deepEqual(await delivery.json(), { ok: true, announced: false });
  assert.equal(db.prepare("SELECT id FROM announcements WHERE order_id = 'tx-food'").get(), undefined);

  const missing = await post({ amount: 1000, payment_type: "QRIS", transaction_status: "settlement" });
  assert.equal(missing.status, 400);
});
