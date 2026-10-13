import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  apiBase,
  callbackSignature,
  inquirySignature,
  signaturesMatch,
  statusSignature,
} from "../src/duitku.js";

function hmac(payload) {
  return createHmac("sha256", "api-key").update(payload).digest("hex");
}

test("basis URL sandbox dan produksi", () => {
  assert.equal(apiBase(false), "https://sandbox.duitku.com/webapi/api/merchant");
  assert.equal(apiBase(true), "https://passport.duitku.com/webapi/api/merchant");
});

test("inquiry HMAC merchant, order, lalu amount", () => {
  const raw = hmac("D1" + "order-1" + "25000");
  assert.equal(inquirySignature("D1", "order-1", "25000", "api-key"), raw);
  assert.equal(signaturesMatch(raw.toUpperCase(), raw), true);
  assert.equal(signaturesMatch("beda", raw), false);
});

test("callback HMAC merchant, amount, lalu order", () => {
  const raw = hmac("D1" + "25000" + "order-1");
  assert.equal(callbackSignature("D1", "25000", "order-1", "api-key"), raw);
  assert.notEqual(
    inquirySignature("D1", "order-1", "25000", "api-key"),
    callbackSignature("D1", "25000", "order-1", "api-key"),
  );
});

test("status HMAC merchant lalu order", () => {
  const raw = hmac("D1" + "order-1");
  assert.equal(statusSignature("D1", "order-1", "api-key"), raw);
});
