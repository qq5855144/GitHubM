// Issue 详情页

import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  Edit2,
  EyeOff,
  Flag,
  Loader2,
  MessageSquarePlus,
  Quote,
  Save,
  Send,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import { UserLink } from '@/components/common/UserLink';
import IssueAttachmentButton from '@/components/issues/IssueAttachmentButton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import i18n from "@/i18n";
import { pageCache } from '@/lib/page-cache';
import { buildCommentQuote, buildIssueQuote } from '@/lib/quote';
import { isRepoOwner } from '@/lib/repoPermissions';
import {
  createIssueComment,
  deleteIssueComment,
  formatRelativeTime,
  getIssue,
  getIssueCommentsPage,
  getRepoAssignees,
  getRepoLabels,
  getRepoMilestones,
  updateIssue,
  updateIssueComment,
} from '@/services/github';
import type { HideCommentReason } from '@/services/github-graphql';
import { minimizeIssueComment } from '@/services/github-graphql';
import type { GitHubComment, GitHubIssue, GitHubLabel, GitHubMilestone, GitHubUser } from '@/types/types';

const HIDE_REASONS: Array<{ value: HideCommentReason; label: string }> = [
  { value: 'OFF_TOPIC', label: '偏离主题' },
  { value: 'OUTDATED', label: '过时' },
  { value: 'RESOLVED', label: '已解决' },
  { value: 'SPAM', label: '垃圾信息' },
  { value: 'ABUSE', label: '滥用' },
  { value: 'DUPLICATE', label: '重复' },
];

