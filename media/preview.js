// @ts-check
/*
 * Runs inside the gh-ref WebviewPanel.
 *
 *   1. Receives rendered markdown HTML from the host (postMessage {type:'update'}).
 *   2. Receives an optional GitHub token (postMessage {type:'token'}) for private repos.
 *   3. For every <span class="gh-ref" data-owner/repo/number>, fetches the issue/PR
 *      from the GitHub REST API and rewrites it to:
 *
 *        {state octicon} {title} {repo}#{number}
 *
 *      linked to the issue/PR — matching how references render on github.com.
 *
 * Titles are cached in sessionStorage so re-renders on keystroke are instant.
 */
(function () {
  'use strict';

  const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

  let githubToken = null;
  const CACHE_PREFIX = 'gh-ref-meta:';

  // ---- GitHub octicons (16px), colored per state. ----------------------------
  const OCTICON = {
    // open issue — green
    issueOpen:
      '<svg class="gh-ico" viewBox="0 0 16 16" width="16" height="16" fill="#1a7f37"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>',
    // closed/completed issue — purple
    issueClosed:
      '<svg class="gh-ico" viewBox="0 0 16 16" width="16" height="16" fill="#8250df"><path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z"/><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z"/></svg>',
    // not-planned issue — gray
    issueSkipped:
      '<svg class="gh-ico" viewBox="0 0 16 16" width="16" height="16" fill="#6e7781"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>',
    // open PR — green
    prOpen:
      '<svg class="gh-ico" viewBox="0 0 16 16" width="16" height="16" fill="#1a7f37"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>',
    // merged PR — purple
    prMerged:
      '<svg class="gh-ico" viewBox="0 0 16 16" width="16" height="16" fill="#8250df"><path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>',
    // closed (unmerged) PR — red
    prClosed:
      '<svg class="gh-ico" viewBox="0 0 16 16" width="16" height="16" fill="#cf222e"><path d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.628V5a.75.75 0 0 1 1.5 0v1.628a2.251 2.251 0 1 1-1.5 0ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm-2.72-9.78a.749.749 0 0 1 1.06 0l.97.97.97-.97a.749.749 0 1 1 1.06 1.06l-.97.97.97.97a.749.749 0 1 1-1.06 1.06l-.97-.97-.97.97a.749.749 0 1 1-1.06-1.06l.97-.97-.97-.97a.749.749 0 0 1 0-1.06Z"/></svg>',
  };

  function pickIcon(data) {
    const isPR = !!data.pull_request;
    if (isPR) {
      if (data.pull_request.merged_at) { return OCTICON.prMerged; }
      if (data.state === 'closed') { return OCTICON.prClosed; }
      return OCTICON.prOpen;
    }
    if (data.state === 'closed') {
      return data.state_reason === 'not_planned' ? OCTICON.issueSkipped : OCTICON.issueClosed;
    }
    return OCTICON.issueOpen;
  }

  // ---- cache ------------------------------------------------------------------
  function cacheKey(owner, repo, number) {
    return `${CACHE_PREFIX}${owner}/${repo}#${number}`;
  }
  function readCache(owner, repo, number) {
    try {
      const raw = window.sessionStorage.getItem(cacheKey(owner, repo, number));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function writeCache(owner, repo, number, meta) {
    try { window.sessionStorage.setItem(cacheKey(owner, repo, number), JSON.stringify(meta)); }
    catch { /* ignore */ }
  }

  function refUrl(owner, repo, number, isPR) {
    const kind = isPR ? 'pull' : 'issues';
    return `https://github.com/${owner}/${repo}/${kind}/${number}`;
  }

  // ---- rendering --------------------------------------------------------------
  function applyMeta(span, meta) {
    const { owner, repo, number } = span.dataset;
    span.textContent = '';
    span.classList.remove('gh-ref--loading');
    span.classList.add('gh-ref--resolved');

    const link = document.createElement('a');
    link.href = refUrl(owner, repo, number, meta.isPR);
    link.className = 'gh-ref-link';
    link.title = meta.title;
    link.innerHTML =
      meta.icon +
      `<span class="gh-ref-title"></span>` +
      `<span class="gh-ref-id"></span>`;
    link.querySelector('.gh-ref-title').textContent = meta.title;
    link.querySelector('.gh-ref-id').textContent = ` ${repo}#${number}`;
    span.appendChild(link);
  }

  function markError(span, reason, signInHint) {
    span.dataset.ghState = 'error';
    span.classList.remove('gh-ref--loading');
    span.classList.add('gh-ref--error');
    span.title = reason;
    if (signInHint && vscodeApi) {
      // Replace text with a sign-in affordance for private repos.
      span.textContent = '';
      const btn = document.createElement('a');
      btn.href = '#';
      btn.className = 'gh-ref-signin';
      btn.textContent = `#${span.dataset.number} (sign in)`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        vscodeApi.postMessage({ type: 'requestSignIn' });
      });
      span.appendChild(btn);
    }
  }

  async function resolve(span) {
    if (span.dataset.ghState === 'loading' || span.dataset.ghState === 'done') { return; }
    const { owner, repo, number } = span.dataset;
    if (!owner || !repo || !number) { return; }

    const cached = readCache(owner, repo, number);
    if (cached) {
      span.dataset.ghState = 'done';
      applyMeta(span, cached);
      return;
    }

    span.dataset.ghState = 'loading';
    span.classList.add('gh-ref--loading');

    try {
      const headers = { Accept: 'application/vnd.github+json' };
      if (githubToken) { headers.Authorization = `Bearer ${githubToken}`; }

      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
        { headers }
      );

      if (res.status === 403 || res.status === 429) { markError(span, 'GitHub API rate limit'); return; }
      if (res.status === 404) {
        // 404 on a private repo with no token → offer sign-in.
        markError(span, 'Issue not found or private', !githubToken);
        return;
      }
      if (res.status === 401) { markError(span, 'Token invalid or expired', true); return; }
      if (!res.ok) { markError(span, `GitHub API error (${res.status})`); return; }

      const data = await res.json();
      const title = typeof data.title === 'string' ? data.title : null;
      if (!title) { markError(span, 'No title in API response'); return; }

      const meta = { title, isPR: !!data.pull_request, icon: pickIcon(data) };
      writeCache(owner, repo, number, meta);
      span.dataset.ghState = 'done';
      applyMeta(span, meta);
    } catch {
      markError(span, 'Network error or blocked by CSP');
    }
  }

  // Match full GitHub issue/PR URLs, e.g.
  //   https://github.com/owner/repo/issues/587
  //   https://github.com/owner/repo/pull/604
  const URL_RE =
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)(?:[#?].*)?$/;

  // markdown-it renders bare and []() URLs as <a> tags. Promote any whose href is a
  // GitHub issue/PR link into a gh-ref span so the same resolution path handles them.
  // This also gives cross-repo support for free (the URL carries its own owner/repo).
  function wrapLinks() {
    document.querySelectorAll('#content a[href]').forEach((a) => {
      const link = /** @type {HTMLAnchorElement} */ (a);
      if (link.closest('span.gh-ref')) { return; } // already ours
      const m = URL_RE.exec(link.getAttribute('href') || '');
      if (!m) { return; }

      const span = document.createElement('span');
      span.className = 'gh-ref';
      span.dataset.owner = m[1];
      span.dataset.repo = m[2];
      span.dataset.number = m[3];
      span.textContent = link.textContent || `#${m[3]}`;
      link.replaceWith(span);
    });
  }

  function resolveAll() {
    wrapLinks();
    document.querySelectorAll('span.gh-ref').forEach(
      (s) => resolve(/** @type {HTMLElement} */ (s))
    );
  }

  // ---- host messages ----------------------------------------------------------
  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (!msg) { return; }

    if (msg.type === 'token') {
      githubToken = msg.token;
      // Re-resolve everything now that we can see private repos.
      try { window.sessionStorage.clear(); } catch { /* ignore */ }
      document.querySelectorAll('span.gh-ref').forEach((s) => {
        delete s.dataset.ghState;
      });
      resolveAll();
      return;
    }

    if (msg.type === 'update') {
      const content = document.getElementById('content');
      if (content) {
        content.innerHTML = msg.html;
        resolveAll();
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', resolveAll);
  } else {
    resolveAll();
  }
})();
