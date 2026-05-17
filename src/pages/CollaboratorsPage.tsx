// 协作者管理页

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Users,
  Plus,
  Trash2,
  Shield,
  ChevronRight,
  UserCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getCollaborators,
  addCollaborator,
  removeCollaborator,
  updateCollaboratorPermission,
} from '@/services/github';
import type { GitHubCollaborator } from '@/types/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const PERMISSION_LABELS: Record<string, string> = {
  pull: '读取',
  triage: '分类',
  push: '推送',
  maintain: '维护',
  admin: '管理员',
};

export default function CollaboratorsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [collaborators, setCollaborators] = useState<GitHubCollaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPermission, setNewPermission] = useState<'pull' | 'triage' | 'push' | 'maintain' | 'admin'>('push');
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const loadCollaborators = useCallback(async () => {
    if (!owner || !repo) return;
    setLoading(true);
    try {
      const result = await getCollaborators(owner, repo);
      setCollaborators(result.data);
    } catch (err) {
      toast.error('加载协作者列表失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [owner, repo]);

  useEffect(() => {
    loadCollaborators();
  }, [loadCollaborators]);

  const handleAdd = async () => {
    if (!owner || !repo) return;
    if (!newUsername.trim()) {
      toast.error('请输入用户名');
      return;
    }
    setAdding(true);
    try {
      await addCollaborator(owner, repo, newUsername.trim(), newPermission);
      toast.success(`已邀请 ${newUsername} 成为协作者`);
      setAddDialogOpen(false);
      setNewUsername('');
      setNewPermission('push');
      loadCollaborators();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '邀请失败');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async () => {
    if (!owner || !repo || !removeTarget) return;
    setRemoving(true);
    try {
      await removeCollaborator(owner, repo, removeTarget);
      setCollaborators((prev) => prev.filter((c) => c.login !== removeTarget));
      toast.success(`已移除协作者 ${removeTarget}`);
      setRemoveTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '移除失败');
    } finally {
      setRemoving(false);
    }
  };

  const handlePermissionChange = async (login: string, permission: 'pull' | 'triage' | 'push' | 'maintain' | 'admin') => {
    if (!owner || !repo) return;
    try {
      await updateCollaboratorPermission(owner, repo, login, permission);
      setCollaborators((prev) =>
        prev.map((c) =>
          c.login === login
            ? { ...c, role_name: permission, permissions: { ...c.permissions, [permission]: true } }
            : c
        )
      );
      toast.success(`已更新 ${login} 的权限`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新权限失败');
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
        <span className="text-foreground">协作者</span>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          协作者管理
        </h1>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-2" />
              邀请协作者
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-foreground">邀请协作者</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">GitHub 用户名 *</Label>
                <Input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="octocat"
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">权限级别</Label>
                <Select value={newPermission} onValueChange={(v) => setNewPermission(v as typeof newPermission)}>
                  <SelectTrigger className="bg-secondary border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key} className="text-foreground">
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 border-border hover:bg-secondary"
                  onClick={() => setAddDialogOpen(false)}
                >
                  取消
                </Button>
                <Button
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleAdd}
                  disabled={adding || !newUsername.trim()}
                >
                  {adding ? '邀请中...' : '发送邀请'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* 协作者列表 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-full bg-muted" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-32 bg-muted mb-1" />
                  <Skeleton className="h-3 w-20 bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : collaborators.length === 0 ? (
          <div className="py-16 text-center">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-foreground font-medium">暂无协作者</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {collaborators.map((collaborator) => (
              <div key={collaborator.id} className="p-4 flex items-center gap-3 group">
                <Avatar className="w-10 h-10 shrink-0">
                  <AvatarImage src={collaborator.avatar_url} alt={collaborator.login} />
                  <AvatarFallback className="bg-secondary">
                    {collaborator.login.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <a
                      href={collaborator.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-accent hover:underline"
                    >
                      {collaborator.login}
                    </a>
                    {collaborator.login === user?.login && (
                      <Badge variant="outline" className="text-xs border-border text-muted-foreground">你</Badge>
                    )}
                    {collaborator.permissions?.admin && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Shield className="w-3 h-3" />
                        管理员
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <UserCheck className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {PERMISSION_LABELS[collaborator.role_name] || collaborator.role_name}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {collaborator.login !== user?.login && (
                    <>
                      <Select
                        value={collaborator.role_name}
                        onValueChange={(v) =>
                          handlePermissionChange(collaborator.login, v as 'pull' | 'triage' | 'push' | 'maintain' | 'admin')
                        }
                      >
                        <SelectTrigger className="bg-secondary border-border text-foreground w-24 h-8 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                            <SelectItem key={key} value={key} className="text-foreground text-sm">
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                        onClick={() => setRemoveTarget(collaborator.login)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 删除确认 */}
      <AlertDialog open={!!removeTarget} onOpenChange={() => setRemoveTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">确认移除协作者</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              确定要移除 <span className="font-medium text-foreground">{removeTarget}</span> 的协作者权限吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground hover:bg-secondary">取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleRemove}
              disabled={removing}
            >
              {removing ? '移除中...' : '确认移除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
