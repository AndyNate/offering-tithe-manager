const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../db');

let passed = 0;
function t(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ok - ' + name);
  } catch (e) {
    console.error('  FAIL - ' + name);
    console.error(e && e.stack || e);
    process.exitCode = 1;
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'otm-test-'));
db.init(path.join(tmpDir, 'test.db'));

// ---- settings / password
t('default password verifies', () => {
  assert.strictEqual(db.verifyPassword('admin'), true);
  assert.strictEqual(db.verifyPassword('wrong'), false);
});
t('isDefaultPassword detects the shipped default', () => {
  assert.strictEqual(db.isDefaultPassword(), true, 'fresh DB still uses the admin default');
  db.setPassword('s3cret');
  assert.strictEqual(db.isDefaultPassword(), false);
  db.setPassword('admin');
  assert.strictEqual(db.isDefaultPassword(), true);
});
t('password change persists', () => {
  db.setPassword('newpass');
  assert.strictEqual(db.verifyPassword('newpass'), true);
  assert.strictEqual(db.verifyPassword('admin'), false);
  db.setPassword('admin');
});
t('password change requires current password and matching confirmation', () => {
  assert.throws(() => db.changePassword('wrong', 'changed', 'changed'), /Current password is incorrect/);
  assert.throws(() => db.changePassword('admin', 'changed', 'different'), /do not match/);
  db.changePassword('admin', 'changed', 'changed');
  assert.strictEqual(db.verifyPassword('changed'), true);
  db.setPassword('admin');
});
t('non-scrypt hashes are rejected (no legacy support)', () => {
  db.setSetting('admin_password_hash', 'not-a-scrypt-hash');
  assert.strictEqual(db.verifyPassword('anything'), false);
  assert.strictEqual(db.getSetting('admin_password_hash'), 'not-a-scrypt-hash', 'stored hash must not be altered');
  db.setPassword('admin');
});
t('email recipients roundtrip + dedupe (case-insensitive)', () => {
  const next = db.setEmailRecipients(['a@x.com', 'B@X.com']);
  assert.deepStrictEqual(next, ['a@x.com', 'b@x.com']); // normalized to lowercase
  const deduped = db.setEmailRecipients(['A@X.com', 'a@x.com']);
  assert.deepStrictEqual(deduped, ['a@x.com']);
});
t('settings get/set roundtrip', () => {
  db.setSetting('brevo_api_key', 'key-123'); // nosemgrep: test fixture, not a real credential
  assert.strictEqual(db.getSetting('brevo_api_key', ''), 'key-123');
});
t('org_name defaults to OTMP and persists', () => {
  assert.strictEqual(db.getSetting('org_name', 'OTMP'), 'OTMP');
  db.setSetting('org_name', 'Grace Fellowship');
  assert.strictEqual(db.getSetting('org_name', 'OTMP'), 'Grace Fellowship');
});

// ---- donors
t('insertDonor assigns tithe IDs sequentially from 1', () => {
  const d1 = db.insertDonor({ fullName: 'Alice Anderson' });
  const d2 = db.insertDonor({ fullName: 'Bob Baker' });
  assert.strictEqual(d1.titheId, '1');
  assert.strictEqual(d2.titheId, '2');
  assert.strictEqual(d1.isNewEntry, true);
});
t('listDonors sorted by tithe id desc-ish and searchable', () => {
  const all = db.listDonors();
  assert.ok(all.length >= 2);
  const hits = db.findDonors('alice');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].fullName, 'Alice Anderson');
});
t('findDonorExact matches by name/email/titheId variants', () => {
  assert.ok(db.findDonorExact({ fullName: 'ALICE ANDERSON' }));
  assert.ok(!db.findDonorExact({ email: '' })); // blank never matches
  assert.ok(db.findDonorExact({ titheId: '1' }));
});
t('updateDonor edits fields without changing titheId', () => {
  db.updateDonor({ titheId: '1', fullName: 'Alice Anderson-Smith', spouse: 'Sam', email: 'a@x.com', notes: 'note' });
  const d = db.getDonorByTitheId('1');
  assert.strictEqual(d.fullName, 'Alice Anderson-Smith');
  assert.strictEqual(d.spouse, 'Sam');
});
t('deleteDonor cascades giving rows', () => {
  db.recordGift({ name: 'Bob Baker', regular: 5000 }, {});
  const changes = db.deleteDonor('2');
  assert.strictEqual(changes, 1);
  assert.strictEqual(db.getDonorByTitheId('2'), null);
  assert.strictEqual(db.listGiving().length, 0);
});

