// AI V2 — 内置技能（按需注入，不一次性塞进系统提示词）
export interface AgentSkill {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  content: string;
}

export const SKILLS: AgentSkill[] = [
  {
    id: 'actions-debug',
    title: 'Actions 失败排查',
    description: '按 Job、失败步骤和日志证据定位 CI/CD 问题',
    keywords: ['actions', '工作流', 'ci', '构建失败', '部署失败', 'job', '日志', '报错'],
    content: [
      '处理 GitHub Actions 失败：',
      '1. 先确认失败的 workflow、run、job 和具体失败 step。',
      '2. 优先读取完整 Job 日志中的第一条错误，不要只看末尾摘要。',
      '3. 区分代码错误、依赖下载失败、密钥缺失、Runner 环境和临时网络问题。',
      '4. 给出最小修复方案；涉及修改文件时必须先读取目标文件。',
      '5. 修复后建议重跑失败 Job，并等待结果。',
    ].join('\n'),
  },
  {
    id: 'code-review',
    title: '代码审查',
    description: '优先检查正确性、回归风险、边界条件和可维护性',
    keywords: ['审查', 'review', '代码质量', '重构', 'bug', '风险', '检查'],
    content: [
      '代码审查规则：',
      '1. 先说明变更目的和影响范围。',
      '2. 优先找会导致错误、数据损坏、安全问题或回归的缺陷。',
      '3. 每个问题给出文件、位置、触发条件和修复建议。',
      '4. 不为了风格偏好制造大量低价值意见。',
      '5. 最后给出阻塞项和非阻塞项。',
    ].join('\n'),
  },
  {
    id: 'release',
    title: '发布与版本',
    description: '版本号、Release、APK、CI 产物校验流程',
    keywords: ['发布', 'release', '版本', 'apk', 'tag', '发版'],
    content: [
      '发布流程：',
      '1. 确认版本号、分支和待发布提交。',
      '2. 检查构建、测试和 CI 是否通过。',
      '3. 确认 Release 产物名称、大小和校验结果。',
      '4. 不覆盖已发布版本的 tag。',
      '5. 发布后核对线上部署和安装包版本。',
    ].join('\n'),
  },
  {
    id: 'repo-structure',
    title: '仓库结构分析',
    description: '从入口、目录、配置和依赖快速理解项目',
    keywords: ['仓库', '项目结构', '入口', '技术栈', '目录', '架构'],
    content: [
      '仓库分析顺序：',
      '1. 读取 README、package/build 配置和入口文件。',
      '2. 列出主要目录，而不是逐文件扫描。',
      '3. 识别运行时、框架、构建工具、测试和部署方式。',
      '4. 说明关键模块之间的依赖关系。',
      '5. 结论要附上实际读取过的文件依据。',
    ].join('\n'),
  },
];

export function selectSkills(query: string, max = 2): AgentSkill[] {
  const text = query.toLowerCase();
  if (!text.trim()) return [];
  const scored = SKILLS.map(skill => {
    let score = 0;
    for (const keyword of skill.keywords) {
      if (text.includes(keyword.toLowerCase())) score += keyword.length;
    }
    return { skill, score };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map(item => item.skill);
}

export function getSkill(id: string): AgentSkill | undefined {
  return SKILLS.find(skill => skill.id === id);
}