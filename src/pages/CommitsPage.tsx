// 提交历史页

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Clock,
  ChevronRight,
  GitCommit,
  ExternalLink,
  GitBranch,
  Undo2,
  RotateCcw,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { getCommits, getBranches, formatRelativeTime, revertCommit, rollbackBranchToCommit } from '@/services/github';
import type { GitHubCommit, GitHubBranch } from '@/types/types';
import { UserLink } from '@/components/common/UserLink';
import { toast } from 'sonner';
import { pageCache } from '@/lib/page-cache';
import i18n from "@/i18n";

export default function CommitsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [page, setPage] = useState(1);
  const [actionCommit, setActionCommit] = useState<GitHubCommit | null>(null);
  const [actionKind, setActionKind] = useState<'revert' | 'rollback' | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    if (!owner || !repo) return;
    getBranches(owner, repo)
      .then((result) => {
        setBranches(result.data);
        if (result.data.length > 0) setSelectedBranch(result.data[0].name);
      })
      .catch(console.error);
  }, [owner, repo]);

  const loadCommits = useCallback(async (pageNum = 1, append = false, force = false) => {
    if (!owner || !repo || !selectedBranch) return;
    if (pageNum === 1) setLoading(true);

    const cacheKey = `commits:${owner}/${repo}:${selectedBranch}:p1`;
    if (pageNum === 1 && !append && !force) {
      const cached = pageCache.get<{ commits: GitHubCommit[]; hasNextPage: boolean }>(cacheKey);
      if (cached) {
        setCommits(cached.commits);
        setHasNextPage(cached.hasNextPage);
        setPage(1);
        setLoading(false);
        return;
      }
    }

    try {
      const result = await getCommits(owner, repo, {
        sha: selectedBranch,
        per_page: 30,
        page: pageNum,
      });
      if (append) {
        setCommits((prev) => [...prev, ...result.data]);
      } else {
        setCommits(result.data);
        pageCache.set(cacheKey, { commits: result.data, hasNextPage: result.hasNextPage });
      }
      setHasNextPage(result.hasNextPage);
      setPage(pageNum);
    } catch (err) {
      toast.error(i18n.t('加载提交历史失败'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [owner, repo, selectedBranch]);

  useEffect(() => {
    if (selectedBranch) loadCommits(1);
  }, [loadCommits, selectedBranch]);

  const handleViewCommit = (sha: string) => {
    if (!owner || !repo) return;
    navigate(`/repos/${owner}/${repo}/commits/${sha}`);
  };

  const handleConfirmAction = async () => {
    if (!owner || !repo || !actionCommit || !actionKind || !selectedBranch) return;
    setActionBusy(true);
    try {
      if (actionKind === 'revert') {
        const result = await revertCommit(owner, repo, selectedBranch, actionCommit.sha);
        toast.success(`已创建撤销提交 ${result.sha.substring(0, 7)}`);
      } else {
        await rollbackBranchToCommit(owner, repo, selectedBranch, actionCommit.sha);
        toast.success(`分支 ${selectedBranch} 已回滚到 ${actionCommit.sha.substring(0, 7)}`);
      }
      setActionCommit(null);
      setActionKind(null);
      await loadCommits(1, false, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('操作失败'));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">{i18n.t('提交历史')}</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <GitCommit className="w-5 h-5 text-primary" />
          {i18n.t('提交历史')}</h1>
        <Select value={selectedBranch} onValueChange={setSelectedBranch}>
          <SelectTrigger className="bg-secondary border-border text-foreground w-40 h-9">
            <GitBranch className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder={i18n.t('选择分支')} />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border max-h-48">
            {branches.map((branch) => (
              <SelectItem key={branch.name} value={branch.name} className="text-foreground font-mono text-sm">
                {branch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 提交列表 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4 flex items-center gap-3">
                <Skeleton className="w-8 h-8 rounded-full bg-muted" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-2/3 bg-muted mb-1.5" />
                  <Skeleton className="h-4 w-1/3 bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : commits.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">{i18n.t('暂无提交记录')}</div>
        ) : (
          <div className="divide-y divide-border">
            {commits.map((commit) => (
              <div
                key={commit.sha}
                className="p-4 hover:bg-secondary/50 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  {commit.author ? (
                    <UserLink login={commit.author.login} className="shrink-0">
                      <Avatar className="w-8 h-8 shrink-0">
                        <AvatarImage src={commit.author.avatar_url} />
                        <AvatarFallback className="bg-secondary text-xs">
                          {commit.commit.author.name.substring(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                    </UserLink>
                  ) : (
                    <Avatar className="w-8 h-8 shrink-0">
                      <AvatarFallback className="bg-secondary text-xs">
                        {commit.commit.author.name.substring(0, 1)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      className="text-sm font-medium text-foreground group-hover:text-accent transition-colors text-left line-clamp-2 text-balance w-full"
                      onClick={() => handleViewCommit(commit.sha)}
                    >
                      {commit.commit.message.split('\n')[0]}
                    </button>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {commit.commit.author.name}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(commit.commit.author.date)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost" size="icon"
                      className="w-7 h-7 text-muted-foreground hover:bg-secondary hover:text-primary"
                      title={i18n.t('撤销提交（创建反向提交）')}
                      onClick={() => { setActionCommit(commit); setActionKind('revert'); }}
                    >
                      <Undo2 className="w-3.5 h-3.5" /><span className="hidden xl:inline text-xs ml-0.5">{i18n.t('撤销')}</span>
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="w-7 h-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title={i18n.t('回滚分支到此提交（会移动分支）')}
                      onClick={() => { setActionCommit(commit); setActionKind('rollback'); }}
                    >
                      <RotateCcw className="w-3.5 h-3.5" /><span className="hidden xl:inline text-xs ml-0.5">{i18n.t('回滚')}</span>
                    </Button>
                    <button
                      type="button"
                      className="text-xs bg-secondary border border-border px-2 py-1 rounded font-mono text-accent hover:bg-secondary/80 transition-colors"
                      onClick={() => handleViewCommit(commit.sha)}
                    >
                      {commit.sha.substring(0, 7)}
                    </button>
                    <a
                      href={commit.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:bg-secondary">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {hasNextPage && !loading && (
        <div className="text-center">
          <Button
            variant="outline"
            className="border-border hover:bg-secondary"
            onClick={() => loadCommits(page + 1, true)}
          >
            {i18n.t('加载更多')}</Button>
        </div>
      )}



      <AlertDialog open={!!actionCommit && !!actionKind} onOpenChange={(open) => { if (!open && !actionBusy) { setActionCommit(null); setActionKind(null); } }}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              {actionKind === 'revert' ? i18n.t('撤销这个提交？') : i18n.t('回滚分支到这个提交？')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground space-y-2">
              <span className="block font-mono text-xs break-all">{actionCommit?.sha}</span>
              <span className="block">{actionCommit?.commit.message.split('\n')[0]}</span>
              <span className="block text-xs">
                {actionKind === 'revert'
                  ? i18n.t('将创建一个新的反向提交，保留提交历史。')
                  : i18n.t('会强制移动分支指针并丢失此提交之后的提交，操作不可撤销。')}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>{i18n.t('取消')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={actionBusy}
              className={actionKind === 'rollback' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
              onClick={(e) => { e.preventDefault(); void handleConfirmAction(); }}
            >
              {actionBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : actionKind === 'revert' ? i18n.t('确认撤销') : i18n.t('确认回滚')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
