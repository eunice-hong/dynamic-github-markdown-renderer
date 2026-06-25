import * as vscode from 'vscode';
import * as path from 'path';
import { getRepoInfo, RepoInfo } from './gitConfig';
import { ghRefPlugin } from './markdownItPlugin';

// Workspace repo, read by the markdown-it inline rule to stamp owner/repo onto
// each `#123` span. Refreshed when the workspace folders change.
let currentRepo: RepoInfo | undefined;

function refreshRepo(): void {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  currentRepo = getRepoInfo(root);
}

// One preview panel per source document, keyed by document URI.
const panels = new Map<string, vscode.WebviewPanel>();

export function activate(context: vscode.ExtensionContext) {
  refreshRepo();
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(refreshRepo)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gh-ref.openPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Open a markdown file first.');
        return;
      }
      openPreview(context, editor.document);
    })
  );

  // Optionally open the preview automatically when a markdown file is opened.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId === 'markdown' && autoOpenEnabled()) {
        openPreview(context, doc);
      }
    })
  );

  return {
    extendMarkdownIt(md: any) {
      md.use((instance: any) => ghRefPlugin(instance, () => currentRepo));
      return md;
    },
  };
}

function autoOpenEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('githubIssueTitleRenderer')
    .get<boolean>('autoOpenPreview', false);
}

function openPreview(context: vscode.ExtensionContext, doc: vscode.TextDocument): void {
  const key = doc.uri.toString();

  // Reuse an existing panel for this document instead of stacking duplicates.
  const existing = panels.get(key);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'gh-ref-preview',
    'Preview: ' + path.basename(doc.fileName),
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    }
  );
  panels.set(key, panel);

  panel.webview.html = buildHtml(context, panel.webview);

  async function postToken(createIfNone: boolean) {
    try {
      const session = await vscode.authentication.getSession('github', ['repo'], {
        createIfNone,
        silent: !createIfNone,
      });
      if (session) {
        panel.webview.postMessage({ type: 'token', token: session.accessToken });
      }
    } catch {
      /* no session available; public repos still work */
    }
  }

  async function render() {
    try {
      const html = await vscode.commands.executeCommand<string>(
        'markdown.api.render',
        doc
      );
      if (typeof html === 'string') {
        panel.webview.postMessage({ type: 'update', html });
      }
    } catch (e) {
      console.error('[gh-ref] render error:', e);
    }
  }

  // Token first so the very first fetch can already see private repos.
  void postToken(false).then(render);

  // ---- two-way scroll sync ----------------------------------------------------
  // Each side ignores the scroll event caused by the *other* side's programmatic
  // move, using a short timestamp window — that breaks the feedback loop.
  let editorRevealedAt = 0;

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg?.type === 'requestSignIn') {
      await postToken(true);
      render();
      return;
    }
    if (msg?.type === 'previewScrolled') {
      const ed = vscode.window.visibleTextEditors.find((e) => e.document === doc);
      if (ed) {
        editorRevealedAt = Date.now();
        const line = Math.min(Math.max(0, msg.line | 0), doc.lineCount - 1);
        ed.revealRange(
          new vscode.Range(line, 0, line, 0),
          vscode.TextEditorRevealType.AtTop
        );
      }
    }
  });

  const onVisible = vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
    if (e.textEditor.document !== doc) { return; }
    if (Date.now() - editorRevealedAt < 250) { return; } // our own reveal
    const line = e.visibleRanges[0]?.start.line ?? 0;
    panel.webview.postMessage({ type: 'scroll', line });
  });

  const onChange = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document === doc) {
      render();
    }
  });

  panel.onDidDispose(() => {
    onChange.dispose();
    onVisible.dispose();
    panels.delete(key);
  });
}

function buildHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'media', 'preview.js')
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'media', 'preview.css')
  );
  const githubCssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'media', 'github-markdown.css')
  );
  const csp = webview.cspSource;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src ${csp} https: data:; style-src ${csp} 'unsafe-inline'; script-src ${csp}; connect-src https://api.github.com;">
  <link rel="stylesheet" href="${githubCssUri}">
  <link rel="stylesheet" href="${styleUri}">
  <style>
    /* github-markdown-css scopes everything under .markdown-body; this wrapper
       just centers it and adds page padding (per the library's README). */
    .markdown-body { box-sizing: border-box; max-width: 980px; margin: 0 auto; padding: 24px 32px; }
    #loading { color: gray; font-family: monospace; font-size: 13px; }
  </style>
</head>
<body>
  <article class="markdown-body" id="content"><p id="loading">Rendering…</p></article>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

export function deactivate() {
  /* no-op */
}

export type { RepoInfo };
