// Issue 附件按钮：选择图片 / 文件 → 上传到仓库 → 把 Markdown 插回输入框
import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Loader2, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MAX_FILE_SIZE, formatFileSize, uploadIssueAttachment, validateAttachment } from '@/lib/issueAttachments';
import { toast } from 'sonner';
import i18n from '@/i18n';

interface IssueAttachmentButtonProps {
  owner: string;
  repo: string;
  branch?: string;
  disabled?: boolean;
  onInsert: (markdown: string) => void;
}

export default function IssueAttachmentButton({ owner, repo, branch, disabled, onInsert }: IssueAttachmentButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length === 0) return;

    // 先把本地就能判定失败的挑出来，避免用户白等一轮上传
    const accepted = files.filter((file) => {
      const invalid = validateAttachment(file);
      if (invalid) toast.error(`${file.name}：${invalid}`);
      return !invalid;
    });
    if (accepted.length === 0) {
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setBusy(true);
    let uploaded = 0;
    let failed = 0;
    try {
      for (let i = 0; i < accepted.length; i += 1) {
        const file = accepted[i];
        setProgress({ current: i + 1, total: accepted.length });
        try {
          const markdown = await uploadIssueAttachment({ owner, repo, branch, file });
          onInsert(markdown);
          uploaded += 1;
        } catch (error) {
          failed += 1;
          const reason = error instanceof Error ? error.message : i18n.t('上传失败');
          toast.error(`${file.name}：${reason}`);
        }
      }
      if (uploaded > 0 && failed === 0) {
        toast.success(`${i18n.t('已插入')} ${uploaded} ${i18n.t('个附件')}`);
      } else if (uploaded > 0) {
        toast.warning(
          `${i18n.t('已插入')} ${uploaded} ${i18n.t('个附件')}，${failed} ${i18n.t('个失败')}`,
        );
      }
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const label = busy
    ? progress && progress.total > 1
      ? `${i18n.t('上传中')} ${progress.current}/${progress.total}`
      : i18n.t('上传中…')
    : i18n.t('图片/文件');

  return (
    <>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={handleChange} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 text-xs border border-border text-muted-foreground hover:bg-secondary gap-1 shrink-0"
        disabled={busy || disabled || !owner || !repo}
        onClick={() => inputRef.current?.click()}
        title={`${i18n.t('附件会上传到仓库并插入 Markdown')} (≤ ${formatFileSize(MAX_FILE_SIZE)})`}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
        {label}
      </Button>
    </>
  );
}
