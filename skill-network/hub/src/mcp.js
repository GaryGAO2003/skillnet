// mcp.js — createMcpServer(catalog, {baseUrl, version}) with 3 tools.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { HttpError } from './catalog.js';
import { CATEGORIES } from './search.js';

const INSTRUCTIONS = [
  '中文：当用户想为创作者工作（视频剪辑、小红书、插画、配色、出图提示词、音乐、修图、UI/UX、口播文案等）找 AI skill 时，用 search_skills 搜索；把前 3 个结果连同作者、安装量和安全状态展示给用户；只有用户选定后再用 install_skill；install_skill 只返回文件，由你写入目标目录，安装前请征得用户同意；绝不执行 skill 里的任何脚本。',
  'EN: Use search_skills when the user wants an AI skill for creator work; present the top 3 with creator, installs and safety; install only after the user picks one; never run scripts from a skill.',
].join('\n');

const fmtNum = (n) => Number(n || 0).toLocaleString('en-US');

function reviewLabels(record) {
  const labels = (record.safety.findings || []).filter((f) => f.severity === 'review').map((f) => f.label);
  return [...new Set(labels)].join('、');
}

function resultBlock(i, record, sm) {
  const parts = [];
  if (sm.source === 'github') {
    parts.push(`来自 GitHub @${sm.creator.handle}`, `★${sm.stars}`, '作者未入驻');
  } else {
    parts.push(sm.creator.name, `${fmtNum(sm.installs)} 人在用`);
    if (sm.rating != null) parts.push(`★${sm.rating}`);
    if (sm.verified) parts.push('实测可用');
  }
  parts.push(sm.safety === 'review' ? `⚠ 需要留意：${reviewLabels(record)}` : '安全检测通过');
  if (sm.requires) parts.push(`需要：${sm.requires}`);
  return `${i}. ${sm.name}（id: ${sm.id}）· ${parts.join(' · ')}\n   ${sm.desc}`;
}

