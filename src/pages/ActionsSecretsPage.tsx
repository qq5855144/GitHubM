import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Braces,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
  createRepoActionsVariable,
  deleteRepoActionsSecret,
  deleteRepoActionsVariable,
  formatRelativeTime,
  getRepoActionsPublicKey,
  getRepoActionsSecrets,
  getRepoActionsVariables,
  putRepoActionsSecret,
  updateRepoActionsVariable,
  type GitHubActionsSecretInfo,
  type GitHubActionsVariableInfo,
} from '@/services/github';
import { encryptGitHubSecretValue } from '@/lib/githubSealedBox';
import { copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';
import i18n from '@/i18n';

type ConfigKind = 'secret' | 'variable';
type EditorMode = 'create' | 'edit';

interface EditorState {
  kind: ConfigKind;
  mode: EditorMode;
  originalName?: string;
}

interface DeleteTarget {
  kind: ConfigKind;
  name: string;
}

function apiErrorMessage(error: unknown): string {
  const status = (error as { status?: number })?.status;
  if (status === 403) return i18n.t('权限不足：需要仓库 Admin 权限');
  if (status === 404) return i18n.t('资源不存在或无权访问');
  return error instanceof Error ? error.message : i18n.t('操作失败，请重试');
}

function validateName(name: string): string | null {
  if (!name) return i18n.t('请输入名称');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return i18n.t('名称只能包含字母、数字和下划线，且不能以数字开头');
  }
  if (name.toUpperCase().startsWith('GITHUB_')) {
    return i18n.t('名称不能以 GITHUB_ 开头');
  }
  return null;
}

function formatTime(value: string): string {
  if (!value) return '-';
  try {
    return formatRelativeTime(value);
  } catch {
    return value;
  }
}

