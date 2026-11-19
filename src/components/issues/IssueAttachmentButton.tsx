// Issue 附件按钮：选择图片 / 文件 → 上传到仓库 → 把 Markdown 插回输入框
import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Loader2, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { uploadIssueAttachment } from '@/lib/issueAttachments';
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

  const handleChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length === 0) return;
    setBusy(true);
    let uploaded = 0;
    try {
      for (const file of files) {
        try {
          const markdown = await uploadIssueAttachment({ owner, repo, branch, file });
          onInsert(markdown);
          uploaded += 1;
        } catch (error) {
          toast.error(error instanceof Error ? error.message : i18n.t('上传失败'));
        }
      }
      if (uploaded > 0) toast.success(`${i18n.t('已插入')} ${uploaded} ${i18n.t('个附件')}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

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
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
        {busy ? i18n.t('上传中…') : i18n.t('图片/文件')}
      </Button>
    </>
  );
}
