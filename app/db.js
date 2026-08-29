'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const GIVING_TYPES = ['Cash / Cheque', 'E-Transfer', 'Online'];
// nosemgrep: intentional bootstrap default password, documented in README (changed via Admin panel)
const DEFAULT_PASSWORD = 'admin';

let db = null;

// ---------------------------------------------------------------------------
// Date helpers (local time — never UTC, so day boundaries match the church's wall clock)

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// ---------------------------------------------------------------------------
// Setup

function init(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const hasDonors = db
    .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='donors'")
    .get().n > 0;
  if (!hasDonors) {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);
  }

  migrateGivingOnline();

  // Seed settings defaults (default password; changeable in-app later)
  const seed = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  seed.run('admin_password_hash', hashPassword(DEFAULT_PASSWORD));
  seed.run('org_name', 'OTMP');
  seed.run('brevo_api_key', '');
  seed.run('brevo_sender_email', '');
  seed.run('email_recipients', '[]');

  return module.exports;
}

function close() {
  if (db) db.close();
  db = null;
}

// v1 -> online giving method: the "Tithly" payment option becomes the generic
// "Online" so any organization's online fees can be entered. Rebuilds the giving
// table to swap the CHECK constraint, rename tithly_fee_amount to online_fee_amount,
// and convert existing 'Tithly' records to 'Online'. Idempotent: a fresh schema.sql
// or an already-migrated table (no 'Tithly' in its DDL) is left untouched.
function migrateGivingOnline() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'giving'").get();
  if (!row || !/Tithly/.test(row.sql || '')) return;
  db.transaction(() => {
    db.exec(`
      CREATE TABLE giving_online (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        tithe_id           VARCHAR(20) NOT NULL REFERENCES donors(tithe_id),
        date               DATE NOT NULL,
        giving_type        VARCHAR(20) NOT NULL CHECK (giving_type IN ('Cash / Cheque', 'E-Transfer', 'Online')),
        regular            INTEGER NOT NULL DEFAULT 0,
        mission            INTEGER NOT NULL DEFAULT 0,
        building_fund      INTEGER NOT NULL DEFAULT 0,
        other              INTEGER NOT NULL DEFAULT 0,
        total_amount       INTEGER GENERATED ALWAYS AS (regular + mission + building_fund + other) STORED CHECK (total_amount > 0),
        note               TEXT,
        is_fee             BOOLEAN NOT NULL DEFAULT 0,
        online_fee_amount  INTEGER NOT NULL DEFAULT 0,
        created_donor      BOOLEAN NOT NULL DEFAULT 0
      );
      INSERT INTO giving_online (id, tithe_id, date, giving_type, regular, mission, building_fund, other, note, is_fee, online_fee_amount, created_donor)
        SELECT id, tithe_id, date,
               CASE WHEN giving_type = 'Tithly' THEN 'Online' ELSE giving_type END,
               regular, mission, building_fund, other, note, is_fee, tithly_fee_amount, created_donor
        FROM giving;
      DROP TABLE giving;
      ALTER TABLE giving_online RENAME TO giving;
      CREATE INDEX idx_giving_tithe_id ON giving (tithe_id);
      UPDATE sqlite_sequence SET seq = (SELECT COALESCE(MAX(id), 0) FROM giving) WHERE name = 'giving';
    `);
  })();
}

// Password hashing uses scrypt (a memory-hard KDF) with a per-user random
// salt, encoded as "scrypt$<salt-hex>$<derivedkey-hex>".
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(String(password), salt, 32);
  return 'scrypt$' + salt + '$' + derivedKey.toString('hex');
}

function verifyPasswordHash(password, stored) {
  const parts = String(stored).split('$');
  if (parts[0] !== 'scrypt' || parts.length !== 3) return false;
  const [, salt, hashHex] = parts;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'error';
  }
}

const toCents = (v) => Math.round(Number(v) || 0);

// ---------------------------------------------------------------------------
// Settings

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

function getEmailRecipients() {
  try { return JSON.parse(getSetting('email_recipients', '[]')); } catch { return []; }
}

