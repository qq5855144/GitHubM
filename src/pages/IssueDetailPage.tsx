// Issue 详情页

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  Send,
  ChevronRight,
  Edit2,
  X,
  Check,
  Tag,
  Save,
  Trash2,
  Users,
  Flag,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  getIssue,
  getIssueCommentsPage,
  createIssueComment,
  updateIssueComment,
  deleteIssueComment,
  updateIssue,
  getRepoLabels,
  getRepoMilestones,
  getRepoAssignees,
  formatRelativeTime,
} from '@/services/github';
import type { GitHubIssue, GitHubComment, GitHubLabel, GitHubMilestone, GitHubUser } from '@/types/types';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import { UserLink } from '@/components/common/UserLink';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { pageCache } from '@/lib/page-cache';
import i18n from "@/i18n";

export default function IssueDetailPage() {
  const { owner, repo, number } = useParams<{ owner: string; repo: string; number: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [issue, setIssue] = useState<GitHubIssue | null>(null);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [commentPage, setCommentPage] = useState(1);
  const [hasMoreComments, setHasMoreComments] = useState(false);
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [savingIssue, setSavingIssue] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [repoLabels, setRepoLabels] = useState<GitHubLabel[]>([]);
  const [repoMilestones, setRepoMilestones] = useState<GitHubMilestone[]>([]);
  const [assignableUsers, setAssignableUsers] = useState<GitHubUser[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
  const [selectedMilestone, setSelectedMilestone] = useState('__none');
  const [savingMeta, setSavingMeta] = useState(false);
  const [labelQuery, setLabelQuery] = useState('');

  useEffect(() => {
    if (!owner || !repo || !number) return;
    const load = async () => {
      setLoading(true);
      try {
        const [issueData, commentsResult] = await Promise.all([
          getIssue(owner, repo, Number(number)),
          getIssueCommentsPage(owner, repo, Number(number), 1, 50),
        ]);
        setIssue(issueData);
        setComments(commentsResult.data);
        setCommentPage(1);
        setHasMoreComments(commentsResult.hasNextPage);
      } catch (err) {
        toast.error(i18n.t('加载 Issue 详情失败'));
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [owner, repo, number]);

  const handleComment = async () => {
    if (!owner || !repo || !number || !newComment.trim()) return;
    setSubmitting(true);
    try {
      const comment = await createIssueComment(owner, repo, Number(number), newComment.trim());
      setComments((prev) => [...prev, comment]);
      setIssue(prev => prev ? { ...prev, comments: prev.comments + 1 } : prev);
      setNewComment('');
      invalidateIssueList();
      toast.success(i18n.t('评论已发布'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('发布失败'));
    } finally {
      setSubmitting(false);
    }
  };

  // Ctrl/Cmd+Enter 快捷提交评论
  const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!submitting && newComment.trim()) handleComment();
    }
  };

  const handleToggleState = async () => {
    if (!owner || !repo || !number || !issue) return;
    setToggling(true);
    try {
      const newState = issue.state === 'open' ? 'closed' : 'open';
      const updated = await updateIssue(owner, repo, Number(number), { state: newState });
      setIssue(updated);
      invalidateIssueList();
      toast.success(newState === 'closed' ? i18n.t('Issue 已关闭') : i18n.t('Issue 已重新打开'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('操作失败'));
    } finally {
      setToggling(false);
    }
  };

  const invalidateIssueList = () => {
    if (owner && repo) pageCache.invalidate(`issues:${owner}/${repo}:`);
  };
  const openEditIssue = () => {
    if (!issue) return;
    setEditTitle(issue.title);
    setEditBody(issue.body || '');
    setEditOpen(true);
  };
  const handleSaveIssue = async () => {
    if (!owner || !repo || !number || !issue || !editTitle.trim()) return;
    setSavingIssue(true);
    try {
      const updated = await updateIssue(owner, repo, Number(number), {
        title: editTitle.trim(),
        body: editBody,
      });
      setIssue(updated);
      setEditOpen(false);
      invalidateIssueList();
      toast.success(i18n.t('Issue 已更新'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('保存失败'));
    } finally {
      setSavingIssue(false);
    }
  };
  const openManageIssue = async () => {
    if (!owner || !repo || !issue) return;
    setSelectedLabels(issue.labels.map(label => label.name));
    setSelectedAssignees(issue.assignees.map(assignee => assignee.login));
    setSelectedMilestone(issue.milestone ? String(issue.milestone.number) : '__none');
    setManageOpen(true);
    const [labelResult, milestoneResult, collaboratorResult] = await Promise.allSettled([
      getRepoLabels(owner, repo),
      getRepoMilestones(owner, repo),
      getRepoAssignees(owner, repo),
    ]);
    if (labelResult.status === 'fulfilled') setRepoLabels(labelResult.value);
    if (milestoneResult.status === 'fulfilled') setRepoMilestones(milestoneResult.value);
    if (collaboratorResult.status === 'fulfilled') setAssignableUsers(collaboratorResult.value);
    if (labelResult.status === 'rejected' && milestoneResult.status === 'rejected') {
      toast.error(i18n.t('加载仓库元数据失败'));
    }
  };
  const handleSaveMeta = async () => {
    if (!owner || !repo || !number || !issue) return;
    setSavingMeta(true);
    try {
      const updated = await updateIssue(owner, repo, Number(number), {
        labels: selectedLabels,
        assignees: selectedAssignees,
        milestone: selectedMilestone === '__none' ? null : Number(selectedMilestone),
      });
      setIssue(updated);
      setManageOpen(false);
      invalidateIssueList();
      toast.success(i18n.t('Issue 信息已更新'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('保存失败'));
    } finally {
      setSavingMeta(false);
    }
  };
  const handleLoadMoreComments = async () => {
    if (!owner || !repo || !number || loadingMoreComments) return;
    setLoadingMoreComments(true);
    try {
      const next = commentPage + 1;
      const result = await getIssueCommentsPage(owner, repo, Number(number), next, 50);
      setComments(prev => [...prev, ...result.data]);
      setCommentPage(next);
      setHasMoreComments(result.hasNextPage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('加载评论失败'));
    } finally {
      setLoadingMoreComments(false);
    }
  };
  const startEditComment = (comment: GitHubComment) => {
    setEditingCommentId(comment.id);
    setEditingCommentBody(comment.body);
  };
  const saveEditedComment = async (commentId: number) => {
    if (!owner || !repo || !editingCommentBody.trim()) return;
    try {
      const updated = await updateIssueComment(owner, repo, commentId, editingCommentBody.trim());
      setComments(prev => prev.map(comment => comment.id === commentId ? updated : comment));
      setEditingCommentId(null);
      setEditingCommentBody('');
      toast.success(i18n.t('评论已更新'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('保存评论失败'));
    }
  };
  const removeComment = async (commentId: number) => {
    if (!owner || !repo || !number) return;
    if (!window.confirm(i18n.t('确定删除这条评论？'))) return;
    try {
      await deleteIssueComment(owner, repo, commentId);
      setComments(prev => prev.filter(comment => comment.id !== commentId));
      setIssue(prev => prev ? { ...prev, comments: Math.max(0, prev.comments - 1) } : prev);
      invalidateIssueList();
      toast.success(i18n.t('评论已删除'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('删除评论失败'));
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-full bg-muted" />
        <Skeleton className="h-32 w-full bg-muted" />
        <Skeleton className="h-24 w-full bg-muted" />
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
        <p className="text-foreground">{i18n.t('Issue 不存在')}</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate(`/repos/${owner}/${repo}/issues`)}>Issues</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">#{issue.number}</span>
      </div>

      {/* Issue 标题 */}
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <div className={`mt-1 shrink-0 ${issue.state === 'open' ? 'text-primary' : 'text-muted-foreground'}`}>
            {issue.state === 'open' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-foreground text-balance">
              {issue.title}
              <span className="text-muted-foreground font-normal ml-2">#{issue.number}</span>
            </h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge
                variant="outline"
                className={`text-xs ${issue.state === 'open' ? 'border-primary text-primary' : 'border-muted-foreground text-muted-foreground'}`}
              >
                {issue.state === 'open' ? i18n.t('开放') : i18n.t('已关闭')}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {issue.user.login} {i18n.t('于')}{formatRelativeTime(issue.created_at)} {i18n.t('创建 ·')}{issue.comments} {i18n.t('条评论')}</span>
            </div>
          </div>
          {/* 操作按钮 */}
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
            <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={openEditIssue} title={i18n.t('编辑标题和正文')}>
              <Edit2 className="w-3.5 h-3.5 mr-1" />{i18n.t('编辑')}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={openManageIssue} title={i18n.t('标签、负责人、里程碑')}>
              <Tag className="w-3.5 h-3.5 mr-1" />{i18n.t('管理')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={`border-border h-8 ${issue.state === 'open' ? 'text-foreground hover:bg-secondary' : 'text-primary hover:bg-secondary'}`}
              onClick={handleToggleState}
              disabled={toggling}
            >
              {issue.state === 'open' ? (
                <><X className="w-3.5 h-3.5 mr-1" />{i18n.t('关闭')}</>
              ) : (
                <><Check className="w-3.5 h-3.5 mr-1" />{i18n.t('重新打开')}</>
              )}
            </Button>
          </div>
        </div>

        {/* 标签 */}
        {issue.labels.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap ml-8">
            <Tag className="w-3.5 h-3.5 text-muted-foreground" />
            {issue.labels.map((label) => (
              <Badge
                key={label.id}
                variant="outline"
                className="text-xs h-5 px-2"
                style={{
                  borderColor: `#${label.color}50`,
                  backgroundColor: `#${label.color}15`,
                  color: `#${label.color}`,
                }}
              >
                {label.name}
              </Badge>
            ))}
          </div>
        )}
        {(issue.assignees.length > 0 || issue.milestone) && (
          <div className="flex items-center gap-3 flex-wrap ml-8 text-xs text-muted-foreground">
            {issue.assignees.length > 0 && (
              <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{issue.assignees.map(a => a.login).join(', ')}</span>
            )}
            {issue.milestone && (
              <span className="flex items-center gap-1"><Flag className="w-3.5 h-3.5" />{issue.milestone.title}</span>
            )}
          </div>
        )}
      </div>

      {/* Issue 正文 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-secondary/30">
          <UserLink login={issue.user.login} className="flex items-center gap-2">
            <Avatar className="w-6 h-6">
              <AvatarImage src={issue.user.avatar_url} />
              <AvatarFallback className="bg-secondary text-xs">{issue.user.login[0]}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium text-foreground hover:text-accent">{issue.user.login}</span>
          </UserLink>
          <span className="text-xs text-muted-foreground">{formatRelativeTime(issue.created_at)}</span>
          <Badge variant="outline" className="ml-auto text-xs border-border text-muted-foreground">{i18n.t('作者')}</Badge>
        </div>
        <div className="p-4">
          {issue.body ? (
            <MarkdownRenderer content={issue.body} repoContext={owner && repo ? { owner, repo } : undefined} />
          ) : (
            <p className="text-muted-foreground text-sm italic">{i18n.t('无描述')}</p>
          )}
        </div>
      </div>

      {/* 评论列表 */}
      {comments.map((comment) => (
        <div key={comment.id} className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-secondary/30">
            <UserLink login={comment.user.login} className="flex items-center gap-2">
              <Avatar className="w-6 h-6">
                <AvatarImage src={comment.user.avatar_url} />
                <AvatarFallback className="bg-secondary text-xs">{comment.user.login[0]}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium text-foreground hover:text-accent">{comment.user.login}</span>
            </UserLink>
            <span className="text-xs text-muted-foreground">{formatRelativeTime(comment.created_at)}</span>
            <div className="ml-auto flex items-center gap-1">
              {user?.login === comment.user.login && (
                <Badge variant="outline" className="text-xs border-border text-muted-foreground">{i18n.t('你')}</Badge>
              )}
              {user?.login === comment.user.login && editingCommentId !== comment.id && (
                <>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => startEditComment(comment)} title={i18n.t('编辑评论')}>
                    <Edit2 className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeComment(comment.id)} title={i18n.t('删除评论')}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="p-4">
            {editingCommentId === comment.id ? (
              <div className="space-y-2">
                <Textarea
                  value={editingCommentBody}
                  onChange={(e) => setEditingCommentBody(e.target.value)}
                  className="bg-secondary border-border text-foreground resize-none font-mono text-sm min-h-24"
                  rows={4}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditingCommentId(null); setEditingCommentBody(''); }}>
                    {i18n.t('取消')}
                  </Button>
                  <Button size="sm" className="h-7 text-xs bg-primary text-primary-foreground" disabled={!editingCommentBody.trim()} onClick={() => saveEditedComment(comment.id)}>
                    <Save className="w-3 h-3 mr-1" />{i18n.t('保存')}
                  </Button>
                </div>
              </div>
            ) : (
              <MarkdownRenderer content={comment.body} repoContext={owner && repo ? { owner, repo } : undefined} />
            )}
          </div>
        </div>
      ))}
      {hasMoreComments && (
        <div className="text-center">
          <Button variant="outline" className="border-border hover:bg-secondary" onClick={handleLoadMoreComments} disabled={loadingMoreComments}>
            {loadingMoreComments ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null}
            {loadingMoreComments ? i18n.t('加载中...') : i18n.t('加载更多评论')}
          </Button>
        </div>
      )}

      {/* 添加评论 */}
      {user && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <Avatar className="w-6 h-6">
              <AvatarImage src={user.avatar_url} />
              <AvatarFallback className="bg-secondary text-xs">{user.login[0]}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium text-foreground">{i18n.t('添加评论')}</span>
          </div>
          <div className="p-4 space-y-3">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleCommentKeyDown}
              placeholder={i18n.t('撰写评论（支持 Markdown）...')}
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none font-mono text-sm min-h-24"
              rows={4}
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Edit2 className="w-3 h-3" />
                {i18n.t('支持 Markdown · Ctrl+Enter 快速提交')}</span>
              <Button
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={handleComment}
                disabled={submitting || !newComment.trim()}
                size="sm"
              >
                {submitting ? (
                  i18n.t('发布中...')
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5 mr-1.5" />
                    {i18n.t('发布评论')}</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">{i18n.t('编辑 Issue')} #{issue.number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{i18n.t('标题')}</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="bg-secondary border-border text-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{i18n.t('正文（支持 Markdown）')}</Label>
              <Textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={10} className="bg-secondary border-border text-foreground resize-y font-mono text-sm" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditOpen(false)}>{i18n.t('取消')}</Button>
              <Button className="bg-primary text-primary-foreground" onClick={handleSaveIssue} disabled={savingIssue || !editTitle.trim()}>
                {savingIssue ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                {i18n.t('保存')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">{i18n.t('管理 Issue')} #{issue.number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{i18n.t('标签')}</Label>
              <Input value={labelQuery} onChange={(e) => setLabelQuery(e.target.value)} placeholder={i18n.t('搜索标签')} className="bg-secondary border-border text-foreground h-8" />
              <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-secondary/30 p-2 space-y-1.5">
                {repoLabels.length === 0 && <p className="text-xs text-muted-foreground">{i18n.t('仓库暂无标签')}</p>}
                {repoLabels.filter(label => label.name.toLowerCase().includes(labelQuery.trim().toLowerCase()) || selectedLabels.includes(label.name)).slice(0, 100).map((label) => (
                  <label key={label.id} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <Checkbox
                      checked={selectedLabels.includes(label.name)}
                      onCheckedChange={(checked) => setSelectedLabels(prev => checked ? [...prev, label.name] : prev.filter(name => name !== label.name))}
                    />
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: `#${label.color}` }} />
                    <span className="truncate">{label.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">{i18n.t('负责人')}</Label>
              <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-secondary/30 p-2 space-y-1.5">
                {assignableUsers.length === 0 && <p className="text-xs text-muted-foreground">{i18n.t('没有可分配的协作者')}</p>}
                {assignableUsers.map((person) => (
                  <label key={person.id} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <Checkbox
                      checked={selectedAssignees.includes(person.login)}
                      onCheckedChange={(checked) => setSelectedAssignees(prev => checked ? [...prev, person.login] : prev.filter(login => login !== person.login))}
                    />
                    <span className="truncate">{person.login}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{i18n.t('里程碑')}</Label>
              <Select value={selectedMilestone} onValueChange={setSelectedMilestone}>
                <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="__none" className="text-foreground">{i18n.t('无里程碑')}</SelectItem>
                  {repoMilestones.map((milestone) => (
                    <SelectItem key={milestone.id} value={String(milestone.number)} className="text-foreground">{milestone.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setManageOpen(false)}>{i18n.t('取消')}</Button>
              <Button className="bg-primary text-primary-foreground" onClick={handleSaveMeta} disabled={savingMeta}>
                {savingMeta ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                {i18n.t('保存')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
