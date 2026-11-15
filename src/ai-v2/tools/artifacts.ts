// AI V2 — Artifact 读取工具（核心能力，始终可用）
import type { AgentTool } from '../types';
import { listArtifacts, readArtifact } from '../artifacts';

export const ARTIFACT_TOOLS: AgentTool[] = [{
  name: 'artifact_read',
  description: '读取大型工具结果 Artifact。省略 id 时列出最近 Artifact；提供 id 时按 offset/limit 分页读取。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Artifact ID；省略时列出最近 Artifact' },
      offset: { type: 'number', description: '起始字符位置，默认 0' },
      limit: { type: 'number', description: '最多读取字符数，默认 12000，最大 20000' },
    },
  },
  risk: 'read',
  async execute(args, ctx) {
    const id = String(args.id || '').trim();
    if (!id) {
      const items = listArtifacts(ctx.userLogin, 20);
      if (!items.length) return { ok: true, content: '当前没有 Artifact。' };
      return {
        ok: true,
        content: items.map(item => [
          `- ${item.id}`,
          `  ${item.title}`,
          `  ${item.size} 字符 · ${item.createdAt}`,
          `  ${item.preview.slice(0, 120).replace(/\n/g, ' ')}`,
        ].join('\n')).join('\n'),
      };
    }

    const offset = Number(args.offset || 0);
    const limit = Number(args.limit || 12000);
    const result = await readArtifact(ctx.userLogin, id, Number.isFinite(offset) ? offset : 0, Number.isFinite(limit) ? limit : 12000);
    if (!result.meta) return { ok: false, content: `Artifact 不存在：${id}` };
    const start = result.nextOffset - result.content.length;
    return {
      ok: true,
      content: [
        `Artifact：${result.meta.title}`,
        `ID：${result.meta.id}`,
        `总长度：${result.total} 字符`,
        `当前范围：${start} - ${result.nextOffset}`,
        result.hasMore ? `还有更多内容，继续读取 offset=${result.nextOffset}` : '已读取到结尾',
        '',
        result.content,
      ].join('\n'),
    };
  },
}];