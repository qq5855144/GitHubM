// AI 助手 — 执行过程：DeepSeek 风格的折叠行，默认只显示一行摘要
import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Eye, Loader2, XCircle } from 'lucide-react';
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
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <StatusIcon status={tool.status} />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
          {toolCallLabel({ id: tool.id, name: tool.name, arguments: tool.arguments })}
        </span>
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
            <p className="mb-1 text-[10px] text-muted-foreground">{i18n.t('结果')}</p>
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
  if (!tools.length) return null;

  const running = tools.find(tool => tool.status === 'running');
  const failed = tools.filter(tool => tool.status === 'error').length;
  const activeLabel = running
    ? toolCallLabel({ id: running.id, name: running.name, arguments: running.arguments })
    : '';

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
            : `${i18n.t('执行过程')} · ${i18n.t('{{count}} 次调用', { count: tools.length })}`}
        </span>
        {failed > 0 && (
          <span className="shrink-0 text-[11px] text-destructive">{i18n.t('失败 {{count}}', { count: failed })}</span>
        )}
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
      </button>

      {open && (
        <div className="mt-1.5 border-l-2 border-border/70 pl-3">
          {tools.map(tool => (
            <StepRow key={tool.id} tool={tool} onOpenArtifact={onOpenArtifact} />
          ))}
        </div>
      )}
    </div>
  );
}