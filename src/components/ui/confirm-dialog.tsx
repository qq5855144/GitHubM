// 全局确认弹窗：替代原生 window.confirm，支持异步 await
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import i18n from '@/i18n';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  /** 默认 true：红色危险操作样式 */
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

let pushConfirm: ((pending: PendingConfirm) => void) | null = null;

/** 用法：if (!(await confirmAction({ title: '…' }))) return; */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    if (!pushConfirm) {
      // 极端兜底：宿主未挂载时退回原生确认
      resolve(window.confirm(options.description || options.title));
      return;
    }
    pushConfirm({ ...options, resolve });
  });
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  useEffect(() => {
    pushConfirm = next => setPending(next);
    return () => {
      pushConfirm = null;
    };
  }, []);

  const close = (value: boolean) => {
    setPending(current => {
      current?.resolve(value);
      return null;
    });
  };

  const destructive = pending?.destructive !== false;

  return (
    <Dialog open={Boolean(pending)} onOpenChange={open => { if (!open) close(false); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-2xl p-0 md:max-w-sm [&>button]:hidden">
        <div className="px-5 pb-5 pt-6 text-center">
          <DialogTitle className="text-[15px] font-semibold leading-6 break-words">
            {pending?.title}
          </DialogTitle>
          {pending?.description && (
            <DialogDescription className="mt-1.5 text-xs leading-relaxed text-muted-foreground break-words">
              {pending.description}
            </DialogDescription>
          )}
        </div>
        <DialogFooter className="flex-row gap-2 border-t border-border/60 bg-muted/20 px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 flex-1 rounded-lg text-xs"
            onClick={() => close(false)}
          >
            {pending?.cancelText || i18n.t('取消')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={destructive ? 'destructive' : 'default'}
            className="h-9 flex-1 rounded-lg text-xs"
            onClick={() => close(true)}
          >
            {pending?.confirmText || i18n.t('删除')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
