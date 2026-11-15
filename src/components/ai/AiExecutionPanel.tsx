// AI 助手 — 执行过程面板：把连续的工具调用收进一条可折叠时间线
import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Eye, Loader2, Wrench, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  const duration = stepDuration(tool);

  return (
    <div className="relative">
      <span className="absolute -left-[13px] top-3 h-1.5 w-1.5 rounded-full bg-primary/50" />
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs transition-colors hover:bg-muted/40"
      >
        <StatusIcon status={tool.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
          {toolCallLabel({ id: tool.id, name: tool.name, arguments: tool.arguments })}
        </span>
        {duration && <span className="shrink-0 text-[10px] text-muted-foreground">{duration}</span>}
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <div className="mb-1 ml-5 space-y-2 rounded-lg border border-border/60 bg-background/60 p-2">
          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">{i18n.t('参数')}</p>
            <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 text-[10px] font-mono">
              {tool.arguments || '{}'}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">{i18n.t('结果')}</p>
            {tool.status === 'running' ? (
              <p className="text-xs text-muted-foreground">{i18n.t('正在执行…')}</p>
            ) : (
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-[10px] font-mono">
                {tool.content || i18n.t('无输出')}
              </pre>
            )}
            {tool.artifact && (
              <button
                type="button"
                onClick={() => onOpenArtifact(tool.artifact!)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/25 bg-primary/5 px-2 py-1 text-[10px] text-primary hover:bg-primary/10"
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
  if (!tools.length) return null;

  const running = tools.find(tool => tool.status === 'running');
  const failed = tools.filter(tool => tool.status === 'error').length;
  const startedAt = Math.min(...tools.map(tool => tool.startedAt || Date.now()));
  const endedAt = Math.max(...tools.map(tool => tool.endedAt || Date.now()));
  const total = `${Math.max(0.1, (endedAt - startedAt) / 1000).toFixed(1)}s`;
  const activeLabel = running
    ? toolCallLabel({ id: running.id, name: running.name, arguments: running.arguments })
    : '';

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        <Wrench className={cn('h-3.5 w-3.5 shrink-0', running ? 'text-primary' : 'text-muted-foreground')} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
          {running ? `${i18n.t('正在执行')} · ${activeLabel}` : i18n.t('执行详情')}
        </span>
        {failed > 0 && (
          <span className="shrink-0 text-[10px] text-destructive">{i18n.t('失败 {{count}}', { count: failed })}</span>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {i18n.t('{{count}} 次调用', { count: tools.length })} · {total}
        </span>
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </button>

      {open && (
        <div className="relative ml-4 border-t border-border/60 py-2 pl-3 pr-2">
          <span className="absolute bottom-3 left-[9px] top-3 w-px bg-border" />
          {tools.map(tool => (
            <StepRow key={tool.id} tool={tool} onOpenArtifact={onOpenArtifact} />
          ))}
        </div>
      )}
    </div>
  );
}