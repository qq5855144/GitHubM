// 新建 Pull Request 页面

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, GitPullRequest, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createPullRequest, getAllBranches, getRepo } from '@/services/github';
import { pageCache } from '@/lib/page-cache';
import { toast } from 'sonner';
import i18n from '@/i18n';

export default function NewPullPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [branches, setBranches] = useState<string[]>([]);
  const [branchQuery, setBranchQuery] = useState('');
  const [head, setHead] = useState('');
  const [base, setBase] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!owner || !repo) return;
    let cancelled = false;
    setLoadingBranches(true);
    Promise.all([
      getRepo(owner, repo),
      getAllBranches(owner, repo),
    ]).then(([repoInfo, branchResult]) => {
      if (cancelled) return;
      const names = branchResult.map((branch) => branch.name);
      if (!names.includes(repoInfo.default_branch)) names.unshift(repoInfo.default_branch);
      setBranches(names);
      setBase(repoInfo.default_branch);
      setHead(names.find((name) => name !== repoInfo.default_branch) || '');
    }).catch((err) => {
      if (!cancelled) toast.error(err instanceof Error ? err.message : i18n.t('加载分支失败'));
    }).finally(() => {
      if (!cancelled) setLoadingBranches(false);
    });
    return () => { cancelled = true; };
  }, [owner, repo]);

  const handleCreate = async () => {
    if (!owner || !repo) return;
    if (!title.trim()) { toast.error(i18n.t('请输入 PR 标题')); return; }
    if (!head || !base) { toast.error(i18n.t('请选择源分支和目标分支')); return; }
    if (head === base) { toast.error(i18n.t('源分支和目标分支不能相同')); return; }
    setCreating(true);
    try {
      const pr = await createPullRequest(owner, repo, {
        title: title.trim(),
        head,
        base,
        body: body.trim(),
        draft,
      });
      pageCache.invalidate(`pulls:${owner}/${repo}`);
      toast.success(i18n.t('PR 已创建'));
      navigate(`/repos/${owner}/${repo}/pulls/${pr.number}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('创建 PR 失败'));
    } finally {
      setCreating(false);
    }
  };

  const normalizedQuery = branchQuery.trim().toLowerCase();
  const branchOptions = normalizedQuery
    ? branches.filter((name) => name.toLowerCase().includes(normalizedQuery) || name === head || name === base)
    : branches;

  const renderBranchSelect = (value: string, onChange: (value: string) => void, placeholder: string) => (
    <Select value={value} onValueChange={onChange} disabled={loadingBranches}>
      <SelectTrigger className="bg-secondary border-border text-foreground">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="bg-popover border-border max-h-60">
        {branchOptions.map((name) => (
          <SelectItem key={name} value={name} className="text-foreground">{name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate(`/repos/${owner}/${repo}/pulls`)}>Pull Requests</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">{i18n.t('新建 PR')}</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <GitPullRequest className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">{i18n.t('创建 Pull Request')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{i18n.t('选择源分支和目标分支后提交')}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 md:p-5 space-y-5">
        <div className="space-y-1.5">
          <Label className="text-sm font-normal text-foreground">{i18n.t('筛选分支')}</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={branchQuery}
              onChange={(event) => setBranchQuery(event.target.value)}
              placeholder={i18n.t('筛选分支，例如 main')}
              className="bg-secondary border-border text-foreground pl-9"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-normal text-foreground">{i18n.t('源分支')}</Label>
            {renderBranchSelect(head, setHead, i18n.t('选择分支'))}
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-normal text-foreground">{i18n.t('目标分支')}</Label>
            {renderBranchSelect(base, setBase, i18n.t('选择分支'))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-normal text-foreground">{i18n.t('标题')}</Label>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={i18n.t('PR 标题')} className="bg-secondary border-border text-foreground" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-normal text-foreground">{i18n.t('描述（可选）')}</Label>
          <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} placeholder={i18n.t('描述这次改动…')} className="bg-secondary border-border text-foreground resize-y min-h-32" />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-secondary/20 p-3">
          <div>
            <Label className="text-sm font-normal text-foreground">{i18n.t('创建为草稿')}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">{i18n.t('草稿 PR 不会自动请求评审')}</p>
          </div>
          <Switch checked={draft} onCheckedChange={setDraft} />
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
          <Button
            type="button"
            variant="outline"
            className="sm:flex-1 border-border hover:bg-secondary"
            onClick={() => navigate(`/repos/${owner}/${repo}/pulls`)}
            disabled={creating}
          >
            {i18n.t('取消')}
          </Button>
          <Button
            type="button"
            className="sm:flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleCreate}
            disabled={creating || loadingBranches || !branches.length || !title.trim()}
          >
            {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <GitPullRequest className="w-4 h-4 mr-2" />}
            {creating ? i18n.t('创建中…') : i18n.t('创建 PR')}
          </Button>
        </div>
      </div>
    </div>
  );
}