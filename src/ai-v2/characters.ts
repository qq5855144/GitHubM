// AI V2 — 角色卡：内置默认角色 + 用户自定义角色
export interface CharacterCard {
  id: string;
  name: string;
  description: string;
  prompt: string;
  builtin?: boolean;
  createdAt: string;
}

const CHARACTERS_PREFIX = 'githubm_ai_characters:';
const ACTIVE_PREFIX = 'githubm_ai_active_character:';
const MAX_CUSTOM = 20;

export const DEFAULT_CHARACTER_ID = 'builtin-engineer';

export const BUILTIN_CHARACTERS: CharacterCard[] = [
  {
    id: DEFAULT_CHARACTER_ID,
    name: '资深代码工程师',
    description: '严谨、可验证、以零已知缺陷为目标的工程角色',
    builtin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    prompt: [
      '你是一个全能AI助手，旨在解决用户提出的任何任务。擅长研读代码、定位根因、最可靠改动，交付高质量可运行代码。优先保证使用体验，直击根因，不引入使用障碍，拒绝为了“技术正确”做负优化。',
    ].join('\n'),
  },
];

function safeLogin(login?: string): string {
  return encodeURIComponent(login || 'anonymous');
}

function readCustom(login?: string): CharacterCard[] {
  try {
    const raw = localStorage.getItem(`${CHARACTERS_PREFIX}${safeLogin(login)}`);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CharacterCard => {
      if (!item || typeof item !== 'object') return false;
      const card = item as Partial<CharacterCard>;
      return Boolean(card.id && card.name && card.prompt);
    }).map(card => ({ ...card, builtin: false }));
  } catch {
    return [];
  }
}

function writeCustom(login: string | undefined, cards: CharacterCard[]): void {
  localStorage.setItem(
    `${CHARACTERS_PREFIX}${safeLogin(login)}`,
    JSON.stringify(cards.slice(0, MAX_CUSTOM)),
  );
}

export function loadCharacters(login?: string): CharacterCard[] {
  return [...BUILTIN_CHARACTERS, ...readCustom(login)];
}

export function loadActiveCharacter(login?: string): CharacterCard {
  const cards = loadCharacters(login);
  try {
    const id = localStorage.getItem(`${ACTIVE_PREFIX}${safeLogin(login)}`);
    return cards.find(card => card.id === id) || BUILTIN_CHARACTERS[0];
  } catch {
    return BUILTIN_CHARACTERS[0];
  }
}

export function saveActiveCharacterId(login: string | undefined, id: string): void {
  const exists = loadCharacters(login).some(card => card.id === id);
  if (!exists) return;
  localStorage.setItem(`${ACTIVE_PREFIX}${safeLogin(login)}`, id);
}

export function saveCustomCharacter(
  login: string | undefined,
  input: { id?: string; name: string; description?: string; prompt: string },
): CharacterCard | null {
  const name = input.name.trim().slice(0, 40);
  const prompt = input.prompt.trim().slice(0, 12000);
  if (!name || !prompt) return null;
  const cards = readCustom(login);
  const now = new Date().toISOString();
  const existingIndex = input.id ? cards.findIndex(card => card.id === input.id) : -1;
  const card: CharacterCard = {
    id: existingIndex >= 0 ? cards[existingIndex].id : `char_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    description: String(input.description || '').trim().slice(0, 200),
    prompt,
    builtin: false,
    createdAt: existingIndex >= 0 ? cards[existingIndex].createdAt : now,
  };
  if (existingIndex >= 0) cards[existingIndex] = card;
  else cards.unshift(card);
  writeCustom(login, cards);
  return card;
}

export function deleteCustomCharacter(login: string | undefined, id: string): void {
  const cards = readCustom(login).filter(card => card.id !== id);
  writeCustom(login, cards);
  if (localStorage.getItem(`${ACTIVE_PREFIX}${safeLogin(login)}`) === id) {
    localStorage.setItem(`${ACTIVE_PREFIX}${safeLogin(login)}`, DEFAULT_CHARACTER_ID);
  }
}