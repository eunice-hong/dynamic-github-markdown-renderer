import assert from 'assert';
import { parseGitHubUrl, parseRepoFromGitConfig } from './gitConfig';

// A tiny zero-dependency test harness so this runs with plain `node` after tsc,
// without pulling in a full test framework for Phase 1.
let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${name}\n       ${(e as Error).message}`);
  }
}

test('parses scp-style remote', () => {
  assert.deepStrictEqual(parseGitHubUrl('git@github.com:acme/renderer.git'), {
    owner: 'acme',
    repo: 'renderer',
  });
});

test('parses https remote with .git', () => {
  assert.deepStrictEqual(parseGitHubUrl('https://github.com/acme/renderer.git'), {
    owner: 'acme',
    repo: 'renderer',
  });
});

test('parses https remote without .git or trailing slash', () => {
  assert.deepStrictEqual(parseGitHubUrl('https://github.com/acme/renderer/'), {
    owner: 'acme',
    repo: 'renderer',
  });
});

test('parses ssh:// remote with embedded user', () => {
  assert.deepStrictEqual(parseGitHubUrl('ssh://git@github.com/acme/renderer.git'), {
    owner: 'acme',
    repo: 'renderer',
  });
});

test('keeps repo names containing dots', () => {
  assert.deepStrictEqual(parseGitHubUrl('git@github.com:acme/my.repo.io.git'), {
    owner: 'acme',
    repo: 'my.repo.io',
  });
});

test('rejects non-github host', () => {
  assert.strictEqual(parseGitHubUrl('git@gitlab.com:acme/renderer.git'), undefined);
});

test('prefers origin over other remotes', () => {
  const config = `
[remote "upstream"]
\turl = git@github.com:upstream-owner/repo.git
[remote "origin"]
\turl = git@github.com:my-fork/repo.git
`;
  assert.deepStrictEqual(parseRepoFromGitConfig(config), {
    owner: 'my-fork',
    repo: 'repo',
  });
});

test('falls back to a non-origin github remote', () => {
  const config = `
[core]
\tbare = false
[remote "upstream"]
\turl = https://github.com/upstream-owner/repo.git
`;
  assert.deepStrictEqual(parseRepoFromGitConfig(config), {
    owner: 'upstream-owner',
    repo: 'repo',
  });
});

test('returns undefined when no github remote exists', () => {
  const config = `
[remote "origin"]
\turl = git@bitbucket.org:acme/repo.git
`;
  assert.strictEqual(parseRepoFromGitConfig(config), undefined);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