function setEmailRecipients(list) {
  const seen = new Set();
  const clean = [];
  for (const item of Array.isArray(list) ? list : []) {
    const e = String(item).trim().toLowerCase();
    if (e && !seen.has(e)) { seen.add(e); clean.push(e); }
  }
  setSetting('email_recipients', JSON.stringify(clean));
  return clean;
}

function verifyPassword(password) {
  return verifyPasswordHash(password, getSetting('admin_password_hash'));
}

function setPassword(password) {
  if (!password || String(password).length < 4) throw new AppError('Password must be at least 4 characters.');
  setSetting('admin_password_hash', hashPassword(password));
}

function changePassword(currentPassword, newPassword, confirmation) {
  if (!verifyPassword(currentPassword)) throw new AppError('Current password is incorrect.');
  if (!newPassword || String(newPassword).length < 4) throw new AppError('New password must be at least 4 characters.');
  if (String(newPassword) !== String(confirmation)) throw new AppError('New passwords do not match.');
  setPassword(newPassword);
}

// ---------------------------------------------------------------------------
// Donors

const DONOR_COLS = 'tithe_id, date, full_name, spouse, email, notes, is_new_entry';

function mapDonor(row) {
  if (!row) return null;
  return {
    titheId: row.tithe_id,
    date: row.date,
    fullName: row.full_name,
    spouse: row.spouse || '',
    email: row.email || '',
    notes: row.notes || '',
    isNewEntry: !!row.is_new_entry,
  };
}

function listDonors() {
  return db.prepare(`SELECT ${DONOR_COLS} FROM donors ORDER BY CAST(tithe_id AS INTEGER)`).all().map(mapDonor);
}

function findDonors(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  return db.prepare(
    `SELECT ${DONOR_COLS} FROM donors
     WHERE tithe_id = ? COLLATE NOCASE OR LOWER(full_name) LIKE LOWER(?)
     ORDER BY CAST(tithe_id AS INTEGER)`
  ).all(q, `%${q}%`).map(mapDonor);
}

function getDonorByTitheId(titheId) {
  return mapDonor(db.prepare(`SELECT ${DONOR_COLS} FROM donors WHERE tithe_id = ? COLLATE NOCASE`).get(String(titheId)));
}

// Next Tithe ID = lowest positive integer not already taken, so gaps left by
// deleted donors get reused; with no gaps this falls back to max + 1.
function nextTitheIdTx() {
  const row = db.prepare(
    `WITH RECURSIVE seq(n) AS (
       SELECT 1
       UNION ALL
       SELECT n + 1 FROM seq
       WHERE n < (SELECT IFNULL(MAX(CAST(tithe_id AS INTEGER)), 0) FROM donors)
     )
     SELECT IFNULL(
       MIN(n),
       (SELECT IFNULL(MAX(CAST(tithe_id AS INTEGER)), 0) + 1 FROM donors)
     ) AS next
     FROM seq
     WHERE n NOT IN (SELECT CAST(tithe_id AS INTEGER) FROM donors)`
  ).get();
  return String(row.next);
}