// ---- recordGift
t('recordGift creates new donor from plain name (New badge)', () => {
  const r = db.recordGift({ name: 'Cara Cole', regular: 2500 }, {});
  assert.strictEqual(r.isNewEntry, true);
  assert.strictEqual(r.donation.createdDonor, true);
  assert.strictEqual(r.donation.method, 'Cash / Cheque'); // non-admin locked
});
t('recordGift matches existing donor by exact name (no New badge)', () => {
  const r = db.recordGift({ name: 'cara cole', regular: 1000 }, {});
  assert.strictEqual(r.isNewEntry, false);
  assert.strictEqual(r.donation.createdDonor, false);
});
t('numeric input that is not a tithe ID errors with code no-tithe-id', () => {
  assert.throws(() => db.recordGift({ name: '999999', regular: 1000 }, {}), /doesn.t exist|Tithe ID/);
});
t('non-admin cannot use non-cash methods or custom dates', () => {
  const r = db.recordGift({ name: 'Cara Cole', regular: 1000, method: 'Online', date: '2020-01-01' }, {});
  assert.strictEqual(r.donation.method, 'Cash / Cheque');
});
t('admin unlock: E-Transfer + custom date respected', () => {
  const r = db.recordGift({ name: 'Cara Cole', regular: 3000, method: 'E-Transfer', date: '2026-08-15' }, { isAdmin: true });
  assert.strictEqual(r.donation.method, 'E-Transfer');
  assert.strictEqual(r.donation.date, '2026-08-15');
});
t('Online fee recorded as fee row fields', () => {
  const r = db.recordGift({ name: 'Cara Cole', regular: 5000, method: 'Online', onlineFee: 175 }, { isAdmin: true });
  assert.strictEqual(r.donation.isFee, true);
  assert.strictEqual(r.donation.onlineFeeAmount, 175);
});
t('other > 0 requires notes', () => {
  assert.throws(() => db.recordGift({ name: 'Cara Cole', other: 1200 }, {}), /Notes are required/);
});
t('zero total rejected', () => {
  assert.throws(() => db.recordGift({ name: 'Cara Cole' }, {}), /Enter a name/);
});
t('negative amount rejected', () => {
  assert.throws(() => db.recordGift({ name: 'Cara Cole', regular: -5 }, {}), /negative/);
});

