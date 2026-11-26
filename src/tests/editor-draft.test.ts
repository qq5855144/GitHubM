import { beforeEach, describe, expect, it } from 'vitest';
import { clearEditorDraft, editorDraftKey, listEditorDrafts, readEditorDraft, saveEditorDraft } from '@/lib/editorDraft';

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

  it('lists drafts for the signed-in owner, newest first, and prefers the new copy', () => {
    const existing = {
      owner: 'owner', repo: 'repo', branch: 'feature/work', path: 'src/example.ts',
      baseSha: 'sha', content: 'local', commitMessage: 'Update file', savedAt: '2026-01-01T08:00:00Z',
    };
    const legacyKey = 'githubm_editor_draft:owner/repo/feature/work/src/example.ts';
    localStorage.setItem(legacyKey, JSON.stringify({ ...existing, version: 1 }));
    expect(readEditorDraft('owner', 'repo', 'feature/work', 'src/example.ts')).toMatchObject(existing);
    saveEditorDraft({ ...existing, content: 'updated', savedAt: '2026-01-02T08:00:00Z' });
    saveEditorDraft({ ...existing, path: 'README.md' });
    saveEditorDraft({ ...existing, owner: 'another-user' });
    localStorage.setItem(editorDraftKey('owner', 'repo', 'main', 'bad.ts'), 'null');

    expect(listEditorDrafts('OWNER').map(draft => [draft.path, draft.content])).toEqual([
      ['src/example.ts', 'updated'], ['README.md', 'local'],
    ]);
    expect(clearEditorDraft(existing.owner, existing.repo, existing.branch, existing.path)).toBe(true);
    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect(listEditorDrafts('owner').map(draft => draft.path)).toEqual(['README.md']);
  });

  it('keeps branch names with slashes distinct from directory paths', () => {
    const first = {
      owner: 'owner', repo: 'repo', branch: 'feature/work', path: 'example.ts',
      baseSha: 'sha', content: 'first', commitMessage: 'First', savedAt: '2026-01-01T08:00:00Z',
    };
    localStorage.setItem('githubm_editor_draft:owner/repo/feature/work/example.ts', JSON.stringify({ ...first, version: 1 }));
    saveEditorDraft({ ...first, branch: 'feature', path: 'work/example.ts', content: 'second' });
    expect(clearEditorDraft('owner', 'repo', 'feature', 'work/example.ts')).toBe(true);
    expect(readEditorDraft('owner', 'repo', 'feature/work', 'example.ts')?.content).toBe('first');
    expect(readEditorDraft('owner', 'repo', 'feature', 'work/example.ts')).toBeNull();
  });
});
