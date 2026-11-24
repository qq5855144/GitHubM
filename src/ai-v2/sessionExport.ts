import i18n from '@/i18n';
import type { V2SessionMeta } from './sessionStore';
import type { UiChatMessage } from './types';

function isoDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function inlineMarkdown(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().replace(/[\\\x60*_{}\[\]()#+!|<>]/gu, '\\$&');
}

export function createSessionMarkdown(
  session: V2SessionMeta,
  messages: readonly UiChatMessage[],
): { blob: Blob; filename: string } | null {
  const transcript = messages.flatMap(message => {
    const attachments = message.attachments?.map(attachment => `- ${inlineMarkdown(attachment.path || attachment.name)}`) ?? [];
    const error = message.errorDetail?.trim();
    if (!message.content.trim() && !attachments.length && !error) return [];

    const author = i18n.t(message.role === 'user' ? '用户' : '助手');
    const timestamp = isoDate(message.createdAt);
    const section = [`## ${author}${timestamp ? ` · ${timestamp}` : ''}`];
    if (message.content.trim()) section.push(message.content);
    if (attachments.length) section.push(`**${i18n.t('附件')}**\n\n${attachments.join('\n')}`);
    if (error) section.push(error.split('\n').map(line => `> ${line}`).join('\n'));
    return [section.join('\n\n')];
  });
  if (!transcript.length) return null;

  const title = session.title.trim() || i18n.t('新对话');
  const created = isoDate(session.createdAt);
  const updated = isoDate(session.updatedAt);
  const header = [`# ${inlineMarkdown(title)}`];
  if (session.repo) {
    header.push(`- ${i18n.t('仓库')}：${inlineMarkdown(session.repo.fullName)}`);
    header.push(`- ${i18n.t('分支')}：${inlineMarkdown(session.repo.branch || session.repo.defaultBranch)}`);
  }
  if (created) header.push(`- ${i18n.t('创建时间')}：${created}`);
  if (updated) header.push(`- ${i18n.t('更新时间')}：${updated}`);

  const basename = [...title.replace(/[<>:"/\\|?*]/gu, '-').replace(/\p{Cc}/gu, '').replace(/^\.+|[.\s]+$/gu, '')]
    .slice(0, 48).join('').trim() || 'conversation';
  const date = (updated || created || new Date().toISOString()).slice(0, 10);
  const filename = `${basename}-${date}.md`;
  const markdown = `${header[0]}\n\n${header.slice(1).join('\n')}\n\n${transcript.join('\n\n')}\n`;
  return { blob: new Blob([markdown], { type: 'text/markdown' }), filename };
}
