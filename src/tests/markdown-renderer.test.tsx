// MarkdownRenderer 交互测试：README 语言切换 vs 普通文件链接
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderMarkdown(content: string) {
  return render(
    <MemoryRouter initialEntries={['/repos/octocat/Hello-World']}>
      <Routes>
        <Route
          path="/repos/:owner/:repo"
          element={
            <>
              <MarkdownRenderer
                content={content}
                repoContext={{
                  owner: 'octocat',
                  repo: 'Hello-World',
                  ref: 'main',
                  path: 'README.md',
                }}
              />
              <LocationProbe />
            </>
          }
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('MarkdownRenderer README 语言切换', () => {
  it('点击 README.zh-CN.md 切换 README 而不是进入代码浏览', () => {
    renderMarkdown('English | [简体中文](./README.zh-CN.md)');
    fireEvent.click(screen.getByText('简体中文'));
    expect(screen.getByTestId('location').textContent).toBe(
      '/repos/octocat/Hello-World?readme=README.zh-CN.md'
    );
  });

  it('普通 Markdown 文件链接仍进入代码浏览', () => {
    renderMarkdown('[guide](./docs/guide.md)');
    fireEvent.click(screen.getByText('guide'));
    expect(screen.getByTestId('location').textContent).toBe(
      '/repos/octocat/Hello-World/code/docs/guide.md'
    );
  });

  it('外部链接不会被改写为内部路由', () => {
    renderMarkdown('[Vue](https://vuejs.org/)');
    const link = screen.getByText('Vue').closest('a');
    expect(link?.getAttribute('href')).toBe('https://vuejs.org/');
    expect(link?.getAttribute('target')).toBe('_blank');
  });
});