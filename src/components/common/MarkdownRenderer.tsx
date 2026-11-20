// Markdown 渲染组件
//
// 关键能力：仓库上下文（repoContext）下的相对链接/相对图片解析。
//
// 背景（Issue #21）：README / Issue / PR 正文里的相对链接（如 ./docs/a.md、
// images/logo.png）在 WebView APK 内会被解析成 file:///android_asset/...，
// 点击后直接报 ERR_FILE_NOT_FOUND。这里在渲染阶段把相对地址还原成
// 「仓库内路径」，点击时走应用内代码浏览路由；图片则转换为 raw.githubusercontent。
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import type { Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

export interface RepoLinkContext {
  owner: string;
  repo: string;
  /** 分支 / tag / commit，缺省用默认分支 */
  ref?: string;
  /** 当前 Markdown 文件在仓库中的路径，例如 README.md、docs/guide.md */
  path?: string;
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
  /** 传入后启用「仓库相对路径」解析；不传则保持原有行为 */
  repoContext?: RepoLinkContext;
  /**
   * 页内锚点「能否处理」的判定（纯函数，不得有副作用）。
   *
   * 评论里的 `#issuecomment-123` 这类链接，默认会当作外链开新窗口，
   * 在 app 内等于跳出应用。返回 true 表示宿主认领该锚点。
   *
   * 注意：这个回调在 render 阶段被调用，必须保持纯粹。任何滚动/toast/请求
   * 都必须放进 onAnchorClick，否则一屏出现 N 条带锚点的引用会触发 N 次副作用。
   */
  onAnchor?: (anchor: string) => boolean;
  /** 锚点被点击时调用，跳转等副作用放这里。 */
  onAnchorClick?: (anchor: string) => void;
}

/**
 * Markdown 来自 Issue / PR / 仓库文件 / AI 工具返回，全部按不可信输入处理。
 * rehype-raw 会保留内联 HTML，必须在它之后做 sanitize，否则 iframe[srcdoc]、
 * 事件属性和 javascript: 链接可以直接接触页面上下文。
 */
const MARKDOWN_SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'details', 'summary', 'kbd', 'del', 'ins', 'sup', 'sub', 'picture', 'source',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'className', 'id'],
    code: [['className', /^language-./]],
    img: [...(defaultSchema.attributes?.img ?? []), 'loading', 'width', 'height'],
    // GFM 任务列表
    input: ['type', 'checked', 'disabled'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
};
const ABSOLUTE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** 归一化仓库内相对路径：处理 ./ ../ 与多余的斜杠 */
export function normalizeRepoPath(input: string): string {
  const out: string[] = [];
  for (const raw of input.split('/')) {
    const seg = raw.trim();
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? '' : path.slice(0, idx);
}

/**
 * 判断是否为 README 文件（含语言变体）。
 * 例：README.md、README.zh-CN.md、README_CN.md、readme-ja.md
 */
export function isReadmeFilePath(path: string | undefined): boolean {
  if (!path) return false;
  const base = path.split('/').pop() || '';
  return /^readme([._-].*)?\.(md|markdown|mdown|mkd|mdx)$/i.test(base);
}

/** 拆分 URL 的 path / query / hash，避免 hash 被当作文件名的一部分 */
function splitHref(href: string): { pathPart: string; query: string; hash: string } {
  let rest = href;
  let hash = '';
  const hashIdx = rest.indexOf('#');
  if (hashIdx >= 0) {
    hash = rest.slice(hashIdx);
    rest = rest.slice(0, hashIdx);
  }
  let query = '';
  const queryIdx = rest.indexOf('?');
  if (queryIdx >= 0) {
    query = rest.slice(queryIdx);
    rest = rest.slice(0, queryIdx);
  }
  return { pathPart: rest, query, hash };
}

function encodeRepoPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function rawFileUrl(ctx: RepoLinkContext, path: string): string {
  const ref = ctx.ref || 'HEAD';
  return `https://raw.githubusercontent.com/${ctx.owner}/${ctx.repo}/${encodeURIComponent(ref)}/${encodeRepoPath(path)}`;
}

/**
 * 解析 Markdown 中的链接：
 * - anchor：页内锚点，保持默认行为
 * - internal：仓库内文件/目录，交给 React Router
 * - external：外部链接，交给系统浏览器
 */
export function resolveMarkdownHref(
  href: string | undefined,
  ctx?: RepoLinkContext
): { kind: 'anchor'; href: string } | { kind: 'internal'; path: string; hash: string } | { kind: 'external'; href: string } | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed) return null;

  // 页内锚点
  if (trimmed.startsWith('#')) return { kind: 'anchor', href: trimmed };

  const { pathPart, query, hash } = splitHref(trimmed);

  // 完整 URL
  if (ABSOLUTE_SCHEME.test(pathPart) || pathPart.startsWith('//')) {
    const absolute = pathPart.startsWith('//') ? `https:${pathPart}` : pathPart;

    // 同仓库的 GitHub blob/tree/raw 链接 → 转成应用内代码浏览
    if (ctx) {
      try {
        const url = new URL(absolute);
        if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
          const segments = url.pathname.split('/').filter(Boolean);
          // /owner/repo/blob|tree|raw/ref/path...
          if (
            segments.length >= 5 &&
            segments[0].toLowerCase() === ctx.owner.toLowerCase() &&
            segments[1].toLowerCase() === ctx.repo.toLowerCase() &&
            ['blob', 'tree', 'raw'].includes(segments[2])
          ) {
            const targetPath = normalizeRepoPath(segments.slice(4).join('/'));
            if (segments[2] === 'raw') {
              return { kind: 'external', href: rawFileUrl(ctx, targetPath) };
            }
            return { kind: 'internal', path: targetPath, hash };
          }
        }
        if (url.hostname === 'raw.githubusercontent.com') {
          const segments = url.pathname.split('/').filter(Boolean);
          if (
            segments.length >= 4 &&
            segments[0].toLowerCase() === ctx.owner.toLowerCase() &&
            segments[1].toLowerCase() === ctx.repo.toLowerCase()
          ) {
            return { kind: 'internal', path: normalizeRepoPath(segments.slice(3).join('/')), hash };
          }
        }
      } catch {
        // 非法 URL，按普通外链处理
      }
    }
    return { kind: 'external', href: `${absolute}${query}${hash}` };
  }

  // 无仓库上下文：保持原行为，避免影响非仓库场景（如 Gist、AI 消息）
  if (!ctx) return { kind: 'external', href: trimmed };

  // 站内绝对路径（以 / 开头）按仓库根目录解析，与 GitHub README 行为一致
  const baseDir = dirname(ctx.path || '');
  const resolved = trimmed.startsWith('/')
    ? normalizeRepoPath(pathPart)
    : normalizeRepoPath(`${baseDir}/${pathPart}`);

  return { kind: 'internal', path: resolved, hash };
}

