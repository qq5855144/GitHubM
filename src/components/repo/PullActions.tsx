import { useState } from 'react';
import { ExternalLink, GitMerge, MoreHorizontal, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getPullRequest, mergePullRequest, samePullRevision, updatePullRequest, type PullMergeMethod } from '@/services/github';
import { gqlSetPullRequestDraft } from '@/services/github-graphql';
import { invalidateAndBust } from '@/services/github/core';
import { pageCache } from '@/lib/page-cache';
import type { GitHubPullRequest, GitHubRepo } from '@/types/types';
import { isRepoOwner } from '@/lib/repoPermissions';
import { toast } from 'sonner';
import i18n from '@/i18n';

function mergeBlock(pr: GitHubPullRequest) {
  if (pr.state !== 'open' || pr.merged || pr.merged_at) return i18n.t('此 PR 已结束');
  if (pr.draft) return i18n.t('草稿 PR 需先标记为可评审');
  if (pr.mergeable_state === 'dirty' || pr.mergeable === false) return i18n.t('存在合并冲突');
  if (pr.mergeable_state === 'behind') return i18n.t('源分支需要同步目标分支');
  if (pr.mergeable_state === 'blocked') return i18n.t('仓库规则暂时阻止合并，请检查评审和状态检查');
  if (!pr.mergeable || pr.mergeable_state === 'unknown') return i18n.t('GitHub 正在计算合并状态');
  return '';
}

type Action = 'merge' | 'edit' | 'close' | 'reopen' | 'draft' | 'ready';

