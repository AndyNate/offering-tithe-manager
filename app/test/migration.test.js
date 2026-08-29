'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const db = require('../db');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otm-migrate-test-'));
const dbPath = path.join(dir, 'legacy.db');

// 1. Build a legacy DB with the OLD schema/tables exactly as v1 shipped.
{
  const d = new Database(dbPath);
  d.pragma('foreign_keys = ON');
  d.exec(`
    CREATE TABLE donors (
      tithe_id       VARCHAR(20) PRIMARY KEY,
      date           DATE NOT NULL,
      full_name      VARCHAR(255) NOT NULL,
      spouse         VARCHAR(255),
      email          VARCHAR(255),
      notes          TEXT,
      is_new_entry   BOOLEAN NOT NULL DEFAULT 1
    );
    CREATE TABLE giving (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      tithe_id           VARCHAR(20) NOT NULL REFERENCES donors(tithe_id),
      date               DATE NOT NULL,
      giving_type        VARCHAR(20) NOT NULL CHECK (giving_type IN ('Cash / Cheque', 'E-Transfer', 'Tithly')),
      regular            INTEGER NOT NULL DEFAULT 0,
      mission            INTEGER NOT NULL DEFAULT 0,
      building_fund      INTEGER NOT NULL DEFAULT 0,
      other              INTEGER NOT NULL DEFAULT 0,
      total_amount       INTEGER GENERATED ALWAYS AS (regular + mission + building_fund + other) STORED CHECK (total_amount > 0),
      note               TEXT,
      is_fee             BOOLEAN NOT NULL DEFAULT 0,
      tithly_fee_amount  INTEGER NOT NULL DEFAULT 0,
      created_donor      BOOLEAN NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_giving_tithe_id ON giving (tithe_id);
    CREATE TABLE settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
    INSERT INTO donors (tithe_id, date, full_name) VALUES ('1', '2026-08-10', 'Legacy Tither');
    INSERT INTO giving (tithe_id, date, giving_type, regular, is_fee, tithly_fee_amount)
      VALUES ('1', '2026-08-10', 'Tithly', 5000, 1, 175);
    INSERT INTO giving (tithe_id, date, giving_type, regular)
      VALUES ('1', '2026-08-11', 'E-Transfer', 3000);
  `);
  d.close();

  // 2. Open with the app's init() -> runs migrateGivingOnline().
  db.init(dbPath);
  const gifts = db.listGiving();
  assert.strictEqual(gifts.length, 2);

  const online = gifts.find((g) => g.totalAmount === 5000);
  assert.strictEqual(online.method, 'Online');
  assert.strictEqual(online.isFee, true);
  assert.strictEqual(online.onlineFeeAmount, 175);

  const etransfer = gifts.find((g) => g.totalAmount === 3000);
  assert.strictEqual(etransfer.method, 'E-Transfer');
  assert.strictEqual(etransfer.onlineFeeAmount, 0);

  // 3. New 'Online' gifts with a fee still work after migration.
  const r = db.recordGift({ name: 'Legacy Tither', regular: 1000, method: 'Online', onlineFee: 25 }, { isAdmin: true });
  assert.strictEqual(r.donation.method, 'Online');
  assert.strictEqual(r.donation.isFee, true);
  assert.strictEqual(r.donation.onlineFeeAmount, 25);

  // 4. Month report now rolls 'Online' up correctly.
  const rep = db.monthReport('2026', '8');
  assert.strictEqual(rep.online, 5000 + 1000);
  assert.strictEqual(rep.eTransfer, 3000);
  assert.strictEqual(rep.grandTotal, 9000);

  // 5. Year-end total still includes the migrated fee.
  const yr = db.yearReport('2026');
  assert.strictEqual(yr[0].total, 5000 + 175 + 3000 + 1000 + 25);

  // 5b. ...and can exclude it.
  const yrNoFees = db.yearReport('2026', { includeFees: false });
  assert.strictEqual(yrNoFees[0].total, 5000 + 3000 + 1000);

  // 6. AUTOINCREMENT still hands out fresh ids above the migrated max.
  const freshId = gifts.reduce((m, g) => Math.max(m, g.id), 0) + 1;
  const latestId = db.listGiving().map((g) => g.id).sort((a, b) => a - b).pop();
  assert.ok(latestId >= freshId, 'sequence advanced past migrated max');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('migration test: ok (legacy Tithly -> Online, column renamed, data + sequence preserved)');
}