function IssueScrollButton({ pageRef }: { pageRef: RefObject<HTMLDivElement | null> }) {
  const [target, setTarget] = useState<'top' | 'bottom' | null>(null);

  useEffect(() => {
    const scrollRoot = document.scrollingElement || document.documentElement;
    let frame: number | null = null;
    const updateTarget = () => {
      frame = null;
      const distance = scrollRoot.scrollHeight - scrollRoot.clientHeight;
      setTarget(distance <= 1 ? null : scrollRoot.scrollTop < distance / 2 ? 'bottom' : 'top');
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(updateTarget);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (pageRef.current) observer?.observe(pageRef.current);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    updateTarget();
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [pageRef]);

  if (!target) return null;
  const label = target === 'top' ? i18n.t('回到顶部') : i18n.t('滚动到底部');
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="pointer-events-auto absolute bottom-full right-4 mb-3 rounded-full text-xs font-semibold text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:right-6"
      aria-label={label}
      title={label}
      onClick={() => {
        const scrollRoot = document.scrollingElement || document.documentElement;
        window.scrollTo({
          top: target === 'top' ? 0 : scrollRoot.scrollHeight - scrollRoot.clientHeight,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        });
      }}
    >
      {target === 'top' ? 'top' : 'bot'}
    </Button>
  );
}

export default function IssueDetailPage() {
  const { owner, repo, number } = useParams<{ owner: string; repo: string; number: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = isRepoOwner(owner, user?.login);
  // APK 内底部导航由原生提供，Web 端由 MobileBottomNav（4rem）提供
  const hasBridge = typeof window !== 'undefined' && !!(window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
  const bottomOffset = hasBridge ? 'env(safe-area-inset-bottom)' : 'calc(4rem + env(safe-area-inset-bottom))';
  const pageRef = useRef<HTMLDivElement>(null);
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
  /** 待发送的引用块：与正文分开存，这样才能单独移除而不必手动删 Markdown */
  const [pendingQuote, setPendingQuote] = useState<{ block: string; label: string } | null>(null);
  const [hiddenComments, setHiddenComments] = useState<Set<number>>(new Set());
  const composerRef = useRef<HTMLTextAreaElement>(null);
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

  /**
   * 正文 + 引用块拼成最终提交内容。
   *
   * 顺序为：**引用块在前、回复在后**，中间空一行。
   * 即被引用的消息显示在上、自己的回复显示在下，符合引用回复的阅读语义。
   * 实测校验（qq5855144/GitHubM#32）：
   * body 为 `> Actions工作流记录没有删除按钮。\n>\n> ——来自 [@mymine](...)\n\n这个我看看能不能排到下一个版本`。
   * 注意：不要改回「回复在前、引用块在后」。那样读起来像回复先于被引用的原文，语义颠倒。
   */
  const composeCommentBody = (): string => {
    const text = newComment.trim();
    if (!pendingQuote) return text;
    // 引用块必须在回复之前：被引用的消息在上、回复在下，与 GitHub 原生行为一致。
    return text ? `${pendingQuote.block.trim()}\n\n${text}` : pendingQuote.block.trim();
  };

  const handleComment = async () => {
    if (!owner || !repo || !number) return;
    const payload = composeCommentBody();
    if (!payload.trim()) return;
    setSubmitting(true);
    try {
      const comment = await createIssueComment(owner, repo, Number(number), payload);
      setComments((prev) => [...prev, comment]);
      setIssue(prev => prev ? { ...prev, comments: prev.comments + 1 } : prev);
      setNewComment('');
      setPendingQuote(null);
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
      if (!submitting && composeCommentBody().trim()) handleComment();
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

  /** 拼出 GitHub 风格的引用块 */
  const quoteIssueUrl = `https://github.com/${owner}/${repo}/issues/${number}`;
  const buildQuote = (comment: GitHubComment): string =>
    buildCommentQuote(comment, quoteIssueUrl);

  /** 聚焦悬浮评论框，并把光标放到末尾 */
  const focusComposer = () => {
    const el = composerRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    try { el.setSelectionRange(end, end); } catch { /* 某些 WebView 不支持 */ }
  };

  const handleQuoteReply = (comment: GitHubComment) => {
    setPendingQuote({
      block: buildQuote(comment),
      label: `@${comment.user.login} 的评论`,
    });
    // 评论框是悬浮固定在底部的，不需要滚动；等 React 提交后立即聚焦（双保险）
    requestAnimationFrame(focusComposer);
    window.setTimeout(focusComposer, 60);
  };

  /** 引用 Issue 正文本身 —— 最常见的场景（逐条回应需求原文） */
  const handleQuoteIssueBody = () => {
    if (!issue) return;
    setPendingQuote({
      block: buildIssueQuote(issue, quoteIssueUrl),
      label: `@${issue.user.login} 的议题描述`,
    });
    requestAnimationFrame(focusComposer);
    window.setTimeout(focusComposer, 60);
  };

  const clearPendingQuote = () => {
    setPendingQuote(null);
    requestAnimationFrame(focusComposer);
  };

  /**
   * 滚动到某条评论并短暂高亮。
   *
   * 评论是分页加载的，被引用的评论很可能还没拉下来。
   * 这里不做「找不到就报错」，而是继续向后翻页直到命中或没有更多，
   * 这样点「——来自 @xxx」时体验跟 GitHub 一致。
   */
  const jumpToComment = async (commentId: number) => {
    const targetId = `issuecomment-${commentId}`;
    const highlight = () => {
      const el = document.getElementById(targetId);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('ring-2', 'ring-primary/60');
      window.setTimeout(() => el.classList.remove('ring-2', 'ring-primary/60'), 1600);
    };

    if (document.getElementById(targetId)) {
      highlight();
      return;
    }
    if (!owner || !repo || !number) return;

    // 已经在加载就不再并发翻页，直接等它结束（loading 结束会自动重试一次定位）
    if (loadingMoreComments) return;

    let nextPage = commentPage;
    let more = hasMoreComments;

    setLoadingMoreComments(true);
    try {
      // 上限兜底：避免超大 issue 卡死，也防 hasNextPage 判断异常时死循环
      for (let i = 0; i < 20 && more; i += 1) {
        const result = await getIssueCommentsPage(owner, repo, Number(number), nextPage + 1, 50);
        nextPage += 1;
        more = result.hasNextPage;
        setCommentPage(nextPage);
        setHasMoreComments(result.hasNextPage);

        // 用函数式更新并把结果并进 comments，同时判断是否命中目标
        const hit = result.data.some((c) => c.id === commentId);
        setComments((prev) => {
          const seen = new Set(prev.map((c) => c.id));
          const merged = [...prev, ...result.data.filter((c) => !seen.has(c.id))];
          return merged;
        });

        if (hit) break;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('加载评论失败'));
      return;
    } finally {
      setLoadingMoreComments(false);
    }

    // 等 React 把新评论渲染到 DOM 再滚动
    requestAnimationFrame(() => {
      if (!document.getElementById(targetId)) {
        window.setTimeout(highlight, 120);
        return;
      }
      highlight();
    });
  };

  const handleQuoteToNewIssue = (comment: GitHubComment) => {
    if (!owner || !repo) return;
    navigate(`/repos/${owner}/${repo}/issues/new`, {
      state: {
        title: `引用 #${number}`,
        body: buildQuote(comment),
      },
    });
  };

  const handleQuoteToNewIssueBody = () => {
    if (!owner || !repo || !issue) return;
    navigate(`/repos/${owner}/${repo}/issues/new`, {
      state: {
        title: `引用 #${number}`,
        body: buildIssueQuote(issue, quoteIssueUrl),
      },
    });
  };

  /**
   * 判断锚点能否被本页处理。
   *
   * 这个函数会在 MarkdownRenderer 的 render 阶段被调用（每渲染一条带锚点的
   * 评论就会调一次），所以它必须是纯函数：只做正则判定，绝不能触发跳转、
   * toast 或请求，否则一屏出现 N 条引用就会弹 N 个提示。
   */
  const handleAnchor = (anchor: string): boolean => /^issuecomment-\d+$/.test(anchor);
  /** 锚点真正被点击时才跳转（找不到评论会自动向后翻页加载）。 */
  const handleAnchorClick = (anchor: string) => {
    const matched = /^issuecomment-(\d+)$/.exec(anchor);
    if (!matched) return;
    void jumpToComment(Number(matched[1]));
  };

  const handleHide = async (comment: GitHubComment, reason: HideCommentReason) => {
    if (!comment.node_id) {
      toast.error(i18n.t('该评论缺少 node_id，无法隐藏'));
      return;
    }
    try {
      await minimizeIssueComment(comment.node_id, reason);
      setHiddenComments((prev) => new Set(prev).add(comment.id));
      toast.success(i18n.t('评论已隐藏'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('隐藏评论失败'));
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
    <div ref={pageRef} className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
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
          <div className={`mt-0.5 shrink-0 ${issue.state === 'open' ? 'text-primary' : 'text-muted-foreground'}`}>
            {issue.state === 'open' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <h1 className="text-lg md:text-2xl font-bold text-foreground leading-snug break-words">
              {issue.title}
              <span className="text-muted-foreground font-normal ml-1.5 text-base">#{issue.number}</span>
            </h1>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={`text-xs ${issue.state === 'open' ? 'border-primary text-primary' : 'border-muted-foreground text-muted-foreground'}`}>
                {issue.state === 'open' ? i18n.t('开放') : i18n.t('已关闭')}
              </Badge>
              <span className="text-xs sm:text-sm text-muted-foreground">
                {issue.user.login} {i18n.t('于')}{formatRelativeTime(issue.created_at)} {i18n.t('创建 ·')}{issue.comments} {i18n.t('条评论')}
              </span>
            </div>
            {canManage && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={openEditIssue}>
                <Edit2 className="w-3 h-3 mr-1" />{i18n.t('编辑')}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={openManageIssue}>
                <Tag className="w-3 h-3 mr-1" />{i18n.t('管理')}
              </Button>
              <Button variant="outline" size="sm" className={`h-7 text-xs border-border ${issue.state === 'open' ? 'text-foreground hover:bg-secondary' : 'text-primary hover:bg-secondary'}`} onClick={handleToggleState} disabled={toggling}>
                {issue.state === 'open' ? (<><X className="w-3 h-3 mr-1" />{i18n.t('关闭')}</>) : (<><Check className="w-3 h-3 mr-1" />{i18n.t('重新打开')}</>)}
              </Button>
            </div>
            )}
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
        {/* issue 正文操作栏：正文本身也要能引用，这是逐条回应需求原文的常用入口 */}
        <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 border-t border-border bg-secondary/20">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={handleQuoteIssueBody}>
            <Quote className="w-3.5 h-3.5 mr-1" />{i18n.t('引用回复')}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={handleQuoteToNewIssueBody}>
            <MessageSquarePlus className="w-3.5 h-3.5 mr-1" />{i18n.t('引用到新议题')}
          </Button>
        </div>
      </div>

      {/* 评论列表 */}
      {comments.map((comment) => (
        <div
          key={comment.id}
          id={`issuecomment-${comment.id}`}
          className="bg-card border border-border rounded-lg overflow-hidden scroll-mt-[calc(var(--layout-header-height,3.5rem)+1.5rem)] transition-shadow"
        >
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
              {hiddenComments.has(comment.id) && (
                <Badge variant="outline" className="text-xs border-border text-muted-foreground">{i18n.t('已隐藏')}</Badge>
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
            ) : hiddenComments.has(comment.id) ? (
              <p className="text-xs text-muted-foreground italic">{i18n.t('这条评论已被隐藏')}</p>
            ) : (
              <MarkdownRenderer content={comment.body} repoContext={owner && repo ? { owner, repo } : undefined} onAnchor={handleAnchor} onAnchorClick={handleAnchorClick} />
            )}
          </div>
          {editingCommentId !== comment.id && (
            <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 border-t border-border bg-secondary/20">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => handleQuoteReply(comment)}>
                <Quote className="w-3.5 h-3.5 mr-1" />{i18n.t('引用回复')}
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => handleQuoteToNewIssue(comment)}>
                <MessageSquarePlus className="w-3.5 h-3.5 mr-1" />{i18n.t('引用到新议题')}
              </Button>
              {user?.login === comment.user.login && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => startEditComment(comment)}>
                  <Edit2 className="w-3.5 h-3.5 mr-1" />{i18n.t('编辑')}
                </Button>
              )}
              {(user?.login === comment.user.login || canManage) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                      <EyeOff className="w-3.5 h-3.5 mr-1" />{i18n.t('隐藏')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="bg-popover border-border">
                    <DropdownMenuLabel className="text-[11px] text-muted-foreground">{i18n.t('选择隐藏原因')}</DropdownMenuLabel>
                    <DropdownMenuSeparator className="bg-border" />
                    {HIDE_REASONS.map((reason) => (
                      <DropdownMenuItem key={reason.value} className="text-xs cursor-pointer" onClick={() => void handleHide(comment, reason.value)}>
                        {i18n.t(reason.label)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {(user?.login === comment.user.login || canManage) && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" onClick={() => void removeComment(comment.id)}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" />{i18n.t('删除')}
                </Button>
              )}
            </div>
          )}
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

      {/* 添加评论 —— 固定悬浮在底部 */}
      {!user && (
        <div className="pointer-events-none fixed inset-x-0 z-30" style={{ bottom: bottomOffset }}>
          <IssueScrollButton pageRef={pageRef} />
        </div>
      )}
      {user && (
        <>
          {/* 占位，避免固定栏遮挡最后一条评论 */}
          <div className="h-36" aria-hidden="true" />
          <div
            className="fixed inset-x-0 z-30 px-4 md:px-6 pt-2 pb-2 bg-background/95 backdrop-blur-md border-t border-border"
            style={{ bottom: bottomOffset }}
          >
            <IssueScrollButton pageRef={pageRef} />
            <div className="rounded-xl border border-border bg-card shadow-lg overflow-hidden max-w-4xl mx-auto">
              {/* 引用预览条：引用块独立于正文存储，所以可以单独移除，不必手动删 Markdown */}
              {pendingQuote && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-secondary/40">
                  <Quote className="w-3.5 h-3.5 shrink-0 text-primary" />
                  <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                    {i18n.t('正在引用')} {pendingQuote.label}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={clearPendingQuote}
                    aria-label={i18n.t('取消引用')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
              <Textarea
                ref={composerRef}
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={handleCommentKeyDown}
                placeholder={i18n.t('撰写评论（支持 Markdown）...')}
                className="border-0 rounded-none bg-transparent text-foreground placeholder:text-muted-foreground resize-none font-mono text-sm min-h-16 focus-visible:ring-0 focus-visible:ring-offset-0"
                rows={2}
              />
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-border bg-secondary/20">
                <IssueAttachmentButton
                  owner={owner || ''}
                  repo={repo || ''}
                  disabled={submitting}
                  onInsert={(markdown) => setNewComment((prev) => (prev.trim() ? `${prev}\n\n${markdown}` : markdown))}
                />
                <div className="flex items-center gap-2 shrink-0">
                  <span className="hidden sm:flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Edit2 className="w-3 h-3" />{i18n.t('Ctrl+Enter 提交')}
                  </span>
                  <Button
                    className="bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-3"
                    onClick={handleComment}
                    disabled={submitting || !composeCommentBody().trim()}
                    size="sm"
                  >
                    {submitting ? i18n.t('发布中...') : (
                      <>
                        <Send className="w-3.5 h-3.5 mr-1.5" />{i18n.t('发布评论')}</>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
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
