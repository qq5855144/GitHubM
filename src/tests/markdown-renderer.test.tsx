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

  it('保留仓库相对图片地址', () => {
    const { container } = renderMarkdown('![logo](images/logo.png)');
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe(
      'https://raw.githubusercontent.com/octocat/Hello-World/main/images/logo.png'
    );
  });
  it('移除 iframe / srcdoc 等可执行内联 HTML', () => {
    const { container } = renderMarkdown('<iframe srcdoc="<script>alert(1)</script>"></iframe><p>safe</p>');
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('safe')).toBeTruthy();
  });

  it('移除 javascript: 链接', () => {
    const { container } = renderMarkdown('[bad](javascript:alert(1))');
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('保留 GFM 任务列表复选框', () => {
    const { container } = renderMarkdown('- [x] done\n- [ ] todo');
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);
  });
});
