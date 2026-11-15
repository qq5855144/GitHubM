import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CodeBlock from '@/components/ai/CodeBlock';

describe('CodeBlock', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders short code expanded and copies content', async () => {
    render(<CodeBlock code={'const a = 1;'} lang="ts" />);
    expect(screen.getByText('const a = 1;')).toBeTruthy();
    fireEvent.click(screen.getByTitle('复制代码'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('const a = 1;'));
    expect(screen.getByText('已复制')).toBeTruthy();
  });

  it('collapses long code by default and expands on click', () => {
    const longCode = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n');
    render(<CodeBlock code={longCode} lang="ts" />);
    expect(screen.queryByText(/line 29/)).toBeNull();
    expect(screen.getByText('代码已折叠，点击标题展开')).toBeTruthy();

    fireEvent.click(screen.getByText('ts'));
    expect(screen.getByText(/line 29/)).toBeTruthy();
  });

  it('toggles code visibility from the header', () => {
    render(<CodeBlock code={'console.log(1);'} lang="js" />);
    fireEvent.click(screen.getByText('js'));
    expect(screen.getByText('代码已折叠，点击标题展开')).toBeTruthy();
    fireEvent.click(screen.getByText('js'));
    expect(screen.getByText('console.log(1);')).toBeTruthy();
  });
});