export function PullActions({ owner, repo, pr, repository, login, onUpdate }: {
  owner: string;
  repo: string;
  pr: GitHubPullRequest;
  repository: GitHubRepo | null;
  login?: string;
  onUpdate: (pr: GitHubPullRequest) => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mergeTarget, setMergeTarget] = useState<GitHubPullRequest | null>(null);
  const [method, setMethod] = useState<PullMergeMethod>('merge');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const permissions = repository?.permissions ?? pr.base.repo?.permissions;
  const canMerge = isRepoOwner(owner, login) || !!permissions?.admin || !!permissions?.maintain || !!permissions?.push;
  const canEdit = canMerge || isRepoOwner(pr.user.login, login);
  const isOpen = pr.state === 'open' && !pr.merged && !pr.merged_at;
  const isMerged = pr.merged || !!pr.merged_at || pr.state === 'merged';
  const settings = repository ?? pr.base.repo;
  const methods = [
    { value: 'merge' as const, label: i18n.t('创建合并提交'), allowed: settings?.allow_merge_commit },
    { value: 'squash' as const, label: i18n.t('压缩提交并合并'), allowed: settings?.allow_squash_merge },
    { value: 'rebase' as const, label: i18n.t('变基并合并'), allowed: settings?.allow_rebase_merge },
  ].filter(({ allowed }) => allowed !== false);
  const reason = isOpen && canMerge && !pr.draft
    ? (mergeBlock(pr) || (methods.length === 0 ? i18n.t('仓库未启用直接合并方式') : ''))
    : '';
  const selectedMethod = methods.find(({ value }) => value === method)?.value ?? methods[0]?.value;
  const mergeTargetChanged = !!mergeTarget && !samePullRevision(pr, mergeTarget);
  const prUrl = `https://github.com/${owner}/${repo}/pull/${pr.number}`;

  const openAction = (next: Action) => {
    setError('');
    if (next === 'merge') {
      setMergeTarget(pr);
      setMethod(methods[0]?.value ?? 'merge');
    }
    if (next === 'edit') {
      setTitle(pr.title);
      setBody(pr.body ?? '');
    }
    setAction(next);
  };

  const readLatest = () => getPullRequest(owner, repo, pr.number, { fresh: true });
  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      onUpdate(await readLatest());
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n.t('刷新失败'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !action) return;
    setBusy(true);
    setError('');
    let updated: GitHubPullRequest;
    try {
      if (action === 'merge') {
        if (!mergeTarget || !selectedMethod || mergeTargetChanged || reason) return;
        const latest = await readLatest();
        onUpdate(latest);
        if (!samePullRevision(latest, mergeTarget)) throw new Error(i18n.t('分支已有更新，请重新检查变更后再合并'));
        const newReason = mergeBlock(latest);
        if (newReason) throw new Error(newReason);
        const result = await mergePullRequest(owner, repo, pr.number, { merge_method: selectedMethod, sha: mergeTarget.head.sha });
        if (!result.merged) throw new Error(result.message || i18n.t('合并失败'));
        updated = { ...latest, merged: true, state: 'closed' };
      } else if (action === 'draft' || action === 'ready') {
        if (!pr.node_id) return;
        const draft = await gqlSetPullRequestDraft(pr.node_id, action === 'draft');
        updated = { ...pr, draft };
        invalidateAndBust(`/repos/${owner}/${repo}/pulls`);
      } else {
        const update = action === 'edit' ? { title: title.trim(), body: body.trim() } : { state: action === 'close' ? 'closed' as const : 'open' as const };
        updated = await updatePullRequest(owner, repo, pr.number, update);
      }
      onUpdate(updated);
      pageCache.invalidate(`pulls:${owner}/${repo}:`);
      setAction(null);
      toast.success({
        merge: i18n.t('Pull Request 已合并！'),
        edit: i18n.t('已保存'),
        close: i18n.t('PR 已关闭'),
        reopen: i18n.t('PR 已重新打开'),
        draft: i18n.t('PR 已转为草稿'),
        ready: i18n.t('PR 已标记为可评审'),
      }[action]);
    } catch (err) {
      setError(err instanceof Error ? err.message : i18n.t('操作失败'));
    } finally {
      setBusy(false);
    }
  };

  const actionLabels: Record<Action, { label: string; description: string }> = {
    merge: { label: i18n.t('合并 PR'), description: i18n.t('确认源分支、目标分支和合并方式') },
    edit: { label: i18n.t('编辑 PR'), description: i18n.t('修改标题和描述') },
    close: { label: i18n.t('关闭 PR'), description: i18n.t('关闭后仍可重新打开此 PR') },
    reopen: { label: i18n.t('重新打开 PR'), description: i18n.t('恢复此 PR 的讨论与评审') },
    draft: { label: i18n.t('转为草稿'), description: i18n.t('转为草稿后可以继续修改并重新发起评审') },
    ready: { label: i18n.t('标记为可评审'), description: i18n.t('将草稿转为开放评审') },
  };

  return (
    <div className="flex max-w-full flex-wrap items-center gap-2">
      {isOpen && !pr.draft && canMerge && (
        <Button size="sm" className="gap-1.5" onClick={() => openAction('merge')} disabled={busy || !!reason}>
          <GitMerge className="h-4 w-4" />{actionLabels.merge.label}
        </Button>
      )}
      {isOpen && pr.draft && canEdit && pr.node_id && (
        <Button size="sm" onClick={() => openAction('ready')} disabled={busy}>{actionLabels.ready.label}</Button>
      )}
      {!isOpen && !isMerged && canEdit && (
        <Button size="sm" onClick={() => openAction('reopen')} disabled={busy}>{actionLabels.reopen.label}</Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label={i18n.t('更多 PR 操作')} className="h-9 w-9" disabled={busy}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && <DropdownMenuItem onSelect={() => openAction('edit')}>{actionLabels.edit.label}</DropdownMenuItem>}
          {canEdit && isOpen && !pr.draft && pr.node_id && <DropdownMenuItem onSelect={() => openAction('draft')}>{actionLabels.draft.label}</DropdownMenuItem>}
          {canEdit && isOpen && <DropdownMenuItem onSelect={() => openAction('close')} className="text-destructive">{actionLabels.close.label}</DropdownMenuItem>}
          <DropdownMenuItem onSelect={refresh}><RefreshCw className="mr-2 h-3.5 w-3.5" />{i18n.t('刷新状态')}</DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={prUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-3.5 w-3.5" />{i18n.t('在 GitHub 中打开')}</a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {!action && (error || reason) && (
        <div className="flex w-full flex-wrap items-center gap-x-2 text-xs text-muted-foreground" role="status">
          <span className="break-words">{error || reason}</span>
          <Button variant="link" size="sm" className="h-auto px-0 py-1 text-xs" onClick={refresh} disabled={busy}>{i18n.t('刷新状态')}</Button>
        </div>
      )}
      <Dialog open={!!action} onOpenChange={(open) => { if (!open && !busy) { setAction(null); setError(''); } }}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto">
          {action && (
            <form onSubmit={confirm} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{actionLabels[action].label}</DialogTitle>
                <DialogDescription>{actionLabels[action].description}</DialogDescription>
              </DialogHeader>
              {action === 'edit' && (
                <div className="space-y-2">
                  <Label htmlFor="edit-pr-title">{i18n.t('标题')}</Label>
                  <Input id="edit-pr-title" value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} required />
                  <Label htmlFor="edit-pr-body">{i18n.t('描述（可选）')}</Label>
                  <Textarea id="edit-pr-body" value={body} onChange={(event) => setBody(event.target.value)} rows={5} disabled={busy} />
                </div>
              )}
              {action === 'merge' && mergeTarget && (
                <div className="space-y-2">
                  <p className="break-all rounded-lg bg-secondary p-2 text-sm">
                    <code>{mergeTarget.head.label || mergeTarget.head.ref}</code> → <code>{mergeTarget.base.ref}</code>
                  </p>
                  <Label htmlFor="pull-merge-method">{i18n.t('合并方式')}</Label>
                  <Select value={selectedMethod} onValueChange={(value: PullMergeMethod) => setMethod(value)} disabled={busy}>
                    <SelectTrigger id="pull-merge-method"><SelectValue /></SelectTrigger>
                    <SelectContent>{methods.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
              <DialogFooter className="gap-y-2">
                <Button type="button" variant="outline" disabled={busy} onClick={() => { setAction(null); setError(''); }}>{i18n.t('取消')}</Button>
                <Button type="submit" variant={action === 'close' ? 'destructive' : 'default'} disabled={busy || (action === 'edit' && !title.trim()) || (action === 'merge' && (mergeTargetChanged || !!reason))}>
                  {busy ? i18n.t('处理中…') : action === 'edit' ? i18n.t('保存') : action === 'merge' ? i18n.t('确认合并') : actionLabels[action].label}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
