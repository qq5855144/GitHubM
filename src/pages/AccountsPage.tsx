// 账号中心：本机 Token 管理 + 账号资料 + 账号级安全操作
//
// 设计说明（重要）：
// GitHub 官方 REST API 并不提供「列出 / 创建 Personal Access Token」的接口。
// 因此本页的 Token 管理是可落地的那部分：
//   1) 管理本机保存的多个 Token（备注、切换、复制、删除）
//   2) 验证 Token 并读取其真实元信息（类型 / 作用域 / 过期时间 / 速率额度）
//   3) 提供一键跳转 GitHub 官方页面创建 / 吊销 Token
// 同时补齐真正可用的账号级操作：资料编辑、邮箱、SSH 公钥、GPG 公钥。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Loader2,
  LogIn,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  addEmail,
  addGpgKey,
  addSshKey,
  deleteEmail,
  deleteGpgKey,
  deleteSshKey,
  getEmails,
  getGpgKeys,
  getSshKeys,
  getTokenMetadata,
  updateEmail,
  updateUserProfile,
  type TokenMetadata,
} from '@/services/github';
import type { GitHubEmail, GitHubGpgKey, GitHubSshKey, SavedAccount } from '@/types/types';
import { toast } from 'sonner';
import i18n from '@/i18n';

type TabKey = 'accounts' | 'tokens' | 'security';

const TOKEN_TYPE_LABEL: Record<string, string> = {
  classic: i18n.t('经典 PAT'),
  'fine-grained': i18n.t('细粒度 PAT'),
  oauth: 'OAuth',
  unknown: i18n.t('未知'),
};

/** GitHub 官方新建 Token 页面（预填经典 PAT 所需 scope） */
const NEW_TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo,read:user,user:email,read:public_key,write:public_key,read:gpg_key,write:gpg_key&description=GitHub%20Manager';

function maskToken(token: string): string {
  if (token.length <= 12) return `${token.slice(0, 4)}****`;
  return `${token.slice(0, 8)}${'*'.repeat(12)}${token.slice(-4)}`;
}

function tokenTypeOf(account: SavedAccount): string {
  return account.tokenType || TOKEN_TYPE_LABEL.unknown;
}

function ExpiryBadge({ meta }: { meta: TokenMetadata }) {
  if (meta.daysUntilExpiry === null) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="w-3 h-3" />
        {i18n.t('无过期时间')}
      </span>
    );
  }
  const expired = meta.daysUntilExpiry <= 0;
  const warning = meta.daysUntilExpiry <= 14;
  return (
    <span
      className={`flex items-center gap-1 text-xs ${
        expired ? 'text-destructive' : warning ? 'text-warning' : 'text-muted-foreground'
      }`}
    >
      {expired ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
      {expired
        ? i18n.t('已过期')
        : `${i18n.t('剩余')} ${meta.daysUntilExpiry} ${i18n.t('天')}`}
    </span>
  );
}

