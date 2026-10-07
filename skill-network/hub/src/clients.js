// clients.js — per-client install targets for Agent-Skills tools.

export const CLIENT_NAMES = ['claude-code', 'codex', 'cursor', 'openclaw', 'claude-app', 'other'];

// user/project are POSIX-style; `~` = home, bare path = project-relative.
const SPECS = {
  'claude-code': { user: '~/.claude/skills', project: '.claude/skills' },
  codex: { user: '~/.agents/skills', project: '.agents/skills' },
  cursor: {
    user: '~/.cursor/skills', project: '.cursor/skills',
    note: 'Cursor 也会读取 ~/.agents/skills 和 ~/.claude/skills。',
  },
  openclaw: { user: '~/.openclaw/skills', project: '<workspace>/skills' },
  'claude-app': {
    user: null, project: null,
    note: '此客户端不支持直接写文件：下载 zip 后，在 Claude 设置的 Skills 里上传（网页/桌面端）。',
  },
  other: {
    user: '~/.agents/skills', project: '.agents/skills',
    note: '多数 Agent-Skills 工具都会读取 .agents/skills。',
  },
};

export function resolveClient(name) {
  const key = String(name || '').toLowerCase();
  return CLIENT_NAMES.includes(key) ? key : 'other';
}

function toWindows(p) {
  if (!p) return null;
  return p.replace(/^~/, '%USERPROFILE%').replace(/\//g, '\\');
}

// Build the concrete install target for a client + slug.
export function installTarget(name, slug) {
  const key = resolveClient(name);
  const spec = SPECS[key];
  const user = spec.user ? `${spec.user}/${slug}` : null;
  const project = spec.project ? `${spec.project}/${slug}` : null;
  return {
    client: key,
    user,
    project,
    windowsUser: toWindows(user),
    windowsProject: toWindows(project),
    note: spec.note || null,
  };
}

// Compact install targets for every client — used on the skill page / detail API.
export function allTargets(slug) {
  return CLIENT_NAMES.map((name) => installTarget(name, slug));
}
