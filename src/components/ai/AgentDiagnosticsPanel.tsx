// Agent 运行诊断面板：展示最近 AI 助手运行轨迹，便于定位卡住/重复调用/工具失败。
import { useState } from 'react';
import { Activity, ClipboardCopy, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  clearAgentTraces,
  formatAgentTrace,
  getAgentTraces,
  type AgentTrace,
} from '@/lib/agent/runTrace';
import { toast } from 'sonner';
import i18n from '@/i18n';

const STATUS_STYLE: Record<AgentTrace['status'], string> = {
  running: 'text-warning border-warning/30 bg-warning/10',
  success: 'text-success border-success/30 bg-success/10',
  error: 'text-destructive border-destructive/30 bg-destructive/10',
  aborted: 'text-muted-foreground border-border bg-secondary',
};

export default function AgentDiagnosticsPanel() {
  const [traces, setTraces] = useState<AgentTrace[]>(() => getAgentTraces());

  const refresh = () => setTraces(getAgentTraces());

  const copyTrace = async (trace: AgentTrace) => {
    try {
      await navigator.clipboard.writeText(formatAgentTrace(trace));
      toast.success(i18n.t('诊断信息已复制'));
    } catch {
      toast.error(i18n.t('复制失败'));
    }
  };

  const clear = () => {
    clearAgentTraces();
    setTraces([]);
    toast.success(i18n.t('运行记录已清除'));
  };

  return (
    <div className="border-t border-border/60 pt-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" />
          {i18n.t('Agent 运行诊断')}
        </p>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={refresh}>
            <RefreshCw className="w-3 h-3 mr-1" />
            {i18n.t('刷新')}
          </Button>
          {traces.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={clear}
            >
              <Trash2 className="w-3 h-3 mr-1" />
              {i18n.t('清除')}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        {i18n.t('最近 20 次 AI 任务的本机执行轨迹（模型、工具、耗时、错误），不会上传。')}
      </p>

      {traces.length === 0 ? (
        <p className="text-xs text-muted-foreground py-3 text-center">
          {i18n.t('暂无运行记录，使用 AI 助手后自动生成')}
        </p>
      ) : (
        <div className="space-y-2">
          {traces.slice(0, 5).map((trace) => {
            const toolEvents = trace.events.filter((e) => e.type === 'tool_end');
            const failCount = toolEvents.filter((e) => e.data?.status === 'fail').length;
            const duration = trace.endedAt ? trace.endedAt - trace.startedAt : Date.now() - trace.startedAt;
            return (
              <div key={trace.id} className="border border-border rounded-lg p-2.5 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] ${STATUS_STYLE[trace.status]}`}>
                    {trace.status}
                  </span>
                  <span className="font-mono text-muted-foreground truncate max-w-[140px]">{trace.id}</span>
                  <span className="text-muted-foreground truncate">{trace.model || '-'}</span>
                  <span className="text-muted-foreground truncate">{trace.repo || '-'}</span>
                  <span className="ml-auto text-muted-foreground shrink-0">
                    {toolEvents.length} tools{failCount > 0 ? ` · ${failCount} fail` : ''} · {(duration / 1000).toFixed(1)}s
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-6 h-6 text-muted-foreground"
                    title={i18n.t('复制诊断信息')}
                    onClick={() => copyTrace(trace)}
                  >
                    <ClipboardCopy className="w-3 h-3" />
                  </Button>
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {new Date(trace.startedAt).toLocaleString('zh-CN')}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}