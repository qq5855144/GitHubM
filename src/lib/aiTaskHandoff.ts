export interface AiTaskHandoff {
  prompt: string;
  repoFullName: string;
  branch?: string;
  source?: 'actions';
}

const AI_TASK_HANDOFF_KEY = 'githubm_ai_task_handoff_v1';

export function setAiTaskHandoff(handoff: AiTaskHandoff): boolean {
  try {
    sessionStorage.setItem(AI_TASK_HANDOFF_KEY, JSON.stringify(handoff));
    return true;
  } catch {
    return false;
  }
}

export function consumeAiTaskHandoff(): AiTaskHandoff | null {
  try {
    const raw = sessionStorage.getItem(AI_TASK_HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(AI_TASK_HANDOFF_KEY);
    const value = JSON.parse(raw) as Partial<AiTaskHandoff>;
    if (typeof value.prompt !== 'string' || !value.prompt.trim() || typeof value.repoFullName !== 'string') {
      return null;
    }
    return value as AiTaskHandoff;
  } catch {
    return null;
  }
}