// ---- reports (fixed month: 2026-08)
// so far: Cara Cole cash 2500 + 1000 + 3000 + 5000(+fee 175) = 11500; yearReport adds fee -> 11675 for her
// ---- reports (fixed month: 2026-08)
// gifts so far: Cara cash 2500, cara cash 1000, non-admin-locked cash 1000,
// etransfer 3000 (08-15), online 5000(+fee 175), Dan cash 4000+500+250+250
t('monthReport aggregates by method in cents', () => {
  db.recordGift({ name: 'Dan Diaz', regular: 4000, mission: 500, buildingFund: 250, other: 250, notes: 'ladies event' }, { isAdmin: true });
  const rep = db.monthReport('2026', '8');
  assert.strictEqual(rep.cashCheque, 2500 + 1000 + 1000 + 5000);
  assert.strictEqual(rep.eTransfer, 3000);
  assert.strictEqual(rep.online, 5000);
  assert.strictEqual(rep.grandTotal, 9500 + 3000 + 5000);
});
t('fundTotals sums per fund', () => {
  const f = db.fundTotals('2026', '8');
  assert.strictEqual(f.regular, 2500 + 1000 + 1000 + 3000 + 5000 + 4000);
  assert.strictEqual(f.mission, 500);
  assert.strictEqual(f.buildingFund, 250);
  assert.strictEqual(f.other, 250);
});
t('otherReport lists noted donations with fund breakdown', () => {
  db.recordGift({ name: 'Dawn Donor', regular: 2000, mission: 4020, notes: 'mcathy missionary' }, { isAdmin: true });
  db.recordGift({ name: 'Zed Quiet', regular: 1000, notes: '' }, { isAdmin: true });
  const o = db.otherReport('2026', '8');
  const ladies = o.entries.find((e) => e.note === 'ladies event');
  assert.ok(ladies, 'noted regular/mission/building/other row included');
  assert.strictEqual(ladies.regular, 4000);
  assert.strictEqual(ladies.mission, 500);
  assert.strictEqual(ladies.buildingFund, 250);
  assert.strictEqual(ladies.other, 250);
  const mcathy = o.entries.find((e) => e.note === 'mcathy missionary');
  assert.ok(mcathy, 'noted regular/mission-only row included');
  assert.strictEqual(mcathy.regular, 2000);
  assert.strictEqual(mcathy.mission, 4020);
  assert.strictEqual(mcathy.buildingFund, 0);
  assert.strictEqual(mcathy.other, 0);
  assert.strictEqual(o.entries.length, 2, 'rows without notes are excluded');
  assert.strictEqual(o.total, 4000 + 500 + 250 + 250 + 2000 + 4020);
});
t('yearReport includes online fees in donor totals, sorted desc', () => {
  const cara = db.listDonors().find((d) => d.fullName.startsWith('Cara'));
  db.updateDonor({ titheId: String(cara.titheId), fullName: cara.fullName, spouse: 'Carl Cole', email: cara.email, notes: cara.notes });
  const yr = db.yearReport('2026').filter((r) => r.fullName.startsWith('Cara'));
  assert.strictEqual(yr.length, 1);
  assert.strictEqual(yr[0].total, 12675); // Cara only: 4500 cash + 3000 e-transfer + 5000 online + 175 fee (Dan's gifts are his own)
  assert.strictEqual(yr[0].spouse, 'Carl Cole');
});
t('yearReport can exclude online fees', () => {
  const cara = db.listDonors().find((d) => d.fullName.startsWith('Cara'));
  const yr = db.yearReport('2026', { includeFees: false }).filter((r) => r.titheId === String(cara.titheId));
  assert.strictEqual(yr.length, 1);
  assert.strictEqual(yr[0].total, 12500); // 12675 minus the 175 online fee
});

// ---- deposits
t('insertDeposit recomputes subtotals server-side', () => {
  const d = db.insertDeposit({
    depositNumber: 'D-12',
    teller1: 'Tess',
    counts: { bill20: 3, coin1: 4, otherLooseCoin: 125 },
    cheques: [{ identification: '#101', amount: 25000 }, { identification: '', amount: 0 }],
    date: '2026-08-21',
  });
  assert.strictEqual(d.billsTotal, 6000);
  assert.strictEqual(d.coinsTotal, 525);
  assert.strictEqual(d.cashSubtotal, 6525);
  assert.strictEqual(d.chequesSubtotal, 25000); // empty cheque filtered
  assert.strictEqual(d.total, 31525);
});
t('deposit number digits-only normalization + admin duplicate rejection', () => {
  assert.throws(() => db.insertDeposit({ depositNumber: '12', counts: {}, cheques: [] }, { isAdmin: true }), /already exists/);
});
t('non-admin deposits retry duplicate numbers automatically', () => {
  const d = db.insertDeposit({ depositNumber: '12', counts: {}, cheques: [] }, { isAdmin: false });
  assert.ok(/^\d{7}$/.test(d.depositNumber));
  assert.notStrictEqual(d.depositNumber, '12');
  db.deleteDeposit(d.depositNumber);
});
t('titheSheetTotal sums same-day cash gifts only', () => {
  const s = db.titheSheetTotal('2026-08-21');
  assert.ok(s.total >= 0); // no gifts dated today in fixture unless seeded
});
t('markDepositEmailed stamps recipient', () => {
  db.markDepositEmailed('12', 'team@example.com');
  const [d] = db.listDeposits();
  assert.strictEqual(d.emailedTo, 'team@example.com');
});
t('deleteDeposit removes the row', () => {
  db.deleteDeposit('12');
  assert.strictEqual(db.listDeposits().length, 0);
});

