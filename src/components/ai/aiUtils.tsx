// AI 助手共享工具函数 & 常量
import React from 'react';
import type { ModelConfig, ModelType } from './aiTypes';
import {
  FolderOpen, BookOpen, Search, FileCode2, Pencil,
  GitBranch, GitCommit, GitMerge, CircleAlert,
  Play, ListChecks, BugPlay, LayoutDashboard,
} from 'lucide-react';

// ── 模型类型（从 aiTypes 导入，在此仅重导出供外部使用）──────────────────────────────
export type { ModelType };

export interface ModelDef {
  type: ModelType;
  label: string;
  desc: string;
  badge?: string;
  models?: { value: string; label: string }[];
  needKey: boolean;
  needEndpoint: boolean;
  keyPlaceholder?: string;
  docsUrl?: string;
}

export const MODEL_DEFS: ModelDef[] = [
  {
    type: 'wenxin',
    label: '文心 ERNIE 4.5',
    desc: '百度文心大模型，平台内置免费使用',
    badge: '免费',
    needKey: false,
    needEndpoint: false,
  },
  {
    type: 'deepseek',
    label: 'DeepSeek',
    desc: '需填入 DeepSeek API Key',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat（推荐）' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner（R1）' },
    ],
    needKey: true,
    needEndpoint: false,
    keyPlaceholder: 'sk-xxxxxxxxxxxxxxxx',
    docsUrl: 'https://platform.deepseek.com/api-keys',
  },
  {
    type: 'openai',
    label: 'OpenAI',
    desc: '需填入 OpenAI API Key',
    models: [
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini（推荐）' },
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    ],
    needKey: true,
    needEndpoint: false,
    keyPlaceholder: 'sk-xxxxxxxxxxxxxxxx',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    type: 'custom',
    label: '自定义接口',
    desc: '兼容 OpenAI 格式的任意接口',
    needKey: true,
    needEndpoint: true,
    keyPlaceholder: 'Bearer token 或 API Key',
  },
];

// ── 快捷指令 ────────────────────────────────────────────────────────────────────

export const QUICK_PROMPTS = [
  { icon: FolderOpen,      label: '项目结构',   text: '帮我分析一下这个仓库的整体项目结构和技术栈' },
  { icon: BookOpen,        label: '查看 README', text: '请读取并展示 README.md 的内容' },
  { icon: Search,          label: '搜索 TODO',  text: '搜索仓库中所有包含 TODO 注释的代码位置，并列出需要完成的工作' },
  { icon: FileCode2,       label: '代码审查',   text: '请列出根目录文件结构，然后挑选主要源码文件进行代码质量审查，给出改进建议' },
  { icon: Pencil,          label: '优化 README', text: '请读取 README.md，帮我优化内容使其更专业，然后写入更新' },
  { icon: GitBranch,       label: '列出分支',   text: '请列出该仓库所有的分支' },
  { icon: GitCommit,       label: '提交历史',   text: '请展示仓库最近 10 条提交记录，并总结最近的变更方向' },
  { icon: GitMerge,        label: '查看 PR',    text: '请列出该仓库所有 open 状态的 Pull Request' },
  { icon: CircleAlert,     label: '查看 Issues', text: '请列出该仓库所有 open 状态的 Issues，并按优先级分类总结' },
  { icon: Play,            label: '工作流列表', text: '请列出仓库所有 GitHub Actions 工作流文件' },
  { icon: ListChecks,      label: '最近部署',   text: '请查看最近 5 次 GitHub Actions 运行记录，告诉我哪些成功、哪些失败' },
  { icon: BugPlay,         label: '排查失败',   text: '请找出最近一次失败的工作流运行，查看其 Job 列表，下载失败 Job 的日志，分析报错原因并给出修复建议' },
  { icon: LayoutDashboard, label: '查看 Secrets', text: '请列出该仓库配置的 Actions Secrets 名称（不含值），检查是否有缺失的环境变量' },
];

// ── 纯工具函数 ──────────────────────────────────────────────────────────────────

const MODEL_CONFIG_KEY = 'ai_assistant_model_config';

/**
 * 将 API Key 部分掩码显示（隐藏状态）：保留前 4 位 + 后 4 位，中间用 * 替代。
 * 避免使用 type="password" 触发 Android WebView 安全键盘。
 */
export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return key.slice(0, 4) + '*'.repeat(Math.min(key.length - 8, 20)) + key.slice(-4);
}

export function getModelDef(type: ModelType): ModelDef {
  return MODEL_DEFS.find(m => m.type === type) ?? MODEL_DEFS[0];
}

export function loadModelConfig(): ModelConfig {
  try {
    const raw = localStorage.getItem(MODEL_CONFIG_KEY);
    if (raw) return JSON.parse(raw) as ModelConfig;
  } catch { /* ignore */ }
  return { type: 'wenxin' };
}

