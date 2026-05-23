/**
 * ExecutionBlock — 将一组连续的 step/tool/thinking 气泡包裹进
 * 可折叠的"执行详情"卡片，避免日志淹没主聊天区。
 *
 * 行为：
 * - 流式进行中 → 自动展开，展示实时进度
 * - 流式完成后 → 延迟 600ms 自动折叠，只显示摘要行
 * - 用户可随时手动点击标题行展开/折叠
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  XCircle,
  Cpu,
  Wrench,
  Brain,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Message } from './aiTypes';

// ── 每种气泡类型对应的小图标，用于折叠摘要行 ─────────────────────────────────
function BubbleIcon({ type, className }: { type: Message['bubbleType']; className?: string }) {
  if (type === 'thinking') return <Brain className={cn('w-3 h-3 text-muted-foreground/60', className)} />;
  if (type === 'tool') return <Wrench className={cn('w-3 h-3 text-muted-foreground/60', className)} />;
  return <Cpu className={cn('w-3 h-3 text-muted-foreground/60', className)} />;
}

// ── ToolRow：内嵌工具行（折叠视图里的 mini 工具展示） ────────────────────────
function ToolRow({ msg }: { msg: Message }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = msg.toolStatus === 'running';
  const isFail = msg.toolStatus === 'fail';
  const isSuccess = msg.toolStatus === 'success';
  const result = msg.toolResult ?? '';
  const canExpand = result.length > 80;

  return (
    <div className="flex gap-2 items-start">
      {/* 竖线连接 */}
      <div className="w-px self-stretch bg-border/25 mx-2 mt-1 shrink-0" />
      <div className="flex-1 min-w-0">
        <button
          onClick={() => canExpand && setExpanded(v => !v)}
          disabled={!canExpand}
          className={cn(
            'flex items-center gap-2 w-full text-left rounded-lg px-3 py-1.5 border text-xs transition-colors',
            isRunning
              ? 'bg-muted/30 border-border/40'
              : isFail
                ? 'bg-destructive/5 border-destructive/20'
                : 'bg-muted/20 border-border/30 hover:bg-muted/40',
            canExpand && !isRunning ? 'cursor-pointer' : 'cursor-default',
          )}
        >
          {isRunning && <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />}
          {isSuccess && <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />}
          {isFail && <XCircle className="w-3 h-3 text-destructive shrink-0" />}
          <span className={cn(
            'font-medium truncate flex-1',
            isRunning ? 'text-foreground/80' : isFail ? 'text-destructive' : 'text-foreground/70',
          )}>
            {msg.toolLabel || msg.toolName || '工具调用'}
          </span>
          {msg.toolHint && (
            <span className="text-muted-foreground/50 truncate max-w-[100px] hidden sm:block text-[11px]">
              {msg.toolHint}
            </span>
          )}
          {msg.toolElapsedMs != null && (
            <span className={cn(
              'font-mono shrink-0',
              isFail ? 'text-destructive/70' : 'text-muted-foreground/50',
            )}>
              {msg.toolElapsedMs < 1000
                ? `${msg.toolElapsedMs}ms`
                : `${(msg.toolElapsedMs / 1000).toFixed(1)}s`}
            </span>
          )}
          {canExpand && !isRunning && (
            expanded
              ? <ChevronDown className="w-3 h-3 text-muted-foreground/50 shrink-0" />
              : <ChevronRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
          )}
        </button>
        {expanded && result && (
          <div className="mt-1 rounded-lg border border-border/40 bg-muted/10 px-3 py-2 max-h-[180px] overflow-y-auto scrollbar-thin">
            <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap break-words leading-relaxed font-mono">
              {result}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ThinkingRow：内嵌思考行 ────────────────────────────────────────────────
function ThinkingRow({ msg }: { msg: Message }) {
  const content = msg.thinkingContent ?? '';
  const done = msg.thinkingDone ?? false;
  const isThinking = !done && msg.streaming === true;
  const [expanded, setExpanded] = useState(false);
  const preview = content.replace(/\s+/g, ' ').trim().slice(0, 40);

  return (
    <div className="flex gap-2 items-start pl-2">
      <div className="w-px self-stretch bg-primary/20 mx-2 mt-1 shrink-0" />
      <div className="flex-1 min-w-0">
        <button
          onClick={() => content && setExpanded(v => !v)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors py-0.5 w-full text-left"
        >
          {isThinking
            ? <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />
            : <CheckCircle2 className="w-3 h-3 text-primary/50 shrink-0" />}
          <span className={cn('font-medium shrink-0', isThinking ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
            {isThinking ? '思考中…' : '思考完成'}
          </span>
          {!expanded && preview && (
            <span className="text-muted-foreground/40 truncate flex-1 italic hidden sm:block">
              {preview}{content.length > 40 ? '…' : ''}
            </span>
          )}
          {content && (
            <span className="ml-auto shrink-0 text-muted-foreground/40">
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </span>
          )}
        </button>
        {expanded && content && (
          <div className={cn(
            'mt-1 rounded-lg border px-3 py-2 max-h-[160px] overflow-y-auto scrollbar-thin',
            isThinking ? 'bg-primary/5 border-primary/15' : 'bg-muted/10 border-border/30',
          )}>
            <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap italic break-words">
              {content}
              {isThinking && <span className="inline-block w-1 h-3 ml-1 bg-primary/50 animate-pulse align-middle rounded-sm" />}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── StepRow：内嵌步骤行（含 tool 子行） ──────────────────────────────────────
function StepRow({ msg, toolMsgs }: { msg: Message; toolMsgs: Message[] }) {
  const stepDone = !msg.streaming;
  return (
    <div className="flex flex-col gap-1">
      {/* 步骤标题行 */}
      <div className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-1.5 border text-xs',
        msg.streaming ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-border/40',
      )}>
        {msg.streaming
          ? <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />
          : <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />}
        <span className={cn(
          'font-medium truncate flex-1',
          msg.streaming ? 'text-primary' : 'text-foreground/70',
        )}>
          {msg.stepTitle ?? '执行步骤'}
        </span>
        {msg.streaming && <span className="text-[10px] text-primary/70 shrink-0 animate-pulse">进行中…</span>}
        {stepDone && <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />}
      </div>
      {/* 工具子行 */}
      {toolMsgs.map(t => <ToolRow key={t.id} msg={t} />)}
    </div>
  );
}

// ── ExecutionBlock 主体 ───────────────────────────────────────────────────────
export interface ExecutionBlockProps {
  /** 属于同一执行块的消息（step / tool / thinking） */
  msgs: Message[];
  /** 最终状态：是否仍在流式中 */
  streaming: boolean;
}

export default function ExecutionBlock({ msgs, streaming }: ExecutionBlockProps) {
  const hasError = msgs.some(m => m.toolStatus === 'fail');

  // 流式中默认展开；完成后 600ms 自动折叠
  const [expanded, setExpanded] = useState(streaming);
  const prevStreamingRef = useRef(streaming);

  useEffect(() => {
    if (streaming && !expanded) setExpanded(true); // 新事件到来 → 展开
    if (prevStreamingRef.current && !streaming) {
      prevStreamingRef.current = false;
      const t = setTimeout(() => setExpanded(false), 600);
      return () => clearTimeout(t);
    }
    prevStreamingRef.current = streaming;
  }, [streaming, expanded]);

  // ── 摘要行文本 ────────────────────────────────────────────────────────────
  const stepCount = msgs.filter(m => m.bubbleType === 'step').length;
  const toolCount = msgs.filter(m => m.bubbleType === 'tool').length;
  const hasThinking = msgs.some(m => m.bubbleType === 'thinking');

  const summaryParts: string[] = [];
  if (stepCount > 0) summaryParts.push(`${stepCount} 步`);
  if (toolCount > 0) summaryParts.push(`${toolCount} 个工具`);
  if (hasThinking) summaryParts.push('思考');
  const summary = summaryParts.join(' · ');

  // ── 构建渲染树：step 与其紧跟的 tool 绑定在一起 ─────────────────────────
  type RenderItem =
    | { kind: 'step'; msg: Message; tools: Message[] }
    | { kind: 'thinking'; msg: Message }
    | { kind: 'orphan-tool'; msg: Message };

  const items: RenderItem[] = [];
  let i = 0;
  while (i < msgs.length) {
    const m = msgs[i];
    if (m.bubbleType === 'step') {
      const tools: Message[] = [];
      let j = i + 1;
      while (j < msgs.length && msgs[j].bubbleType === 'tool') {
        tools.push(msgs[j]);
        j++;
      }
      items.push({ kind: 'step', msg: m, tools });
      i = j;
    } else if (m.bubbleType === 'thinking') {
      items.push({ kind: 'thinking', msg: m });
      i++;
    } else {
      // tool 出现在 step 前（孤立）
      items.push({ kind: 'orphan-tool', msg: m });
      i++;
    }
  }

  return (
    <div className="flex gap-2.5 flex-row">
      {/* 左侧时间轴 */}
      <div className="flex flex-col items-center shrink-0 mt-1">
        <div className={cn(
          'w-6 h-6 rounded-full flex items-center justify-center border transition-colors',
          streaming
            ? 'bg-primary/10 border-primary/30'
            : hasError
              ? 'bg-destructive/10 border-destructive/30'
              : 'bg-green-500/10 border-green-500/30',
        )}>
          {streaming
            ? <Loader2 className="w-3 h-3 text-primary animate-spin" />
            : hasError
              ? <XCircle className="w-3 h-3 text-destructive" />
              : <CheckCircle2 className="w-3 h-3 text-green-500" />}
        </div>
        <div className="w-px flex-1 min-h-[8px] bg-border/40 mt-1" />
      </div>

      {/* 卡片主体 */}
      <div className="flex-1 min-w-0">
        {/* 标题/折叠行 */}
        <button
          onClick={() => setExpanded(v => !v)}
          className={cn(
            'flex items-center gap-2 w-full rounded-xl px-3 py-2 border text-sm text-left transition-colors',
            streaming
              ? 'bg-primary/5 border-primary/20 hover:bg-primary/8'
              : 'bg-muted/40 border-border/50 hover:bg-muted/60',
          )}
        >
          {/* 类型图标 mini 组 */}
          <div className="flex items-center gap-0.5 shrink-0">
            {hasThinking && <BubbleIcon type="thinking" />}
            {stepCount > 0 && <BubbleIcon type="step" />}
            {toolCount > 0 && <BubbleIcon type="tool" />}
          </div>

          <span className={cn(
            'font-medium text-xs flex-1 truncate',
            streaming ? 'text-primary' : 'text-foreground/70',
          )}>
            {streaming ? '执行中…' : hasError ? '执行出错' : '执行完成'}
          </span>

          {/* 摘要标签 */}
          {!expanded && summary && (
            <span className="text-[10px] text-muted-foreground/50 shrink-0 hidden sm:block">
              {summary}
            </span>
          )}

          {streaming && (
            <span className="text-[10px] text-primary/70 shrink-0 animate-pulse">进行中…</span>
          )}

          {/* 展开/折叠箭头 */}
          <span className="text-muted-foreground/40 shrink-0">
            {expanded
              ? <ChevronDown className="w-3.5 h-3.5" />
              : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
        </button>

        {/* 展开详情 */}
        {expanded && (
          <div className="mt-1.5 flex flex-col gap-1.5 pl-1">
            {items.map((item, idx) => {
              if (item.kind === 'thinking') return <ThinkingRow key={item.msg.id} msg={item.msg} />;
              if (item.kind === 'step') return <StepRow key={item.msg.id} msg={item.msg} toolMsgs={item.tools} />;
              return <ToolRow key={item.msg.id + idx} msg={item.msg} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
