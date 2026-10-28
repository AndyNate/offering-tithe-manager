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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'otm-fuzzy-'));
db.init(path.join(tmpDir, 'fuzzy.db'));

// Build a larger donor population with a few near-collision clusters plus
// many unrelated names so fuzzy matching has to discriminate.
const firstNames = ['Aaron','Bella','Carlos','Diana','Ethan','Fiona','George','Hannah','Ivan','Julia','Kevin','Laura','Marcus','Nina','Oscar','Paula','Quentin','Rachel','Samuel','Tina','Uma','Victor','Wendy','Xavier','Yara','Zach'];
const lastNames = ['Anderson','Baker','Carter','Diaz','Evans','Foster','Garcia','Harris','Ingram','Johnson','King','Lopez','Miller','Nelson','Owens','Parker','Quinn','Roberts','Smith','Taylor','Underwood','Vargas','Wilson','Xu','Young','Zimmerman'];

let n = 0;
for (const f of firstNames) {
  for (const l of lastNames) {
    db.insertDonor({ fullName: f + ' ' + l });
    n++;
  }
}
// Near-collision cluster for ambiguous tests.
db.insertDonor({ fullName: 'John Smith' });
db.insertDonor({ fullName: 'Jon Smith' });
db.insertDonor({ fullName: 'John Smyth' });
// Unique-surname donors for clear single-match tests.
db.insertDonor({ fullName: 'Alice Zephyr' });
db.insertDonor({ fullName: 'Barnaby Quark' });

t('seeded a larger donor set', () => {
  assert.ok(db.listDonors().length >= firstNames.length * lastNames.length);
});

t('findFuzzyMatches returns sorted, scored candidates on a large DB', () => {
  const m = db.findFuzzyMatches('Jhon Smith');
  assert.ok(m.length >= 2, 'expected at least two close candidates');
  for (let i = 1; i < m.length; i++) {
    assert.ok(m[i - 1].score >= m[i].score, 'results must be sorted by score desc');
  }
  assert.ok(m[0].score >= 0.7, 'top score should clear the minimum threshold');
});

t('ambiguous input with several close donors creates a provisional donor + ambiguous review', () => {
  const before = db.listDonors().length;
  const r = db.recordGift({ name: 'Jhon Smith', regular: 1000 }, { isAdmin: true });
  assert.strictEqual(r.isNewEntry, true, 'ambiguous case provisions a new donor');
  assert.ok(db.listDonors().length > before, 'provisional donor inserted');
  const reviews = db.listNameReviews('pending');
  const amb = reviews.find((rv) => rv.originalName === 'Jhon Smith');
  assert.ok(amb, 'an ambiguous review is queued');
  assert.strictEqual(amb.reason, 'ambiguous_matches');
  assert.ok((amb.matches || []).length >= 2, 'candidate list is preserved');
});

t('a single clear match auto-corrects and queues one review', () => {
  const r = db.recordGift({ name: 'Alise Zephyr', regular: 500 }, { isAdmin: true });
  assert.strictEqual(r.isNewEntry, false, 'gift attributed to existing donor');
  assert.strictEqual(r.donation.fullName, 'Alice Zephyr', 'stored spelling is used');
  const reviews = db.listNameReviews('pending');
  const rev = reviews.find((rv) => rv.originalName === 'Alise Zephyr');
  assert.ok(rev, 'a review is queued');
  assert.notStrictEqual(rev.proposedName, null, 'a single proposed donor is set');
});

t('a name with no close match creates a brand-new donor and no review', () => {
  const beforeReviews = db.listNameReviews('pending').length;
  const r = db.recordGift({ name: 'Zzzzyx Qqqqq', regular: 250 }, { isAdmin: true });
  assert.strictEqual(r.isNewEntry, true);
  const afterReviews = db.listNameReviews('pending').length;
  assert.strictEqual(afterReviews, beforeReviews, 'no review queued for a genuinely new name');
});

t('clear top match with a weak runner-up auto-corrects instead of going ambiguous', () => {
  // Only 'Xavier Young' is close to this input; bulk names are far away.
  const r = db.recordGift({ name: 'Barnaby Quarq', regular: 300 }, { isAdmin: true });
  assert.strictEqual(r.isNewEntry, false);
  assert.strictEqual(r.donation.fullName, 'Barnaby Quark');
});

t('ambiguous review exposes candidates that can be assigned', () => {
  const rev = db.listNameReviews('pending').find((r) => r.originalName === 'Jhon Smith');
  assert.ok(rev && Array.isArray(rev.matches) && rev.matches.length >= 2);
  const target = rev.matches[0].donor.titheId;
  const res = db.approveNameReview(rev.id, { assignToTitheId: target });
  assert.deepStrictEqual(res, { ok: true });
  const updated = db.listNameReviews().find((r) => r.id === rev.id);
  assert.strictEqual(updated.status, 'approved');
});

t('fuzzy matching stays fast on a larger donor table', () => {
  // Add more donors to stress the O(n * m^2) matcher.
  for (let i = 0; i < 1500; i++) {
    db.insertDonor({ fullName: 'Stress Donor ' + i });
  }
  const start = Date.now();
  const m = db.findFuzzyMatches('Stress Donar 42');
  const elapsed = Date.now() - start;
  assert.ok(m.length >= 1, 'stress search still finds a match');
  assert.ok(elapsed < 2000, 'fuzzy search should complete in under 2s (took ' + elapsed + 'ms)');
});

db.close();
console.log('\n' + passed + ' checks passed' + (process.exitCode ? ' (WITH FAILURES)' : ''));
process.exit(process.exitCode || 0);
EOF