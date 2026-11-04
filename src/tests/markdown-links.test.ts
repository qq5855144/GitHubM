// Markdown 仓库相对链接解析单元测试（Issue #21 回归）
import { describe, it, expect } from 'vitest';
import {
  normalizeRepoPath,
  resolveMarkdownHref,
  resolveMarkdownImage,
  type RepoLinkContext,
} from '@/components/common/MarkdownRenderer';

const ctx: RepoLinkContext = {
  owner: 'octocat',
  repo: 'Hello-World',
  ref: 'main',
  path: 'docs/guide/intro.md',
};

describe('normalizeRepoPath', () => {
  it('处理 ./ 与多余斜杠', () => {
    expect(normalizeRepoPath('./docs//a.md')).toBe('docs/a.md');
  });

  it('处理 ../ 回退', () => {
    expect(normalizeRepoPath('docs/guide/../images/logo.png')).toBe('docs/images/logo.png');
  });

  it('根路径保持稳定', () => {
    expect(normalizeRepoPath('/LICENSE')).toBe('LICENSE');
  });
});

describe('resolveMarkdownHref（仓库上下文）', () => {
  it('相对文件路径解析为仓库内路径', () => {
    expect(resolveMarkdownHref('./setup.md', ctx)).toEqual({
      kind: 'internal',
      path: 'docs/guide/setup.md',
      hash: '',
    });
  });

  it('相对父级路径 + 锚点', () => {
    expect(resolveMarkdownHref('../README.md#install', ctx)).toEqual({
      kind: 'internal',
      path: 'docs/README.md',
      hash: '#install',
    });
  });

  it('以 / 开头按仓库根目录解析', () => {
    expect(resolveMarkdownHref('/LICENSE', ctx)).toEqual({
      kind: 'internal',
      path: 'LICENSE',
      hash: '',
    });
  });

  it('同仓库 GitHub blob 链接转为应用内路由', () => {
    expect(
      resolveMarkdownHref('https://github.com/octocat/Hello-World/blob/main/src/a.ts', ctx)
    ).toEqual({ kind: 'internal', path: 'src/a.ts', hash: '' });
  });

  it('其他仓库链接保持外链', () => {
    const result = resolveMarkdownHref('https://github.com/other/repo/blob/main/a.ts', ctx);
    expect(result?.kind).toBe('external');
  });

  it('页内锚点保持原样', () => {
    expect(resolveMarkdownHref('#section', ctx)).toEqual({ kind: 'anchor', href: '#section' });
  });

  it('没有仓库上下文时相对路径不误判为内部路由', () => {
    expect(resolveMarkdownHref('./a.md')).toEqual({ kind: 'external', href: './a.md' });
  });
});

describe('resolveMarkdownImage（仓库上下文）', () => {
  it('相对图片转 raw.githubusercontent', () => {
    expect(resolveMarkdownImage('images/logo.png', ctx)).toBe(
      'https://raw.githubusercontent.com/octocat/Hello-World/main/docs/guide/images/logo.png'
    );
  });

  it('绝对图片地址保持不变', () => {
    expect(resolveMarkdownImage('https://example.com/a.png', ctx)).toBe('https://example.com/a.png');
  });
});