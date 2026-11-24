// PR Diff 对比视图页

import { useState, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Plus,
  Minus,
  MessageSquare,
  Send,
  Columns2,
  AlignJustify,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  MessageCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  getPullRequest,
  getPullRequestFiles,
  getPullRequestReviewComments,
  createPullRequestReviewComment,
  submitPullRequestReview,
  samePullRevision,
  type ReviewEvent,
} from '@/services/github';
import type { GitHubPullRequest, GitHubFile, GitHubComment } from '@/types/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { isRepoOwner } from '@/lib/repoPermissions';
import i18n from "@/i18n";

// ===== 类型 =====
interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'hunk';
  content: string;
  lineOld: number | null;
  lineNew: number | null;
}

// ===== Diff 解析 =====
function parsePatch(patch: string): DiffLine[] {
  const lines = patch.split('\n');
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of lines) {
    if (raw.startsWith('@@')) {
      // 解析 @@ -old,n +new,n @@ 格式
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[2], 10);
      }
      result.push({ type: 'hunk', content: raw, lineOld: null, lineNew: null });
    } else if (raw.startsWith('+')) {
      result.push({ type: 'add', content: raw.slice(1), lineOld: null, lineNew: newLine });
      newLine++;
    } else if (raw.startsWith('-')) {
      result.push({ type: 'remove', content: raw.slice(1), lineOld: oldLine, lineNew: null });
      oldLine++;
    } else {
      const c = raw.startsWith('\\') ? raw : raw.slice(1);
      result.push({ type: 'context', content: c, lineOld: oldLine, lineNew: newLine });
      oldLine++;
      newLine++;
    }
  }
  return result;
}

// ===== ANSI 颜色剥除（Diff 用不到 ANSI，但日志用） =====
// PR Diff 行内评论数据结构
interface LineCommentGroup {
  path: string;
  line: number;
  comments: GitHubComment[];
}

function groupCommentsByLine(comments: GitHubComment[]): Map<string, LineCommentGroup> {
  const map = new Map<string, LineCommentGroup>();
  for (const c of comments) {
    const raw = c as unknown as Record<string, unknown>;
    const path = (raw['path'] as string) ?? '';
    const line = (raw['line'] as number) ?? (raw['original_line'] as number) ?? 0;
    const side = raw['side'] === 'LEFT' ? 'LEFT' : 'RIGHT';
    const key = `${path}:${side}:${line}`;
    if (!map.has(key)) map.set(key, { path, line, comments: [] });
    map.get(key)!.comments.push(c);
  }
  return map;
}

// ===== 行内评论输入框 =====
interface InlineCommentInputProps {
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
}
function InlineCommentInput({ onSubmit, onCancel }: InlineCommentInputProps) {
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const handleSubmit = async () => {
    if (!body.trim()) return;
    setSubmitting(true);
    try { await onSubmit(body.trim()); }
    finally { setSubmitting(false); }
  };

  return (
    <tr>
      <td colSpan={4} className="p-0">
        <div className="bg-secondary/60 border-y border-border p-3 space-y-2">
          <Textarea
            ref={ref}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={i18n.t('添加行内评审评论（支持 Markdown）...')}
            className="bg-card border-border text-foreground placeholder:text-muted-foreground resize-none text-sm min-h-20"
            rows={3}
          />
          <div className="flex gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs border border-border text-muted-foreground hover:bg-secondary"
              onClick={onCancel}
              disabled={submitting}
            >
              {i18n.t('取消')}</Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleSubmit}
              disabled={submitting || !body.trim()}
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Send className="w-3 h-3 mr-1" />}
              {i18n.t('提交评论')}</Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ===== 单文件 Diff 展示（Unified 模式）=====
interface UnifiedDiffProps {
  file: GitHubFile;
  commentGroups: Map<string, LineCommentGroup>;
  prHead: string;
  owner: string;
  repo: string;
  pullNumber: number;
  onCommentAdded: (c: GitHubComment, path: string, line: number) => void;
}

