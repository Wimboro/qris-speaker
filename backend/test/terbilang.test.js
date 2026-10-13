import assert from "node:assert/strict";
import test from "node:test";
import { kalimatNominal, terbilang } from "../src/terbilang.js";

test("terbilang angka dasar", () => {
  assert.equal(terbilang(0), "nol");
  assert.equal(terbilang(1), "satu");
  assert.equal(terbilang(11), "sebelas");
  assert.equal(terbilang(12), "dua belas");
  assert.equal(terbilang(25), "dua puluh lima");
  assert.equal(terbilang(100), "seratus");
  assert.equal(terbilang(110), "seratus sepuluh");
  assert.equal(terbilang(111), "seratus sebelas");
  assert.equal(terbilang(215), "dua ratus lima belas");
});

test("terbilang ribu dan juta", () => {
  assert.equal(terbilang(1000), "seribu");
  assert.equal(terbilang(1001), "seribu satu");
  assert.equal(terbilang(1100), "seribu seratus");
  assert.equal(terbilang(25000), "dua puluh lima ribu");
  assert.equal(terbilang(1000000), "satu juta");
  assert.equal(terbilang(1502500), "satu juta lima ratus dua ribu lima ratus");
});

test("kalimat pengumuman", () => {
  assert.equal(
    kalimatNominal(25000),
    "Pembayaran diterima sebesar dua puluh lima ribu rupiah",
  );
});