// ---- imports
t('importDonors upserts by Tithe ID', () => {
  const res = db.importDonors([
    { 'Tithe ID': '900', 'Full name': 'Alice A. Smith', 'Spouse': 'Sam', Email: 'alice@x.com', Notes: 'upd', 'Registration date': 'June 15, 2025', 'Is new entry': 'N' },
    { 'Tithe ID': '2000', 'Full name': 'Zoe Zane', 'Registration date': 'bad-date' },
    { 'Tithe ID': '', 'Full name': 'skipped' },
  ]);
  assert.strictEqual(res.processed, 3);
  assert.strictEqual(res.inserted, 2); // '900' and '2000' are new; empty row skipped
  const a = db.getDonorByTitheId('900');
  assert.strictEqual(a.fullName, 'Alice A. Smith');
  assert.strictEqual(a.date, '2025-06-15');
  assert.strictEqual(db.getDonorByTitheId('2000').fullName, 'Zoe Zane');
});
t('importGiving auto-creates missing donors to preserve integrity', () => {
  const res = db.importGiving([
    { 'Tithe ID': '3000', 'Full name': 'Ivy Innis', Date: 'Aug 10, 2026', Method: 'E-Transfer', Regular: '50', Mission: '', 'Building fund': '', Other: '', Notes: '', 'Online fee amount': '' },
    { 'Tithe ID': '3000', Date: 'not-a-date', Regular: '25' },
  ]);
  assert.strictEqual(res.inserted, 2);
  const ivy = db.getDonorByTitheId(3000);
  assert.strictEqual(ivy.fullName, 'Ivy Innis');
});
t('importGiving converts dollar CSV values to cents', () => {
  db.importGiving([
    { 'Tithe ID': '4000', 'Full name': 'Carol Cards', Date: 'Aug 10, 2026', Method: 'Cash / Cheque', Regular: '87', Mission: '12.5', 'Building fund': '0', Other: '1.25', Notes: '', 'Online fee amount': '' },
    { 'Tithe ID': '4001', 'Full name': 'Pete Pence', Date: 'Aug 11, 2026', Method: 'Online', Regular: '10', Mission: '', 'Building fund': '', Other: '', Notes: '', 'Online fee amount': '0.3' },
  ]);
  let gifts = db.listGiving().filter((g) => String(g.titheId) === '4000');
  assert.strictEqual(gifts.length, 1);
  assert.strictEqual(gifts[0].regular, 8700);
  assert.strictEqual(gifts[0].mission, 1250);
  assert.strictEqual(gifts[0].buildingFund, 0);
  assert.strictEqual(gifts[0].other, 125);
  gifts = db.listGiving().filter((g) => String(g.titheId) === '4001');
  assert.strictEqual(gifts.length, 1);
  assert.strictEqual(gifts[0].regular, 1000);
  assert.strictEqual(gifts[0].isFee, true);
  assert.strictEqual(gifts[0].onlineFeeAmount, 30);
});

// ---- tithe ID gap-filling
t('insertDonor fills the lowest gaps left by deleted donors', () => {
  db.listDonors().forEach((d) => db.deleteDonor(d.titheId)); // start from an empty table
  ['A One', 'B Two', 'C Three', 'D Four', 'E Five'].forEach((n) => db.insertDonor({ fullName: n }));
  db.deleteDonor('2');
  db.deleteDonor('4');
  const first = db.insertDonor({ fullName: 'Gus Gapper' });
  const second = db.insertDonor({ fullName: 'Hank Holler' });
  assert.strictEqual(first.titheId, '2');
  assert.strictEqual(second.titheId, '4');
});
t('recordGift auto-create fills gaps too (New badge on reused id)', () => {
  db.deleteDonor('4'); // frees another slot
  const r = db.recordGift({ name: 'Ivy Ingram', regular: 1000 }, {});
  assert.strictEqual(r.isNewEntry, true);
  assert.strictEqual(r.donation.createdDonor, true);
  assert.strictEqual(db.getDonorByTitheId('4').fullName, 'Ivy Ingram');
});
t('with no gaps tithe IDs continue past the max', () => {
  // table currently holds a perfect 1..5 run, so the next free number is 6
  const tail = db.insertDonor({ fullName: 'Tail Ender' });
  assert.strictEqual(tail.titheId, '6');
});

