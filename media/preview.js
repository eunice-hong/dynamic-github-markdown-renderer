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
 * Titles are cached in the host's globalState (seeded into an in-memory mirror)
 * so re-renders on keystroke are instant and titles persist across sessions.
 */
(function () {
  'use strict';

  const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

  let githubToken = null;

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
    // GitHub mark — for the hovercard header
    github:
      '<svg class="gh-hc-mark" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>',
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

  // Everything the inline link + hovercard need, in one JSON-serializable object
  // (so it serializes into the persistent cache).
  function buildMeta(data, title, owner, repo, number) {
    const merged = !!(data.pull_request && data.pull_request.merged_at);
    const isPR = !!data.pull_request;
    const stateText = merged ? 'Merged' : data.state === 'closed' ? 'Closed' : 'Open';
    const when = merged
      ? data.pull_request.merged_at
      : data.state === 'closed'
        ? data.closed_at || data.created_at
        : data.created_at;
    return {
      title,
      isPR,
      icon: pickIcon(data),
      stateText,
      when,
      repoFull: `${owner}/${repo}`,
      number,
      author: data.user ? { login: data.user.login, avatar: data.user.avatar_url } : null,
      labels: (data.labels || []).map((l) => ({ name: l.name, color: l.color })),
      assignees: (data.assignees || []).map((a) => a.login),
      milestone: data.milestone && data.milestone.title ? data.milestone.title : null,
    };
  }

  // Readable text color over a label's background (YIQ luminance), like github.
  function labelText(hex) {
    if (!hex || hex.length < 6) { return '#ffffff'; }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 >= 140 ? '#1f2328' : '#ffffff';
  }

  // "1 day ago" from an ISO timestamp; coarse units are plenty for a tooltip.
  function relTime(iso) {
    if (!iso) { return ''; }
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [name, secs] of units) {
      const n = Math.floor(s / secs);
      if (n >= 1) { return `${n} ${name}${n > 1 ? 's' : ''} ago`; }
    }
    return 'just now';
  }

  // ---- cache ------------------------------------------------------------------
  // In-memory mirror of the host's persistent cache. Seeded by the host on load
  // (message 'cacheSeed') and written through to the host (message 'cachePut'),
  // which persists it in globalState so titles survive across windows/sessions.
  let memCache = {};

  function cacheKey(owner, repo, number) {
    return `${owner}/${repo}#${number}`;
  }
  function readCache(owner, repo, number) {
    return memCache[cacheKey(owner, repo, number)] || null;
  }
  function writeCache(owner, repo, number, meta) {
    const key = cacheKey(owner, repo, number);
    memCache[key] = meta;
    if (vscodeApi) { vscodeApi.postMessage({ type: 'cachePut', key, meta }); }
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
    link.innerHTML =
      meta.icon +
      `<span class="gh-ref-title"></span>` +
      `<span class="gh-ref-id"></span>`;
    link.querySelector('.gh-ref-title').textContent = meta.title;
    link.querySelector('.gh-ref-id').textContent = ` ${repo}#${number}`;

    // Rich hovercard (github.com style). Native `title` would not allow the
    // octicons / avatar, so this is one shared positioned div — no tooltip lib.
    // The card is non-interactive, so hide directly when the pointer leaves.
    link.addEventListener('mouseenter', () => showCard(link, meta));
    link.addEventListener('mouseleave', () => { if (cardEl) { cardEl.hidden = true; } });
    span.appendChild(link);
  }

  // ---- hovercard --------------------------------------------------------------
  let cardEl = null;

  function card() {
    if (!cardEl) {
      cardEl = document.createElement('div');
      cardEl.className = 'gh-hovercard';
      cardEl.hidden = true;
      document.body.appendChild(cardEl);
    }
    return cardEl;
  }

  // Append a key cell + value cell straight into the 2-column grid so all keys
  // align in column 1 and all values in column 2.
  function hcRow(rows, key, valueNode) {
    const k = document.createElement('span');
    k.className = 'gh-hc-k';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = 'gh-hc-v';
    v.appendChild(valueNode);
    rows.append(k, v);
  }

  function showCard(link, meta) {
    const c = card();
    c.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'gh-hc-head';
    head.innerHTML = OCTICON.github;
    head.appendChild(document.createTextNode(' GitHub'));

    const title = document.createElement('div');
    title.className = 'gh-hc-title';
    title.textContent = meta.title;

    const event = meta.stateText === 'Open' ? 'Opened' : meta.stateText;
    const sub = document.createElement('div');
    sub.className = 'gh-hc-sub';
    sub.textContent = `${meta.repoFull} · ${event} ${relTime(meta.when)}`;

    c.append(head, title, sub);

    const rows = document.createElement('div');
    rows.className = 'gh-hc-rows';

    hcRow(rows, meta.isPR ? 'Pull Request' : 'Issue', document.createTextNode('#' + meta.number));

    const status = document.createElement('span');
    status.innerHTML = meta.icon; // trusted octicon constant
    status.appendChild(document.createTextNode(' ' + meta.stateText));
    hcRow(rows, 'Status', status);

    if (meta.author) {
      const a = document.createElement('span');
      const img = document.createElement('img');
      img.className = 'gh-hc-avatar';
      img.src = meta.author.avatar;
      img.referrerPolicy = 'no-referrer';
      a.append(img, document.createTextNode(' ' + meta.author.login));
      hcRow(rows, 'Author', a);
    }
    if ((meta.assignees || []).length) {
      hcRow(rows, 'Assignee', document.createTextNode(meta.assignees.join(', ')));
    }
    if ((meta.labels || []).length) {
      const wrap = document.createElement('span');
      wrap.className = 'gh-hc-labels';
      meta.labels.forEach((l) => {
        const chip = document.createElement('span');
        chip.className = 'gh-hc-label';
        chip.style.backgroundColor = '#' + (l.color || '888888');
        chip.style.color = labelText(l.color);
        chip.textContent = l.name;
        wrap.appendChild(chip);
      });
      hcRow(rows, 'Labels', wrap);
    }
    if (meta.milestone) {
      hcRow(rows, 'Milestone', document.createTextNode(meta.milestone));
    }

    c.appendChild(rows);

    // Position below the link, flipping above / clamping to the viewport.
    c.hidden = false;
    const r = link.getBoundingClientRect();
    let top = r.bottom + 8;
    if (top + c.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, r.top - c.offsetHeight - 8);
    }
    const left = Math.min(r.left, window.innerWidth - c.offsetWidth - 12);
    c.style.top = top + 'px';
    c.style.left = Math.max(8, left) + 'px';
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

      const meta = buildMeta(data, title, owner, repo, number);
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

  // ---- two-way scroll sync ----------------------------------------------------
  // The rendered HTML carries `data-line="N"` on each block (added by
  // markdown.api.render), giving a source-line ↔ element map for free.
  // `programmaticScrollAt` suppresses the scroll event our own scrollToLine
  // causes, so the editor→preview→editor loop can't run away.
  let programmaticScrollAt = 0;

  function scrollToLine(line) {
    let target = null;
    for (const n of document.querySelectorAll('#content [data-line]')) {
      if (+n.dataset.line <= line) { target = n; } else { break; }
    }
    if (target) {
      programmaticScrollAt = Date.now();
      window.scrollTo(0, target.offsetTop - 8);
    }
  }

  function topVisibleLine() {
    let line = 0;
    for (const n of document.querySelectorAll('#content [data-line]')) {
      if (n.getBoundingClientRect().top > 0) { break; }
      line = +n.dataset.line;
    }
    return line;
  }

  let scrollQueued = false;
  window.addEventListener('scroll', () => {
    if (!vscodeApi) { return; }
    if (Date.now() - programmaticScrollAt < 250) { return; } // our own scroll
    if (scrollQueued) { return; }
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      vscodeApi.postMessage({ type: 'previewScrolled', line: topVisibleLine() });
    });
  });

  // ---- host messages ----------------------------------------------------------
  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (!msg) { return; }

    if (msg.type === 'scroll') {
      scrollToLine(msg.line | 0);
      return;
    }

    if (msg.type === 'cacheSeed') {
      // Arrives before the first 'update'; that message resolves spans against
      // this seeded cache, so no resolveAll() is needed here.
      memCache = msg.cache || {};
      return;
    }

    if (msg.type === 'token') {
      githubToken = msg.token;
      // Retry only the refs that failed (private 404s); errors are never cached,
      // so successful titles stay put.
      document.querySelectorAll('span.gh-ref[data-gh-state="error"]').forEach((s) => {
        delete s.dataset.ghState;
        s.classList.remove('gh-ref--error');
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
