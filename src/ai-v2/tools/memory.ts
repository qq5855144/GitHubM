// AI V2 — 长期记忆工具
import type { AgentTool } from '../types';
import { listMemories, saveMemory, searchMemories } from '../memory';

export const MEMORY_TOOLS: AgentTool[] = [
  {
    name: 'memory_save',
    description: '保存一条长期记忆，例如用户偏好、项目约定、已确认的解决方案。只在信息值得跨会话保留时使用。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '要记住的内容，简明扼要' },
        tags: { type: 'array', items: { type: 'string' }, description: '可选标签' },
      },
      required: ['content'],
    },
    risk: 'write',
    async execute(args, ctx) {
      const record = saveMemory(
        ctx.userLogin,
        String(args.content || ''),
        Array.isArray(args.tags) ? args.tags.map(String) : [],
      );
      if (!record) return { ok: false, content: '记忆内容为空，未保存。' };
      return { ok: true, content: `已保存记忆：${record.id}\n${record.content}` };
    },
  },
  {
    name: 'memory_search',
    description: '搜索本机长期记忆。query 省略时列出最近记忆。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
    },
    risk: 'read',
    async execute(args, ctx) {
      const query = String(args.query || '').trim();
      const records = query ? searchMemories(ctx.userLogin, query, 8) : listMemories(ctx.userLogin, 10);
      if (!records.length) return { ok: true, content: '没有找到相关长期记忆。' };
      return {
        ok: true,
        content: records.map(record => [
          `- ${record.id}`,
          `  ${record.content}`,
          record.tags.length ? `  标签：${record.tags.join(', ')}` : '',
        ].filter(Boolean).join('\n')).join('\n'),
      };
    },
  },
];