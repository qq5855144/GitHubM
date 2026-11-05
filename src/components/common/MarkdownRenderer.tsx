// Markdown 渲染组件
//
// 关键能力：仓库上下文（repoContext）下的相对链接/相对图片解析。
//
// 背景（Issue #21）：README / Issue / PR 正文里的相对链接（如 ./docs/a.md、
// images/logo.png）在 WebView APK 内会被解析成 file:///android_asset/...，
// 点击后直接报 ERR_FILE_NOT_FOUND。这里在渲染阶段把相对地址还原成
// 「仓库内路径」，点击时走应用内代码浏览路由；图片则转换为 raw.githubusercontent。
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import { useNavigate } from 'react-router-dom';

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
}

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

export default function MarkdownRenderer({ content, className, repoContext }: MarkdownRendererProps) {
  const navigate = useNavigate();

  return (
    <div className={`markdown-body ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeRaw]}
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
            const target = resolveMarkdownHref(typeof href === 'string' ? href : undefined, repoContext);

            if (target?.kind === 'internal') {
              // README 内的语言切换（README.md / README.zh-CN.md 等）应切换 README 渲染，
              // 而不是进入代码浏览查看原始 Markdown 文件。
              const isReadmeSwitch =
                !!repoContext &&
                isReadmeFilePath(repoContext.path) &&
                isReadmeFilePath(target.path);
              const to = isReadmeSwitch
                ? `/repos/${repoContext!.owner}/${repoContext!.repo}?readme=${encodeURIComponent(target.path || 'README.md')}${target.hash}`
                : `/repos/${repoContext!.owner}/${repoContext!.repo}/code${target.path ? `/${target.path}` : ''}${target.hash}`;
              return (
                <a
                  href={`#${to}`}
                  {...props}
                  onClick={(e) => {
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
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