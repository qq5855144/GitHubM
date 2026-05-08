// 仓库详情页

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Star,
  GitFork,
  Eye,
  AlertCircle,
  GitPullRequest,
  GitBranch,
  Users,
  Code,
  Clock,
  Globe,
  Lock,
  ExternalLink,
  ChevronRight,
  Tag,
  Upload,
  Package,
  Trash2,
  Settings,
  Loader2,
  Play,
  MessageCircle,
  BookOpen,
  LayoutGrid,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  getRepo,
  getReadme,
  getCommits,
  checkStarred,
  starRepo,
  unstarRepo,
  forkRepo,
  getRepoLanguages,
  formatRelativeTime,
  formatNumber,
  getLanguageColor,
  deleteRepo,
  updateRepo,
} from '@/services/github';
import type { GitHubRepo, GitHubCommit } from '@/types/types';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import { toast } from 'sonner';
import { decodeBase64Content } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function RepoDetailPage() {
  const { owner, repo: repoName } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [repo, setRepo] = useState<GitHubRepo | null>(null);
  const [readme, setReadme] = useState<string>('');
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [languages, setLanguages] = useState<Record<string, number>>({});
  const [starred, setStarred] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starring, setStarring] = useState(false);
  const [forking, setForking] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [editPrivate, setEditPrivate] = useState(false);
  const [editRepoName, setEditRepoName] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!owner || !repoName) return;

    const load = async () => {
      setLoading(true);
      try {
        const [repoData, starredStatus, langData] = await Promise.all([
          getRepo(owner, repoName),
          checkStarred(owner, repoName),
          getRepoLanguages(owner, repoName),
        ]);
        setRepo(repoData);
        setStarred(starredStatus);
        setLanguages(langData);

        // 加载 README 和提交记录（不阻塞主内容）
        Promise.all([
          getReadme(owner, repoName).catch(() => null),
          getCommits(owner, repoName, { per_page: 10 }).catch(() => ({ data: [], hasNextPage: false })),
        ]).then(([readmeData, commitsResult]) => {
          if (readmeData?.content) {
            const decoded = decodeBase64Content(readmeData.content);
            setReadme(decoded);
          }
          setCommits(commitsResult.data);
        });
      } catch (err) {
        toast.error('加载仓库信息失败');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [owner, repoName]);

  const handleStar = async () => {
    if (!owner || !repoName) return;
    setStarring(true);
    try {
      if (starred) {
        await unstarRepo(owner, repoName);
        setStarred(false);
        setRepo((prev) => prev ? { ...prev, stargazers_count: prev.stargazers_count - 1 } : prev);
        toast.success('已取消收藏');
      } else {
        await starRepo(owner, repoName);
        setStarred(true);
        setRepo((prev) => prev ? { ...prev, stargazers_count: prev.stargazers_count + 1 } : prev);
        toast.success('已收藏仓库');
      }
    } catch {
      toast.error('操作失败');
    } finally {
      setStarring(false);
    }
  };

  const handleFork = async () => {
    if (!owner || !repoName) return;
    setForking(true);
    try {
      const forked = await forkRepo(owner, repoName);
      toast.success(`Fork 成功！新仓库：${forked.full_name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fork 失败');
    } finally {
      setForking(false);
    }
  };

  // 删除仓库
  const handleDeleteRepo = async () => {
    if (!owner || !repoName) return;
    if (deleteConfirmName !== `${owner}/${repoName}`) { toast.error('仓库名称输入不正确'); return; }
    setDeleting(true);
    try {
      await deleteRepo(owner, repoName);
      toast.success('仓库已删除');
      navigate('/repos');
    } catch (err) { toast.error(err instanceof Error ? err.message : '删除失败'); }
    finally { setDeleting(false); }
  };

  // 修改仓库信息
  const handleUpdateRepo = async () => {
    if (!owner || !repoName) return;
    setUpdating(true);
    try {
      const updated = await updateRepo(owner, repoName, { name: editRepoName.trim() || repoName, description: editDesc, private: editPrivate });
      setRepo(updated);
      toast.success('仓库信息已更新');
      setEditDialogOpen(false);
      if (editRepoName.trim() && editRepoName.trim() !== repoName) navigate(`/repos/${owner}/${editRepoName.trim()}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : '更新失败'); }
    finally { setUpdating(false); }
  };

  const openEditDialog = () => {
    if (!repo) return;
    setEditDesc(repo.description || '');
    setEditPrivate(repo.private);
    setEditRepoName(repo.name);
    setEditDialogOpen(true);
  };

  // 计算语言占比
  const totalBytes = Object.values(languages).reduce((a, b) => a + b, 0);
  const langEntries = Object.entries(languages).sort(([, a], [, b]) => b - a).slice(0, 6);

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-64 bg-muted" />
        <Skeleton className="h-4 w-96 bg-muted" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 bg-muted" />
          <Skeleton className="h-9 w-24 bg-muted" />
        </div>
        <Skeleton className="h-48 w-full bg-muted" />
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
        <p className="text-foreground font-medium">仓库不存在或无权访问</p>
        <Button
          variant="outline"
          className="mt-4 border-border hover:bg-secondary"
          onClick={() => navigate('/repos')}
        >
          返回仓库列表
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* 仓库标题 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button
            type="button"
            className="hover:text-accent transition-colors"
            onClick={() => navigate('/repos')}
          >
            仓库
          </button>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground truncate">{repo.full_name}</span>
        </div>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-foreground text-balance">{repo.full_name}</h1>
              <Badge variant="outline" className="border-border text-muted-foreground text-xs">
                {repo.private ? <><Lock className="w-3 h-3 mr-1" />私有</> : <><Globe className="w-3 h-3 mr-1" />公开</>}
              </Badge>
              {repo.archived && (
                <Badge variant="outline" className="border-warning text-warning text-xs">已归档</Badge>
              )}
            </div>
            {repo.description && (
              <p className="text-sm text-muted-foreground mt-1 text-pretty">{repo.description}</p>
            )}
          </div>
          {/* 管理操作：固定右侧，不参与换行 */}
          <div className="flex items-center gap-1 shrink-0">
            <a href={repo.html_url} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:bg-secondary" title="在 GitHub 中查看">
                <ExternalLink className="w-4 h-4" />
              </Button>
            </a>
            <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:bg-secondary" onClick={openEditDialog} title="仓库设置">
              <Settings className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="w-8 h-8 text-destructive/70 hover:bg-destructive/10 hover:text-destructive" onClick={() => { setDeleteConfirmName(''); setDeleteDialogOpen(true); }} title="删除仓库">
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* 统计行 —— 仅 star/fork/eye/license，无换行风险 */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className={`border-border h-8 ${starred ? 'text-warning border-warning' : 'text-foreground hover:bg-secondary'}`}
          onClick={handleStar}
          disabled={starring}
        >
          <Star className={`w-3.5 h-3.5 mr-1.5 ${starred ? 'fill-warning' : ''}`} />
          {starred ? '已收藏' : '收藏'}
          <span className="ml-1.5 text-xs text-muted-foreground">{formatNumber(repo.stargazers_count)}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-border hover:bg-secondary h-8"
          onClick={handleFork}
          disabled={forking}
        >
          <GitFork className="w-3.5 h-3.5 mr-1.5" />
          Fork
          <span className="ml-1.5 text-xs text-muted-foreground">{formatNumber(repo.forks_count)}</span>
        </Button>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Eye className="w-3.5 h-3.5" />
          <span>{formatNumber(repo.watchers_count)}</span>
        </div>
        {repo.license && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Tag className="w-3.5 h-3.5" />
            {repo.license.spdx_id}
          </div>
        )}
      </div>

      {/* 功能导航 —— 统一为一个网格 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Issues',     icon: AlertCircle,    count: repo.open_issues_count, path: 'issues' },
          { label: 'Pull Requests', icon: GitPullRequest, count: null,              path: 'pulls' },
          { label: '提交历史',   icon: Clock,           count: null,                 path: 'commits' },
          { label: '分支管理',   icon: GitBranch,       count: null,                 path: 'branches' },
          { label: '代码浏览',   icon: Code,            count: null,                 path: 'code' },
          { label: '协作者',     icon: Users,           count: null,                 path: 'collaborators' },
          { label: 'Actions',   icon: Play,             count: null,                 path: 'actions' },
          { label: '上传文件',   icon: Upload,           count: null,                 path: 'upload' },
          { label: '产物下载',   icon: Package,          count: null,                 path: 'artifacts' },
          { label: 'Pages 部署', icon: Globe,            count: null,                 path: 'pages' },
          { label: 'Projects',  icon: LayoutGrid,       count: null,                 path: 'projects' },
          { label: 'Discussions', icon: MessageCircle,  count: null,                 path: 'discussions' },
          { label: 'Wiki',      icon: BookOpen,         count: null,                 path: 'wiki' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              type="button"
              className="bg-card border border-border rounded-lg p-3 hover:bg-secondary/50 transition-colors text-left group"
              onClick={() => navigate(`/repos/${repo.full_name}/${item.path}`)}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-muted-foreground group-hover:text-accent transition-colors shrink-0" />
                <span className="text-sm text-foreground group-hover:text-accent transition-colors truncate">{item.label}</span>
                {item.count !== null && (
                  <Badge variant="outline" className="ml-auto border-border text-muted-foreground text-xs shrink-0">
                    {item.count}
                  </Badge>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* 主内容标签 */}
      <Tabs defaultValue="readme" className="space-y-4">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="readme" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground">
            README
          </TabsTrigger>
          <TabsTrigger value="commits" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground">
            最近提交
          </TabsTrigger>
          <TabsTrigger value="stats" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground">
            统计
          </TabsTrigger>
        </TabsList>

        {/* README */}
        <TabsContent value="readme">
          <Card className="bg-card border-border">
            <CardContent className="p-6">
              {readme ? (
                <MarkdownRenderer content={readme} />
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Code className="w-10 h-10 mx-auto mb-3" />
                  <p>暂无 README</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 最近提交 */}
        <TabsContent value="commits">
          <Card className="bg-card border-border">
            <CardContent className="p-0">
              {commits.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">暂无提交记录</div>
              ) : (
                <div className="divide-y divide-border">
                  {commits.map((commit) => (
                    <div key={commit.sha} className="p-4 hover:bg-secondary/50 transition-colors">
                      <div className="flex items-start gap-3">
                        <Avatar className="w-7 h-7 shrink-0">
                          <AvatarImage src={commit.author?.avatar_url} />
                          <AvatarFallback className="bg-secondary text-xs">
                            {commit.commit.author.name.substring(0, 1)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground font-medium line-clamp-1 text-balance">
                            {commit.commit.message.split('\n')[0]}
                          </p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              {commit.commit.author.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatRelativeTime(commit.commit.author.date)}
                            </span>
                          </div>
                        </div>
                        <a
                          href={commit.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <code className="text-xs bg-secondary border border-border px-2 py-1 rounded font-mono text-accent hover:bg-secondary/80">
                            {commit.sha.substring(0, 7)}
                          </code>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <div className="text-center mt-3">
            <Button
              variant="outline"
              size="sm"
              className="border-border hover:bg-secondary"
              onClick={() => navigate(`/repos/${repo.full_name}/commits`)}
            >
              查看全部提交
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </TabsContent>

        {/* 统计 */}
        <TabsContent value="stats">
          <div className="space-y-4">
            {/* 仓库信息 */}
            <Card className="bg-card border-border">
              <CardContent className="p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { label: '默认分支', value: repo.default_branch, icon: GitBranch },
                  { label: '最近推送', value: formatRelativeTime(repo.pushed_at), icon: Clock },
                  { label: '仓库大小', value: `${(repo.size / 1024).toFixed(1)} MB`, icon: Code },
                ].map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div key={stat.label} className="space-y-1">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Icon className="w-3 h-3" />
                        {stat.label}
                      </div>
                      <p className="text-sm font-medium text-foreground">{stat.value}</p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* 语言统计 */}
            {langEntries.length > 0 && (
              <Card className="bg-card border-border">
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-sm font-medium text-foreground">编程语言</h3>
                  <div className="flex h-2 rounded-full overflow-hidden gap-px">
                    {langEntries.map(([lang, bytes]) => (
                      <div
                        key={lang}
                        className="h-full first:rounded-l-full last:rounded-r-full"
                        style={{
                          width: `${(bytes / totalBytes) * 100}%`,
                          backgroundColor: getLanguageColor(lang),
                        }}
                        title={`${lang}: ${((bytes / totalBytes) * 100).toFixed(1)}%`}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {langEntries.map(([lang, bytes]) => (
                      <div key={lang} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: getLanguageColor(lang) }}
                        />
                        <span className="text-foreground">{lang}</span>
                        <span>{((bytes / totalBytes) * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Topics */}
            {repo.topics && repo.topics.length > 0 && (
              <Card className="bg-card border-border">
                <CardContent className="p-4 space-y-2">
                  <h3 className="text-sm font-medium text-foreground">Topics</h3>
                  <div className="flex flex-wrap gap-2">
                    {repo.topics.map((topic) => (
                      <Badge key={topic} variant="outline" className="border-accent/40 text-accent bg-accent/10 text-xs">
                        {topic}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* ── 删除仓库确认对话框 ── */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => { if (!open) setDeleteDialogOpen(false); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-destructive" />删除仓库
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              此操作将永久删除仓库及其所有数据，不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2 space-y-1.5">
            <Label className="text-sm font-normal text-foreground">请输入仓库完整名称以确认删除：</Label>
            <Input value={deleteConfirmName} onChange={(e) => setDeleteConfirmName(e.target.value)} placeholder={`${owner}/${repoName}`} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary" onClick={() => setDeleteDialogOpen(false)}>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDeleteRepo} disabled={deleting || deleteConfirmName !== `${owner}/${repoName}`}>
              {deleting ? "删除中..." : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── 仓库设置对话框 ── */}
      <Dialog open={editDialogOpen} onOpenChange={(open) => { if (!open) setEditDialogOpen(false); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Settings className="w-4 h-4 text-primary" />仓库设置
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">仓库名称</Label>
              <Input value={editRepoName} onChange={(e) => setEditRepoName(e.target.value)} placeholder={repoName} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">仓库描述</Label>
              <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="简短描述这个仓库..." rows={3} className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none" />
            </div>
            <div className="flex items-center gap-3">
              <button type="button" className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors ${!editPrivate ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-secondary"}`} onClick={() => setEditPrivate(false)}>
                <Globe className="w-3.5 h-3.5" />公开
              </button>
              <button type="button" className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors ${editPrivate ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-secondary"}`} onClick={() => setEditPrivate(true)}>
                <Lock className="w-3.5 h-3.5" />私有
              </button>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="border border-border text-muted-foreground hover:bg-secondary" onClick={() => setEditDialogOpen(false)}>取消</Button>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleUpdateRepo} disabled={updating}>
              {updating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />保存中...</> : "保存更改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