function UnifiedDiff({ file, commentGroups, prHead, owner, repo, pullNumber, onCommentAdded }: UnifiedDiffProps) {
  const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null);
  const { user } = useAuth();

  if (!file.patch) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground italic">
        {file.status === 'binary' ? i18n.t('二进制文件，无法预览差异') : i18n.t('无差异内容')}
      </div>
    );
  }

  const lines = parsePatch(file.patch);

  const handleAddComment = async (body: string, lineNum: number, side: 'LEFT' | 'RIGHT') => {
    if (!owner || !repo) return;
    try {
      const comment = await createPullRequestReviewComment(owner, repo, pullNumber, {
        body,
        commit_id: prHead,
        path: file.filename,
        line: lineNum,
        side,
      });
      onCommentAdded(comment, file.filename, lineNum);
      setActiveCommentLine(null);
      toast.success(i18n.t('评论已提交'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('提交评论失败'));
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-xs font-mono border-collapse">
        <tbody>
          {lines.map((line, idx) => {
            const side: 'LEFT' | 'RIGHT' = line.type === 'remove' ? 'LEFT' : 'RIGHT';
            const lineNum = side === 'RIGHT' ? (line.lineNew ?? 0) : (line.lineOld ?? 0);
            const commentKey = `${file.filename}:${side}:${lineNum}`;
            const group = commentGroups.get(commentKey);
            const isCommentActive = activeCommentLine === idx;

            if (line.type === 'hunk') {
              return (
                <tr key={idx} className="bg-accent/5">
                  <td className="w-10 px-2 py-0.5 text-muted-foreground text-right select-none border-r border-border" />
                  <td className="w-10 px-2 py-0.5 text-muted-foreground text-right select-none border-r border-border" />
                  <td className="w-6 border-r border-border" />
                  <td className="px-3 py-0.5 text-accent text-xs">{line.content}</td>
                </tr>
              );
            }

            const rowBg =
              line.type === 'add' ? 'bg-success/8' :
              line.type === 'remove' ? 'bg-destructive/8' :
              '';
            const numColor = line.type === 'add' ? 'text-success/70' : line.type === 'remove' ? 'text-destructive/70' : 'text-muted-foreground';
            const textColor = line.type === 'add' ? 'text-success' : line.type === 'remove' ? 'text-destructive' : 'text-foreground';
            const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';

            return (
              <>
                <tr
                  key={idx}
                  className={`group ${rowBg} hover:brightness-95 transition-colors`}
                >
                  {/* 旧行号 */}
                  <td className={`w-10 px-2 py-0.5 text-right select-none border-r border-border ${numColor}`}>
                    {line.lineOld ?? ''}
                  </td>
                  {/* 新行号 */}
                  <td className={`w-10 px-2 py-0.5 text-right select-none border-r border-border ${numColor}`}>
                    {line.lineNew ?? ''}
                  </td>
                  {/* 评论触发按钮 */}
                  <td className="w-6 border-r border-border text-center">
                    {user && lineNum > 0 && (
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 transition-opacity w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-primary"
                        onClick={() => setActiveCommentLine(isCommentActive ? null : idx)}
                        title={i18n.t('添加评论')}
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    )}
                  </td>
                  {/* 代码内容 */}
                  <td className={`px-3 py-0.5 whitespace-pre ${textColor}`}>
                    <span className="select-none mr-1 opacity-60">{prefix}</span>
                    {line.content}
                    {/* 已有评论徽标 */}
                    {group && (
                      <button
                        type="button"
                        className="ml-2 inline-flex items-center gap-0.5 text-accent hover:text-primary"
                        onClick={() => setActiveCommentLine(isCommentActive ? null : idx)}
                        title={`${group.comments.length} 条评论`}
                      >
                        <MessageSquare className="w-3 h-3" />
                        <span className="text-[10px]">{group.comments.length}</span>
                      </button>
                    )}
                  </td>
                </tr>
                {/* 行内评论输入框 */}
                {isCommentActive && (
                  <InlineCommentInput
                    key={`input-${idx}`}
                    onSubmit={(body) => handleAddComment(body, lineNum, side)}
                    onCancel={() => setActiveCommentLine(null)}
                  />
                )}
                {/* 已有评论展示 */}
                {group && activeCommentLine === idx && (
                  <tr key={`comments-${idx}`}>
                    <td colSpan={4} className="p-0">
                      <div className="bg-accent/5 border-y border-border divide-y divide-border">
                        {group.comments.map((c) => (
                          <div key={c.id} className="px-4 py-2.5 flex gap-2 text-xs">
                            <span className="font-medium text-foreground shrink-0">{c.user.login}:</span>
                            <span className="text-muted-foreground">{c.body}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ===== Side-by-Side Diff（左右分屏）=====
interface SideBySideDiffProps {
  file: GitHubFile;
  commentGroups: Map<string, LineCommentGroup>;
  prHead: string;
  owner: string;
  repo: string;
  pullNumber: number;
  onCommentAdded: (c: GitHubComment, path: string, line: number) => void;
}

function SideBySideDiff({ file, commentGroups, prHead, owner, repo, pullNumber, onCommentAdded }: SideBySideDiffProps) {
  const [activeCommentLine, setActiveCommentLine] = useState<{ idx: number; side: 'old' | 'new' } | null>(null);
  const { user } = useAuth();

  if (!file.patch) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground italic">
        {file.status === 'binary' ? i18n.t('二进制文件，无法预览差异') : i18n.t('无差异内容')}
      </div>
    );
  }

  const lines = parsePatch(file.patch);

  // 构建左右两侧行列表
  const pairs: Array<{ left: DiffLine | null; right: DiffLine | null; hunk?: DiffLine }> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.type === 'hunk') {
      pairs.push({ left: null, right: null, hunk: line });
      i++;
    } else if (line.type === 'context') {
      pairs.push({ left: line, right: line });
      i++;
    } else if (line.type === 'remove') {
      // 尝试配对后续的 add 行
      const nextLine = lines[i + 1];
      if (nextLine?.type === 'add') {
        pairs.push({ left: line, right: nextLine });
        i += 2;
      } else {
        pairs.push({ left: line, right: null });
        i++;
      }
    } else if (line.type === 'add') {
      pairs.push({ left: null, right: line });
      i++;
    } else {
      i++;
    }
  }

  const handleAddComment = async (body: string, lineNum: number, side: 'old' | 'new') => {
    try {
      const comment = await createPullRequestReviewComment(owner, repo, pullNumber, {
        body,
        commit_id: prHead,
        path: file.filename,
        line: lineNum,
        side: side === 'new' ? 'RIGHT' : 'LEFT',
      });
      onCommentAdded(comment, file.filename, lineNum);
      setActiveCommentLine(null);
      toast.success(i18n.t('评论已提交'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('提交评论失败'));
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-xs font-mono border-collapse">
        <tbody>
          {pairs.map((pair, idx) => {
            if (pair.hunk) {
              return (
                <tr key={idx} className="bg-accent/5">
                  <td colSpan={6} className="px-3 py-0.5 text-accent text-xs">{pair.hunk.content}</td>
                </tr>
              );
            }

            const leftBg = pair.left?.type === 'remove' ? 'bg-destructive/8' : '';
            const rightBg = pair.right?.type === 'add' ? 'bg-success/8' : '';
            const isActive = activeCommentLine?.idx === idx;

            return (
              <>
                <tr key={idx} className="group">
                  {/* 左侧（删除）*/}
                  <td className={`w-10 px-2 py-0.5 text-right select-none border-r border-border text-muted-foreground ${leftBg}`}>
                    {pair.left?.lineOld ?? ''}
                  </td>
                  <td className={`w-6 border-r border-border text-center ${leftBg}`}>
                    {user && pair.left && pair.left.lineOld && (
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setActiveCommentLine(isActive && activeCommentLine?.side === 'old' ? null : { idx, side: 'old' })}
                      >
                        <Plus className="w-3 h-3 text-muted-foreground hover:text-primary" />
                      </button>
                    )}
                  </td>
                  <td className={`px-3 py-0.5 whitespace-pre w-1/2 border-r border-border ${leftBg} ${pair.left?.type === 'remove' ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {pair.left ? <><span className="select-none opacity-60 mr-1">{pair.left.type === 'remove' ? '-' : ' '}</span>{pair.left.content}</> : ''}
                  </td>
                  {/* 右侧（新增）*/}
                  <td className={`w-10 px-2 py-0.5 text-right select-none border-r border-border text-muted-foreground ${rightBg}`}>
                    {pair.right?.lineNew ?? ''}
                  </td>
                  <td className={`w-6 border-r border-border text-center ${rightBg}`}>
                    {user && pair.right && pair.right.lineNew && (
                      <button
                        type="button"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setActiveCommentLine(isActive && activeCommentLine?.side === 'new' ? null : { idx, side: 'new' })}
                      >
                        <Plus className="w-3 h-3 text-muted-foreground hover:text-primary" />
                      </button>
                    )}
                  </td>
                  <td className={`px-3 py-0.5 whitespace-pre w-1/2 ${rightBg} ${pair.right?.type === 'add' ? 'text-success' : 'text-foreground'}`}>
                    {pair.right ? <><span className="select-none opacity-60 mr-1">{pair.right.type === 'add' ? '+' : ' '}</span>{pair.right.content}</> : ''}
                  </td>
                </tr>
                {isActive && (
                  <InlineCommentInput
                    key={`input-${idx}`}
                    onSubmit={(body) => {
                      const side = activeCommentLine?.side ?? 'new';
                      const lineNum = side === 'new'
                        ? (pair.right?.lineNew ?? 0)
                        : (pair.left?.lineOld ?? 0);
                      return handleAddComment(body, lineNum, side);
                    }}
                    onCancel={() => setActiveCommentLine(null)}
                  />
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ===== 文件 Diff 卡片 =====
interface FileDiffCardProps {
  file: GitHubFile;
  mode: 'unified' | 'side';
  collapsed: boolean;
  onToggle: () => void;
  commentGroups: Map<string, LineCommentGroup>;
  prHead: string;
  owner: string;
  repo: string;
  pullNumber: number;
  onCommentAdded: (c: GitHubComment, path: string, line: number) => void;
}

function FileDiffCard({ file, mode, collapsed, onToggle, commentGroups, prHead, owner, repo, pullNumber, onCommentAdded }: FileDiffCardProps) {

  const statusColor =
    file.status === 'added' ? 'text-success border-success/30 bg-success/10' :
    file.status === 'removed' ? 'text-destructive border-destructive/30 bg-destructive/10' :
    'text-muted-foreground border-border bg-secondary';

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* 文件头 */}
      <button
        type="button"
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 border-b border-border bg-secondary/40 px-3 py-2.5 text-left transition-colors hover:bg-secondary/70"
        onClick={onToggle}
      >
        {collapsed ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <code className="text-xs text-foreground font-mono flex-1 min-w-0 truncate">{file.filename}</code>
        <span className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-success flex items-center gap-0.5">
            <Plus className="w-3 h-3" />{file.additions}
          </span>
          <span className="text-xs text-destructive flex items-center gap-0.5">
            <Minus className="w-3 h-3" />{file.deletions}
          </span>
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${statusColor}`}>
            {file.status}
          </Badge>
        </span>
      </button>
      {!collapsed && (
        mode === 'unified'
          ? <UnifiedDiff file={file} commentGroups={commentGroups} prHead={prHead} owner={owner} repo={repo} pullNumber={pullNumber} onCommentAdded={onCommentAdded} />
          : <SideBySideDiff file={file} commentGroups={commentGroups} prHead={prHead} owner={owner} repo={repo} pullNumber={pullNumber} onCommentAdded={onCommentAdded} />
      )}
    </div>
  );
}

// ===== 主页面 =====
export default function PrDiffPage() {
  const { owner, repo, number } = useParams<{ owner: string; repo: string; number: string }>();
  return <PrDiff key={`${owner}/${repo}/${number}`} owner={owner!} repo={repo!} number={Number(number)} />;
}

function PrDiff({ owner, repo, number }: { owner: string; repo: string; number: number }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const detailPath = `/repos/${owner}/${repo}/pulls/${number}`;
  const [pr, setPr] = useState<GitHubPullRequest | null>(null);
  const [files, setFiles] = useState<GitHubFile[]>([]);
  const [filesPage, setFilesPage] = useState(1);
  const [moreFiles, setMoreFiles] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reviewComments, setReviewComments] = useState<GitHubComment[]>([]);
  const [commentsError, setCommentsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revisionChanged, setRevisionChanged] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<'unified' | 'side'>(isMobile ? 'unified' : 'side');
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewEvent, setReviewEvent] = useState<ReviewEvent>('COMMENT');
  const [reviewBody, setReviewBody] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewPublished, setReviewPublished] = useState(false);
  const changedMessage = i18n.t('分支已有更新，请刷新变更后再评审');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const latest = await getPullRequest(owner, repo, number, { fresh: true });
        if (cancelled) return;
        const result = await getPullRequestFiles(owner, repo, number);
        if (cancelled) return;
        setPr(latest);
        setFiles(result.data);
        setFilesPage(1);
        setMoreFiles(result.hasNextPage);
        setCollapsedFiles(new Set());
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : i18n.t('加载 Diff 失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    getPullRequestReviewComments(owner, repo, number).then((data) => {
      if (!cancelled) setReviewComments(data);
    }).catch(() => { if (!cancelled) setCommentsError(true); });
    return () => { cancelled = true; };
  }, [owner, repo, number, retry]);

  const reloadDiff = () => {
    setReviewOpen(false);
    setLoading(true);
    setPr(null);
    setLoadError('');
    setReviewError('');
    setCommentsError(false);
    setReviewComments([]);
    setRevisionChanged(false);
    setRetry(retry + 1);
  };

  const loadMoreFiles = async () => {
    if (!pr || loadingMore || revisionChanged || !moreFiles) return;
    setLoadingMore(true);
    setLoadError('');
    try {
      const page = filesPage + 1;
      const result = await getPullRequestFiles(owner, repo, number, page);
      const latest = await getPullRequest(owner, repo, number, { fresh: true });
      if (!samePullRevision(pr, latest)) {
        setRevisionChanged(true);
        throw new Error(changedMessage);
      }
      setFiles((previous) => [...previous, ...result.data]);
      setFilesPage(page);
      setMoreFiles(result.hasNextPage);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : i18n.t('加载 Diff 失败'));
    } finally {
      setLoadingMore(false);
    }
  };

  const commentGroups = groupCommentsByLine(reviewComments);
  const allCollapsed = files.length > 0 && files.every((item) => collapsedFiles.has(item.filename));

  const toggleFile = (filename: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const handleCommentAdded = (comment: GitHubComment, _path: string, _line: number) => {
    setReviewComments((prev) => [...prev, comment]);
  };

  const reviewOptions: Record<ReviewEvent, string> = {
    APPROVE: i18n.t('批准'),
    REQUEST_CHANGES: i18n.t('请求更改'),
    COMMENT: i18n.t('仅评论'),
  };
  const isAuthor = isRepoOwner(pr?.user.login, user?.login);
  const canReview = !!user && pr?.state === 'open';
  const reviewRequiresBody = reviewEvent !== 'APPROVE';

  const handleSubmitReview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pr || !canReview || revisionChanged || submittingReview || (reviewRequiresBody && !reviewBody.trim())) return;
    setSubmittingReview(true);
    setReviewError('');
    try {
      const latest = await getPullRequest(owner, repo, number, { fresh: true });
      if (!samePullRevision(pr, latest)) {
        setRevisionChanged(true);
        throw new Error(changedMessage);
      }
      if (latest.state !== 'open') {
        setPr(latest);
        throw new Error(i18n.t('此 PR 已结束'));
      }
      await submitPullRequestReview(owner, repo, number, {
        event: reviewEvent,
        body: reviewBody.trim(),
        commit_id: pr.head.sha,
      });
      toast.success(i18n.t('评审已提交'));
      setReviewOpen(false);
      setReviewBody('');
      setReviewPublished(true);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : i18n.t('提交评审失败'));
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
        <Skeleton className="h-8 w-2/3 bg-muted" />
        <Skeleton className="h-12 w-full bg-muted" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 w-full bg-muted" />)}
      </div>
    );
  }

  if (!pr) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
        <p className="mb-3 break-words text-foreground">{loadError || i18n.t('无法加载 PR 信息')}</p>
        <Button variant="outline" onClick={reloadDiff}>{i18n.t('重试')}</Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}/pulls`)}>Pull Requests</button>
        <ChevronRight className="w-3 h-3" />
        <Link to={detailPath} className="hover:text-accent">#{pr.number}</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">Diff</span>
      </div>

      {/* 标题栏 + 操作 */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="break-words text-lg font-bold text-foreground">{pr.title}</h1>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            <span>{pr.changed_files} {i18n.t('个文件变更')}</span>
            <span className="text-success">+{pr.additions} {i18n.t('行')}</span>
            <span className="text-destructive">-{pr.deletions} {i18n.t('行')}</span>
            <span>{pr.review_comments} {i18n.t('条行内评论')}</span>
          </div>
        </div>

        {canReview && (
          <Button size="sm" className="shrink-0 gap-1.5" onClick={() => { setReviewError(''); setReviewOpen(true); }} disabled={revisionChanged}>
            <MessageCircle className="h-4 w-4" />{i18n.t('提交评审')}
          </Button>
        )}
      </div>
      {reviewPublished && (
        <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" />{i18n.t('评审已提交')}
          <Button variant="link" size="sm" asChild><Link to={`${detailPath}?tab=reviews`}>{i18n.t('查看评审记录')}</Link></Button>
        </div>
      )}
      {commentsError && <p role="status" className="text-sm text-muted-foreground">{i18n.t('暂时无法加载行内评论')}</p>}

      {/* 展示模式与折叠控制 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 w-fit">
        <button
          type="button"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors ${mode === 'unified' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setMode('unified')}
        >
          <AlignJustify className="w-3.5 h-3.5" />
          {i18n.t('合并视图')}</button>
        <button
          type="button"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors ${mode === 'side' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setMode('side')}
        >
          <Columns2 className="w-3.5 h-3.5" />
          {i18n.t('分屏视图')}</button>
      </div>
        <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 w-fit">
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            onClick={() => setCollapsedFiles(new Set())}
            disabled={collapsedFiles.size === 0}
          >
            <ChevronDown className="w-3.5 h-3.5" />
            {i18n.t('全部展开')}</button>
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            onClick={() => setCollapsedFiles(new Set(files.map((item) => item.filename)))}
            disabled={allCollapsed}
          >
            <ChevronUp className="w-3.5 h-3.5" />
            {i18n.t('全部折叠')}</button>
        </div>
      </div>

      {/* 文件 Diff 列表 */}
      <div className="space-y-3">
        {files.map((file) => (
          <FileDiffCard
            key={file.filename}
            file={file}
            mode={mode}
            collapsed={collapsedFiles.has(file.filename)}
            onToggle={() => toggleFile(file.filename)}
            commentGroups={commentGroups}
            prHead={pr.head.sha}
            owner={owner!}
            repo={repo!}
            pullNumber={Number(number)}
            onCommentAdded={handleCommentAdded}
          />
        ))}
      </div>

      {revisionChanged && !reviewOpen && (
        <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {changedMessage}<Button variant="outline" size="sm" onClick={reloadDiff}>{i18n.t('刷新变更')}</Button>
        </div>
      )}
      {moreFiles && !revisionChanged && (
        <div className="space-y-2 text-center">
          {loadError && <p role="alert" className="break-words text-sm text-destructive">{loadError}</p>}
          <Button variant="outline" onClick={loadMoreFiles} disabled={loadingMore}>
            {loadingMore ? i18n.t('加载中...') : `${i18n.t('加载更多文件')} (${files.length}/${pr.changed_files})`}
          </Button>
        </div>
      )}
      {!moreFiles && files.length < pr.changed_files && (
        <Button size="sm" variant="outline" asChild>
          <a href={`https://github.com/${owner}/${repo}/pull/${number}/files`} target="_blank" rel="noopener noreferrer">{i18n.t('在 GitHub 查看其余文件')}</a>
        </Button>
      )}

      <Dialog open={reviewOpen} onOpenChange={(open) => { if (!submittingReview) setReviewOpen(open); }}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto">
          <form onSubmit={handleSubmitReview} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{i18n.t('提交评审')}</DialogTitle>
              <DialogDescription>{i18n.t('评审的提交')} <code>{pr.head.sha.slice(0, 7)}</code></DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="pr-review-event">{i18n.t('评审结果')}</Label>
              <Select value={reviewEvent} onValueChange={(value: ReviewEvent) => setReviewEvent(value)} disabled={submittingReview}>
                <SelectTrigger id="pr-review-event"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMMENT">{reviewOptions.COMMENT}</SelectItem>
                  {!isAuthor && <SelectItem value="APPROVE">{reviewOptions.APPROVE}</SelectItem>}
                  {!isAuthor && <SelectItem value="REQUEST_CHANGES">{reviewOptions.REQUEST_CHANGES}</SelectItem>}
                </SelectContent>
              </Select>
              <Label htmlFor="pr-review-body">{reviewRequiresBody ? i18n.t('评审说明') : i18n.t('评审说明（可选）')}</Label>
              <Textarea id="pr-review-body" value={reviewBody} onChange={(event) => setReviewBody(event.target.value)} rows={4} disabled={submittingReview} required={reviewRequiresBody} />
            </div>
            {reviewError && <p role="alert" className="break-words text-sm text-destructive">{reviewError}</p>}
            <DialogFooter className="gap-y-2">
              <Button type="button" variant="outline" disabled={submittingReview} onClick={() => setReviewOpen(false)}>{i18n.t('取消')}</Button>
              {revisionChanged
                ? <Button type="button" onClick={reloadDiff}>{i18n.t('刷新变更')}</Button>
                : <Button type="submit" disabled={submittingReview || !canReview || (reviewRequiresBody && !reviewBody.trim())}>
                  {submittingReview && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{i18n.t('提交评审')}
                </Button>}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
