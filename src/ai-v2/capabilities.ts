// AI V2 — Capability Registry：按上下文激活能力包，避免一次性注入全部工具
import type { AgentTool, CapabilityInfo, RepoContext } from './types';
import { GITHUB_READ_TOOLS, GITHUB_WRITE_TOOLS } from './tools/github';
import { ARTIFACT_TOOLS } from './tools/artifacts';
import { MEMORY_TOOLS } from './tools/memory';

export interface CapabilityPack extends CapabilityInfo {
  tools: AgentTool[];
  active: (ctx: { repo?: RepoContext }) => boolean;
}

export const CAPABILITY_PACKS: CapabilityPack[] = [
  {
    id: 'core',
    label: '核心',
    description: 'Artifact 读取与长期记忆能力',
    tools: [...ARTIFACT_TOOLS, ...MEMORY_TOOLS],
    active: () => true,
  },
  {
    id: 'github-read',
    label: 'GitHub 只读',
    description: '仓库信息、目录、文件和代码搜索',
    tools: GITHUB_READ_TOOLS,
    active: ctx => Boolean(ctx.repo),
  },
  {
    id: 'github-write',
    label: 'GitHub 写入',
    description: '创建或更新文件，执行前必须用户确认',
    tools: GITHUB_WRITE_TOOLS,
    active: ctx => Boolean(ctx.repo),
  },
];

export function resolveCapabilities(repo?: RepoContext): {
  capabilities: CapabilityInfo[];
  tools: AgentTool[];
} {
  const ctx = { repo };
  const activePacks = CAPABILITY_PACKS.filter(pack => pack.active(ctx));
  return {
    capabilities: activePacks.map(({ id, label, description }) => ({ id, label, description })),
    tools: activePacks.flatMap(pack => pack.tools),
  };
}

export function getToolsForContext(repo?: RepoContext): AgentTool[] {
  return resolveCapabilities(repo).tools;
}

export function getCapabilitySummaries(repo?: RepoContext): CapabilityInfo[] {
  return resolveCapabilities(repo).capabilities;
}