import * as fs from 'fs';
import * as path from 'path';

export interface RepoInfo {
  owner: string;
  repo: string;
}

interface CacheEntry {
  mtimeMs: number;
  info: RepoInfo | undefined;
}

const cache = new Map<string, CacheEntry>();

/**
 * Reads `<root>/.git/config` and extracts `{ owner, repo }` from the first GitHub
 * remote it finds (preferring `origin`). Result is cached and invalidated by the
 * config file's mtime so an opened preview reflects remote changes without a reload.
 *
 * Supported remote URL shapes:
 *   - git@github.com:owner/repo.git
 *   - https://github.com/owner/repo.git
 *   - https://github.com/owner/repo
 *   - ssh://git@github.com/owner/repo.git
 */
export function getRepoInfo(root: string | undefined): RepoInfo | undefined {
  if (!root) {
    return undefined;
  }

  const configPath = path.join(root, '.git', 'config');

  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(configPath).mtimeMs;
  } catch {
    cache.delete(configPath);
    return undefined;
  }

  const cached = cache.get(configPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.info;
  }

  let info: RepoInfo | undefined;
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    info = parseRepoFromGitConfig(raw);
  } catch {
    info = undefined;
  }

  cache.set(configPath, { mtimeMs, info });
  return info;
}

/**
 * Parses the remote URLs out of a git config file body. Exported for unit testing.
 * Prefers the `origin` remote; falls back to any GitHub remote.
 */
export function parseRepoFromGitConfig(config: string): RepoInfo | undefined {
  const remotes = new Map<string, string>();

  // Section header like: [remote "origin"]
  const sectionRe = /^\[remote\s+"([^"]+)"\]\s*$/;
  // url = ... line
  const urlRe = /^\s*url\s*=\s*(.+?)\s*$/;

  let currentRemote: string | undefined;
  for (const line of config.split(/\r?\n/)) {
    const section = sectionRe.exec(line);
    if (section) {
      currentRemote = section[1];
      continue;
    }
    if (line.startsWith('[')) {
      currentRemote = undefined; // entered a non-remote section
      continue;
    }
    if (currentRemote) {
      const url = urlRe.exec(line);
      if (url) {
        remotes.set(currentRemote, url[1]);
      }
    }
  }

  const ordered = [
    ...(remotes.has('origin') ? [remotes.get('origin')!] : []),
    ...[...remotes.entries()].filter(([k]) => k !== 'origin').map(([, v]) => v),
  ];

  for (const url of ordered) {
    const parsed = parseGitHubUrl(url);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
}

export function parseGitHubUrl(url: string): RepoInfo | undefined {
  // Strip a trailing .git and any trailing slash.
  const cleaned = url.trim().replace(/\.git$/, '').replace(/\/$/, '');

  // scp-like: git@github.com:owner/repo
  const scp = /^git@github\.com:([^/]+)\/(.+)$/.exec(cleaned);
  if (scp) {
    return { owner: scp[1], repo: scp[2] };
  }

  // https / ssh: //github.com/owner/repo
  const proto = /^(?:https?|ssh):\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/(.+)$/.exec(cleaned);
  if (proto) {
    return { owner: proto[1], repo: proto[2] };
  }

  return undefined;
}
