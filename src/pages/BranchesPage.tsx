// 分支管理页

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  GitBranch,
  GitCommit,
  Code2,
  Star,
  Plus,
  Trash2,
  ChevronRight,
  Shield,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getAllBranches,
  createBranch,
  deleteBranch,
  compareBranches,
  getRepo,
  updateRepo,
} from '@/services/github';
import type { GitHubBranch } from '@/types/types';
import { toast } from 'sonner';
import { pageCache } from '@/lib/page-cache';
import i18n from "@/i18n";

interface BranchWithCompare extends GitHubBranch {
  ahead_by?: number;
  behind_by?: number;
  lastCommitDate?: string;
}

const CARD_ACTION_BUTTON_CLASS = 'h-8 px-2 text-xs gap-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground';

export default function BranchesPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [branches, setBranches] = useState<BranchWithCompare[]>([]);
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [loading, setLoading] = useState(true);
  const [canPush, setCanPush] = useState(false);
  const [canAdmin, setCanAdmin] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchFrom, setNewBranchFrom] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [defaultTarget, setDefaultTarget] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState(false);
  const requestSeq = useRef(0);

  const loadBranches = useCallback(async (force = false, showLoading = true) => {
    if (!owner || !repo) return;
    const requestId = ++requestSeq.current;
    if (showLoading) setLoading(true);

    const cacheKey = `branches:${owner}/${repo}:all-v2`;
    if (!force) {
      const cached = pageCache.get<{
        branches: BranchWithCompare[];
        defaultBranch: string;
        canPush: boolean;
        canAdmin: boolean;
      }>(cacheKey);
      if (cached) {
        setBranches(cached.branches);
        setDefaultBranch(cached.defaultBranch);
        setNewBranchFrom(cached.defaultBranch);
        setCanPush(cached.canPush);
        setCanAdmin(cached.canAdmin);
        setLoading(false);
        return;
      }
    }

    try {
      const [branchList, repoData] = await Promise.all([
        getAllBranches(owner, repo),
        getRepo(owner, repo),
      ]);
      if (requestId !== requestSeq.current) return;

      const defaultName = repoData.default_branch || branchList[0]?.name || 'main';
      const pushPermission = !!repoData.permissions?.push;
      const adminPermission = !!repoData.permissions?.admin;
      const ordered = [...branchList].sort((a, b) => {
        if (a.name === defaultName) return -1;
        if (b.name === defaultName) return 1;
        return 0;
      });

      setDefaultBranch(defaultName);
      setNewBranchFrom(defaultName);
      setCanPush(pushPermission);
      setCanAdmin(adminPermission);
      setBranches(ordered);
      pageCache.set(cacheKey, {
        branches: ordered,
        defaultBranch: defaultName,
        canPush: pushPermission,
        canAdmin: adminPermission,
      });

      // 仅比较前 10 个非默认分支，避免分支较多时触发大量 API 请求。
      const compareTargets = ordered.filter((b) => b.name !== defaultName).slice(0, 10);
      Promise.all(
        compareTargets.map((b) =>
          compareBranches(owner, repo, defaultName, b.name)
            .then((comp) => ({ name: b.name, ahead: comp.ahead_by, behind: comp.behind_by }))
            .catch(() => ({ name: b.name, ahead: undefined, behind: undefined }))
        )
      ).then((comparisons) => {
        if (requestId !== requestSeq.current) return;
        setBranches((prev) => {
          const enriched = prev.map((b) => {
            const comp = comparisons.find((c) => c.name === b.name);
            return comp ? { ...b, ahead_by: comp.ahead, behind_by: comp.behind } : b;
          });
          pageCache.set(cacheKey, {
            branches: enriched,
            defaultBranch: defaultName,
            canPush: pushPermission,
            canAdmin: adminPermission,
          });
          return enriched;
        });
      });
    } catch (err) {
      if (requestId === requestSeq.current) {
        toast.error(i18n.t('加载分支列表失败'));
        console.error(err);
      }
    } finally {
      if (requestId === requestSeq.current && showLoading) setLoading(false);
    }
  }, [owner, repo]);

  useEffect(() => {
    loadBranches();
    return () => {
      requestSeq.current += 1;
    };
  }, [loadBranches]);

  const handleCreateBranch = async () => {
    if (!owner || !repo) return;
    if (!newBranchName.trim()) {
      toast.error(i18n.t('请输入分支名称'));
      return;
    }
    setCreating(true);
    try {
      // 获取基础分支的 SHA
      const baseBranch = branches.find((b) => b.name === newBranchFrom);
      if (!baseBranch) {
        toast.error(i18n.t('找不到基础分支'));
        return;
      }
      await createBranch(owner, repo, {
        ref: newBranchName.trim(),
        sha: baseBranch.commit.sha,
      });
      toast.success(`分支 ${newBranchName} 创建成功！`);
      setCreateDialogOpen(false);
      setNewBranchName('');
      pageCache.invalidate(`branches:${owner}/${repo}:`);
      await loadBranches(true, false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('创建分支失败'));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteBranch = async () => {
    if (!owner || !repo || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteBranch(owner, repo, deleteTarget);
      setBranches((prev) => {
        const updated = prev.filter((b) => b.name !== deleteTarget);
        pageCache.set(`branches:${owner}/${repo}:all-v2`, {
          branches: updated,
          defaultBranch,
          canPush,
          canAdmin,
        });
        return updated;
      });
      toast.success(`分支 ${deleteTarget} 已删除`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('删除失败'));
    } finally {
      setDeleting(false);
    }
  };

  const handleSetDefaultBranch = async () => {
    if (!owner || !repo || !defaultTarget) return;
    setSettingDefault(true);
    try {
      await updateRepo(owner, repo, { default_branch: defaultTarget });
      toast.success(`分支 ${defaultTarget} 已设为默认分支`);
      setDefaultTarget(null);
      pageCache.invalidate(`branches:${owner}/${repo}:`);
      await loadBranches(true, false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('设置默认分支失败'));
    } finally {
      setSettingDefault(false);
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
        <span className="text-foreground">{i18n.t('分支管理')}</span>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-primary" />
          {i18n.t('分支管理')}
          {!loading && (
            <span className="text-xs font-normal text-muted-foreground">
              {branches.length} {i18n.t('个分支')}
            </span>
          )}
        </h1>
        {canPush && (
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-2" />
              {i18n.t('新建分支')}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-foreground">{i18n.t('创建新分支')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">{i18n.t('分支名称 *')}</Label>
                <Input
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="feature/my-feature"
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">{i18n.t('基于分支')}</Label>
                <Select value={newBranchFrom} onValueChange={setNewBranchFrom}>
                  <SelectTrigger className="bg-secondary border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border max-h-48">
                    {branches.map((b) => (
                      <SelectItem key={b.name} value={b.name} className="text-foreground font-mono text-sm">
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 border-border hover:bg-secondary"
                  onClick={() => setCreateDialogOpen(false)}
                >
                  {i18n.t('取消')}</Button>
                <Button
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleCreateBranch}
                  disabled={creating || !newBranchName.trim()}
                >
                  {creating ? i18n.t('创建中...') : i18n.t('创建')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {/* 分支列表 */}
      <div className="space-y-2">
        {loading ? (
          <>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
                <Skeleton className="w-8 h-8 rounded-lg bg-muted shrink-0" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-1/3 bg-muted mb-1.5" />
                  <Skeleton className="h-4 w-1/4 bg-muted" />
                </div>
              </div>
            ))}
          </>
        ) : branches.length === 0 ? (
          <div className="bg-card border border-border rounded-xl py-16 text-center text-muted-foreground">
            {i18n.t('暂无分支')}
          </div>
        ) : (
          branches.map((branch) => (
            <div
              key={branch.name}
              className="bg-card border border-border rounded-xl overflow-hidden group"
            >
              <div className="px-4 pt-3 pb-2.5 min-w-0">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <GitBranch className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <code className="text-sm font-semibold font-mono text-foreground break-all">
                        {branch.name}
                      </code>
                      {branch.name === defaultBranch && (
                        <Badge variant="outline" className="text-xs border-primary/50 text-primary bg-primary/10">
                          {i18n.t('默认')}
                        </Badge>
                      )}
                      {branch.protected && (
                        <Badge variant="outline" className="text-xs gap-1 text-muted-foreground border-border">
                          <Shield className="w-3 h-3" />{i18n.t('受保护')}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span className="font-mono text-[11px]">{branch.commit.sha.substring(0, 7)}</span>
                      {branch.name !== defaultBranch && branch.ahead_by !== undefined && branch.ahead_by > 0 && (
                        <span className="flex items-center gap-0.5 text-primary">
                          <ArrowUp className="w-3 h-3" />{branch.ahead_by} {i18n.t('领先')}
                        </span>
                      )}
                      {branch.name !== defaultBranch && branch.behind_by !== undefined && branch.behind_by > 0 && (
                        <span className="flex items-center gap-0.5 text-muted-foreground">
                          <ArrowDown className="w-3 h-3" />{branch.behind_by} {i18n.t('落后')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-1 px-3 py-2 border-t border-border bg-secondary/20">
                <Button
                  variant="ghost" size="sm"
                  className={CARD_ACTION_BUTTON_CLASS}
                  title={i18n.t('查看该分支代码')}
                  onClick={() => navigate(`/repos/${owner}/${repo}/code?branch=${encodeURIComponent(branch.name)}`)}
                >
                  <Code2 className="w-3.5 h-3.5" />{i18n.t('代码')}
                </Button>
                <Button
                  variant="ghost" size="sm"
                  className={CARD_ACTION_BUTTON_CLASS}
                  title={i18n.t('查看该分支提交历史')}
                  onClick={() => navigate(`/repos/${owner}/${repo}/commits?branch=${encodeURIComponent(branch.name)}`)}
                >
                  <GitCommit className="w-3.5 h-3.5" />{i18n.t('提交')}
                </Button>
                {canAdmin && branch.name !== defaultBranch && (
                  <Button
                    variant="ghost" size="sm"
                    className={CARD_ACTION_BUTTON_CLASS}
                    title={i18n.t('设为默认分支')}
                    onClick={() => setDefaultTarget(branch.name)}
                  >
                    <Star className="w-3.5 h-3.5" />{i18n.t('默认')}
                  </Button>
                )}
                {canPush && branch.name !== defaultBranch && !branch.protected && (
                  <Button
                    variant="ghost" size="sm"
                    className={`${CARD_ACTION_BUTTON_CLASS} hover:text-destructive hover:bg-destructive/10`}
                    title={i18n.t('删除分支')}
                    onClick={() => setDeleteTarget(branch.name)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />{i18n.t('删除')}
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">{i18n.t('确认删除分支')}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {i18n.t('确定要删除分支')}<code className="font-mono text-foreground">{deleteTarget}</code> {i18n.t('吗？此操作无法撤销。')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground hover:bg-secondary">{i18n.t('取消')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteBranch}
              disabled={deleting}
            >
              {deleting ? i18n.t('删除中...') : i18n.t('确认删除')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 设为默认分支确认 */}
      <AlertDialog
        open={!!defaultTarget}
        onOpenChange={(open) => {
          if (!open && !settingDefault) setDefaultTarget(null);
        }}
      >
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">{i18n.t('设为默认分支？')}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground space-y-1">
              <span className="block font-mono text-xs break-all text-foreground">{defaultTarget}</span>
              <span className="block">{i18n.t('设为默认分支后，克隆和 PR 将默认使用该分支。')}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground hover:bg-secondary">{i18n.t('取消')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={(event) => {
                event.preventDefault();
                void handleSetDefaultBranch();
              }}
              disabled={settingDefault}
            >
              {settingDefault ? i18n.t('设置中...') : i18n.t('确认设置')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
