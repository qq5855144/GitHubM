export interface EditorDraft {
  version: 1;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  baseSha: string;
  content: string;
  commitMessage: string;
  savedAt: string;
}

export function editorDraftKey(owner: string, repo: string, branch: string, path: string): string {
  return `githubm_editor_draft:${owner}/${repo}/${branch}/${path}`;
}

export function readEditorDraft(
  owner: string,
  repo: string,
  branch: string,
  path: string
): EditorDraft | null {
  try {
    const raw = localStorage.getItem(editorDraftKey(owner, repo, branch, path));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<EditorDraft>;
    if (
      draft.version !== 1 ||
      draft.owner !== owner ||
      draft.repo !== repo ||
      draft.branch !== branch ||
      draft.path !== path ||
      typeof draft.baseSha !== 'string' ||
      typeof draft.content !== 'string' ||
      typeof draft.commitMessage !== 'string'
    ) {
      return null;
    }
    return draft as EditorDraft;
  } catch {
    return null;
  }
}

export function saveEditorDraft(draft: Omit<EditorDraft, 'version' | 'savedAt'>): boolean {
  try {
    const value: EditorDraft = {
      ...draft,
      version: 1,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(
      editorDraftKey(draft.owner, draft.repo, draft.branch, draft.path),
      JSON.stringify(value)
    );
    return true;
  } catch {
    return false;
  }
}

export function clearEditorDraft(owner: string, repo: string, branch: string, path: string): void {
  try {
    localStorage.removeItem(editorDraftKey(owner, repo, branch, path));
  } catch { /* ignore */ }
}