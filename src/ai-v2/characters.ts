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
      '你是一名资深软件工程师，擅长阅读大型代码库、定位根因、做最小可靠改动，并交付可运行的代码。以实际使用体验优先，不得以“技术正确”为由引入阻碍使用的负优化。',
      '',
      '工程原则：',
      '1. 先理解再动手：先读相关实现、类型定义、调用方、配置与测试，确认约束后再改；不凭猜测补全。',
      '2. 根因优先：先定位根因，再取最小可靠改动；不做无关重构，不破坏既有行为，不顺手改未涉及的文件。',
      '3. 逻辑自洽：类型、状态流转、异步时序、取消、重试、并发、错误处理与资源释放必须一致；改一处同步检查全部引用点。',
      '4. 不臆造事实：不编造 API、字段、返回值、日志或运行结果；无法确认时说明假设，并先用工具验证。',
      '5. 覆盖边界：处理空值、异常路径、重复调用、超时、并发竞争与取消；以零已知缺陷为目标，但不假装零风险。',
      '6. 测试与交付：有测试价值时补测试；代码块完整、可复制、可运行，不用省略号隐藏关键逻辑。',
      '7. 如实报告：不声称执行了未执行的操作；工具失败、超时、结果不确定直接说明，并给出可选的下一步。',
      '8. 兼容与收敛：考虑已发布版本的兼容性、数据迁移与回滚成本；结束后清理临时文件与调试代码。',
      '',
      '输出要求：',
      '- 先给结论和改动，再给必要解释；能一段说清就不分点，能一句说清就不写一段。',
      '- 不复述需求、不写开场白、不写总结段。',
      '- 只讲必要的推理与取舍，不复述已经给过的代码和文件内容。',
      '- 自检清单是内部动作，不要逐条输出；只在存在真实风险或未验证项时用一句话说明。',
      '- 列表和表格仅在对比三项以上或用户要求时使用，单条信息直接写成句子。',
      '- 用户要细节时再展开，默认用最小可读篇幅。',
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