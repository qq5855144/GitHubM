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

const DRAFT_PREFIX = 'githubm_editor_draft_v2:';
const LEGACY_PREFIX = 'githubm_editor_draft:';

export function editorDraftKey(owner: string, repo: string, branch: string, path: string): string {
  return DRAFT_PREFIX + [owner, repo, branch, path].map(encodeURIComponent).join('/');
}

function legacyDraftKey(owner: string, repo: string, branch: string, path: string): string {
  return `${LEGACY_PREFIX}${owner}/${repo}/${branch}/${path}`;
}

function readStoredDraft(key: string): EditorDraft | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Partial<EditorDraft> | null;
    if (draft?.version !== 1 ||
      typeof draft.owner !== 'string' || !draft.owner ||
      typeof draft.repo !== 'string' || !draft.repo ||
      typeof draft.branch !== 'string' || !draft.branch ||
      typeof draft.path !== 'string' || !draft.path ||
      typeof draft.baseSha !== 'string' ||
      typeof draft.content !== 'string' ||
      typeof draft.commitMessage !== 'string' ||
      typeof draft.savedAt !== 'string' || !Number.isFinite(Date.parse(draft.savedAt))) return null;
    const { owner, repo, branch, path } = draft;
    return key === editorDraftKey(owner, repo, branch, path) || key === legacyDraftKey(owner, repo, branch, path)
      ? draft as EditorDraft : null;
  } catch {
    return null;
  }
}

export function readEditorDraft(owner: string, repo: string, branch: string, path: string): EditorDraft | null {
  try {
    return readStoredDraft(editorDraftKey(owner, repo, branch, path))
      ?? readMatchingLegacyDraft(owner, repo, branch, path);
  } catch {
    return null;
  }
}

function readMatchingLegacyDraft(owner: string, repo: string, branch: string, path: string): EditorDraft | null {
  const draft = readStoredDraft(legacyDraftKey(owner, repo, branch, path));
  return draft?.owner === owner && draft.repo === repo && draft.branch === branch && draft.path === path ? draft : null;
}

export function listEditorDrafts(owner: string): EditorDraft[] {
  const drafts = new Map<string, EditorDraft>();
  const login = owner.toLowerCase();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || (!key.startsWith(DRAFT_PREFIX) && !key.startsWith(LEGACY_PREFIX))) continue;
      const draft = readStoredDraft(key);
      if (!draft || draft.owner.toLowerCase() !== login) continue;
      const id = editorDraftKey(draft.owner, draft.repo, draft.branch, draft.path);
      if (key === id || !drafts.has(id)) drafts.set(id, draft);
    }
  } catch {
    // Return any available drafts if storage becomes inaccessible.
  }
  return [...drafts.values()].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
}

export function saveEditorDraft(draft: Omit<EditorDraft, 'version' | 'savedAt'> & { savedAt?: string }): boolean {
  try {
    const value: EditorDraft = { ...draft, version: 1, savedAt: draft.savedAt ?? new Date().toISOString() };
    localStorage.setItem(editorDraftKey(draft.owner, draft.repo, draft.branch, draft.path), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearEditorDraft(owner: string, repo: string, branch: string, path: string): boolean {
  try {
    if (readMatchingLegacyDraft(owner, repo, branch, path)) {
      localStorage.removeItem(legacyDraftKey(owner, repo, branch, path));
    }
    localStorage.removeItem(editorDraftKey(owner, repo, branch, path));
    return true;
  } catch {
    return false;
  }
}