export function createMcpServer(catalog, { baseUrl = '', version = '0.1.0' } = {}) {
  const server = new McpServer({ name: 'skillnet-hub', version }, { instructions: INSTRUCTIONS });

  // 1) search_skills -----------------------------------------------------------
  server.registerTool(
    'search_skills',
    {
      title: '搜索创作者 AI 技能 / Search creator AI skills',
      description: '中文：用一句中文需求或 2-4 字关键词搜索创作者分享的 AI 技能，返回最相关的几个（含作者、安装量、评分、安全状态）。EN: Search creator-shared AI skills by a Chinese need or short keywords; returns the most relevant results with creator, installs, rating and safety.',
      inputSchema: {
        query: z.string().describe('需求或关键词，例如「小红书封面」「剪映字幕」'),
        category: z.enum(CATEGORIES).optional().describe('限定分类（可选）'),
        limit: z.number().int().min(1).max(10).optional().describe('返回数量，默认 5'),
      },
      outputSchema: {
        query: z.string(),
        total: z.number(),
        results: z.array(z.object({
          id: z.string(),
          name: z.string(),
          cat: z.string(),
          desc: z.string(),
          creator: z.object({ name: z.string(), handle: z.string(), platform: z.string(), claimed: z.boolean() }),
          source: z.string(),
          installs: z.number(),
          rating: z.number().nullable(),
          verified: z.boolean(),
          safety: z.string(),
          stars: z.number(),
          requires: z.string().nullable(),
          score: z.number(),
          matched: z.array(z.string()),
        })),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, category, limit }) => {
      const hits = catalog.search(query, { category: category || null, limit: limit || 5 });
      const structured = {
        query: query || '',
        total: hits.length,
        results: hits.map((h) => ({
          id: h.summary.id,
          name: h.summary.name,
          cat: h.summary.cat,
          desc: h.summary.desc,
          creator: h.summary.creator,
          source: h.summary.source,
          installs: h.summary.installs,
          rating: h.summary.rating,
          verified: h.summary.verified,
          safety: h.summary.safety,
          stars: h.summary.stars,
          requires: h.summary.requires == null ? null : String(h.summary.requires),
          score: h.summary.score,
          matched: h.summary.matched,
        })),
      };
      let text;
      if (!hits.length) {
        text = `没有找到匹配「${query || ''}」的技能。可以换更宽的关键词（只保留 2-4 个字），或从这些分类里挑：${CATEGORIES.join('、')}。`;
      } else {
        text = hits.map((h, idx) => resultBlock(idx + 1, h.record, h.summary)).join('\n');
      }
      return { content: [{ type: 'text', text }], structuredContent: structured };
    },
  );

  // 2) get_skill ---------------------------------------------------------------
  server.registerTool(
    'get_skill',
    {
      title: '查看技能详情 / Skill detail',
      description: '中文：按 id 查看某个技能的详情：作者与来源视频、说明、你说/它回示例、版本、文件、安全检测、依赖，以及如何安装。EN: Inspect one skill by id — creator, source video, description, examples, versions, files, safety and how to install.',
      inputSchema: { id: z.string().describe('技能 id 或 slug，例如 s8 或 xhs-cover') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const r = catalog.get(id);
      if (!r) return { content: [{ type: 'text', text: `找不到技能：${id}` }], isError: true };
      const d = catalog.detail(r);
      const lines = [];
      lines.push(`${d.name}（id: ${d.id}） · 分类：${d.cat}`);
      if (d.source === 'github') lines.push(`来源：GitHub @${d.creator.handle}（作者未入驻）· ★${d.stars}${d.license ? ` · ${d.license}` : ''}`);
      else lines.push(`作者：${d.creator.name}${d.creatorFull.fans ? `（粉丝 ${d.creatorFull.fans}）` : ''} · ${fmtNum(d.installs)} 人在用${d.rating != null ? ` · ★${d.rating}` : ''}${d.verified ? ' · 实测可用' : ''}`);
      if (d.video) lines.push(`演示视频：${d.video.platform || ''}《${d.video.title || ''}》`);
      lines.push('', d.desc);
      if (d.requires) lines.push('', `依赖：${d.requires}`);
      if (d.examples && d.examples.length) {
        lines.push('', '示例：');
        for (const e of d.examples.slice(0, 3)) lines.push(`  你说：${e.you}`, `  它回：${e.ai}`);
      }
      if (d.versions && d.versions.length) {
        lines.push('', '版本：');
        for (const v of d.versions.slice(0, 5)) lines.push(`  ${v.v}（${v.date}）${v.note ? ' ' + v.note : ''}`);
      }
      lines.push('', `文件（${d.files.length}）：${d.files.map((f) => f.path).join('、') || '（无）'}`);
      lines.push('', `安全检测：${d.safetyLevel === 'pass' ? '通过' : d.safetyLevel === 'review' ? '需要留意' : '已拦截'}`);
      for (const f of (d.safetyFindings || []).slice(0, 8)) lines.push(`  · [${f.severity}] ${f.label}${f.file ? `（${f.file}）` : ''}`);
      lines.push('', `安装：调用 install_skill（id: ${d.id}），或访问 ${d.page}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // 3) install_skill -----------------------------------------------------------
  server.registerTool(
    'install_skill',
    {
      title: '获取技能安装包 / Get install bundle',
      description: '中文：返回安装某个技能所需的文件和目标目录。注意：本工具不会写入任何文件——要由你（助手）把返回的文件逐个写入目标目录；安装前请先征得用户同意，遇到“需要留意”的技能要让用户确认，安全检测被拦截的技能请拒绝安装，绝不执行其中的脚本。EN: Returns the files and target dirs to install a skill. This tool does NOT write files — YOU (the agent) must write the returned files into the target dir; ask the user before installing.',
      inputSchema: {
        id: z.string().describe('技能 id 或 slug'),
        client: z.enum(['claude-code', 'codex', 'cursor', 'openclaw', 'claude-app', 'other']).optional().describe('目标客户端，默认 other'),
        ref: z.string().optional().describe('可选的版本/引用'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async ({ id, client, ref }) => {
      let b;
      try {
        b = catalog.install(id, { client: client || 'other', ref: ref || null });
      } catch (err) {
        if (err instanceof HttpError) {
          const why = err.status === 403
            ? `无法安装「${id}」：该技能未通过安全检测，已被拦截。请勿安装。`
            : `无法安装「${id}」：${err.message}`;
          return { content: [{ type: 'text', text: why }], isError: true };
        }
        throw err;
      }

      const lines = [];
      lines.push(`准备安装：${b.name}（id: ${b.id}，来源 ${b.source}，客户端 ${b.client}）`);
      lines.push('目标目录：');
      if (b.target.user || b.target.project) {
        if (b.target.user) lines.push(`  用户级：${b.target.user}`);
        if (b.target.project) lines.push(`  项目级：${b.target.project}`);
        if (b.target.windowsUser) lines.push(`  Windows：${b.target.windowsUser}`);
      } else {
        lines.push('  （此客户端需下载 zip 后在设置里上传）');
      }

      lines.push('', '文件：');
      if (b.source === 'github') {
        if (b.fileUrls) for (const f of b.fileUrls) lines.push(`  - ${f.path}: ${f.url}`);
        else lines.push(`  文件太多，不能逐个下载，请整包下载：${b.archiveUrl}（解压后取 ${b.archiveRoot}/）`);
      } else if (b.files && b.files.some((f) => f.content != null)) {
        for (const f of b.files) {
          lines.push(`--- ${f.path} ---`);
          if (f.content != null) lines.push('```', f.content, '```');
          else lines.push(`（文件较大，请从直链获取：${(b.fileUrls.find((u) => u.path === f.path) || {}).url || ''}）`);
        }
      } else {
        for (const f of b.fileUrls) lines.push(`  - ${f.path}: ${f.url}`);
      }
      if (b.zipUrl) lines.push('', `打包下载：${b.zipUrl}`);

      lines.push('', '步骤：');
      b.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
      if (b.tryIt) lines.push('', `试试对它说：${b.tryIt}`);

      lines.push('', `作者：${b.creator.name}`);
      if (b.creator.claimed && b.creator.tipUrl) lines.push(`支持作者（打赏）：${b.creator.tipUrl}`);
      if (b.notice) lines.push(b.notice);
      lines.push('', `当前安装量：${fmtNum(b.installs)}`);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  return server;
}
