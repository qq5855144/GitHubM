import { describe, it, expect } from 'vitest';
import { sanitizeQuoteBody, buildCommentQuote } from '@/lib/quote';

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

  it('超长正文截断到 maxLength 以内并加省略号', () => {
    const quote = buildCommentQuote(
      { id: 1, body: 'x'.repeat(2000), user: { login: 'u' } },
      issueUrl,
      100,
    );
    const bodyLines = quote.split('\n').filter((l) => l.startsWith('> ') && !l.includes('——来自'));
    const body = bodyLines.join('\n');
    expect(body).toContain('…');
    expect(body.length).toBeLessThanOrEqual(110);
  });

  it('正文为空时仍然给出出处行', () => {
    const quote = buildCommentQuote({ id: 2, body: '', user: { login: 'u' } }, issueUrl);
    expect(quote).toContain('> ——来自 [@u]');
  });
});