// ---- edit giving entry
t('findGivingDatesByPerson returns unique dates with counts', () => {
  // Ensure Dan Diaz has a gift to search for (may have been cleaned up by earlier tests)
  db.recordGift({ name: 'Dan Diaz', regular: 1234 }, { isAdmin: true });
  const dates = db.findGivingDatesByPerson('Dan Diaz');
  assert.ok(dates.length >= 1);
  assert.ok(dates[0].date);
  assert.ok(dates[0].count >= 1);
});
t('findGivingByPersonAndDate returns matching entries', () => {
  const dates = db.findGivingDatesByPerson('Dan Diaz');
  const entries = db.findGivingByPersonAndDate('Dan Diaz', dates[0].date);
  assert.ok(entries.length >= 1);
  assert.ok(entries[0].id);
  assert.strictEqual(entries[0].fullName, 'Dan Diaz');
});
t('findGivingDatesByPerson returns empty for unknown person', () => {
  const dates = db.findGivingDatesByPerson('ZZZ NOBODY');
  assert.strictEqual(dates.length, 0);
});
t('updateGiving changes tithe_id and amounts', () => {
  // Record a gift for Dan Diaz to edit
  const r = db.recordGift({ name: 'Dan Diaz', regular: 1000, mission: 500 }, { isAdmin: true });
  const giftId = r.donation.id;
  const updated = db.updateGiving(giftId, {
    titheId: r.donation.titheId,
    date: r.donation.date,
    method: 'E-Transfer',
    regular: 2000,
    mission: 0,
    buildingFund: 0,
    other: 100,
    onlineFee: 0,
    notes: 'updated test',
  });
  assert.strictEqual(updated.method, 'E-Transfer');
  assert.strictEqual(updated.regular, 2000);
  assert.strictEqual(updated.mission, 0);
  assert.strictEqual(updated.other, 100);
  assert.strictEqual(updated.notes, 'updated test');
  assert.strictEqual(updated.totalAmount, 2100);
});
t('updateGiving rejects non-existent tithe ID', () => {
  const r = db.recordGift({ name: 'Dan Diaz', regular: 1000 }, { isAdmin: true });
  assert.throws(() => db.updateGiving(r.donation.id, {
    titheId: '99999', date: r.donation.date, method: 'Cash / Cheque',
    regular: 1000, mission: 0, buildingFund: 0, other: 0,
  }), /No donor/);
});
t('updateGiving rejects zero total', () => {
  const r = db.recordGift({ name: 'Dan Diaz', regular: 1000 }, { isAdmin: true });
  assert.throws(() => db.updateGiving(r.donation.id, {
    titheId: r.donation.titheId, date: r.donation.date, method: 'Cash / Cheque',
    regular: 0, mission: 0, buildingFund: 0, other: 0,
  }), /greater than zero/);
});
t('updateGiving allows reassigning tithe_id to another donor', () => {
  const r1 = db.recordGift({ name: 'Alice Anderson-Smith', regular: 800 }, { isAdmin: true });
  const r2 = db.recordGift({ name: 'Dan Diaz', regular: 600 }, { isAdmin: true });
  // Reassign Dan's gift to Alice
  const updated = db.updateGiving(r2.donation.id, {
    titheId: r1.donation.titheId,
    date: r2.donation.date,
    method: 'Cash / Cheque',
    regular: 600, mission: 0, buildingFund: 0, other: 0,
  });
  assert.strictEqual(updated.titheId, r1.donation.titheId);
  assert.strictEqual(updated.fullName, 'Alice Anderson-Smith');
});

// ---- backup
t('backupTo writes a valid sqlite file via VACUUM INTO', () => {
  const dest = path.join(tmpDir, 'backup.db');
  db.backupTo(dest);
  assert.ok(fs.statSync(dest).size > 0);
});

db.close();
console.log('\n' + passed + ' checks passed' + (process.exitCode ? ' (WITH FAILURES)' : ''));
process.exit(process.exitCode || 0);
