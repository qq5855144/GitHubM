// 流式响应性能指标条
// 在每次 AI 回答完成后显示 TTFT、流速、事件总数等调试信息
import React from 'react';
import { Gauge, Timer, Hash, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StreamMetrics } from './aiTypes';

interface StreamMetricsBarProps {
  metrics: Partial<StreamMetrics>;
  className?: string;
}

function fmt(n: number, unit: string) {
  return `${n.toLocaleString()}${unit}`;
}

const StreamMetricsBar = React.memo(function StreamMetricsBar({ metrics, className }: StreamMetricsBarProps) {
  const { ttft, throughput, totalSeq, interruptReason } = metrics;

  // 仅在有至少一个有效指标时渲染
  if (!ttft && !throughput && !totalSeq) return null;

  const items: { icon: React.ElementType; label: string; value: string; title: string }[] = [];

  if (ttft !== undefined) {
    items.push({
      icon: Timer,
      label: '首字节',
      value: ttft < 1000 ? fmt(ttft, 'ms') : `${(ttft / 1000).toFixed(1)}s`,
      title: 'Time To First Token（从发送请求到收到第一个字符的延迟）',
    });
  }

  if (throughput !== undefined && throughput > 0) {
    items.push({
      icon: Gauge,
      label: '流速',
      value: fmt(throughput, ' c/s'),
      title: '近似字符流速（字符/秒），反映模型输出速率',
    });
  }

  if (totalSeq !== undefined && totalSeq > 0) {
    items.push({
      icon: Hash,
      label: '事件',
      value: fmt(totalSeq, ''),
      title: '本次流式对话收到的 SSE 事件总数（含 heartbeat）',
    });
  }

  const isError = interruptReason === 'network_error' || interruptReason === 'server_error';

  return (
    <div
      className={cn(
        'flex items-center gap-3 flex-wrap px-2 py-1 rounded-md',
        'bg-muted/40 border border-border/40',
        className,
      )}
      role="status"
      aria-label="流式响应指标"
    >
      {isError && (
        <div className="flex items-center gap-1 text-destructive">
          <Wifi className="w-3 h-3 shrink-0" />
          <span className="text-[10px]">连接中断</span>
        </div>
      )}
      {items.map(({ icon: Icon, label, value, title }) => (
        <div
          key={label}
          className="flex items-center gap-1 text-muted-foreground"
          title={title}
        >
          <Icon className="w-3 h-3 shrink-0" />
          <span className="text-[10px] tabular-nums">
            <span className="text-muted-foreground/60">{label} </span>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
});

export default StreamMetricsBar;
