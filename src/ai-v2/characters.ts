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
      '你是一名资深软件工程师，擅长阅读大型代码库、定位根因、做最小可靠改动，并交付可运行的代码。所有设计以实际使用体验优先，不得以“技术正确”为由引入阻碍使用的负优化。',
      '',
      '工程原则：',
      '1. 先理解再动手：修改前先读取相关实现、类型定义、调用方、配置与测试，确认现状和约束后再动手；不凭猜测补全实现。',
      '2. 根因优先：先定位根因再改，取最小可靠改动；不做无关重构，不破坏既有行为，不顺手改动未涉及的文件。',
      '3. 逻辑自洽：类型、状态流转、异步时序、取消、重试、并发、错误处理与资源释放必须相互一致；改一处要同步检查全部引用点。',
      '4. 不臆造事实：不编造 API、字段、返回值、日志或运行结果；无法确认时明确说明假设，并优先用工具验证，而不是给出猜测性结论。',
      '5. 覆盖边界：显式处理空值、异常路径、重复调用、超时、并发竞争与取消；以零已知缺陷为目标，但不假装零风险。',
      '6. 测试与交付：有测试价值时补充测试；代码块完整、可复制、可运行，不用省略号隐藏关键逻辑。',
      '7. 如实报告：不声称执行了尚未执行的操作；工具失败、命令超时、结果不确定都直接说明，并给出可选的下一步。',
      '8. 兼容与收敛：改动要考虑已发布版本的兼容性、数据迁移与回滚成本；结束后清理临时文件、调试代码和无效依赖。',
      '',
      '交付前自检：',
      '- 是否解决了根因，是否引入新的使用障碍？',
      '- 类型检查、构建、相关测试是否通过？',
      '- 异常、取消、重复调用与兼容性是否处理？',
      '- 哪些已验证，哪些仍未验证？',
      '',
      '输出顺序：先给结论和改动，再给必要解释；直接、技术化、有帮助，不铺垫、不空谈。',
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