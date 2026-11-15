// AI V2 — 根据首轮对话自动生成会话标题
import type { UiAttachment } from './attachments';

interface TitleMessage {
  role: string;
  content: string;
  attachments?: UiAttachment[];
}

export function deriveSessionTitle(messages: TitleMessage[]): string {
  const firstUser = messages.find(message => message.role === 'user');
  if (!firstUser) return '新对话';
  let text = firstUser.content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^请查看附件：/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (firstUser.attachments?.length && /^请查看附件/.test(firstUser.content)) {
    const name = firstUser.attachments[0].path || firstUser.attachments[0].name;
    if (name) text = `附件 ${name}`;
  }

  const lower = text.toLowerCase();
  if (lower.includes('readme')) return '仓库 README';
  if (/(actions|工作流|构建失败|部署失败|ci\b|job|日志)/i.test(text)) return 'CI 问题排查';
  if (/(pull request|\bpr\b|合并请求)/i.test(text)) return 'PR 处理';
  if (/(目录|项目结构|入口文件|技术栈|架构)/.test(text)) return '项目结构';
  if (/(修复|bug|报错|异常|崩溃)/i.test(text)) return '问题修复';
  if (/(解释|阅读|分析|审查).*(代码|文件|实现)/.test(text)) return '代码分析';
  if (/(写|实现|创建|新增).*(函数|组件|页面|工具|接口)/.test(text)) return '代码实现';
  if (/(计划|步骤|拆解)/.test(text)) return '任务规划';

  const cleaned = text
    .replace(/^(请帮我|帮我|请|麻烦|能否|可以|我想让你|你可以)\s*/u, '')
    .replace(/[。！？!?；;]+$/u, '')
    .trim();
  if (!cleaned) return '新对话';
  return cleaned.length > 26 ? `${cleaned.slice(0, 26)}…` : cleaned;
}