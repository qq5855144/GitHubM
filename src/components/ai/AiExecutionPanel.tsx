// AI 助手 — 执行过程：折叠摘要 + 步骤时间线 + 失败筛选 + 复制记录
import { useMemo, useState } from 'react';
import { Check, CheckCircle2, ChevronDown, ChevronRight, Copy, Eye, Loader2, XCircle } from 'lucide-react';
import i18n from '@/i18n';
import { toolCallLabel } from '@/ai-v2/agent';
import type { ArtifactMeta, UiToolRun } from '@/ai-v2/types';

function stepDuration(tool: UiToolRun): string {
  if (!tool.startedAt) return '';
  const end = tool.endedAt ?? Date.now();
  return `${Math.max(0.1, (end - tool.startedAt) / 1000).toFixed(1)}s`;
}

function StatusIcon({ status }: { status: UiToolRun['status'] }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />;
  if (status === 'done') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />;
  return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
}

function StepRow({ tool, onOpenArtifact }: {
  tool: UiToolRun;
  onOpenArtifact: (meta: ArtifactMeta) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const duration = stepDuration(tool);
  const label = toolCallLabel({ id: tool.id, name: tool.name, arguments: tool.arguments });

  const copyResult = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(tool.content || '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 忽略
    }
  };

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <StatusIcon status={tool.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{label}</span>
        {duration && <span className="shrink-0 text-[10px] text-muted-foreground/70">{duration}</span>}
        {open
          ? <ChevronDown className="h-3 w-3 shrink-0" />
          : <ChevronRight className="h-3 w-3 shrink-0" />}
      </button>

      {open && (
        <div className="my-1 space-y-2 rounded-lg bg-muted/40 p-2">
          <div>
            <p className="mb-1 text-[10px] text-muted-foreground">{i18n.t('参数')}</p>
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/70 p-2 text-[10px] font-mono">
              {tool.arguments || '{}'}
            </pre>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">{i18n.t('结果')}</p>
              <button
                type="button"
                onClick={copyResult}
                className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              >
                {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                {copied ? i18n.t('已复制') : i18n.t('复制')}
              </button>
            </div>
            {tool.status === 'running' ? (
              <p className="text-xs text-muted-foreground">{i18n.t('正在执行…')}</p>
            ) : (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-2 text-[10px] font-mono">
                {tool.content || i18n.t('无输出')}
              </pre>
            )}
            {tool.artifact && (
              <button
                type="button"
                onClick={() => onOpenArtifact(tool.artifact!)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-background/70 px-2 py-1 text-[10px] text-primary hover:bg-background"
              >
                <Eye className="h-3 w-3" />
                {i18n.t('查看完整结果')} · {tool.artifact.size.toLocaleString()} {i18n.t('字符')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AiExecutionPanel({ tools, onOpenArtifact }: {
  tools: UiToolRun[];
  onOpenArtifact: (meta: ArtifactMeta) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'failed'>('all');
  const [copied, setCopied] = useState(false);

  const failed = useMemo(() => tools.filter(tool => tool.status === 'error'), [tools]);
  const shown = filter === 'failed' ? failed : tools;
  const running = tools.find(tool => tool.status === 'running');
  if (!tools.length) return null;

  const startedAt = Math.min(...tools.map(tool => tool.startedAt || Date.now()));
  const endedAt = Math.max(...tools.map(tool => tool.endedAt || Date.now()));
  const total = `${Math.max(0.1, (endedAt - startedAt) / 1000).toFixed(1)}s`;
  const activeLabel = running
    ? toolCallLabel({ id: running.id, name: running.name, arguments: running.arguments })
    : '';

  const copyTranscript = async () => {
    const text = tools.map(tool => {
      const label = toolCallLabel({ id: tool.id, name: tool.name, arguments: tool.arguments });
      const status = tool.status === 'done' ? i18n.t('完成') : tool.status === 'error' ? i18n.t('失败') : i18n.t('执行中');
      return `[${status}] ${label} ${stepDuration(tool)}\n${tool.content || ''}`.trim();
    }).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 忽略
    }
  };

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="inline-flex max-w-full items-center gap-1.5 py-0.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <span className="shrink-0 text-[11px]">⚙</span>
        )}
        <span className="min-w-0 truncate">
          {running
            ? `${i18n.t('正在调用')} ${activeLabel}`
            : `${i18n.t('执行过程')} · ${i18n.t('{{count}} 次调用', { count: tools.length })} · ${total}`}
        </span>
        {failed.length > 0 && (
          <span className="shrink-0 text-[11px] text-destructive">{i18n.t('失败 {{count}}', { count: failed.length })}</span>
        )}
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
      </button>

      {open && (
        <div className="mt-1.5 border-l-2 border-border/70 pl-3">
          <div className="mb-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`rounded-full px-2 py-0.5 text-[10px] ${filter === 'all' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {i18n.t('全部 {{count}}', { count: tools.length })}
            </button>
            <button
              type="button"
              onClick={() => setFilter('failed')}
              className={`rounded-full px-2 py-0.5 text-[10px] ${filter === 'failed' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {i18n.t('失败 {{count}}', { count: failed.length })}
            </button>
            <button
              type="button"
              onClick={copyTranscript}
              className="ml-auto flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
              {copied ? i18n.t('已复制') : i18n.t('复制记录')}
            </button>
          </div>

          {shown.length === 0 ? (
            <p className="py-1 text-[11px] text-muted-foreground">{i18n.t('没有失败的步骤')}</p>
          ) : (
            shown.map(tool => (
              <StepRow key={tool.id} tool={tool} onOpenArtifact={onOpenArtifact} />
            ))
          )}
        </div>
      )}
    </div>
  );
}