export default function ActionsSecretsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();

  const [tab, setTab] = useState<ConfigKind>('secret');
  const [secrets, setSecrets] = useState<GitHubActionsSecretInfo[]>([]);
  const [variables, setVariables] = useState<GitHubActionsVariableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [formName, setFormName] = useState('');
  const [formValue, setFormValue] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!owner || !repo) return;
    setLoading(true);
    setError(null);
    const [secretResult, variableResult] = await Promise.allSettled([
      getRepoActionsSecrets(owner, repo),
      getRepoActionsVariables(owner, repo),
    ]);

    if (secretResult.status === 'fulfilled') {
      setSecrets(secretResult.value);
    }
    if (variableResult.status === 'fulfilled') {
      setVariables(variableResult.value);
    }

    const failures = [
      secretResult.status === 'rejected' ? `${i18n.t('Secrets 加载失败')}：${apiErrorMessage(secretResult.reason)}` : '',
      variableResult.status === 'rejected' ? `${i18n.t('Variables 加载失败')}：${apiErrorMessage(variableResult.reason)}` : '',
    ].filter(Boolean);
    setError(failures.length > 0 ? failures.join('\n') : null);
    setLoading(false);
  }, [owner, repo]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredSecrets = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return secrets
      .filter((item) => !keyword || item.name.toLowerCase().includes(keyword))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [secrets, query]);

  const filteredVariables = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return variables
      .filter((item) => !keyword || item.name.toLowerCase().includes(keyword))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [variables, query]);

  const openCreate = (kind: ConfigKind) => {
    setEditor({ kind, mode: 'create' });
    setFormName('');
    setFormValue('');
    setShowValue(false);
    setFormError(null);
  };

  const openEditSecret = (name: string) => {
    setEditor({ kind: 'secret', mode: 'edit', originalName: name });
    setFormName(name);
    setFormValue('');
    setShowValue(false);
    setFormError(null);
  };

  const openEditVariable = (variable: GitHubActionsVariableInfo) => {
    setEditor({ kind: 'variable', mode: 'edit', originalName: variable.name });
    setFormName(variable.name);
    setFormValue(variable.value);
    setShowValue(true);
    setFormError(null);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditor(null);
    setFormValue('');
    setShowValue(false);
    setFormError(null);
  };

  const handleSave = async () => {
    if (!owner || !repo || !editor) return;
    const name = formName.trim();
    const nameError = validateName(name);
    if (nameError) {
      setFormError(nameError);
      return;
    }
    if (editor.kind === 'secret' && formValue.length === 0) {
      setFormError(i18n.t('请输入 Secret 值'));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (editor.kind === 'secret') {
        const publicKey = await getRepoActionsPublicKey(owner, repo);
        const encryptedValue = encryptGitHubSecretValue(formValue, publicKey.key);
        await putRepoActionsSecret(owner, repo, name, encryptedValue, publicKey.key_id);
        toast.success(editor.mode === 'create' ? i18n.t('Secret 已创建') : i18n.t('Secret 已更新'));
      } else if (editor.mode === 'create') {
        await createRepoActionsVariable(owner, repo, name, formValue);
        toast.success(i18n.t('Variable 已创建'));
      } else {
        await updateRepoActionsVariable(owner, repo, editor.originalName ?? name, formValue);
        toast.success(i18n.t('Variable 已更新'));
      }
      setEditor(null);
      setFormValue('');
      setShowValue(false);
      await load();
    } catch (saveError) {
      setFormError(apiErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!owner || !repo || !deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.kind === 'secret') {
        await deleteRepoActionsSecret(owner, repo, deleteTarget.name);
        toast.success(i18n.t('Secret 已删除'));
      } else {
        await deleteRepoActionsVariable(owner, repo, deleteTarget.name);
        toast.success(i18n.t('Variable 已删除'));
      }
      setDeleteTarget(null);
      await load();
    } catch (deleteError) {
      toast.error(apiErrorMessage(deleteError));
    } finally {
      setDeleting(false);
    }
  };

  const copy = async (value: string, message: string) => {
    try {
      await copyToClipboard(value);
      toast.success(message);
    } catch {
      toast.error(i18n.t('复制失败'));
    }
  };

  const currentCount = tab === 'secret' ? secrets.length : variables.length;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-primary transition-colors" onClick={() => navigate('/repos')}>
          {i18n.t('仓库')}
        </button>
        <ChevronRight className="w-3 h-3" />
        <button
          type="button"
          className="hover:text-primary transition-colors max-w-[220px] truncate"
          onClick={() => navigate(`/repos/${owner}/${repo}`)}
        >
          {owner}/{repo}
        </button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">{i18n.t('Actions 配置')}</span>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" />
            {i18n.t('Actions 密钥与变量')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 text-pretty">
            {i18n.t('管理仓库级 Actions Secrets 与 Variables，值只会在写入时经过客户端。')}
          </p>
        </div>
        <Button variant="outline" size="sm" className="border-border h-8 shrink-0" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          {i18n.t('刷新')}
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive whitespace-pre-line flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-3 flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={i18n.t('搜索名称...')}
            className="h-8 pl-8 bg-secondary border-border text-foreground placeholder:text-muted-foreground text-xs"
          />
        </div>
        <Button
          size="sm"
          className="h-8 bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
          onClick={() => openCreate(tab)}
        >
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          {tab === 'secret' ? i18n.t('新建 Secret') : i18n.t('新建 Variable')}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as ConfigKind)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="secret" className="gap-2">
            <LockKeyhole className="w-3.5 h-3.5" />
            Secrets
            <Badge variant="outline" className="border-border text-[10px] px-1.5 py-0">{secrets.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="variable" className="gap-2">
            <Braces className="w-3.5 h-3.5" />
            Variables
            <Badge variant="outline" className="border-border text-[10px] px-1.5 py-0">{variables.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="secret" className="mt-3 space-y-3">
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{i18n.t('Secret 只能写入和覆盖，无法读取原值；列表只显示名称和更新时间。')}</span>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {loading ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : filteredSecrets.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {query ? i18n.t('没有匹配的 Secret') : i18n.t('还没有配置 Secret')}
              </div>
            ) : (
              filteredSecrets.map((secret) => (
                <div key={secret.name} className="flex items-start gap-3 px-3 py-3 border-b border-border last:border-b-0">
                  <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                    <LockKeyhole className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium text-foreground break-all">{secret.name}</span>
                      <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">{i18n.t('不可读取')}</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {i18n.t('更新于')} {formatTime(secret.updated_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => void copy(secret.name, i18n.t('名称已复制'))}>
                      <Copy className="w-3.5 h-3.5 md:mr-1" /><span className="hidden md:inline">{i18n.t('名称')}</span>
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => openEditSecret(secret.name)}>
                      <Pencil className="w-3.5 h-3.5 md:mr-1" /><span className="hidden md:inline">{i18n.t('更新')}</span>
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive/80 hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteTarget({ kind: 'secret', name: secret.name })}>
                      <Trash2 className="w-3.5 h-3.5 md:mr-1" /><span className="hidden md:inline">{i18n.t('删除')}</span>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="variable" className="mt-3 space-y-3">
          <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
            <Braces className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
            <span>{i18n.t('Variable 是明文配置，适合非敏感参数；Secret 适合令牌、密码和密钥。')}</span>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {loading ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : filteredVariables.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {query ? i18n.t('没有匹配的 Variable') : i18n.t('还没有配置 Variable')}
              </div>
            ) : (
              filteredVariables.map((variable) => (
                <div key={variable.name} className="flex items-start gap-3 px-3 py-3 border-b border-border last:border-b-0">
                  <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                    <Braces className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-medium text-foreground break-all">{variable.name}</span>
                      <Badge variant="outline" className="border-border text-[10px] text-muted-foreground">{i18n.t('明文')}</Badge>
                    </div>
                    <p className="text-xs font-mono text-muted-foreground mt-1 break-all line-clamp-2">{variable.value || i18n.t('（空值）')}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{i18n.t('更新于')} {formatTime(variable.updated_at)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => void copy(variable.value, i18n.t('值已复制'))}>
                      <Copy className="w-3.5 h-3.5 md:mr-1" /><span className="hidden md:inline">{i18n.t('复制')}</span>
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => openEditVariable(variable)}>
                      <Pencil className="w-3.5 h-3.5 md:mr-1" /><span className="hidden md:inline">{i18n.t('编辑')}</span>
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive/80 hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteTarget({ kind: 'variable', name: variable.name })}>
                      <Trash2 className="w-3.5 h-3.5 md:mr-1" /><span className="hidden md:inline">{i18n.t('删除')}</span>
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      <p className="text-[11px] text-muted-foreground">
        {i18n.t('共')} {currentCount} {i18n.t('项配置')}。{i18n.t('Secret 值仅在写入时使用 GitHub 公钥加密，应用不会保存明文。')}
      </p>

      <Dialog open={!!editor} onOpenChange={(open) => { if (!open) closeEditor(); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {editor?.kind === 'secret' ? <LockKeyhole className="w-4 h-4 text-primary" /> : <Braces className="w-4 h-4 text-primary" />}
              {editor?.kind === 'secret'
                ? (editor.mode === 'create' ? i18n.t('新建 Secret') : i18n.t('更新 Secret'))
                : (editor?.mode === 'create' ? i18n.t('新建 Variable') : i18n.t('编辑 Variable'))}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {editor?.kind === 'secret'
                ? i18n.t('Secret 使用 GitHub 公钥加密后写入，保存后无法查看原值。')
                : i18n.t('Variable 以明文保存，请勿放置密码或令牌。')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">{i18n.t('名称')}</Label>
              <Input
                value={formName}
                onChange={(event) => setFormName(event.target.value)}
                disabled={editor?.mode === 'edit'}
                placeholder={editor?.kind === 'secret' ? 'DEPLOY_TOKEN' : 'API_BASE_URL'}
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">{i18n.t('只能包含字母、数字和下划线，不能以数字或 GITHUB_ 开头。')}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">
                {editor?.kind === 'secret' ? i18n.t('Secret 值') : i18n.t('Variable 值')}
              </Label>
              <div className="relative">
                <Input
                  type={editor?.kind === 'secret' && !showValue ? 'password' : 'text'}
                  value={formValue}
                  onChange={(event) => setFormValue(event.target.value)}
                  placeholder={editor?.kind === 'secret' && editor.mode === 'edit' ? i18n.t('输入新值以覆盖原 Secret') : i18n.t('输入值')}
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono pr-10"
                  autoComplete="new-password"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {editor?.kind === 'secret' && (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowValue((value) => !value)}
                    aria-label={showValue ? i18n.t('隐藏值') : i18n.t('显示值')}
                  >
                    {showValue ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                )}
              </div>
              {editor?.kind === 'secret' && editor.mode === 'edit' && (
                <p className="text-[11px] text-muted-foreground">{i18n.t('原值不可读取，必须输入新值才能覆盖保存。')}</p>
              )}
            </div>
            {formError && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {formError}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" className="border border-border text-muted-foreground hover:bg-secondary" onClick={closeEditor} disabled={saving}>
              {i18n.t('取消')}
            </Button>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => void handleSave()} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{i18n.t('保存中...')}</> : i18n.t('保存')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{i18n.t('确认删除')}</AlertDialogTitle>
            <AlertDialogDescription>
              {i18n.t('将永久删除')} <span className="font-mono text-foreground">{deleteTarget?.name}</span>，{i18n.t('此操作不可撤销。')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{i18n.t('取消')}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : i18n.t('删除')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}