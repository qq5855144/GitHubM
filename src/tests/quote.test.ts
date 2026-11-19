import { describe, expect, it } from 'vitest';
import { buildCommentQuote, buildIssueQuote, sanitizeQuoteBody } from '@/lib/quote';

describe('sanitizeQuoteBody', () => {
  it('把粘贴截图留下的 <img> HTML 转成 Markdown 图片', () => {
    const raw =
      '<img width="1080" height="2400" alt="Screenshot_2026-11-19" ' +
      'src="https://github.com/user-attachments/assets/03c4cfe0" />\n正文';
    const out = sanitizeQuoteBody(raw);
    expect(out).not.toContain('<img');
    expect(out).not.toContain('width=');
    expect(out).toContain('![Screenshot_2026-11-19](https://github.com/user-attachments/assets/03c4cfe0)');
    expect(out).toContain('正文');
  });

  it('没有 alt 时用「图片」占位', () => {
    const out = sanitizeQuoteBody('<img src="https://x.test/a.png">');
    expect(out).toBe('![图片](https://x.test/a.png)');
  });

  it('<br> 变成换行，其它标签被去掉', () => {
    const out = sanitizeQuoteBody('第一行<br>第二行<p>段落</p>');
    expect(out).toBe('第一行\n第二行段落');
  });

  it('压掉连续空行和行尾空白', () => {
    const out = sanitizeQuoteBody('a   \n\n\n\nb');
    expect(out).toBe('a\n\nb');
  });

  it('保留 Markdown 引用里的 > 前缀', () => {
    const out = sanitizeQuoteBody('> 搜索功能页？\n> > 我的收藏');
    expect(out).toBe('> 搜索功能页？\n> > 我的收藏');
  });
});

describe('buildCommentQuote', () => {
  const issueUrl = 'https://github.com/qq5855144/GitHubM/issues/32';

  it('带截图 HTML 的评论不再整段倒 HTML', () => {
    const quote = buildCommentQuote(
      {
        id: 7001894466,
        body:
          '<img width="1080" height="2400" alt="Screenshot" src="https://github.com/user-attachments/assets/03c4cfe0" />\n\n我的收藏，没有挂梯子。',
        user: { login: 'mymine' },
      },
      issueUrl,
    );
    expect(quote).not.toContain('<img');
    expect(quote).toContain('> ![Screenshot](https://github.com/user-attachments/assets/03c4cfe0)');
    expect(quote).toContain('> 我的收藏，没有挂梯子。');
    expect(quote).toContain('> ——来自 [@mymine](https://github.com/qq5855144/GitHubM/issues/32#issuecomment-7001894466)');
  });

  it('正文为空时仍然给出出处行', () => {
    const quote = buildCommentQuote({ id: 2, body: '', user: { login: 'u' } }, issueUrl);
    expect(quote).toContain('> ——来自 [@u]');
  });

  it('短正文直接整段引用，不套 details', () => {
    const quote = buildCommentQuote(
      { id: 3, body: '短内容\n第二行', user: { login: 'u' } },
      issueUrl,
    );
    expect(quote).not.toContain('<details>');
    expect(quote).toContain('> 短内容');
    expect(quote).toContain('> 第二行');
  });

  it('长正文只露预览行，全文折进 details 且每行仍在引用块内', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `第 ${i + 1} 行内容`);
    const quote = buildCommentQuote({ id: 4, body: lines.join('\n'), user: { login: 'u' } }, issueUrl);

    expect(quote).toContain('<details><summary>展开被引用的完整内容</summary>');
    expect(quote).toContain('> 第 1 行内容');
    // 预览限制为 3 行，第 4 行起应在折叠区里
    const beforeDetails = quote.slice(0, quote.indexOf('<details>'));
    expect(beforeDetails).not.toContain('第 4 行内容');
    expect(quote).toContain('> 第 20 行内容');

    // details 区块内的所有非空行都必须带 `>`，否则引用块会被提前截断，
    // 折叠内容跑到引用之外。注意要从 `<details>` 那一行的行首开始切，
    // 直接从 `<summary>` 下标切会把同一行的开头部分（含 `>`）切掉。
    const detailsStart = quote.lastIndexOf('\n', quote.indexOf('<details>'));
    const folded = quote.slice(detailsStart + 1);
    for (const line of folded.split('\n')) {
      if (!line.trim()) continue;
      expect(line.startsWith('>')).toBe(true);
    }
  });

  it('超长正文不会丢失尾部内容（旧实现会硬截断）', () => {
    const body = 'x'.repeat(2000) + '\n结尾标记';
    const quote = buildCommentQuote({ id: 5, body, user: { login: 'u' } }, issueUrl);
    expect(quote).toContain('结尾标记');
  });

  it('单行超长时预览也受字符上限约束', () => {
    const quote = buildCommentQuote(
      { id: 6, body: 'y'.repeat(1000) + '\n第二行', user: { login: 'u' } },
      issueUrl,
      { previewLines: 3, previewChars: 100 },
    );
    const preview = quote.slice(0, quote.indexOf('——来自'));
    expect(preview.length).toBeLessThanOrEqual(110);
    expect(quote).toContain('第二行');
  });

  it('支持自定义 summary 文案与锚点', () => {
    const quote = buildCommentQuote(
      { id: 7, body: Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n'), user: { login: 'u' } },
      issueUrl,
      { summaryText: '展开', anchor: 'issuecomment-custom' },
    );
    expect(quote).toContain('<summary>展开</summary>');
    expect(quote).toContain('#issuecomment-custom');
  });
});

describe('buildIssueQuote', () => {
  const issueUrl = 'https://github.com/qq5855144/GitHubM/issues/32';

  it('引用 issue 正文时锚点指向 issue 本身而不是伪造 comment id', () => {
    const quote = buildIssueQuote(
      { title: '一些功能建议', body: '功能描述\n1. 触发工作流', user: { login: 'mymine' } },
      issueUrl,
    );
    expect(quote).toContain('> 功能描述');
    expect(quote).toContain('> ——来自 [@mymine](https://github.com/qq5855144/GitHubM/issues/32)');
    expect(quote).not.toContain('issuecomment-issue-body');
  });

  it('正文为空时退回用标题占位', () => {
    const quote = buildIssueQuote({ title: '只有标题', body: '', user: { login: 'u' } }, issueUrl);
    expect(quote).toContain('**只有标题**');
  });
});