/** 解析图片地址：相对路径 → raw.githubusercontent（私有仓库需登录态，可能无法直显） */
export function resolveMarkdownImage(src: string | undefined, ctx?: RepoLinkContext): string | undefined {
  if (!src) return src;
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#')) return trimmed;
  if (ABSOLUTE_SCHEME.test(trimmed) || trimmed.startsWith('//')) {
    return trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  }
  if (!ctx) return trimmed;

  const baseDir = dirname(ctx.path || '');
  const resolved = trimmed.startsWith('/')
    ? normalizeRepoPath(trimmed)
    : normalizeRepoPath(`${baseDir}/${trimmed}`);
  return rawFileUrl(ctx, resolved);
}

export default function MarkdownRenderer({
  content,
  className,
  repoContext,
  onAnchor,
  onAnchorClick,
}: MarkdownRendererProps) {
  const navigate = useNavigate();

  return (
    <div className={`markdown-body ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA], rehypeHighlight]}
        components={{
          // 安全处理图片（含仓库相对路径）
          img: ({ src, alt, node: _node, ...props }) => (
            <img
              src={resolveMarkdownImage(typeof src === 'string' ? src : undefined, repoContext)}
              alt={alt || ''}
              {...props}
              loading="lazy"
              className="max-w-full rounded"
            />
          ),
          // 链接：外部新标签；仓库内文件/目录走应用内路由
          a: ({ href, children, node: _node, ...props }) => {
            const rawHref = typeof href === 'string' ? href : undefined;

            // 页内锚点优先：`#issuecomment-123`，或同仓库 issue 链接带的 hash。
            // 交给宿主处理，避免在 app 内点一下就跳出到浏览器。
            if (onAnchor && rawHref) {
              const anchorHash = rawHref.startsWith('#') ? rawHref.slice(1) : '';
              // 这里只做「能不能处理」的判断，不能执行跳转：
              // remark 的 a 组件是在 render 阶段跑的，在这里调宿主回调会变成渲染副作用，
              // 一屏若有多条带锚点的引用就会一次性触发多次。真正跳转放到 onClick。
              if (anchorHash && onAnchor(anchorHash)) {
                return (
                  <a
                    href={`#${anchorHash}`}
                    {...props}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      onAnchorClick?.(anchorHash);
                    }}
                  >
                    {children}
                  </a>
                );
              }
            }
            const target = resolveMarkdownHref(rawHref, repoContext);

            // 同仓库 issue/PR 链接带的 hash（引用块的出处链接就是这种形态），
            // 也交给宿主，这样点「——来自 @xxx」能直接跳到该评论。
            if (onAnchor && rawHref && /#issue(comment)?-/.test(rawHref)) {
              const sameRepo =
                !!repoContext &&
                new RegExp(`github\\.com/${repoContext.owner}/${repoContext.repo}/`, 'i').test(rawHref);
              const hash = rawHref.slice(rawHref.indexOf('#') + 1);
              if (sameRepo && onAnchor(hash)) {
                return (
                  <a
                    href={`#${hash}`}
                    {...props}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      onAnchorClick?.(hash);
                    }}
                  >
                    {children}
                  </a>
                );
              }
            }


            if (target?.kind === 'internal') {
              // README 内的语言切换（README.md / README.zh-CN.md 等）应切换 README 渲染，
              // 而不是进入代码浏览查看原始 Markdown 文件。
              const isReadmeSwitch =
                !!repoContext && isReadmeFilePath(target.path);
              const to = isReadmeSwitch
                ? `/repos/${repoContext!.owner}/${repoContext!.repo}?readme=${encodeURIComponent(target.path || 'README.md')}${target.hash}`
                : `/repos/${repoContext!.owner}/${repoContext!.repo}/code${target.path ? `/${target.path}` : ''}${target.hash}`;
              return (
                <a
                  href={`#${to}`}
                  {...props}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    navigate(to);
                  }}
                >
                  {children}
                </a>
              );
            }

            const isExternal = target?.kind === 'external';
            return (
              <a
                href={isExternal ? target.href : href}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                {...props}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}