// 评论引用工具
//
// GitHub 上粘贴的截图会被存成 HTML：`<img width="1080" height="2400" alt="..." src="..." />`
// 直接整段正文加 `> ` 引用，会把这一坨 HTML 原样倒进输入框，看起来像乱码。
// 这里先把 HTML 收敛成 Markdown，再压掉多余空行。
//
// 长度策略：GitHub 官方会把长引用折进 <details>，只露出前几行。
// 早先的实现按字符数硬截断，截断点可能落在图片/表格中间，读者看不出在回复什么。
// 现在改为「露出预览行 + details 包全文」，信息不丢也不再撑爆输入框。

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

/** 给多行文本逐行加 `> ` 前缀；空行输出孤立的 `>` 保持引用块连续 */
function prefixQuoteLines(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? '> ' + line : '>'))
    .join('\n');
}

/**
 * 把正文拆成「预览 + 其余」。
 *
 * 按行数而非字符数切分：引用块里长行通常是图片或表格，字符截断会把它们劈开。
 * 预览保留前 previewLines 行，且总长不超过 previewChars，双限避免单行超长撑爆。
 */
function splitPreview(
  body: string,
  previewLines: number,
  previewChars: number,
): { head: string; rest: string } {
  const lines = body.split('\n');

  // 快阀：行数和字符都在预算内，整段进预览，不折叠
  if (lines.length <= previewLines && body.length <= previewChars) {
    return { head: body, rest: '' };
  }

  const head: string[] = [];
  let usedChars = 0; // 已占用的字符数（含行间换行）
  let consumedLines = 0; // 已经完整消化的行数
  let cutInLine = false; // 最后一行是否被从中间切开

  for (const line of lines) {
    if (head.length >= previewLines) break;
    const cost = line.length + (head.length > 0 ? 1 : 0);

    if (usedChars + cost > previewChars) {
      // 这一行放不下了。若预览还是空的，就按字符硬切一段，
      // 否则一整段无换行的长文本会原封不动地塞进引用块，预览形同失效。
      if (head.length === 0) {
        head.push(line.slice(0, Math.max(previewChars - 1, 1)) + '…');
        cutInLine = true;
      }
      break;
    }

    head.push(line);
    usedChars += cost;
    consumedLines += 1;
  }

  // rest 按行边界续上，避免用 join 后的长度去 slice 导致错位/重复。
  // 被硬切的那行需要把剩余部分接回去，所以从该行原文里取。
  const rest = cutInLine
    ? body.slice(consumedLines === 0 ? head[0].length - 1 : 0)
    : lines.slice(consumedLines).join('\n');

  return { head: head.join('\n'), rest: rest.replace(/^\n+/, '') };
}

export interface QuoteSource {
  id: number | string;
  body?: string | null;
  user: { login: string };
}

export interface QuoteOptions {
  /** 引用块露出的预览行数，默认 3 */
  previewLines?: number;
  /** 预览行的字符上限，默认 400；超出即折叠 */
  previewChars?: number;
  /**
   * 出处链接的锚点。
   * 不传：默认 issuecomment-{id}；传 null/空串：不加锚点（引用 issue 正文时用）。
   */
  anchor?: string | null;
  /** 折叠区的 summary 文案 */
  summaryText?: string;
}

/**
 * 生成引用块。
 *
 * 短内容：
 *
 * > 原文
 * >
 * > ——来自 [@login](链接#issuecomment-123)
 *
 * 长内容（超过预览限制）：
 *
 * > 前几行预览
 * >
 * > ——来自 [@login](链接#issuecomment-123)
 * >
 * > <details><summary>展开被引用的完整内容</summary>
 * >
 * > 全文……
 * >
 * > </details>
 *
 * 注意 details 内部每一行都要带 `>`，否则引用块会被 Markdown 提前截断，
 * 折叠内容跑到引用之外，视觉上像贴了一大段正文。
 */
export function buildCommentQuote(
  comment: QuoteSource,
  issueUrl: string,
  options: QuoteOptions = {},
): string {
  const { previewLines = 3, previewChars = 400, anchor, summaryText = '展开被引用的完整内容' } = options;

  const body = sanitizeQuoteBody(comment.body || '');
  const url =
    anchor === null || anchor === ''
      ? issueUrl
      : `${issueUrl}#${anchor ?? `issuecomment-${comment.id}`}`;
  const source = `> ——来自 [@${comment.user.login}](${url})`;

  if (!body) return source + '\n\n';

  const { head, rest } = splitPreview(body, previewLines, previewChars);

  let out = prefixQuoteLines(head) + '\n>\n' + source + '\n';

  if (rest) {
    const folded = prefixQuoteLines(rest);
    out += `>\n> <details><summary>${summaryText}</summary>\n>\n${folded}\n>\n> </details>\n`;
  }

  return out + '\n';
}

/**
 * 引用 Issue 正文本身（不是某条评论）。
 *
 * 锚点是 issue 页本身、没有 comment id，所以单独一个入口，
 * 免得调用方为了引用正文去伪造一个假 comment 对象。
 */
export function buildIssueQuote(
  issue: { title: string; body?: string | null; user: { login: string } },
  issueUrl: string,
  options: QuoteOptions = {},
): string {
  const merged = (issue.body || '').trim() ? issue.body || '' : `**${issue.title}**`;
  return buildCommentQuote({ id: 'issue-body', body: merged, user: issue.user }, issueUrl, {
    anchor: null,
    ...options,
  });
}