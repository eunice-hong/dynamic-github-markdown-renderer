type RepoGetter = () => { owner: string; repo: string } | undefined;

export function ghRefPlugin(md: any, getRepo: RepoGetter = () => undefined): void {
  md.inline.ruler.push('gh_ref', (state: any, silent: boolean) =>
    ghRefRule(state, silent, getRepo)
  );

  md.renderer.rules.gh_ref_open = (tokens: any[], idx: number) => {
    const token = tokens[idx];
    const number = token.attrGet('data-number');
    const owner = token.attrGet('data-owner');
    const repo = token.attrGet('data-repo');

    let attrs = `class="gh-ref" data-number="${escapeHtml(number)}"`;
    if (owner && repo) {
      attrs += ` data-owner="${escapeHtml(owner)}" data-repo="${escapeHtml(repo)}"`;
    }
    return `<span ${attrs}>`;
  };
  md.renderer.rules.gh_ref_close = () => '</span>';
}

function escapeHtml(value: string | null): string {
  if (!value) { return ''; }
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ghRefRule(state: any, silent: boolean, getRepo: RepoGetter): boolean {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x23 /* # */) { return false; }

  if (start > 0 && isWordChar(state.src.charCodeAt(start - 1))) { return false; }

  const match = /^#(\d{1,9})/.exec(state.src.slice(start));
  if (!match) { return false; }

  const after = state.src.charCodeAt(start + match[0].length);
  if (!Number.isNaN(after) && isWordChar(after)) { return false; }

  if (silent) { return true; }

  const number = match[1];
  const repo = getRepo();

  const openToken = state.push('gh_ref_open', 'span', 1);
  openToken.attrSet('data-number', number);
  if (repo) {
    openToken.attrSet('data-owner', repo.owner);
    openToken.attrSet('data-repo', repo.repo);
  }

  const text = state.push('text', '', 0);
  text.content = `#${number}`;

  state.push('gh_ref_close', 'span', -1);

  state.pos += match[0].length;
  return true;
}

function isWordChar(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f
  );
}
