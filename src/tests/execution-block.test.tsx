import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ExecutionBlock from '@/components/ai/ExecutionBlock';
import type { Message } from '@/components/ai/aiTypes';

const step: Message = {
  id: 'step-1',
  role: 'assistant',
  content: '',
  bubbleType: 'step',
  stepTitle: '定位文件',
  streaming: false,
};
const tool: Message = {
  id: 'tool-1',
  role: 'assistant',
  content: '',
  bubbleType: 'tool',
  toolLabel: '读取文件',
  toolStatus: 'success',
  toolResult: 'export const a = 1;',
  streaming: false,
};

describe('ExecutionBlock', () => {
  it('当前任务段即使没有 streaming 消息也保持展开', () => {
    render(<ExecutionBlock msgs={[step, tool]} streaming={false} active />);
    expect(screen.getByText('定位文件')).toBeTruthy();
    expect(screen.getByText('读取文件')).toBeTruthy();
  });

  it('历史执行段默认折叠，只显示摘要', () => {
    render(<ExecutionBlock msgs={[step, tool]} streaming={false} active={false} />);
    expect(screen.queryByText('定位文件')).toBeNull();
    expect(screen.queryByText('读取文件')).toBeNull();
    expect(screen.getByText('执行完成')).toBeTruthy();
  });

  it('展开历史执行段后可以看到步骤与工具', () => {
    render(<ExecutionBlock msgs={[step, tool]} streaming={false} active={false} />);
    const header = screen.getByText('执行完成').closest('button');
    if (!header) throw new Error('header button not found');
    fireEvent.click(header);
    expect(screen.getByText('定位文件')).toBeTruthy();
    expect(screen.getByText('读取文件')).toBeTruthy();
  });
});