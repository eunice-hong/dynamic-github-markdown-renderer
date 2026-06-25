// Unit tests for the pure reference-rendering helpers. Run: node media/refLogic.test.js
const assert = require('assert');
const { URL_RE, labelText, relTime } = require('./refLogic');

let passed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok  ', name); passed++; }
  catch (e) { console.error('  FAIL', name, '\n', e.message); process.exitCode = 1; }
}

// ---- URL_RE ----
test('matches an issue URL and captures owner/repo/number', () => {
  const m = URL_RE.exec('https://github.com/owner/repo/issues/587');
  assert.deepStrictEqual([m[1], m[2], m[3]], ['owner', 'repo', '587']);
});
test('matches a pull URL', () => {
  const m = URL_RE.exec('https://github.com/o/r/pull/604');
  assert.strictEqual(m[3], '604');
});
test('matches with a trailing #anchor or ?query', () => {
  assert.ok(URL_RE.exec('https://github.com/o/r/issues/1#issuecomment-9'));
  assert.ok(URL_RE.exec('https://github.com/o/r/pull/2?diff=split'));
});
test('rejects non-issue/pull github paths', () => {
  assert.strictEqual(URL_RE.exec('https://github.com/o/r/commit/abc'), null);
  assert.strictEqual(URL_RE.exec('https://github.com/o/r'), null);
});
test('rejects non-github hosts', () => {
  assert.strictEqual(URL_RE.exec('https://gitlab.com/o/r/issues/1'), null);
});

// ---- labelText (YIQ contrast) ----
test('dark background -> white text', () => {
  assert.strictEqual(labelText('000000'), '#ffffff');
  assert.strictEqual(labelText('0e8a16'), '#ffffff'); // github green
});
test('light background -> dark text', () => {
  assert.strictEqual(labelText('ffffff'), '#1f2328');
  assert.strictEqual(labelText('fbca04'), '#1f2328'); // github yellow
});
test('missing/short hex -> white (safe default)', () => {
  assert.strictEqual(labelText(''), '#ffffff');
  assert.strictEqual(labelText('abc'), '#ffffff');
  assert.strictEqual(labelText(undefined), '#ffffff');
});

// ---- relTime ----
test('empty input -> empty string', () => {
  assert.strictEqual(relTime(''), '');
});
test('singular vs plural units', () => {
  const ago = (secs) => new Date(Date.now() - secs * 1000).toISOString();
  assert.strictEqual(relTime(ago(86400)), '1 day ago');
  assert.strictEqual(relTime(ago(86400 * 3)), '3 days ago');
  assert.strictEqual(relTime(ago(3600)), '1 hour ago');
});
test('under a minute -> just now', () => {
  assert.strictEqual(relTime(new Date().toISOString()), 'just now');
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
