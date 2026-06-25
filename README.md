# GitHub Issue/PR Title Renderer

Render `#123` issue and PR references — and full GitHub issue/PR URLs — in a markdown
preview as their real GitHub titles, just like they appear on github.com.

> `#42` → 🟢 `Add dark mode toggle owner/repo#42`
>
> `https://github.com/owner/repo/pull/108` → 🔀 `Fix flaky preview test owner/repo#108`

Each reference resolves to its **state icon** (open / closed / merged), its **title**, and
a `repo#number` suffix, linked back to GitHub. Works in **VS Code** and **Cursor**.

## Features

- **`#123`** in the current repo → resolved title (owner/repo from `.git/config`).
- **Full GitHub URLs** (`/issues/N`, `/pull/N`) → resolved title, **including cross-repo**
  references (the URL carries its own owner/repo).
- **Octicons** distinguish open issue, closed issue, open PR, merged PR, closed PR.
- **Hovercard**: hover a reference for a github.com-style card — title, state, author
  (with avatar), assignees, color-coded labels, and milestone.
- **github.com styling**: the whole document renders with `github-markdown-css`,
  following the editor's light/dark theme.
- **Private repos** via `vscode.authentication` — reuses an existing GitHub session, or
  offers an inline “sign in” link on first private-repo miss.
- **Two-way scroll sync**: the preview and the source editor follow each other's scroll.
- **Live**: re-renders as you type. Titles are session-cached to respect the GitHub API
  rate limit.

## How it works

The built-in VS Code markdown preview runs in a sandboxed webview with no message
channel back to third-party extensions — and Cursor's preview ignores contributed
`markdown.previewScripts` / `previewStyles` entirely. So instead of hooking the built-in
preview, this extension renders into **its own `WebviewPanel`**:

| Side           | Module                    | Job                                                                                                                            |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Extension host | `src/extension.ts`        | Open a `WebviewPanel`, render the doc via the `markdown.api.render` command, push HTML + (optional) GitHub token to the webview. |
| Extension host | `src/markdownItPlugin.ts` | markdown-it inline rule (run by `markdown.api.render`) wraps each `#123` in `<span class="gh-ref" data-owner/repo/number>`.     |
| Extension host | `src/gitConfig.ts`        | Parse `.git/config` → `{ owner, repo }` (scp / https / ssh remotes; prefers `origin`).                                          |
| Webview        | `media/preview.js`        | Promote GitHub `<a>` URLs into gh-ref spans, fetch titles/state from `api.github.com`, rewrite to `{icon} title repo#number`.   |

`markdown.api.render` **does** run the contributed markdown-it plugin (that is why the
inline rule fires there even though the built-in preview path does not), so the inline
`#123` detection and the host-side rendering share one pipeline.

For public repos the webview calls `api.github.com` directly (CORS-enabled, no token).
For private repos the host threads a token from `vscode.authentication` into the webview.

## Usage

1. Open a markdown file inside a GitHub repo.
2. Run **“GitHub Ref: Open GitHub Preview”** — from the command palette, the editor
   title-bar button, or the editor right-click menu.
3. References resolve to their titles. For a private repo, click the inline
   **sign in** link to authenticate once.

Set `githubIssueTitleRenderer.autoOpenPreview` to open the preview automatically whenever
a markdown file is opened.

## Run it locally

```bash
npm install
npm run compile
```

Press **F5** (the `Run Extension` launch config) to open an Extension Development Host,
then follow the Usage steps above.

> Editing `package.json` contributions requires a **full restart** of the Extension
> Development Host — recompiling TypeScript alone is not enough.

## Test

```bash
npm test
```

## Known limitations

- Unauthenticated GitHub API is rate-limited to 60 requests/hour per IP; resolved titles
  are session-cached to stay well under it.