function insertDonor({ fullName, spouse = '', email = '', notes = '', date = null, isNewEntry = 1 }, tx) {
  const name = String(fullName || '').trim();
  if (!name) throw new AppError('Enter a full name.');
  if (/^\d+$/.test(name)) throw new AppError('Full name must not be purely numeric.');
  const run = tx || db;
  const titheId = nextTitheIdTx();
  const d = isValidDateStr(date) ? date : todayStr();
  run.prepare(
    `INSERT INTO donors (tithe_id, date, full_name, spouse, email, notes, is_new_entry) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(titheId, d, name, String(spouse || '').trim(), String(email || '').trim(), String(notes || '').trim(), isNewEntry ? 1 : 0);
  return getDonorByTitheId(titheId);
}

function updateDonor({ titheId, fullName, spouse = '', email = '', notes = '', date = null }) {
  const id = String(titheId || '').trim();
  const existing = getDonorByTitheId(id);
  if (!id || !existing) throw new AppError('Donor not found for that Tithe ID.');
  const name = String(fullName || '').trim();
  if (!name) throw new AppError('Enter a full name.');
  db.prepare(
    `UPDATE donors SET full_name = ?, spouse = ?, email = ?, notes = ?, date = ?, is_new_entry = 0 WHERE tithe_id = ?`
  ).run(name, String(spouse || '').trim(), String(email || '').trim(), String(notes || '').trim(),
        isValidDateStr(date) ? date : existing.date, existing.titheId);
  return getDonorByTitheId(existing.titheId);
}

function deleteDonor(titheId) {
  const id = String(titheId || '').trim();
  const existing = getDonorByTitheId(id);
  if (!id || !existing) throw new AppError('Donor not found for that Tithe ID.');
  const tx = db.transaction((tid) => {
    db.prepare('DELETE FROM giving WHERE tithe_id = ?').run(tid);
    const res = db.prepare('DELETE FROM donors WHERE tithe_id = ?').run(tid);
    return res.changes;
  });
  return tx(existing.titheId);
}

function newestEntryDonor() {
  return mapDonor(db.prepare(
    `SELECT ${DONOR_COLS} FROM donors WHERE is_new_entry = 1
     ORDER BY date DESC, CAST(tithe_id AS INTEGER) DESC LIMIT 1`
  ).get());
}

// Admin panel lookups: priority Tithe ID -> Full name -> Email (exact matches)
function findDonorExact({ titheId = '', fullName = '', email = '' }) {
  const tid = String(titheId || '').trim();
  const name = String(fullName || '').trim();
  const mail = String(email || '').trim();
  if (tid) return mapDonor(db.prepare(`SELECT ${DONOR_COLS} FROM donors WHERE tithe_id = ? COLLATE NOCASE`).get(tid));
  if (name) return mapDonor(db.prepare(`SELECT ${DONOR_COLS} FROM donors WHERE LOWER(full_name) = LOWER(?)`).get(name));
  if (mail) return mapDonor(db.prepare(`SELECT ${DONOR_COLS} FROM donors WHERE LOWER(email) = LOWER(?)`).get(mail));
  return null;
}

// ---------------------------------------------------------------------------
// Giving

function mapGift(row) {
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    titheId: row.tithe_id,
    fullName: row.full_name,
    createdDonor: !!row.created_donor,
    totalAmount: row.total_amount,          // cents
    regular: row.regular, mission: row.mission, buildingFund: row.building_fund, other: row.other,
    method: row.giving_type,
    isFee: !!row.is_fee,
    onlineFeeAmount: row.online_fee_amount, // cents
    notes: row.note || '',
  };
}

const GIVING_LIST_SQL = `
  SELECT g.id, g.date, g.tithe_id, d.full_name, g.created_donor, g.total_amount,
         g.regular, g.mission, g.building_fund, g.other, g.giving_type,
         g.is_fee, g.online_fee_amount, g.note
  FROM giving g JOIN donors d ON d.tithe_id = g.tithe_id`;

function listGiving(search) {
  const s = String(search || '').trim();
  const sql = `${GIVING_LIST_SQL}
    WHERE (? = '' OR LOWER(d.full_name) LIKE '%' || LOWER(?) || '%' OR CAST(g.tithe_id AS TEXT) LIKE '%' || ? || '%')
    ORDER BY g.date DESC, g.id DESC`;
  return db.prepare(sql).all(s, s, s).map(mapGift);
}

function getGift(id) {
  return mapGift(db.prepare(`${GIVING_LIST_SQL} WHERE g.id = ?`).get(id));
}

function deleteGiving(id) {
  const res = db.prepare('DELETE FROM giving WHERE id = ?').run(Number(id));
  if (!res.changes) throw new AppError('Donation not found.');
  return res.changes;
}

// Look up giving dates for a person (by name or Tithe ID) — returns unique dates
// with a count of entries on each, newest first.
function findGivingDatesByPerson(search) {
  const s = String(search || '').trim();
  if (!s) return [];
  const rows = db.prepare(`
    SELECT g.date, COUNT(*) AS count
    FROM giving g JOIN donors d ON d.tithe_id = g.tithe_id
    WHERE LOWER(d.full_name) LIKE '%' || LOWER(?) || '%'
       OR CAST(g.tithe_id AS TEXT) LIKE '%' || ? || '%'
    GROUP BY g.date
    ORDER BY g.date DESC
  `).all(s, s);
  return rows.map((r) => ({ date: r.date, count: r.count }));
}

// All giving entries for a person (by name or Tithe ID) on a specific date.
function findGivingByPersonAndDate(search, date) {
  const s = String(search || '').trim();
  const d = String(date || '').trim();
  if (!s || !d) return [];
  return db.prepare(`${GIVING_LIST_SQL}
    WHERE g.date = ?
      AND (LOWER(d.full_name) LIKE '%' || LOWER(?) || '%'
           OR CAST(g.tithe_id AS TEXT) LIKE '%' || ? || '%')
    ORDER BY g.id ASC
  `).all(d, s, s).map(mapGift);
}

// Update a single giving entry. Fields: titheId, date, method, regular, mission,
// buildingFund, other, notes — all amounts in cents (integers).
function updateGiving(id, fields) {
  const numId = Number(id);
  const existing = getGift(numId);
  if (!existing) throw new AppError('Donation not found.');

  const titheId = String(fields.titheId || '').trim();
  if (!titheId) throw new AppError('Tithe ID is required.');
  const donor = db.prepare(`SELECT ${DONOR_COLS} FROM donors WHERE tithe_id = ? COLLATE NOCASE`).get(titheId);
  if (!donor) throw new AppError('No donor exists with that Tithe ID.');

  const amounts = ['regular', 'mission', 'buildingFund', 'other'].map((k) => toCents(fields[k]));
  const [regular, mission, buildingFund, other] = amounts;
  if (amounts.some((a) => a < 0)) throw new AppError('Donation amounts cannot be negative.');
  const total = regular + mission + buildingFund + other;
  if (!(total > 0)) throw new AppError('Total donation amount must be greater than zero.');

  const notes = String(fields.notes || '').trim();
  if (other > 0 && !notes) throw new AppError('Notes are required when an other donation amount is entered.');

  let method = fields.method;
  if (!GIVING_TYPES.includes(method)) method = 'Cash / Cheque';

  const feeAmt = method === 'Online' ? toCents(fields.onlineFee) : 0;
  if (feeAmt < 0) throw new AppError('Online fee cannot be negative.');
  const isFee = method === 'Online' && feeAmt > 0;

  let date = fields.date;
  if (!isValidDateStr(date)) date = existing.date;

  db.prepare(
    `UPDATE giving SET tithe_id = ?, date = ?, giving_type = ?, regular = ?, mission = ?, building_fund = ?, other = ?, note = ?, is_fee = ?, online_fee_amount = ? WHERE id = ?`
  ).run(donor.tithe_id, date, method, regular, mission, buildingFund, other, notes || null, isFee ? 1 : 0, feeAmt, numId);

  return getGift(numId);
}

function insertGivingRow(run, gift) {
  const info = run.prepare(
    `INSERT INTO giving (tithe_id, date, giving_type, regular, mission, building_fund, other, note, is_fee, online_fee_amount, created_donor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    gift.titheId, gift.date, gift.method,
    gift.regular, gift.mission, gift.buildingFund, gift.other,
    gift.notes || null, gift.isFee ? 1 : 0, gift.onlineFeeAmount || 0, gift.createdDonor ? 1 : 0
  );
  return Number(info.lastInsertRowid);
}

function validateGiftFields(gift, { allowNonCash, allowCustomDate }) {
  const amounts = ['regular', 'mission', 'buildingFund', 'other'].map((k) => toCents(gift[k]));
  const [regular, mission, buildingFund, other] = amounts;
  if (amounts.some((a) => a < 0)) throw new AppError('Donation amounts cannot be negative.');
  const total = regular + mission + buildingFund + other;
  if (!(total > 0)) throw new AppError('Enter a name or Tithe ID and a donation amount.');

  const notes = String(gift.notes || '').trim();
  if (other > 0 && !notes) throw new AppError('Notes are required when an other donation amount is entered.');

  let method = gift.method;
  if (!GIVING_TYPES.includes(method)) method = 'Cash / Cheque';
  if (!allowNonCash) method = 'Cash / Cheque'; // permission check, not just UI lock

  const feeAmt = method === 'Online' ? toCents(gift.onlineFee) : 0;
  if (feeAmt < 0) throw new AppError('Online fee cannot be negative.');
  const isFee = method === 'Online' && feeAmt > 0;

  let date = gift.date;
  if (allowCustomDate && isValidDateStr(date)) {
    // keep admin-chosen date
  } else {
    date = todayStr();
  }

  return { regular, mission, buildingFund, other, total, method, feeAmt, isFee, notes, date };
}

// The whole Give-form submit, atomic: find-or-create donor, then insert the gift.
function recordGift(payload, opts = {}) {
  const input = String(payload.name || '').trim();
  if (!input) throw new AppError('Enter a name or Tithe ID and a donation amount.');

  const fields = validateGiftFields(payload, {
    allowNonCash: !!opts.isAdmin,
    allowCustomDate: !!opts.isAdmin,
  });

  const tx = db.transaction(() => {
    let donor = db.prepare(`SELECT ${DONOR_COLS} FROM donors WHERE tithe_id = ? COLLATE NOCASE`).get(input)
      || db.prepare(`SELECT ${DONOR_COLS} FROM donors WHERE LOWER(full_name) = LOWER(?)`).get(input);

    let isNewEntry = false;
    if (!donor) {
      if (/^\d+$/.test(input)) throw new AppError('Tithe ID doesn\u2019t exist.', 'no-tithe-id');
      const titheId = nextTitheIdTx();
      db.prepare(
        `INSERT INTO donors (tithe_id, date, full_name, spouse, email, notes, is_new_entry) VALUES (?, ?, ?, '', '', '', 1)`
      ).run(titheId, fields.date, input);
      donor = db.prepare(`SELECT ${DONOR_COLS} FROM donors WHERE tithe_id = ?`).get(titheId);
      isNewEntry = true;
    }

    const id = insertGivingRow(db, {
      titheId: donor.tithe_id,
      date: fields.date,
      method: fields.method,
      regular: fields.regular, mission: fields.mission, buildingFund: fields.buildingFund, other: fields.other,
      notes: fields.notes,
      isFee: fields.isFee, onlineFeeAmount: fields.feeAmt,
      createdDonor: isNewEntry,
    });
    return { id, donor: mapDonor(donor), isNewEntry, date: fields.date };
  });

  const result = tx();
  return { ...result, donation: getGift(result.id) };
}

// ---------------------------------------------------------------------------
// Reports

function monthReport(year, month) {
  const y = String(year), m = String(month).padStart(2, '0');
  const rows = db.prepare(
    `SELECT giving_type, SUM(total_amount) AS t, COUNT(*) AS n
     FROM giving WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ?
     GROUP BY giving_type`
  ).all(y, m);
  const byType = { 'Cash / Cheque': 0, 'E-Transfer': 0, Online: 0 };
  for (const r of rows) byType[r.giving_type] = r.t || 0;
  return {
    cashCheque: byType['Cash / Cheque'],
    eTransfer: byType['E-Transfer'],
    online: byType['Online'],
    grandTotal: Object.values(byType).reduce((a, b) => a + b, 0),
    counts: Object.fromEntries(rows.map((r) => [r.giving_type, r.n])),
  };
}

function yearReport(year, opts = {}) {
  const y = String(year);
  const includeFees = opts.includeFees !== false;
  const feeAdder = includeFees
    ? '(CASE WHEN g.is_fee THEN g.online_fee_amount ELSE 0 END)'
    : '0';
  const rows = db.prepare(
    `SELECT d.tithe_id AS titheId, d.full_name AS fullName, d.spouse AS spouse,
            SUM(g.total_amount + ${feeAdder}) AS total
     FROM giving g JOIN donors d ON d.tithe_id = g.tithe_id
     WHERE strftime('%Y', g.date) = ?
     GROUP BY d.tithe_id
     ORDER BY total DESC`
  ).all(y);
  return rows.map((r) => ({ titheId: r.titheId, fullName: r.fullName, spouse: r.spouse || '', total: r.total || 0 }));
}

function otherReport(year, month) {
  const y = String(year), m = String(month).padStart(2, '0');
  const rows = db.prepare(
    `SELECT note, other FROM giving
     WHERE other > 0 AND strftime('%Y', date) = ? AND strftime('%m', date) = ?
     ORDER BY date, id`
  ).all(y, m);
  return {
    entries: rows.map((r) => ({ note: r.note || 'No note', amount: r.other })),
    total: rows.reduce((sum, r) => sum + (r.other || 0), 0),
  };
}

function fundTotals(year, month) {
  const y = String(year);
  const where = month != null ? " AND strftime('%m', date) = '" + String(month).padStart(2, '0') + "'" : '';
  const row = db.prepare(
    `SELECT SUM(regular) AS regular, SUM(mission) AS mission, SUM(building_fund) AS building_fund, SUM(other) AS other
     FROM giving WHERE strftime('%Y', date) = ?${where}`
  ).get(y);
  return {
    regular: row.regular || 0,
    mission: row.mission || 0,
    buildingFund: row.building_fund || 0,
    other: row.other || 0,
  };
}

// ---------------------------------------------------------------------------
// Deposits

function mapDeposit(row) {
  if (!row) return null;
  let counts = {}, cheques = [];
  try { counts = JSON.parse(row.counts_json || '{}'); } catch {}
  try { cheques = JSON.parse(row.cheques_json || '[]'); } catch {}
  return {
    depositNumber: row.deposit_number,
    date: row.date,
    teller1: row.teller1 || '',
    teller2: row.teller2 || '',
    counts, cheques,
    billsTotal: toCents(counts.bill5) * 500 + toCents(counts.bill10) * 1000 + toCents(counts.bill20) * 2000
              + toCents(counts.bill50) * 5000 + toCents(counts.bill100) * 10000,
    coinsTotal: toCents(counts.coin1) * 100 + toCents(counts.coin2) * 200
              + toCents(counts.otherLooseCoin) + toCents(counts.otherRolledCoin),
    cashSubtotal: row.cash_subtotal,
    chequesSubtotal: row.cheques_subtotal,
    total: row.total,
    titheSheetTotal: row.tithe_sheet_total,
    emailedTo: row.emailed_to || '',
  };
}

function listDeposits() {
  return db.prepare('SELECT * FROM deposits ORDER BY date DESC, rowid DESC').all().map(mapDeposit);
}

function titheSheetTotal(date) {
  const d = isValidDateStr(date) ? date : todayStr();
  const row = db.prepare(
    `SELECT IFNULL(SUM(total_amount), 0) AS t FROM giving WHERE date = ? AND giving_type = 'Cash / Cheque'`
  ).get(d);
  return { date: d, total: row.t };
}

// Recomputes all subtotals server-side from counts + cheques, then inserts.
// Non-admins submit an auto-generated read-only number, so duplicates get a
// fresh number instead of a dead-end error; admins keep strict behavior.
function insertDeposit(payload, opts = {}) {
  const c = payload.counts || {};
  const counts = {
    bill5: toCents(c.bill5), bill10: toCents(c.bill10), bill20: toCents(c.bill20),
    bill50: toCents(c.bill50), bill100: toCents(c.bill100),
    coin1: toCents(c.coin1), coin2: toCents(c.coin2),
    otherLooseCoin: toCents(c.otherLooseCoin), otherRolledCoin: toCents(c.otherRolledCoin),
  };
  const cheques = (Array.isArray(payload.cheques) ? payload.cheques : [])
    .filter((ch) => String(ch.identification || '').trim() !== '' || toCents(ch.amount) > 0)
    .slice(0, 15)
    .map((ch) => ({ identification: String(ch.identification || '').trim(), amount: toCents(ch.amount) }));

  const billsTotal = counts.bill5 * 500 + counts.bill10 * 1000 + counts.bill20 * 2000 + counts.bill50 * 5000 + counts.bill100 * 10000;
  const coinsTotal = counts.coin1 * 100 + counts.coin2 * 200 + counts.otherLooseCoin + counts.otherRolledCoin;
  const cashSubtotal = billsTotal + coinsTotal;
  const chequesSubtotal = cheques.reduce((sum, ch) => sum + ch.amount, 0);
  const total = cashSubtotal + chequesSubtotal;

  const number = String(payload.depositNumber || '').replace(/\D/g, '').slice(0, 10);
  if (!number) throw new AppError('Enter a deposit number.');
  const sheet = titheSheetTotal(payload.date);

  const insert = (num) => db.transaction(() => {
    db.prepare(
      `INSERT INTO deposits (deposit_number, date, teller1, teller2, cash_subtotal, cheques_subtotal, total, tithe_sheet_total, counts_json, cheques_json, emailed_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      num, sheet.date, String(payload.teller1 || '').trim(), String(payload.teller2 || '').trim(),
      cashSubtotal, chequesSubtotal, total, sheet.total,
      JSON.stringify(counts), JSON.stringify(cheques), payload.emailedTo ? String(payload.emailedTo) : ''
    );
  });

  let finalNumber = number;
  const maxAttempts = opts.isAdmin ? 1 : 5;
  for (let attempt = 1; ; attempt++) {
    try {
      insert(finalNumber)();
      break;
    } catch (e) {
      const duplicate = e && /UNIQUE constraint failed: deposits.deposit_number/.test(String(e.message));
      if (!duplicate) throw e;
      if (attempt >= maxAttempts) {
        throw new AppError(`A deposit with number ${finalNumber} already exists.`, 'duplicate-deposit');
      }
      finalNumber = String(Math.floor(1000000 + Math.random() * 9000000));
    }
  }
  return mapDeposit(db.prepare('SELECT * FROM deposits WHERE deposit_number = ?').get(finalNumber));
}

function deleteDeposit(depositNumber) {
  const n = String(depositNumber || '').replace(/\D/g, '');
  const res = db.prepare('DELETE FROM deposits WHERE deposit_number = ?').run(n);
  if (!res.changes) throw new AppError('Deposit not found.');
  return res.changes;
}

function markDepositEmailed(depositNumber, emailedTo) {
  db.prepare('UPDATE deposits SET emailed_to = ? WHERE deposit_number = ?').run(String(emailedTo || ''), String(depositNumber || ''));
}

// ---------------------------------------------------------------------------
// CSV import (validation happens before anything is written)

function importDonors(records) {
  const upsert = db.transaction((rows) => {
    let inserted = 0;
    for (const r of rows) {
      const titheId = String(r['Tithe ID'] || '').trim();
      const fullName = String(r['Full name'] || '').trim();
      if (!titheId || !fullName) continue;
      const parsedDate = Date.parse(r['Registration date']);
      const date = isNaN(parsedDate)
        ? todayStr()
        : `${parsedDate && new Date(parsedDate).getFullYear()}-${String(new Date(parsedDate).getMonth() + 1).padStart(2, '0')}-${String(new Date(parsedDate).getDate()).padStart(2, '0')}`;
      const isNewEntry = /^y/i.test(r['Is new entry']) ? 1 : 0;
      const existing = db.prepare('SELECT tithe_id FROM donors WHERE tithe_id = ? COLLATE NOCASE').get(titheId);
      if (existing) {
        db.prepare(
          `UPDATE donors SET full_name = ?, spouse = ?, email = ?, notes = ?, date = ?, is_new_entry = ? WHERE tithe_id = ?`
        ).run(fullName, String(r['Spouse'] || '').trim(), String(r['Email'] || '').trim(),
              String(r['Notes'] || ''), date, isNewEntry, existing.tithe_id);
      } else {
        db.prepare(
          `INSERT INTO donors (tithe_id, date, full_name, spouse, email, notes, is_new_entry) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(titheId, date, fullName, String(r['Spouse'] || '').trim(), String(r['Email'] || '').trim(),
              String(r['Notes'] || ''), isNewEntry);
        inserted += 1;
      }
    }
    return inserted;
  });
  const inserted = upsert(records);
  return { processed: records.length, inserted };
}

