import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { apiBase, signature, signaturesMatch, signedFields } from "../src/midtrans.js";

test("basis URL sandbox dan produksi", () => {
  assert.equal(apiBase(false), "https://api.sandbox.midtrans.com");
  assert.equal(apiBase(true), "https://api.midtrans.com");
});

test("signature memakai nilai string apa adanya", () => {
  const joined = "order-1" + "200" + "25000.00" + "server-key";
  const raw = createHash("sha512").update(joined).digest("hex");
  assert.equal(signature("order-1", "200", "25000.00", "server-key"), raw);
  assert.notEqual(joined, "order-1" + "25000.00" + "200" + "server-key");
  assert.equal(signaturesMatch(raw.toUpperCase(), raw), true);
  assert.equal(signaturesMatch("beda", raw), false);
});

test("signedFields mempertahankan desimal", () => {
  const raw = '{"order_id":"o1","status_code":"200","gross_amount":"25000.00"}';
  const fields = signedFields(raw, JSON.parse(raw));
  assert.equal(fields.grossAmount, "25000.00");
  assert.equal(fields.orderId, "o1");
  assert.equal(fields.statusCode, "200");
});
