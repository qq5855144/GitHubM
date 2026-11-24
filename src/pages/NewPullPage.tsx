import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, ChevronsUpDown, GitPullRequest, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { compareBranches, createPullRequest, getAllBranches, getPullRequests, getRepo } from '@/services/github';
import { pageCache } from '@/lib/page-cache';
import type { GitHubPullRequest, GitHubRepo } from '@/types/types';
import { toast } from 'sonner';
import i18n from '@/i18n';

function BranchPicker({ id, value, branches, disabled, onChange }: {
  id: string;
  value: string;
  branches: string[];
  disabled: boolean;
  onChange: (branch: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" disabled={disabled} className="w-full justify-between gap-2 bg-secondary">
          <span className="truncate">{value || i18n.t('选择分支')}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command label={i18n.t('选择分支')}>
          <CommandInput placeholder={i18n.t('筛选分支')} />
          <CommandList className="max-h-52">
            <CommandEmpty>{i18n.t('未找到分支')}</CommandEmpty>
            {branches.map((branch) => (
              <CommandItem key={branch} value={branch} onSelect={() => { onChange(branch); setOpen(false); }}>
                <Check className={branch === value ? 'opacity-100' : 'opacity-0'} />
                <span className="break-all">{branch}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

type Comparison = {
  key: string;
  ahead?: number;
  fileCount?: number;
  suggestion: string;
  existing?: number;
};

function existingPull(pulls: GitHubPullRequest[], source: string) {
  return pulls.find((pr) => pr.head.repo?.full_name.toLowerCase() === source.toLowerCase())?.number;
}

export default function NewPullPage() {
  const { owner = '', repo = '' } = useParams<{ owner: string; repo: string }>();
  const [search] = useSearchParams();
  return <NewPullForm key={`${owner}/${repo}?${search}`} owner={owner} repo={repo} initialHead={search.get('head')} initialBase={search.get('base')} />;
}

function NewPullForm({ owner, repo, initialHead, initialBase }: {
  owner: string;
  repo: string;
  initialHead: string | null;
  initialBase: string | null;
}) {
  const navigate = useNavigate();
  const { state } = useLocation();
  const source = `${owner}/${repo}`;
  const pullsPath = `/repos/${source}/pulls`;
  const fromList = (state as { fromList?: string } | null)?.fromList;
  const returnToList = fromList === pullsPath || fromList?.startsWith(`${pullsPath}?`);
  const [branches, setBranches] = useState<string[]>([]);
  const [repository, setRepository] = useState<GitHubRepo | null>(null);
  const [upstream, setUpstream] = useState(false);
  const [upstreamBranches, setUpstreamBranches] = useState<string[] | null>(null);
  const [upstreamError, setUpstreamError] = useState(false);
  const [upstreamRetry, setUpstreamRetry] = useState(0);
  const [head, setHead] = useState('');
  const [base, setBase] = useState('');
  const [title, setTitle] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [branchError, setBranchError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const parent = upstream ? repository?.parent : undefined;
  const targetOwner = parent?.owner.login ?? owner;
  const targetRepo = parent?.name ?? repo;
  const targetPath = `/repos/${targetOwner}/${targetRepo}/pulls`;
  const qualifiedHead = `${owner}:${head}`;
  const sameBranch = !parent && !!head && head === base;
  const canCompare = !loadingBranches && (!parent || !!upstreamBranches) && !!head && !!base && !sameBranch;
  const pairKey = canCompare ? JSON.stringify([targetPath, head, base]) : '';
  const preview = pairKey && comparison?.key === pairKey ? comparison : null;

  useEffect(() => {
    let cancelled = false;
    Promise.all([getRepo(owner, repo), getAllBranches(owner, repo)]).then(([info, result]) => {
      if (cancelled) return;
      const names = [...new Set([info.default_branch, ...result.map((branch) => branch.name)])].filter(Boolean);
      setBranches(names);
      setRepository(info);
      setBase(initialBase && names.includes(initialBase) ? initialBase : info.default_branch);
      setHead(initialHead && names.includes(initialHead) ? initialHead : '');
    }).catch(() => {
      if (!cancelled) setBranchError(true);
    }).finally(() => {
      if (!cancelled) setLoadingBranches(false);
    });
    return () => { cancelled = true; };
  }, [owner, repo, initialHead, initialBase, retry]);

  useEffect(() => {
    if (!parent || upstreamBranches) return;
    let cancelled = false;
    getAllBranches(parent.owner.login, parent.name).then((result) => {
      if (!cancelled) setUpstreamBranches([...new Set([parent.default_branch, ...result.map((branch) => branch.name)])]);
    }).catch(() => {
      if (!cancelled) setUpstreamError(true);
    });
    return () => { cancelled = true; };
  }, [parent, upstreamBranches, upstreamRetry]);

  useEffect(() => {
    if (!pairKey) return;
    let cancelled = false;
    Promise.allSettled([
      compareBranches(targetOwner, targetRepo, base, parent ? qualifiedHead : head, { fresh: true }),
      getPullRequests(targetOwner, targetRepo, { state: 'open', base, head: qualifiedHead, fresh: true }),
    ]).then(([compared, opened]) => {
      if (cancelled) return;
      const result = compared.status === 'fulfilled' ? compared.value : null;
      const commitTitle = result?.ahead_by === 1 ? result.commits[0]?.commit.message.split('\n')[0].trim() : '';
      setComparison({
        key: pairKey,
        ahead: result?.ahead_by,
        fileCount: result?.files?.length,
        suggestion: commitTitle || head,
        existing: opened.status === 'fulfilled' ? existingPull(opened.value.data, source) : undefined,
      });
    });
    return () => { cancelled = true; };
  }, [targetOwner, targetRepo, parent, qualifiedHead, head, base, pairKey, source]);

  const currentTitle = title ?? preview?.suggestion ?? '';
  const canCreate = !creating && !!preview && !preview.existing && preview.ahead !== 0 && !!currentTitle.trim();
  const changeBranch = (setBranch: (value: string) => void, value: string) => {
    setComparison(null);
    setCreateError('');
    setBranch(value);
  };

  const changeTarget = (value: string) => {
    setUpstream(value === 'upstream');
    setUpstreamError(false);
    changeBranch(setBase, (value === 'upstream' ? repository?.parent?.default_branch : repository?.default_branch) ?? '');
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!canCreate) return;
    setCreating(true);
    setCreateError('');
    try {
      const pr = await createPullRequest(targetOwner, targetRepo, {
        title: currentTitle.trim(), head: parent ? qualifiedHead : head, head_repo: parent ? repo : undefined,
        base, body: body.trim(), draft,
      });
      pageCache.invalidate(`pulls:${targetOwner}/${targetRepo}:`);
      toast.success(i18n.t('PR 已创建'));
      navigate(`${targetPath}/${pr.number}`, { replace: true, state: !parent && returnToList ? { fromList } : undefined });
    } catch (err) {
      if ((err as { status?: number })?.status === 422) {
        const opened = await getPullRequests(targetOwner, targetRepo, { state: 'open', base, head: qualifiedHead, fresh: true }).catch(() => null);
        const existing = existingPull(opened?.data ?? [], source);
        if (existing && preview) {
          setComparison({ ...preview, existing });
          return;
        }
      }
      setCreateError(err instanceof Error ? err.message : i18n.t('创建 PR 失败'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <Button variant="ghost" size="sm" asChild><Link to={returnToList ? fromList! : pullsPath} onClick={(event) => { if (returnToList && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(-1); } }}><ArrowLeft className="mr-1.5 h-4 w-4" /> Pull Requests</Link></Button>
      <h1 className="text-xl font-bold text-foreground">{i18n.t('创建 Pull Request')}</h1>
      <form onSubmit={handleCreate} className="space-y-4 rounded-xl border border-border bg-card p-4 md:p-5">
        {repository?.parent && (
          <div className="space-y-1.5">
            <Label htmlFor="pr-target">{i18n.t('目标仓库')}</Label>
            <Select value={upstream ? 'upstream' : 'current'} onValueChange={changeTarget} disabled={creating}>
              <SelectTrigger id="pr-target"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="current">{repository.full_name}</SelectItem>
                <SelectItem value="upstream">{repository.parent.full_name} · {i18n.t('上游')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="pr-head">{i18n.t('源分支')}</Label>
            <BranchPicker id="pr-head" value={head} branches={branches} disabled={loadingBranches || creating || branchError} onChange={(value) => { if (value !== head) changeBranch(setHead, value); }} />
          </div>
          <ArrowRight className="mb-2.5 hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden="true" />
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="pr-base">{i18n.t('目标分支')}</Label>
            <BranchPicker id="pr-base" value={base} branches={parent ? upstreamBranches ?? [] : branches} disabled={loadingBranches || creating || branchError || (!!parent && !upstreamBranches)} onChange={(value) => { if (value !== base) changeBranch(setBase, value); }} />
          </div>
        </div>
        {branchError && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
            {i18n.t('加载分支失败')}
            <Button type="button" size="sm" variant="outline" onClick={() => { setBranchError(false); setLoadingBranches(true); setRetry(retry + 1); }}>{i18n.t('重试')}</Button>
          </div>
        )}
        <div className="text-sm text-muted-foreground" aria-live="polite">
          {(loadingBranches || (parent && !upstreamBranches && !upstreamError)) && i18n.t('加载分支中…')}
          {parent && upstreamError && (
            <div className="flex flex-wrap items-center gap-2 text-destructive" role="alert">
              {i18n.t('加载分支失败')}
              <Button type="button" size="sm" variant="outline" onClick={() => { setUpstreamError(false); setUpstreamRetry(upstreamRetry + 1); }}>{i18n.t('重试')}</Button>
            </div>
          )}
          {!loadingBranches && !branchError && !head && i18n.t('请选择源分支')}
          {sameBranch && i18n.t('源分支和目标分支不能相同')}
          {pairKey && !preview && i18n.t('正在比较分支…')}
          {preview?.existing && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary p-2">
              <span>{i18n.t('这两个分支已有开放的 PR')}</span>
              <Button size="sm" variant="outline" asChild><Link to={`${targetPath}/${preview.existing}`} replace state={!parent && returnToList ? { fromList } : undefined}>{i18n.t('打开 PR')} #{preview.existing}</Link></Button>
            </div>
          )}
          {preview && !preview.existing && (preview.ahead === undefined
            ? i18n.t('暂时无法预览分支差异，提交时由 GitHub 验证')
            : preview.ahead === 0
              ? i18n.t('源分支没有可合并的新提交')
              : <span>{preview.ahead} {i18n.t('个新提交')}{preview.fileCount !== undefined && <> · {preview.fileCount === 300 ? '300+' : preview.fileCount} {i18n.t('个文件变更')}</>}</span>)}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pr-title">{i18n.t('标题')}</Label>
          <Input id="pr-title" value={currentTitle} onChange={(event) => setTitle(event.target.value)} placeholder={i18n.t('PR 标题')} disabled={creating} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pr-body">{i18n.t('描述（可选）')}</Label>
          <Textarea id="pr-body" value={body} onChange={(event) => setBody(event.target.value)} rows={4} disabled={creating} placeholder={i18n.t('描述这次改动…')} />
        </div>
        {createError && <p role="alert" className="break-words text-sm text-destructive">{createError}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <Switch id="pr-draft" checked={draft} onCheckedChange={setDraft} disabled={creating} />
            <Label htmlFor="pr-draft">{i18n.t('创建为草稿')}</Label>
          </div>
          <Button type="submit" disabled={!canCreate}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitPullRequest className="mr-2 h-4 w-4" />}
            {draft ? i18n.t('创建草稿 PR') : i18n.t('创建 PR')}
          </Button>
        </div>
      </form>
    </div>
  );
}
