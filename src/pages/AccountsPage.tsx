// 多账号切换管理

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Plus,
  Trash2,
  CheckCircle2,
  LogIn,
  Eye,
  EyeOff,
  X,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { SavedAccount } from '@/types/types';
import i18n from "@/i18n";

export default function AccountsPage() {
  const navigate = useNavigate();
  const { user, token, savedAccounts, login, switchAccount, removeAccount, logout } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [adding, setAdding] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedAccount | null>(null);

  const handleAdd = async () => {
    if (!newToken.trim()) { toast.error(i18n.t('请输入 Token')); return; }
    setAdding(true);
    try {
      await login(newToken.trim());
      toast.success(i18n.t('账号添加成功'));
      setAddOpen(false);
      setNewToken('');
    } catch {
      toast.error(i18n.t('Token 无效，请检查后重试'));
    } finally {
      setAdding(false);
    }
  };

  const handleSwitch = async (acc: SavedAccount) => {
    if (acc.token === token) return;
    setSwitching(acc.token);
    try {
      await switchAccount(acc.token);
      toast.success(`已切换到 ${acc.user.login}`);
      navigate('/');
    } catch {
      toast.error(i18n.t('切换失败，Token 可能已失效'));
    } finally {
      setSwitching(null);
    }
  };

  const handleRemove = (acc: SavedAccount) => {
    if (acc.token === token) {
      toast.error(i18n.t('无法删除当前使用的账号，请先切换到其他账号'));
      return;
    }
    setDeleteTarget(acc);
  };

  const confirmRemove = () => {
    if (!deleteTarget) return;
    removeAccount(deleteTarget.token);
    toast.success(`账号 ${deleteTarget.user.login} 已删除`);
    setDeleteTarget(null);
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          {i18n.t('账号管理')}</h1>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-2" />
              {i18n.t('添加账号')}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-foreground">{i18n.t('添加 GitHub 账号')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="bg-secondary/50 border border-border rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 text-warning" />{i18n.t('Token 安全提示')}</p>
                <p>{i18n.t('请使用 GitHub Settings → Developer settings → Personal access tokens 中生成的 Token。Token 仅存储在本地浏览器中。')}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-normal text-foreground">Personal Access Token *</Label>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    value={newToken}
                    onChange={(e) => setNewToken(e.target.value)}
                    placeholder="ghp_xxxxxxxxxxxx"
                    className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono pr-10"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-transparent"
                    onClick={() => setShowToken(!showToken)}
                  >
                    {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="ghost" className="flex-1 border border-border text-muted-foreground hover:bg-secondary" onClick={() => { setAddOpen(false); setNewToken(''); }}>
                  <X className="w-4 h-4 mr-2" />{i18n.t('取消')}</Button>
                <Button className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleAdd} disabled={adding || !newToken.trim()}>
                  <LogIn className="w-4 h-4 mr-2" />
                  {adding ? i18n.t('验证中...') : i18n.t('添加并登录')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {savedAccounts.length === 0 ? (
        <div className="bg-card border border-border rounded-lg py-16 text-center">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium">{i18n.t('暂无已保存的账号')}</p>
          <p className="text-sm text-muted-foreground mt-1">{i18n.t('点击"添加账号"开始管理多个 GitHub 账号')}</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border">
          {savedAccounts.map((acc) => {
            const isCurrent = acc.token === token;
            const isSwitching = switching === acc.token;
            return (
              <div key={acc.token} className="flex items-center gap-3 p-4 group hover:bg-secondary/30 transition-colors">
                <Avatar className="w-10 h-10 shrink-0">
                  <AvatarImage src={acc.user.avatar_url} />
                  <AvatarFallback className="bg-secondary text-sm">{acc.user.login.substring(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{acc.user.login}</span>
                    {isCurrent && (
                      <Badge className="bg-primary/10 text-primary border-primary/30 text-xs flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />{i18n.t('当前账号')}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{acc.user.name || acc.user.login}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {acc.token.substring(0, 8)}...{acc.token.substring(acc.token.length - 4)}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {!isCurrent && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="border border-border text-muted-foreground hover:bg-secondary h-8 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                      onClick={() => handleSwitch(acc)}
                      disabled={!!switching}
                    >
                      {isSwitching ? (
                        <><span className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin mr-1.5" />{i18n.t('切换中')}</>
                      ) : (
                        <><LogIn className="w-3.5 h-3.5 mr-1.5" />{i18n.t('切换')}</>
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => handleRemove(acc)}
                    title={isCurrent ? i18n.t('无法删除当前账号') : i18n.t('删除账号')}
                    disabled={isCurrent}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 当前账号 logout */}
      {user && (
        <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground">{i18n.t('当前已登录为')}<span className="text-foreground font-medium">{user.login}</span></p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="border border-destructive/40 text-destructive hover:bg-destructive/10 h-8 shrink-0"
            onClick={() => { logout(); navigate('/login'); }}
          >
            {i18n.t('退出登录')}</Button>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">{i18n.t('确认删除账号')}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {i18n.t('将从本地删除账号')}<strong className="text-foreground">{deleteTarget?.user.login}</strong> {i18n.t('的 Token 记录，此操作不可撤销。')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">{i18n.t('取消')}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmRemove}>
              {i18n.t('确认删除')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
