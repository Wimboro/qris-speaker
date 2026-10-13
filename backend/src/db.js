import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "qris.sqlite"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      gross_amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      fraud_status TEXT,
      qr_string TEXT,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      amount INTEGER NOT NULL,
      wav_path TEXT,
      acked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS qios_seen (
      event_key TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

export function rupiah(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount);
}
