// GitHub Gist 代码片段管理

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Code2,
  Plus,
  Trash2,
  GitFork,
  Lock,
  Globe,
  Clock,
  X,
  Save,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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
  getGists,
  deleteGist,
  createGist,
  forkGist,
  formatRelativeTime,
} from '@/services/github';
import type { GitHubGist } from '@/types/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export default function GistsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [gists, setGists] = useState<GitHubGist[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [forking, setForking] = useState<string | null>(null);
  // 创建表单
  const [newDesc, setNewDesc] = useState('');
  const [newFilename, setNewFilename] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newPublic, setNewPublic] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadGists = useCallback(async (pg = 1, append = false) => {
    if (pg === 1) setLoading(true);
    try {
      const data = await getGists({ per_page: 20, page: pg });
      if (append) setGists((prev) => [...prev, ...data]);
      else setGists(data);
      setHasMore(data.length === 20);
      setPage(pg);
    } catch (err) {
      toast.error('加载 Gist 列表失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadGists(1); }, [loadGists]);

  const handleCreate = async () => {
    if (!newFilename.trim()) { toast.error('请输入文件名'); return; }
    if (!newContent.trim()) { toast.error('请输入文件内容'); return; }
    setCreating(true);
    try {
      await createGist({
        description: newDesc.trim(),
        public: newPublic,
        files: { [newFilename.trim()]: { content: newContent } },
      });
      toast.success('Gist 创建成功');
      setCreateOpen(false);
      setNewDesc(''); setNewFilename(''); setNewContent(''); setNewPublic(true);
      loadGists(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteGist(deleteTarget);
      setGists((prev) => prev.filter((g) => g.id !== deleteTarget));
      toast.success('Gist 已删除');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleFork = async (gistId: string) => {
    setForking(gistId);
    try {
      await forkGist(gistId);
      toast.success('已 Fork Gist');
      loadGists(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fork 失败');
    } finally {
      setForking(null);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Code2 className="w-5 h-5 text-primary" />
          我的 Gists
        </h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-2" />
              新建 Gist
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-foreground">创建 Gist</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">描述（可选）</Label>
                <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="描述这个 Gist..." className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">文件名 *</Label>
                <Input value={newFilename} onChange={(e) => setNewFilename(e.target.value)} placeholder="example.js" className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">内容 *</Label>
                <Textarea value={newContent} onChange={(e) => setNewContent(e.target.value)} placeholder="// 代码内容..." className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono text-xs min-h-32 resize-none" />
              </div>
              <div className="flex items-center gap-3">
                <Switch id="gist-public" checked={newPublic} onCheckedChange={setNewPublic} />
                <Label htmlFor="gist-public" className="text-sm text-foreground cursor-pointer flex items-center gap-1.5">
                  {newPublic ? <><Globe className="w-3.5 h-3.5 text-primary" />公开</>
                    : <><Lock className="w-3.5 h-3.5 text-muted-foreground" />私密</>}
                </Label>
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="ghost" className="flex-1 border border-border text-muted-foreground hover:bg-secondary" onClick={() => setCreateOpen(false)}>
                  <X className="w-4 h-4 mr-2" />取消
                </Button>
                <Button className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleCreate} disabled={creating || !newFilename.trim() || !newContent.trim()}>
                  <Save className="w-4 h-4 mr-2" />
                  {creating ? '创建中...' : '创建'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {[1,2,3,4].map(i => (
              <div key={i} className="p-4">
                <Skeleton className="h-5 w-1/2 bg-muted mb-2" />
                <Skeleton className="h-4 w-1/3 bg-muted" />
              </div>
            ))}
          </div>
        ) : gists.length === 0 ? (
          <div className="py-16 text-center">
            <Code2 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">暂无 Gist</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {gists.map((gist) => {
              const files = Object.values(gist.files);
              const firstFile = files[0];
              return (
                <div key={gist.id} className="p-4 group hover:bg-secondary/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <Avatar className="w-8 h-8 shrink-0 mt-0.5">
                      <AvatarImage src={gist.owner?.avatar_url} />
                      <AvatarFallback className="bg-secondary text-xs">{gist.owner?.login?.substring(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          type="button"
                          className="text-sm font-medium text-accent hover:underline font-mono"
                          onClick={() => navigate(`/gists/${gist.id}`)}
                        >
                          {firstFile?.filename || gist.id.substring(0, 8)}
                        </button>
                        {files.length > 1 && (
                          <span className="text-xs text-muted-foreground">+{files.length - 1} 个文件</span>
                        )}
                        <Badge variant="outline" className={`text-xs shrink-0 ${gist.public ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'}`}>
                          {gist.public ? <><Globe className="w-2.5 h-2.5 mr-1" />公开</> : <><Lock className="w-2.5 h-2.5 mr-1" />私密</>}
                        </Badge>
                      </div>
                      {gist.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{gist.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatRelativeTime(gist.updated_at)}</span>
                        <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{gist.comments} 评论</span>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      {gist.owner?.login !== user?.login && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-8 h-8 text-muted-foreground hover:text-accent hover:bg-accent/10"
                          onClick={() => handleFork(gist.id)}
                          disabled={forking === gist.id}
                          title="Fork"
                        >
                          <GitFork className="w-4 h-4" />
                        </Button>
                      )}
                      {gist.owner?.login === user?.login && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteTarget(gist.id)}
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {hasMore && !loading && (
        <Button variant="ghost" className="w-full border border-border text-muted-foreground hover:bg-secondary" onClick={() => loadGists(page + 1, true)}>
          加载更多
        </Button>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">确认删除 Gist</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">此操作无法撤销，Gist 将被永久删除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete} disabled={deleting}>
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