function importGiving(records) {
  const num = (v) => Math.round(parseFloat(v) || 0);
  const tx = db.transaction((rows) => {
    let inserted = 0;
    for (const r of rows) {
      const titheId = String(r['Tithe ID'] || '').trim();
      if (!titheId) continue;
      let donor = db.prepare('SELECT tithe_id FROM donors WHERE tithe_id = ? COLLATE NOCASE').get(titheId);
      if (!donor) {
        // Preserve referential integrity: create the referenced donor from the CSV row.
        const parsedDate = Date.parse(r['Date']);
        const date = isNaN(parsedDate) ? todayStr()
          : `${new Date(parsedDate).getFullYear()}-${String(new Date(parsedDate).getMonth() + 1).padStart(2, '0')}-${String(new Date(parsedDate).getDate()).padStart(2, '0')}`;
        const newId = /^\d+$/.test(titheId) ? titheId : nextTitheIdTx();
        db.prepare(
          `INSERT INTO donors (tithe_id, date, full_name, spouse, email, notes, is_new_entry) VALUES (?, ?, ?, '', '', '', 0)`
        ).run(newId, date, String(r['Full name'] || titheId).trim());
        donor = { tithe_id: newId };
      }
      const method = GIVING_TYPES.includes(r['Method']) ? r['Method'] : 'Cash / Cheque';
      const feeAmt = method === 'Online' ? Math.max(0, num(r['Online fee amount'])) : 0;
      const isFee = method === 'Online' && feeAmt > 0;
      const parsedDate = Date.parse(r['Date']);
      const date = isNaN(parsedDate) ? todayStr()
        : `${new Date(parsedDate).getFullYear()}-${String(new Date(parsedDate).getMonth() + 1).padStart(2, '0')}-${String(new Date(parsedDate).getDate()).padStart(2, '0')}`;
      const regular = Math.max(0, num(r['Regular'])), mission = Math.max(0, num(r['Mission']));
      const buildingFund = Math.max(0, num(r['Building fund'])), other = Math.max(0, num(r['Other']));
      if (regular + mission + buildingFund + other <= 0) continue; // would violate CHECK (total_amount > 0)
      insertGivingRow(db, {
        titheId: donor.tithe_id, date, method,
        regular, mission, buildingFund, other,
        notes: String(r['Notes'] || ''),
        isFee, onlineFeeAmount: isFee ? feeAmt : 0,
        createdDonor: false,
      });
      inserted += 1;
    }
    return inserted;
  });
  const inserted = tx(records);
  return { processed: records.length, inserted };
}

// ---------------------------------------------------------------------------
// Backup

function backupTo(destPath) {
  db.prepare(`VACUUM INTO ?`).run(destPath);
  return destPath;
}

module.exports = {
  init, close, AppError, todayStr, isValidDateStr,
  getSetting, setSetting, getEmailRecipients, setEmailRecipients,
  verifyPassword, setPassword, changePassword,
  listDonors, findDonors, getDonorByTitheId, insertDonor, updateDonor, deleteDonor,
  newestEntryDonor, findDonorExact,
  listGiving, getGift, deleteGiving, recordGift, updateGiving,
  findGivingDatesByPerson, findGivingByPersonAndDate,
  monthReport, yearReport, otherReport, fundTotals,
  listDeposits, insertDeposit, deleteDeposit, titheSheetTotal, markDepositEmailed,
  importDonors, importGiving,
  backupTo,
};
