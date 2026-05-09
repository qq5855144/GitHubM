// 分支管理页

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  GitBranch,
  Plus,
  Trash2,
  ChevronRight,
  Shield,
  Clock,
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
  getBranches,
  createBranch,
  deleteBranch,
  compareBranches,
  getRepo,
  formatRelativeTime,
} from '@/services/github';
import type { GitHubBranch } from '@/types/types';
import { toast } from 'sonner';

interface BranchWithCompare extends GitHubBranch {
  ahead_by?: number;
  behind_by?: number;
  lastCommitDate?: string;
}

export default function BranchesPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [branches, setBranches] = useState<BranchWithCompare[]>([]);
  const [defaultBranch, setDefaultBranch] = useState('main');
  const [loading, setLoading] = useState(true);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [page, setPage] = useState(1);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchFrom, setNewBranchFrom] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadBranches = useCallback(async (pageNum = 1, append = false) => {
    if (!owner || !repo) return;
    if (pageNum === 1) setLoading(true);
    try {
      const [result, repoData] = await Promise.all([
        getBranches(owner, repo, pageNum),
        pageNum === 1 ? getRepo(owner, repo) : Promise.resolve(null),
      ]);
      const branchList = result.data as BranchWithCompare[];
      if (repoData) {
        setDefaultBranch(repoData.default_branch);
        setNewBranchFrom(repoData.default_branch);
        // 获取与默认分支的比较信息（只针对非默认分支）
        const comparePromises = branchList
          .filter((b) => b.name !== repoData.default_branch)
          .slice(0, 10) // 限制请求数量
          .map((b) =>
            compareBranches(owner, repo, repoData.default_branch, b.name)
              .then((comp) => ({ name: b.name, ahead: comp.ahead_by, behind: comp.behind_by }))
              .catch(() => ({ name: b.name, ahead: 0, behind: 0 }))
          );
        Promise.all(comparePromises).then((comparisons) => {
          setBranches((prev) =>
            prev.map((b) => {
              const comp = comparisons.find((c) => c.name === b.name);
              return comp ? { ...b, ahead_by: comp.ahead, behind_by: comp.behind } : b;
            })
          );
        });
      }
      if (append) {
        setBranches((prev) => [...prev, ...branchList]);
      } else {
        setBranches(branchList);
      }
      setHasNextPage(result.hasNextPage);
      setPage(pageNum);
    } catch (err) {
      toast.error('加载分支列表失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [owner, repo]);

  useEffect(() => {
    loadBranches(1);
  }, [loadBranches]);

  const handleCreateBranch = async () => {
    if (!owner || !repo) return;
    if (!newBranchName.trim()) {
      toast.error('请输入分支名称');
      return;
    }
    setCreating(true);
    try {
      // 获取基础分支的 SHA
      const baseBranch = branches.find((b) => b.name === newBranchFrom);
      if (!baseBranch) {
        toast.error('找不到基础分支');
        return;
      }
      await createBranch(owner, repo, {
        ref: newBranchName.trim(),
        sha: baseBranch.commit.sha,
      });
      toast.success(`分支 ${newBranchName} 创建成功！`);
      setCreateDialogOpen(false);
      setNewBranchName('');
      loadBranches(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建分支失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteBranch = async () => {
    if (!owner || !repo || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteBranch(owner, repo, deleteTarget);
      setBranches((prev) => prev.filter((b) => b.name !== deleteTarget));
      toast.success(`分支 ${deleteTarget} 已删除`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>仓库</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">分支管理</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-primary" />
          分支管理
        </h1>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-2" />
              新建分支
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-foreground">创建新分支</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">分支名称 *</Label>
                <Input
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  placeholder="feature/my-feature"
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">基于分支</Label>
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
                  取消
                </Button>
                <Button
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleCreateBranch}
                  disabled={creating || !newBranchName.trim()}
                >
                  {creating ? '创建中...' : '创建'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* 分支列表 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4">
                <Skeleton className="h-5 w-1/3 bg-muted mb-2" />
                <Skeleton className="h-4 w-1/4 bg-muted" />
              </div>
            ))}
          </div>
        ) : branches.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">暂无分支</div>
        ) : (
          <div className="divide-y divide-border">
            {/* 默认分支排在最前 */}
            {[
              ...branches.filter((b) => b.name === defaultBranch),
              ...branches.filter((b) => b.name !== defaultBranch),
            ].map((branch) => (
              <div key={branch.name} className="p-4 flex items-center gap-3 group">
                <GitBranch className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-mono text-foreground">{branch.name}</code>
                    {branch.name === defaultBranch && (
                      <Badge variant="outline" className="text-xs border-primary/50 text-primary bg-primary/10">默认</Badge>
                    )}
                    {branch.protected && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Shield className="w-3 h-3" />
                        受保护
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    <span className="font-mono text-xs">{branch.commit.sha.substring(0, 7)}</span>
                    {branch.ahead_by !== undefined && branch.behind_by !== undefined && branch.name !== defaultBranch && (
                      <>
                        {branch.ahead_by > 0 && (
                          <span className="flex items-center gap-0.5 text-primary">
                            <ArrowUp className="w-3 h-3" />{branch.ahead_by} 领先
                          </span>
                        )}
                        {branch.behind_by > 0 && (
                          <span className="flex items-center gap-0.5 text-muted-foreground">
                            <ArrowDown className="w-3 h-3" />{branch.behind_by} 落后
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {branch.name !== defaultBranch && !branch.protected && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                    onClick={() => setDeleteTarget(branch.name)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
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
            onClick={() => loadBranches(page + 1, true)}
          >
            加载更多
          </Button>
        </div>
      )}

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">确认删除分支</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              确定要删除分支 <code className="font-mono text-foreground">{deleteTarget}</code> 吗？此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground hover:bg-secondary">取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteBranch}
              disabled={deleting}
            >
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