export default function AccountsPage() {
  const navigate = useNavigate();
  const {
    user,
    token,
    savedAccounts,
    login,
    switchAccount,
    removeAccount,
    renameAccount,
    updateAccountMeta,
    updateUser,
    logout,
  } = useAuth();

  const [tab, setTab] = useState<TabKey>('accounts');

  // ── 添加账号 ────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [adding, setAdding] = useState(false);

  // ── 账号切换 / 删除 ─────────────────────────────────────────
  const [switching, setSwitching] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedAccount | null>(null);

  // ── Token 元信息 ────────────────────────────────────────────
  const [metaMap, setMetaMap] = useState<Record<string, TokenMetadata>>({});
  const [metaError, setMetaError] = useState<Record<string, string>>({});
  const [metaLoading, setMetaLoading] = useState<Set<string>>(new Set());
  const [verifyingAll, setVerifyingAll] = useState(false);

  // ── 备注编辑 ────────────────────────────────────────────────
  const [editingLabelToken, setEditingLabelToken] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');

  // ── 资料编辑 ────────────────────────────────────────────────
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: '',
    bio: '',
    company: '',
    location: '',
    blog: '',
    twitter_username: '',
  });

  // ── 安全操作 ────────────────────────────────────────────────
  const [emails, setEmails] = useState<GitHubEmail[]>([]);
  const [sshKeys, setSshKeys] = useState<GitHubSshKey[]>([]);
  const [gpgKeys, setGpgKeys] = useState<GitHubGpgKey[]>([]);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityError, setSecurityError] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [sshOpen, setSshOpen] = useState(false);
  const [sshTitle, setSshTitle] = useState('');
  const [sshKeyDraft, setSshKeyDraft] = useState('');
  const [gpgOpen, setGpgOpen] = useState(false);
  const [gpgDraft, setGpgDraft] = useState('');
  const [securitySaving, setSecuritySaving] = useState(false);

  const verifyOne = useCallback(
    async (targetToken: string, persist = true) => {
      setMetaLoading((prev) => new Set(prev).add(targetToken));
      setMetaError((prev) => {
        const next = { ...prev };
        delete next[targetToken];
        return next;
      });
      try {
        const meta = await getTokenMetadata(targetToken);
        setMetaMap((prev) => ({ ...prev, [targetToken]: meta }));
        if (persist) {
          updateAccountMeta(targetToken, {
            tokenType: meta.tokenType,
            scopes: meta.scopes,
            expiresAt: meta.expiresAt,
            lastVerifiedAt: new Date().toISOString(),
          });
        }
        return meta;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setMetaError((prev) => ({ ...prev, [targetToken]: message }));
        return null;
      } finally {
        setMetaLoading((prev) => {
          const next = new Set(prev);
          next.delete(targetToken);
          return next;
        });
      }
    },
    [updateAccountMeta]
  );

  // 当前 Token 自动验证一次（其余按需；失败也不重复重试，避免请求风暴）
  const autoVerifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (token && !metaMap[token] && !autoVerifiedRef.current.has(token)) {
      autoVerifiedRef.current.add(token);
      verifyOne(token, false);
    }
  }, [token, metaMap, verifyOne]);

  const verifyAll = async () => {
    setVerifyingAll(true);
    try {
      for (const acc of savedAccounts) {
        await verifyOne(acc.token);
      }
      toast.success(i18n.t('Token 检测完成'));
    } finally {
      setVerifyingAll(false);
    }
  };

  const handleAdd = async () => {
    if (!newToken.trim()) {
      toast.error(i18n.t('请输入 Token'));
      return;
    }
    setAdding(true);
    try {
      await login(newToken.trim());
      toast.success(i18n.t('账号添加成功'));
      setAddOpen(false);
      setNewToken('');
      // 添加后立刻读取作用域 / 过期信息
      verifyOne(newToken.trim(), true);
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

  const copyToken = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(i18n.t('Token 已复制'));
    } catch {
      toast.error(i18n.t('复制失败'));
    }
  };

  const openProfileDialog = () => {
    if (!user) return;
    setProfileForm({
      name: user.name || '',
      bio: user.bio || '',
      company: user.company || '',
      location: user.location || '',
      blog: user.blog || '',
      twitter_username: user.twitter_username || '',
    });
    setProfileOpen(true);
  };

  const handleSaveProfile = async () => {
    setProfileSaving(true);
    try {
      const updated = await updateUserProfile({
        name: profileForm.name,
        bio: profileForm.bio,
        company: profileForm.company,
        location: profileForm.location,
        blog: profileForm.blog,
        twitter_username: profileForm.twitter_username,
      });
      updateUser(updated);
      toast.success(i18n.t('资料已更新'));
      setProfileOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('更新失败，请检查 Token 权限'));
    } finally {
      setProfileSaving(false);
    }
  };

  // ── 安全数据加载 ────────────────────────────────────────────
  const loadSecurity = useCallback(async () => {
    if (!token) return;
    setSecurityLoading(true);
    setSecurityError('');
    const results = await Promise.allSettled([getEmails(), getSshKeys(), getGpgKeys()]);
    const [emailRes, sshRes, gpgRes] = results;
    if (emailRes.status === 'fulfilled') setEmails(emailRes.value);
    if (sshRes.status === 'fulfilled') setSshKeys(sshRes.value);
    if (gpgRes.status === 'fulfilled') setGpgKeys(gpgRes.value);

    const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    if (failures.length === results.length) {
      const first = failures[0]?.reason;
      setSecurityError(
        (first instanceof Error ? first.message : '') ||
          i18n.t('当前 Token 缺少 user:email / read:public_key / read:gpg_key 权限')
      );
    }
    setSecurityLoading(false);
  }, [token]);

  useEffect(() => {
    if (tab === 'security') loadSecurity();
  }, [tab, loadSecurity]);

  const handleAddEmail = async () => {
    if (!emailDraft.trim()) return;
    setSecuritySaving(true);
    try {
      await addEmail(emailDraft.trim());
      setEmailDraft('');
      setEmailOpen(false);
      await loadSecurity();
      toast.success(i18n.t('邮箱已添加，请到邮箱内完成验证'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('添加失败，请检查 user:email 权限'));
    } finally {
      setSecuritySaving(false);
    }
  };

  const handleDeleteEmail = async (email: string) => {
    try {
      await deleteEmail(email);
      await loadSecurity();
      toast.success(i18n.t('邮箱已删除'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('删除失败'));
    }
  };

  const handlePrimaryEmail = async (email: string) => {
    try {
      await updateEmail(email, { primary: true });
      await loadSecurity();
      toast.success(i18n.t('已设为主邮箱'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('设置失败'));
    }
  };

  const handleAddSsh = async () => {
    if (!sshTitle.trim() || !sshKeyDraft.trim()) return;
    setSecuritySaving(true);
    try {
      await addSshKey(sshTitle.trim(), sshKeyDraft.trim());
      setSshTitle('');
      setSshKeyDraft('');
      setSshOpen(false);
      await loadSecurity();
      toast.success(i18n.t('SSH 公钥已添加'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('添加失败，请检查 write:public_key 权限'));
    } finally {
      setSecuritySaving(false);
    }
  };

  const handleAddGpg = async () => {
    if (!gpgDraft.trim()) return;
    setSecuritySaving(true);
    try {
      await addGpgKey(gpgDraft.trim());
      setGpgDraft('');
      setGpgOpen(false);
      await loadSecurity();
      toast.success(i18n.t('GPG 公钥已添加'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('添加失败，请检查 write:gpg_key 权限'));
    } finally {
      setSecuritySaving(false);
    }
  };

  const currentMeta = token ? metaMap[token] : undefined;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          {i18n.t('账号管理')}
        </h1>
        <div className="flex items-center gap-2">
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-2" />
                {i18n.t('添加账号')}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-foreground">{i18n.t('添加 GitHub 账号')}</DialogTitle>
                <DialogDescription className="text-muted-foreground text-xs">
                  {i18n.t('Token 仅保存在本机浏览器存储中，不会上传到任何第三方服务器。')}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="bg-secondary/50 border border-border rounded-lg p-3 text-xs text-muted-foreground space-y-1.5">
                  <p className="font-medium text-foreground flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-warning" />
                    {i18n.t('推荐的 Token 权限')}
                  </p>
                  <p>{i18n.t('repo（仓库读写）、read:user（读取资料）、user:email（邮箱）、read/write:public_key（SSH）、read/write:gpg_key（GPG）')}</p>
                  <a
                    href={NEW_TOKEN_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {i18n.t('前往 GitHub 创建 Token')}
                  </a>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal text-foreground">Personal Access Token *</Label>
                  <div className="relative">
                    <Input
                      type={showToken ? 'text' : 'password'}
                      value={newToken}
                      onChange={(e) => setNewToken(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxx / github_pat_xxxxxxxx"
                      className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono pr-10"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAdd();
                      }}
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
                  <Button
                    variant="ghost"
                    className="flex-1 border border-border text-muted-foreground hover:bg-secondary"
                    onClick={() => {
                      setAddOpen(false);
                      setNewToken('');
                    }}
                  >
                    <X className="w-4 h-4 mr-2" />
                    {i18n.t('取消')}
                  </Button>
                  <Button
                    className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={handleAdd}
                    disabled={adding || !newToken.trim()}
                  >
                    <LogIn className="w-4 h-4 mr-2" />
                    {adding ? i18n.t('验证中...') : i18n.t('添加并登录')}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-3">
        <TabsList className="bg-secondary border border-border w-full grid grid-cols-3">
          <TabsTrigger value="accounts" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground">
            <Users className="w-3.5 h-3.5 mr-1.5" />
            {i18n.t('账号')}
          </TabsTrigger>
          <TabsTrigger value="tokens" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground">
            <KeyRound className="w-3.5 h-3.5 mr-1.5" />
            Token
          </TabsTrigger>
          <TabsTrigger value="security" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5 mr-1.5" />
            {i18n.t('安全')}
          </TabsTrigger>
        </TabsList>

        {/* ═══════════ 账号 ═══════════ */}
        <TabsContent value="accounts" className="space-y-3">
          {user && (
            <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
              <Avatar className="w-12 h-12 shrink-0">
                <AvatarImage src={user.avatar_url} alt={user.login} />
                <AvatarFallback className="bg-secondary text-sm font-semibold">
                  {user.login.substring(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-foreground">{user.name || user.login}</span>
                  <Badge className="bg-primary/10 text-primary border-primary/30 text-xs">
                    {i18n.t('当前账号')}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">@{user.login}</p>
                {currentMeta && (
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border text-muted-foreground">
                      {TOKEN_TYPE_LABEL[currentMeta.tokenType] || currentMeta.tokenType}
                    </Badge>
                    <ExpiryBadge meta={currentMeta} />
                    <span className="text-[11px] text-muted-foreground">
                      API {currentMeta.rateLimit?.remaining ?? '—'}/{currentMeta.rateLimit?.limit ?? '—'}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" className="h-8 border border-border" onClick={openProfileDialog}>
                  <UserCog className="w-3.5 h-3.5 mr-1.5" />
                  {i18n.t('编辑资料')}
                </Button>
              </div>
            </div>
          )}

          {savedAccounts.length === 0 ? (
            <div className="bg-card border border-border rounded-lg py-16 text-center">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-foreground font-medium">{i18n.t('暂无已保存的账号')}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {i18n.t('点击"添加账号"开始管理多个 GitHub 账号')}
              </p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border">
              {savedAccounts.map((acc) => {
                const isCurrent = acc.token === token;
                const isSwitching = switching === acc.token;
                const meta = metaMap[acc.token];
                return (
                  <div key={acc.token} className="flex items-center gap-3 p-4 group hover:bg-secondary/30 transition-colors">
                    <Avatar className="w-10 h-10 shrink-0">
                      <AvatarImage src={acc.user.avatar_url} />
                      <AvatarFallback className="bg-secondary text-sm">
                        {acc.user.login.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{acc.user.login}</span>
                        {acc.label && (
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border text-muted-foreground">
                            {acc.label}
                          </Badge>
                        )}
                        {isCurrent && (
                          <Badge className="bg-primary/10 text-primary border-primary/30 text-xs flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            {i18n.t('当前账号')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {acc.user.name || acc.user.login}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <p className="text-xs text-muted-foreground font-mono">{maskToken(acc.token)}</p>
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border text-muted-foreground">
                          {TOKEN_TYPE_LABEL[acc.tokenType || 'unknown'] || tokenTypeOf(acc)}
                        </Badge>
                        {meta && <ExpiryBadge meta={meta} />}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {!isCurrent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="border border-border text-muted-foreground hover:bg-secondary h-8 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                          onClick={() => handleSwitch(acc)}
                          disabled={!!switching}
                        >
                          {isSwitching ? (
                            <>
                              <span className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin mr-1.5" />
                              {i18n.t('切换中')}
                            </>
                          ) : (
                            <>
                              <LogIn className="w-3.5 h-3.5 mr-1.5" />
                              {i18n.t('切换')}
                            </>
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-8 h-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
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

          {user && (
            <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-muted-foreground">
                  {i18n.t('当前已登录为')} <span className="text-foreground font-medium">{user.login}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {i18n.t('退出登录仅清除本机 Token，不会影响 GitHub 上的 Token 本身。')}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="border border-destructive/40 text-destructive hover:bg-destructive/10 h-8 shrink-0"
                onClick={() => {
                  logout();
                  navigate('/login');
                }}
              >
                {i18n.t('退出登录')}
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ═══════════ Token ═══════════ */}
        <TabsContent value="tokens" className="space-y-3">
          <div className="bg-secondary/40 border border-border rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p className="text-foreground font-medium flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-warning" />
              {i18n.t('关于 Token 管理的边界')}
            </p>
            <p>
              {i18n.t('GitHub 没有开放「列出 / 创建 Personal Access Token」的 API。本页管理的是已经保存在本机的 Token，并通过 GitHub 接口读取它真实的类型、作用域、过期时间与速率额度。')}
            </p>
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              {i18n.t('前往 GitHub 管理 / 吊销 Token')}
            </a>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {i18n.t('本机共保存')} {savedAccounts.length} {i18n.t('个 Token')}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="border-border h-8"
              onClick={verifyAll}
              disabled={verifyingAll || savedAccounts.length === 0}
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${verifyingAll ? 'animate-spin' : ''}`} />
              {i18n.t('全部检测')}
            </Button>
          </div>

          {savedAccounts.length === 0 ? (
            <div className="bg-card border border-border rounded-lg py-12 text-center text-muted-foreground">
              <KeyRound className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{i18n.t('还没有保存任何 Token')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedAccounts.map((acc) => {
                const meta = metaMap[acc.token];
                const error = metaError[acc.token];
                const loading = metaLoading.has(acc.token);
                const isCurrent = acc.token === token;
                return (
                  <div key={acc.token} className="bg-card border border-border rounded-lg p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <Avatar className="w-9 h-9 shrink-0">
                        <AvatarImage src={acc.user.avatar_url} />
                        <AvatarFallback className="bg-secondary text-xs">
                          {acc.user.login.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-foreground">{acc.user.login}</span>
                          {isCurrent && (
                            <Badge className="bg-primary/10 text-primary border-primary/30 text-[10px]">
                              {i18n.t('使用中')}
                            </Badge>
                          )}
                          {acc.label && (
                            <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                              {acc.label}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5 break-all">
                          {maskToken(acc.token)}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {i18n.t('添加于')} {new Date(acc.addedAt).toLocaleDateString('zh-CN')}
                          {acc.lastVerifiedAt
                            ? ` · ${i18n.t('最近验证')} ${new Date(acc.lastVerifiedAt).toLocaleString('zh-CN')}`
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-muted-foreground hover:bg-secondary"
                          title={i18n.t('复制 Token')}
                          onClick={() => copyToken(acc.token)}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-muted-foreground hover:bg-secondary"
                          title={i18n.t('验证并刷新信息')}
                          onClick={() => verifyOne(acc.token)}
                          disabled={loading}
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-7 h-7 text-muted-foreground hover:bg-secondary"
                          title={i18n.t('编辑备注')}
                          onClick={() => {
                            setEditingLabelToken(acc.token);
                            setLabelDraft(acc.label || '');
                          }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>

                    {editingLabelToken === acc.token && (
                      <div className="flex items-center gap-2">
                        <Input
                          value={labelDraft}
                          onChange={(e) => setLabelDraft(e.target.value)}
                          placeholder={i18n.t('例如：工作号 / 只读 Token')}
                          className="h-8 bg-secondary border-border text-foreground text-xs"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              renameAccount(acc.token, labelDraft);
                              setEditingLabelToken(null);
                              toast.success(i18n.t('备注已保存'));
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          className="h-8 bg-primary text-primary-foreground"
                          onClick={() => {
                            renameAccount(acc.token, labelDraft);
                            setEditingLabelToken(null);
                            toast.success(i18n.t('备注已保存'));
                          }}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-muted-foreground"
                          onClick={() => setEditingLabelToken(null)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}

                    {error ? (
                      <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-2.5 py-2">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span className="break-all">{i18n.t('验证失败')}：{error}</span>
                      </div>
                    ) : meta ? (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border text-muted-foreground">
                            {TOKEN_TYPE_LABEL[meta.tokenType] || meta.tokenType}
                          </Badge>
                          <ExpiryBadge meta={meta} />
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            API {meta.rateLimit?.remaining ?? '—'}/{meta.rateLimit?.limit ?? '—'}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {meta.scopes.length > 0 ? (
                            meta.scopes.map((scope) => (
                              <Badge
                                key={scope}
                                variant="outline"
                                className="text-[10px] h-4 px-1.5 border-primary/30 text-primary bg-primary/5 font-mono"
                              >
                                {scope}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              {i18n.t('该 Token 未返回作用域（细粒度 Token 属于正常现象，权限以 GitHub 页面配置为准）')}
                            </span>
                          )}
                        </div>
                        {meta.expiresAt && (
                          <p className="text-[11px] text-muted-foreground">
                            {i18n.t('过期时间')}：{new Date(meta.expiresAt).toLocaleString('zh-CN')}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {loading ? i18n.t('正在读取 Token 信息...') : i18n.t('点击刷新按钮验证此 Token')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="bg-card border border-border rounded-lg p-4 space-y-2">
            <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <KeyRound className="w-4 h-4 text-primary" />
              {i18n.t('新建 Token')}
            </p>
            <p className="text-xs text-muted-foreground">
              {i18n.t('经典 PAT 可勾选 repo、read:user、user:email、read/write:public_key、read/write:gpg_key；细粒度 Token 需在仓库权限中授予 Contents / Issues / Pull requests 读写。')}
            </p>
            <a href={NEW_TOKEN_URL} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="border-border h-8">
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                {i18n.t('前往 GitHub 创建经典 PAT')}
              </Button>
            </a>
          </div>
        </TabsContent>

        {/* ═══════════ 安全 ═══════════ */}
        <TabsContent value="security" className="space-y-3">
          {securityError && (
            <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p>{i18n.t('部分安全功能不可用：')}{securityError}</p>
                <p className="text-muted-foreground mt-1">
                  {i18n.t('请在 GitHub Token 设置中补充 user:email / read:public_key / write:public_key / read:gpg_key / write:gpg_key 权限。')}
                </p>
              </div>
            </div>
          )}

          {/* 邮箱 */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <Mail className="w-4 h-4 text-primary" />
                {i18n.t('邮箱地址')}
              </p>
              <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 border border-border text-muted-foreground">
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    {i18n.t('添加')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
                  <DialogHeader>
                    <DialogTitle>{i18n.t('添加邮箱')}</DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground">
                      {i18n.t('需要 user:email 权限；添加后需在邮箱中点击验证链接。')}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <Input
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      placeholder="name@example.com"
                      className="bg-secondary border-border text-foreground"
                      type="email"
                    />
                    <Button
                      className="w-full bg-primary text-primary-foreground"
                      onClick={handleAddEmail}
                      disabled={securitySaving || !emailDraft.trim()}
                    >
                      {securitySaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      {i18n.t('添加邮箱')}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="divide-y divide-border">
              {securityLoading ? (
                <div className="p-4 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {i18n.t('加载中...')}
                </div>
              ) : emails.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">{i18n.t('暂无邮箱或缺少 user:email 权限')}</div>
              ) : (
                emails.map((mail) => (
                  <div key={mail.email} className="flex items-center gap-2 px-4 py-2.5">
                    <span className="text-sm text-foreground break-all flex-1">{mail.email}</span>
                    {mail.primary && (
                      <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                        {i18n.t('主邮箱')}
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${mail.verified ? 'border-success/40 text-success' : 'border-warning/40 text-warning'}`}
                    >
                      {mail.verified ? i18n.t('已验证') : i18n.t('待验证')}
                    </Badge>
                    {!mail.primary && mail.verified && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={() => handlePrimaryEmail(mail.email)}
                      >
                        {i18n.t('设为主邮箱')}
                      </Button>
                    )}
                    {!mail.primary && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="w-7 h-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteEmail(mail.email)}
                        title={i18n.t('删除邮箱')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* SSH */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-primary" />
                SSH {i18n.t('公钥')}
              </p>
              <Dialog open={sshOpen} onOpenChange={setSshOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 border border-border text-muted-foreground">
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    {i18n.t('添加')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
                  <DialogHeader>
                    <DialogTitle>{i18n.t('添加 SSH 公钥')}</DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground">
                      {i18n.t('粘贴以 ssh-rsa / ssh-ed25519 开头的公钥；需要 write:public_key 权限。')}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <Input
                      value={sshTitle}
                      onChange={(e) => setSshTitle(e.target.value)}
                      placeholder={i18n.t('标题，例如：我的手机')}
                      className="bg-secondary border-border text-foreground"
                    />
                    <Textarea
                      value={sshKeyDraft}
                      onChange={(e) => setSshKeyDraft(e.target.value)}
                      placeholder="ssh-ed25519 AAAA..."
                      className="bg-secondary border-border text-foreground font-mono text-xs min-h-28"
                    />
                    <Button
                      className="w-full bg-primary text-primary-foreground"
                      onClick={handleAddSsh}
                      disabled={securitySaving || !sshTitle.trim() || !sshKeyDraft.trim()}
                    >
                      {securitySaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      {i18n.t('添加 SSH 公钥')}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="divide-y divide-border">
              {securityLoading ? (
                <div className="p-4 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {i18n.t('加载中...')}
                </div>
              ) : sshKeys.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">{i18n.t('暂无 SSH 公钥或缺少 read:public_key 权限')}</div>
              ) : (
                sshKeys.map((key) => (
                  <div key={key.id} className="flex items-center gap-2 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{key.title}</p>
                      <p className="text-[11px] text-muted-foreground font-mono truncate">{key.key}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {i18n.t('添加于')} {new Date(key.created_at).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7 text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        try {
                          await deleteSshKey(key.id);
                          await loadSecurity();
                          toast.success(i18n.t('SSH 公钥已删除'));
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : i18n.t('删除失败'));
                        }
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* GPG */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-primary" />
                GPG {i18n.t('公钥')}
              </p>
              <Dialog open={gpgOpen} onOpenChange={setGpgOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 border border-border text-muted-foreground">
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    {i18n.t('添加')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
                  <DialogHeader>
                    <DialogTitle>{i18n.t('添加 GPG 公钥')}</DialogTitle>
                    <DialogDescription className="text-xs text-muted-foreground">
                      {i18n.t('粘贴 ASCII armor 格式公钥（-----BEGIN PGP PUBLIC KEY BLOCK-----）；需要 write:gpg_key 权限。')}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <Textarea
                      value={gpgDraft}
                      onChange={(e) => setGpgDraft(e.target.value)}
                      placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
                      className="bg-secondary border-border text-foreground font-mono text-xs min-h-40"
                    />
                    <Button
                      className="w-full bg-primary text-primary-foreground"
                      onClick={handleAddGpg}
                      disabled={securitySaving || !gpgDraft.trim()}
                    >
                      {securitySaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                      {i18n.t('添加 GPG 公钥')}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="divide-y divide-border">
              {securityLoading ? (
                <div className="p-4 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {i18n.t('加载中...')}
                </div>
              ) : gpgKeys.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">{i18n.t('暂无 GPG 公钥或缺少 read:gpg_key 权限')}</div>
              ) : (
                gpgKeys.map((key) => (
                  <div key={key.id} className="flex items-center gap-2 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground font-mono">{key.key_id}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {key.emails.map((e) => e.email).join(', ') || '—'}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {i18n.t('创建于')} {new Date(key.created_at).toLocaleDateString('zh-CN')}
                        {key.expires_at
                          ? ` · ${i18n.t('过期于')} ${new Date(key.expires_at).toLocaleDateString('zh-CN')}`
                          : ''}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7 text-muted-foreground hover:text-destructive"
                      onClick={async () => {
                        try {
                          await deleteGpgKey(key.id);
                          await loadSecurity();
                          toast.success(i18n.t('GPG 公钥已删除'));
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : i18n.t('删除失败'));
                        }
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {i18n.t('安全操作直接作用于你的 GitHub 账号，请谨慎删除密钥。本应用不会上传或备份你的 Token / 私钥。')}
          </p>
        </TabsContent>
      </Tabs>

      {/* 删除账号确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">{i18n.t('确认删除账号')}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {i18n.t('将从本机删除')}
              <strong className="text-foreground">{deleteTarget?.user.login}</strong>
              {i18n.t(' 的 Token 记录，此操作不可撤销。')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">{i18n.t('取消')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmRemove}
            >
              {i18n.t('确认删除')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 编辑资料 */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">{i18n.t('编辑 GitHub 资料')}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {i18n.t('通过 PATCH /user 更新，需要 Token 具备 write:user / user 权限。')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{i18n.t('昵称')}</Label>
                <Input
                  value={profileForm.name}
                  onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                  className="bg-secondary border-border text-foreground"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{i18n.t('公司')}</Label>
                <Input
                  value={profileForm.company}
                  onChange={(e) => setProfileForm({ ...profileForm, company: e.target.value })}
                  className="bg-secondary border-border text-foreground"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{i18n.t('所在地')}</Label>
                <Input
                  value={profileForm.location}
                  onChange={(e) => setProfileForm({ ...profileForm, location: e.target.value })}
                  className="bg-secondary border-border text-foreground"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{i18n.t('博客')}</Label>
                <Input
                  value={profileForm.blog}
                  onChange={(e) => setProfileForm({ ...profileForm, blog: e.target.value })}
                  className="bg-secondary border-border text-foreground"
                  placeholder="https://"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs text-muted-foreground">Twitter / X</Label>
                <Input
                  value={profileForm.twitter_username}
                  onChange={(e) => setProfileForm({ ...profileForm, twitter_username: e.target.value })}
                  className="bg-secondary border-border text-foreground"
                  placeholder="username"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{i18n.t('简介')}</Label>
              <Textarea
                value={profileForm.bio}
                onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })}
                className="bg-secondary border-border text-foreground min-h-20"
              />
            </div>
            <Button
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleSaveProfile}
              disabled={profileSaving}
            >
              {profileSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              {i18n.t('保存资料')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}