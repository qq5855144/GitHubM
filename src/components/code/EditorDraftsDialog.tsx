import { useState } from 'react';
import { FileCode2, Files, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { confirmAction } from '@/components/ui/confirm-dialog';
import { clearEditorDraft, editorDraftKey, listEditorDrafts, type EditorDraft } from '@/lib/editorDraft';
import i18n from '@/i18n';

export function EditorDraftsDialog({ owner, onResume }: {
  owner: string;
  onResume: (draft: EditorDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<EditorDraft[]>([]);
  const title = i18n.t('草稿列表');

  const removeDraft = async (draft: EditorDraft) => {
    const confirmed = await confirmAction({
      title: i18n.t('删除草稿'),
      description: `${draft.owner}/${draft.repo} · ${draft.branch} · ${draft.path}`,
    });
    if (!confirmed) return;
    if (clearEditorDraft(draft.owner, draft.repo, draft.branch, draft.path)) {
      setDrafts(listEditorDrafts(owner));
    } else {
      toast.error(i18n.t('无法删除本地草稿'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => {
      if (next) setDrafts(listEditorDrafts(owner));
      setOpen(next);
    }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground"
          aria-label={title} title={title}>
          <Files aria-hidden="true" />
          <span>{title}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] max-w-[calc(100%-1.5rem)] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {drafts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{i18n.t('暂无代码草稿')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {drafts.map(draft => (
              <li key={editorDraftKey(draft.owner, draft.repo, draft.branch, draft.path)} className="flex items-center gap-1">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-3 text-left hover:bg-muted"
                  onClick={() => { setOpen(false); onResume(draft); }}>
                  <FileCode2 aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block truncate text-sm font-medium" title={draft.path}>{draft.path}</span>
                    <span className="block truncate text-xs text-muted-foreground">{draft.owner}/{draft.repo} · {draft.branch}</span>
                    <time dateTime={draft.savedAt} className="block text-xs text-muted-foreground">
                      {new Date(draft.savedAt).toLocaleString(i18n.resolvedLanguage)}
                    </time>
                  </span>
                </button>
                <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`${i18n.t('删除草稿')} ${draft.path}`} title={i18n.t('删除草稿')} onClick={() => void removeDraft(draft)}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
