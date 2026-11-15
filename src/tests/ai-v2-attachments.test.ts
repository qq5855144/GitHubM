import { describe, expect, it } from 'vitest';
import {
  buildModelUserContent,
  buildModelUserParts,
  filterRepoFiles,
  formatFileSize,
  isTextFilePath,
} from '@/ai-v2/attachments';
import type { UiAttachment } from '@/ai-v2/attachments';
import { toAgentHistory } from '@/ai-v2/agent';

const attachment: UiAttachment = {
  id: 'a1',
  name: 'App.tsx',
  path: 'src/App.tsx',
  source: 'repo',
  size: 120,
  content: 'export default function App() { return null; }',
};

describe('AI attachments', () => {
  it('builds model content with paths and fenced file bodies', () => {
    const content = buildModelUserContent('请检查这个文件', [attachment]);
    expect(content).toContain('请检查这个文件');
    expect(content).toContain('[附件 1] src/App.tsx');
    expect(content).toContain('来自当前仓库');
    expect(content).toContain('export default function App');
  });

  it('limits total attachment characters', () => {
    const content = buildModelUserContent('x', [attachment], 10);
    expect(content).toContain('附件已截断');
    expect(content.length).toBeLessThan(200);
  });

  it('rebuilds history from persisted attachments when modelContent is absent', () => {
    const history = toAgentHistory([{
      role: 'user',
      content: '检查附件',
      attachments: [attachment],
    }]);
    expect(history[0].content).toContain('src/App.tsx');
    expect(history[0].content).toContain('export default');
  });

  it('builds multimodal parts for image attachments', () => {
    const parts = buildModelUserParts('看这张图', [{
      id: 'img1',
      name: 'screen.png',
      source: 'local',
      kind: 'image',
      size: 100,
      content: '',
      dataUrl: 'data:image/png;base64,AAAA',
    }]);
    expect(Array.isArray(parts)).toBe(true);
    expect((parts as Array<{ type: string }>).map(part => part.type)).toEqual(['text', 'image_url']);
  });

  it('filters repo text files and formats sizes', () => {
    const paths = ['src/App.tsx', 'src/style.css', 'public/logo.png', 'README.md'];
    expect(filterRepoFiles(paths, 'src/')).toEqual(['src/App.tsx', 'src/style.css']);
    expect(isTextFilePath('src/App.tsx')).toBe(true);
    expect(isTextFilePath('public/logo.png')).toBe(false);
    expect(isTextFilePath('Dockerfile')).toBe(true);
    expect(formatFileSize(1200)).toBe('1.2 KB');
  });
});