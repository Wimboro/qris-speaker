import assert from "node:assert/strict";
import test from "node:test";
import { kataParts, runUji } from "../src/uji.js";

test("urutan kata 24050 dan 123500", () => {
  assert.deepEqual(kataParts(24050), [
    "bunyi koin", "dua", "puluh", "empat", "ribu", "lima", "puluh", "rupiah", "diterima",
  ]);
  assert.deepEqual(kataParts(123500), [
    "bunyi koin", "seratus", "dua", "puluh", "tiga", "ribu", "lima", "ratus", "rupiah", "diterima",
  ]);
  assert.deepEqual(kataParts(1000).slice(1), ["seribu", "rupiah", "diterima"]);
});

test("uji mengirim callback lalu menunggu speaker", async () => {
  let now = 1_700_000_000_000;
  let ref = "";
  const result = await runUji({
    base: "https://toko.example.com",
    secret: "rahasia",
    token: "perangkat",
    amount: 24050,
    now: () => now,
    sleep: async () => { now += 1000; },
    timeoutMs: 5000,
    fetchImpl: async (url, options = {}) => {
      if (url.includes("/qiospay/callback/rahasia")) {
        const data = JSON.parse(options.body).data;
        ref = data.refid;
        assert.equal(data.amount, 24050);
        assert.equal(data.type, "CR");
        assert.equal(options.headers.authorization, undefined);
        return { ok: true, status: 200, json: async () => ({ status: "accept" }) };
      }
      assert.equal(options.headers.authorization, "Bearer perangkat");
      const orderId = `qios-ref-${ref}`;
      const queued = now < 1_700_000_003_000;
      return {
        ok: true,
        status: 200,
        json: async () => ({ announcements: queued ? [{ order_id: orderId, amount: 24050 }] : [] }),
      };
    },
  });
  assert.equal(result.acked, true);
  assert.equal(result.orderId, `qios-ref-${ref}`);
});
