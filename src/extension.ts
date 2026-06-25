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

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg?.type === 'requestSignIn') {
      await postToken(true);
      render();
    }
  });

  const onChange = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document === doc) {
      render();
    }
  });

  panel.onDidDispose(() => {
    onChange.dispose();
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
  const csp = webview.cspSource;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; img-src ${csp} https: data:; style-src ${csp} 'unsafe-inline'; script-src ${csp}; connect-src https://api.github.com;">
  <link rel="stylesheet" href="${styleUri}">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px 28px; line-height: 1.6; max-width: 860px; }
    h1, h2, h3, h4 { font-weight: 600; margin-top: 1.5em; }
    code { font-family: 'SF Mono', Consolas, monospace; font-size: 0.875em; background: rgba(128,128,128,0.15); padding: 1px 5px; border-radius: 3px; }
    pre { background: rgba(128,128,128,0.12); padding: 12px 16px; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; font-size: 0.875em; }
    blockquote { border-left: 4px solid rgba(128,128,128,0.35); margin: 0; padding-left: 16px; color: rgba(128,128,128,0.9); }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid rgba(128,128,128,0.3); padding: 6px 12px; }
    th { background: rgba(128,128,128,0.1); }
    hr { border: none; border-top: 1px solid rgba(128,128,128,0.3); margin: 24px 0; }
    img { max-width: 100%; }
    #loading { color: gray; font-family: monospace; font-size: 13px; }
  </style>
</head>
<body>
  <div id="content"><p id="loading">Rendering…</p></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}

export function deactivate() {
  /* no-op */
}

export type { RepoInfo };
