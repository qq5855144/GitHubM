// 任务工作流面板：展示 AI 任务规划的步骤列表及实时执行状态
import React from 'react';
import {
  ListChecks, CheckCircle2, XCircle, Clock,
  Loader2, Circle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskPlanStep } from './aiTypes';
import i18n from "@/i18n";

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface TaskPlanPanelProps {
  steps: TaskPlanStep[];
  stepStatuses: Record<string, StepStatus>;
  stepRetryCounts: Record<string, number>;
  currentStepId: string | null;
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'running') return <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />;
  if (status === 'done') return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
  if (status === 'error') return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
  return <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />;
}

export function TaskPlanPanel({ steps, stepStatuses, stepRetryCounts, currentStepId }: TaskPlanPanelProps) {
  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
        <div className="bg-muted/50 p-4 rounded-full mb-4">
          <ListChecks className="w-8 h-8 opacity-20" />
        </div>
        <p className="text-sm">{i18n.t('暂无任务计划')}</p>
        <p className="text-[10px] mt-1 opacity-60">{i18n.t('发送任务后 AI 将自动制定执行步骤')}</p>
      </div>
    );
  }

  const doneCount = Object.values(stepStatuses).filter(s => s === 'done').length;
  const progress = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;

  return (
    <div className="flex flex-col h-full bg-background border-l">
      {/* 面板头部 */}
      <div className="p-4 border-b bg-muted/20">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
            <ListChecks className="w-3.5 h-3.5" />
            {i18n.t('任务工作流')}</h3>
          <span className="text-[10px] text-muted-foreground font-mono">
            {doneCount}/{steps.length}
          </span>
        </div>
        {/* 进度条 */}
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 步骤列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1 scrollbar-thin">
        {steps.map((step, idx) => {
          const status: StepStatus = stepStatuses[step.id] ?? 'pending';
          const isActive = step.id === currentStepId;
          const retryCount = stepRetryCounts[step.id] ?? 0;

          return (
            <div key={step.id} className="relative">
              {/* 竖线连接器（不含最后一项） */}
              {idx < steps.length - 1 && (
                <div className="absolute left-[18px] top-[30px] w-[1px] h-[calc(100%-4px)] bg-border" />
              )}

              <div
                className={cn(
                  "relative flex items-start gap-3 p-2.5 rounded-lg transition-colors",
                  isActive && "bg-primary/5 ring-1 ring-primary/20",
                  status === 'done' && "opacity-70",
                )}
              >
                {/* 图标（带背景圆，保证与连接线对齐） */}
                <div className={cn(
                  "mt-0.5 w-6 h-6 rounded-full border flex items-center justify-center shrink-0 bg-background z-10",
                  status === 'running' && "border-primary",
                  status === 'done' && "border-green-500/50",
                  status === 'error' && "border-red-500/50",
                  status === 'pending' && "border-border",
                )}>
                  <StepIcon status={status} />
                </div>

                {/* 步骤内容 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span className={cn(
                      "text-xs font-medium leading-tight truncate",
                      isActive && "text-primary",
                      status === 'done' && "line-through text-muted-foreground",
                    )}>
                      {step.title}
                    </span>
                    {/* 状态标签 */}
                    {status === 'running' && retryCount === 0 && (
                      <span className="ml-auto shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-wide">
                        {i18n.t('执行中')}</span>
                    )}
                    {status === 'running' && retryCount > 0 && (
                      <span className="ml-auto shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 uppercase tracking-wide">
                        {i18n.t('重试')}{retryCount}/2
                      </span>
                    )}
                    {status === 'error' && (
                      <span className="ml-auto shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 uppercase tracking-wide">
                        {i18n.t('失败')}{retryCount > 0 ? `(已重试${retryCount}次)` : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed line-clamp-2 break-words">
                    {step.desc}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
