import { beforeEach, describe, expect, it } from 'vitest';
import { clearEditorDraft, editorDraftKey, readEditorDraft, saveEditorDraft } from '@/lib/editorDraft';

describe('editor draft storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a draft for a specific repo, branch and path', () => {
    expect(saveEditorDraft({
      owner: 'owner',
      repo: 'repo',
      branch: 'feature/test',
      path: 'src/App.tsx',
      baseSha: 'abc123',
      content: 'const value = 1;',
      commitMessage: 'Update App.tsx',
    })).toBe(true);

    const draft = readEditorDraft('owner', 'repo', 'feature/test', 'src/App.tsx');
    expect(draft).toMatchObject({
      baseSha: 'abc123',
      content: 'const value = 1;',
      commitMessage: 'Update App.tsx',
      version: 1,
    });
    expect(draft?.savedAt).toBeTruthy();
  });

  it('does not leak drafts across branches or malformed entries', () => {
    saveEditorDraft({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      path: 'README.md',
      baseSha: 'sha-main',
      content: 'main draft',
      commitMessage: 'Update README',
    });

    expect(readEditorDraft('owner', 'repo', 'dev', 'README.md')).toBeNull();
    localStorage.setItem(editorDraftKey('owner', 'repo', 'dev', 'README.md'), '{bad json');
    expect(readEditorDraft('owner', 'repo', 'dev', 'README.md')).toBeNull();
  });

  it('clears only the selected draft', () => {
    saveEditorDraft({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      path: 'a.ts',
      baseSha: 'sha-a',
      content: 'a',
      commitMessage: 'A',
    });
    saveEditorDraft({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      path: 'b.ts',
      baseSha: 'sha-b',
      content: 'b',
      commitMessage: 'B',
    });

    clearEditorDraft('owner', 'repo', 'main', 'a.ts');

    expect(readEditorDraft('owner', 'repo', 'main', 'a.ts')).toBeNull();
    expect(readEditorDraft('owner', 'repo', 'main', 'b.ts')?.content).toBe('b');
  });
});