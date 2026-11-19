// 评论引用工具
//
// GitHub 上粘贴的截图会被存成 HTML：`<img width="1080" height="2400" alt="..." src="..." />`
// 直接整段正文加 `> ` 引用，会把这一坨 HTML 原样倒进输入框，看起来像乱码。
// 这里先把 HTML 收敛成 Markdown，再压掉多余空行，最后按长度截断。

const HTML_IMG = /<img\b[^>]*>/gi;
const HTML_BR = /<br\s*\/?>/gi;
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g;

/** 取标签里的某个属性值（宽松匹配双引号/单引号） */
function pickAttr(tag: string, name: string): string {
  const re = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i');
  const m = tag.match(re);
  if (!m) return '';
  return (m[2] ?? m[3] ?? '').trim();
}

/** 把 HTML 片段收敛成可读的 Markdown：图片转 ![alt](src)，其余标签去掉 */
export function sanitizeQuoteBody(body: string): string {
  let text = body || '';

  text = text.replace(HTML_IMG, (tag) => {
    const src = pickAttr(tag, 'src');
    if (!src) return '';
    const alt = pickAttr(tag, 'alt') || '图片';
    return `![${alt}](${src})`;
  });

  text = text.replace(HTML_BR, '\n');
  text = text.replace(HTML_TAG, '');

  // 行尾空白 + 连续空行收敛
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}

export interface QuoteSource {
  id: number | string;
  body?: string | null;
  user: { login: string };
}

/**
 * 生成引用块：
 *
 * > 原文第一行
 * >
 * > ——来自 [@login](链接)
 */
export function buildCommentQuote(
  comment: QuoteSource,
  issueUrl: string,
  maxLength = 600,
): string {
  let body = sanitizeQuoteBody(comment.body || '');

  // 超长正文按长度截断，尽量不切断最后一个词
  if (body.length > maxLength) {
    const cut = body.slice(0, maxLength);
    const atSpace = cut.lastIndexOf(' ');
    body = (atSpace > maxLength * 0.6 ? cut.slice(0, atSpace) : cut).replace(/\s+$/, '') + '…';
  }

  const quoted = body
    .split('\n')
    .map((line) => (line ? '> ' + line : '>'))
    .join('\n');
  const url = `${issueUrl}#issuecomment-${comment.id}`;

  return quoted + '\n>\n> ——来自 [@' + comment.user.login + '](' + url + ')\n\n';
}
