// @ts-check
// Pure reference-rendering helpers, extracted so they can be unit-tested in node
// while still loading as a plain <script> global in the webview (see refLogic.test.js).
(function () {
  'use strict';

  // Match full GitHub issue/PR URLs, e.g.
  //   https://github.com/owner/repo/issues/587
  //   https://github.com/owner/repo/pull/604
  const URL_RE =
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)(?:[#?].*)?$/;

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

  const api = { URL_RE, labelText, relTime };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api; // node (tests)
  } else {
    (typeof self !== 'undefined' ? self : this).GHRefLogic = api; // webview
  }
})();
