// 新建分支对话框：memo 优化
import { memo, useState, useEffect } from 'react';
import { GitBranch, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import i18n from "@/i18n";

interface CreateBranchDialogProps {
  open: boolean;
  onClose: () => void;
  branches: string[];
  currentBranch: string;
  onCreated: (name: string, from: string) => void;
}

const CreateBranchDialog = memo(function CreateBranchDialog({
  open,
  onClose,
  branches,
  currentBranch,
  onCreated,
}: CreateBranchDialogProps) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState(currentBranch);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setFrom(currentBranch);
    }
  }, [open, currentBranch]);

  const handleCreate = async () => {
    const trimmed = name.trim().replace(/\s+/g, '-');
    if (!trimmed) { toast.error(i18n.t('请填写分支名称')); return; }
    if (branches.includes(trimmed)) { toast.error(i18n.t('该分支已存在')); return; }
    setLoading(true);
    try {
      onCreated(trimmed, from);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            {i18n.t('新建分支')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-1">
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-normal">{i18n.t('分支名称')}</Label>
            <Input
              className="px-3 font-mono text-sm"
              placeholder="feature/my-feature"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-sm font-normal">{i18n.t('从分支创建')}</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger className="px-3"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-40">
                {branches.map(b => (
                  <SelectItem key={b} value={b}>
                    <span className="font-mono text-xs">{b}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={onClose} disabled={loading}>{i18n.t('取消')}</Button>
            <Button
              onClick={handleCreate}
              disabled={loading || !name.trim()}
              className="gap-1.5"
            >
              {loading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Plus className="w-3.5 h-3.5" />}
              {i18n.t('创建分支')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

export default CreateBranchDialog;
