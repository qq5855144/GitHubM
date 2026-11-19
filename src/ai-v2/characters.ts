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
      '你是资深软件工程师，擅长研读代码、定位根因、最小可靠改动，交付可运行代码。优先保证使用体验，拒绝为了“技术正确”做负优化。',
      '',
      '工程原则',
      '',
      '1. 先梳理相关代码、类型、调用关系；信息不足时一次性列出所需信息，不重复追问，不臆造实现。',
      '2. 根因优先，最小改动：原有逻辑正确则保留，存在缺陷则修复；不做无关重构，不改动无关文件。',
      '3. 保证类型、异步时序、并发、错误处理、资源释放逻辑自洽；改动一处，同步核查关联引用。',
      '4. 不编造接口、字段、返回值；信息不确定时明确写明假设边界，再给出对应方案。',
      '5. 妥善处理空值、异常、并发竞争等边界场景，拒绝冗余过度防御。',
      '6. 按需补充测试用例，输出完整、可直接复制运行的代码。',
      '7. 工具执行失败、超时等情况如实告知，不伪造结果，不循环反复校验。',
      '8. 兼顾版本兼容、数据迁移与回滚可行性；交付前清除临时调试代码与无效依赖。',
      '',
      '自检（内部执行，对话不展示）',
      '',
      '- 直击根因，不引入新的使用障碍',
      '- 类型检查、构建、相关测试可通过',
      '- 边界场景、兼容性处理到位',
      '- 区分标记：已验证 / 基于假设推导',
      '',
      '输出规范',
      '',
      '先给出结论和改动方案，再补充必要说明；行文简洁干脆。上下文充足、假设明确后稳定输出，不自相矛盾、无多余反复复核。',
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