export function saveModelConfig(cfg: ModelConfig): void {
  localStorage.setItem(MODEL_CONFIG_KEY, JSON.stringify(cfg));
}

export function parseChunk(data: string): string {
  if (data === '[DONE]') return '';
  try {
    return (JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> })
      .choices?.[0]?.delta?.content ?? '';
  } catch {
    return '';
  }
}

// ── Markdown 渲染 ────────────────────────────────────────────────────────────────

/**
 * 渲染 Markdown 为 React 节点。
 * 修复：
 * - 代码块内容用 JSX 文本节点渲染，避免任何编码/转义导致的乱码
 * - 所有文本强制 break-words + whitespace-pre-wrap，防止超出视口
 * - 支持 # / ## / ### 标题、有序/无序列表、粗体、行内代码
 */
export function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const renderInline = (raw: string, baseKey: number): React.ReactNode[] => {
    const segs = raw.split(/(`[^`]*`|\*\*[^*]+\*\*)/g);
    return segs.map((seg, si) => {
      if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4)
        return <strong key={`${baseKey}-b${si}`} className="font-semibold">{seg.slice(2, -2)}</strong>;
      if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2)
        return <code key={`${baseKey}-c${si}`} className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono break-all">{seg.slice(1, -1)}</code>;
      return seg || null;
    });
  };

  while (i < lines.length) {
    const line = lines[i];

    // ── 代码块 ──────────────────────────────────────────────────────
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      const codeText = codeLines.join('\n');
      result.push(
        <div key={key++} className="my-2 rounded-lg border border-border bg-muted overflow-hidden">
          {lang && (
            <div className="flex items-center justify-between px-3 py-1 bg-muted border-b border-border">
              <span className="text-[10px] font-mono text-muted-foreground select-none">{lang}</span>
            </div>
          )}
          <pre className="overflow-x-auto max-w-full p-3 text-[11px] font-mono leading-relaxed">
            <code className="break-normal whitespace-pre">{codeText}</code>
          </pre>
        </div>
      );
      i++; continue;
    }

    // ── 标题 ─────────────────────────────────────────────────────────
    if (line.startsWith('# ')) {
      result.push(<h1 key={key++} className="text-lg font-bold mt-4 mb-1.5 break-words text-balance">{line.slice(2)}</h1>);
      i++; continue;
    }
    if (line.startsWith('## ')) {
      result.push(<h2 key={key++} className="text-base font-semibold mt-3 mb-1 break-words text-balance">{line.slice(3)}</h2>);
      i++; continue;
    }
    if (line.startsWith('### ')) {
      result.push(<h3 key={key++} className="text-sm font-semibold mt-2.5 mb-1 break-words text-balance">{line.slice(4)}</h3>);
      i++; continue;
    }

    // ── 无序列表 ─────────────────────────────────────────────────────
    if (/^[-*+] /.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^[-*+] /.test(lines[i])) {
        listItems.push(lines[i].slice(2));
        i++;
      }
      result.push(
        <ul key={key++} className="my-1.5 space-y-0.5 pl-4">
          {listItems.map((item, li) => (
            <li key={li} className="flex gap-1.5 text-sm break-words">
              <span className="text-primary mt-[3px] shrink-0">•</span>
              <span className="min-w-0 break-words">{renderInline(item, key * 100 + li)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // ── 有序列表 ─────────────────────────────────────────────────────
    if (/^\d+\. /.test(line)) {
      const listItems: Array<{ n: number; text: string }> = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        const m = lines[i].match(/^(\d+)\. (.*)/);
        if (m) listItems.push({ n: parseInt(m[1]), text: m[2] });
        i++;
      }
      result.push(
        <ol key={key++} className="my-1.5 space-y-0.5 pl-4">
          {listItems.map((item, li) => (
            <li key={li} className="flex gap-1.5 text-sm break-words">
              <span className="text-primary shrink-0 font-mono text-xs mt-[3px]">{item.n}.</span>
              <span className="min-w-0 break-words">{renderInline(item.text, key * 100 + li)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // ── 分隔线 ───────────────────────────────────────────────────────
    if (/^---+$/.test(line.trim())) {
      result.push(<hr key={key++} className="my-2 border-border" />);
      i++; continue;
    }

    // ── 空行 ─────────────────────────────────────────────────────────
    if (line.trim() === '') {
      if (result.length > 0) result.push(<div key={key++} className="h-1" />);
      i++; continue;
    }

    // ── 普通段落 ─────────────────────────────────────────────────────
    result.push(
      <p key={key++} className="text-sm leading-relaxed break-words min-w-0 text-pretty">
        {renderInline(line, key)}
      </p>
    );
    i++;
  }
  /* overflow-hidden 在此被移除：内层 pre 的 overflow-x-auto 需要能形成独立滚动上下文，
     外部气泡已用 overflow-x-auto 兜底，根 div 只需约束宽度即可 */
  return <div className="flex flex-col gap-0.5 min-w-0 max-w-full">{result}</div>;
}
