// PR Diff 对比视图页

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ChevronRight,
  Plus,
  Minus,
  MessageSquare,
  Send,
  Check,
  X,
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
  getPullRequest,
  getPullRequestFiles,
  getPullRequestReviewComments,
  createPullRequestReviewComment,
  submitPullRequestReview,
  type ReviewEvent,
} from '@/services/github';
import type { GitHubPullRequest, GitHubFile, GitHubComment } from '@/types/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

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
    const key = `${path}:${line}`;
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
            placeholder="添加行内评审评论（支持 Markdown）..."
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
              取消
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleSubmit}
              disabled={submitting || !body.trim()}
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Send className="w-3 h-3 mr-1" />}
              提交评论
            </Button>
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
  const [collapsed, setCollapsed] = useState(false);
  const [activeCommentLine, setActiveCommentLine] = useState<number | null>(null);
  const { user } = useAuth();

  if (!file.patch) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground italic">
        {file.status === 'binary' ? '二进制文件，无法预览差异' : '无差异内容'}
      </div>
    );
  }

  const lines = parsePatch(file.patch);

  const handleAddComment = async (body: string, lineNum: number) => {
    if (!owner || !repo) return;
    try {
      const comment = await createPullRequestReviewComment(owner, repo, pullNumber, {
        body,
        commit_id: prHead,
        path: file.filename,
        line: lineNum,
        side: 'RIGHT',
      });
      onCommentAdded(comment, file.filename, lineNum);
      setActiveCommentLine(null);
      toast.success('评论已提交');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交评论失败');
      throw err;
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-xs font-mono border-collapse">
        <tbody>
          {collapsed ? null : lines.map((line, idx) => {
            const lineNum = line.lineNew ?? line.lineOld ?? 0;
            const commentKey = `${file.filename}:${lineNum}`;
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
                        title="添加评论"
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
                    onSubmit={(body) => handleAddComment(body, lineNum)}
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
        {file.status === 'binary' ? '二进制文件，无法预览差异' : '无差异内容'}
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
      toast.success('评论已提交');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交评论失败');
      throw err;
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
  commentGroups: Map<string, LineCommentGroup>;
  prHead: string;
  owner: string;
  repo: string;
  pullNumber: number;
  onCommentAdded: (c: GitHubComment, path: string, line: number) => void;
}

function FileDiffCard({ file, mode, commentGroups, prHead, owner, repo, pullNumber, onCommentAdded }: FileDiffCardProps) {
  const [collapsed, setCollapsed] = useState(false);

  const statusColor =
    file.status === 'added' ? 'text-success border-success/30 bg-success/10' :
    file.status === 'removed' ? 'text-destructive border-destructive/30 bg-destructive/10' :
    'text-muted-foreground border-border bg-secondary';

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* 文件头 */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 bg-secondary/40 border-b border-border cursor-pointer hover:bg-secondary/70 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <button type="button" className="shrink-0 text-muted-foreground">
          {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
        <code className="text-xs text-foreground font-mono flex-1 min-w-0 truncate">{file.filename}</code>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-success flex items-center gap-0.5">
            <Plus className="w-3 h-3" />{file.additions}
          </span>
          <span className="text-xs text-destructive flex items-center gap-0.5">
            <Minus className="w-3 h-3" />{file.deletions}
          </span>
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${statusColor}`}>
            {file.status}
          </Badge>
        </div>
      </div>
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
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const [pr, setPr] = useState<GitHubPullRequest | null>(null);
  const [files, setFiles] = useState<GitHubFile[]>([]);
  const [reviewComments, setReviewComments] = useState<GitHubComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'unified' | 'side'>(isMobile ? 'unified' : 'side');

  // 快速评审 Dialog
  const [reviewDialog, setReviewDialog] = useState<ReviewEvent | null>(null);
  const [reviewBody, setReviewBody] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // 从 state 中读取 PR 数据（从 PullDetailPage 传来）
  const prFromState = (location.state as { pr?: GitHubPullRequest } | null)?.pr;

  useEffect(() => {
    if (!owner || !repo || !number) return;
    const load = async () => {
      setLoading(true);
      try {
        const [prData, filesData, commentsData] = await Promise.all([
          prFromState ? Promise.resolve(prFromState) : getPullRequest(owner, repo, Number(number)),
          getPullRequestFiles(owner, repo, Number(number)),
          getPullRequestReviewComments(owner, repo, Number(number)),
        ]);
        setPr(prData);
        setFiles(filesData);
        setReviewComments(commentsData);
      } catch (err) {
        toast.error('加载 Diff 失败');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, number]);

  const commentGroups = groupCommentsByLine(reviewComments);

  const handleCommentAdded = (comment: GitHubComment, _path: string, _line: number) => {
    setReviewComments((prev) => [...prev, comment]);
  };

  const handleSubmitReview = async () => {
    if (!owner || !repo || !number || !reviewDialog) return;
    setSubmittingReview(true);
    try {
      await submitPullRequestReview(owner, repo, Number(number), {
        event: reviewDialog,
        body: reviewBody.trim(),
      });
      const labels: Record<ReviewEvent, string> = {
        APPROVE: '已批准 PR',
        REQUEST_CHANGES: '已请求更改',
        COMMENT: '评审评论已提交',
      };
      toast.success(labels[reviewDialog]);
      setReviewDialog(null);
      setReviewBody('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交评审失败');
    } finally {
      setSubmittingReview(false);
    }
  };

  const reviewDialogMeta: Record<ReviewEvent, { title: string; desc: string; icon: React.ReactNode; confirmClass: string; confirmLabel: string }> = {
    APPROVE: {
      title: '批准 Pull Request',
      desc: '表示代码审查通过，同意合并此 PR。',
      icon: <CheckCircle2 className="w-4 h-4 text-success" />,
      confirmClass: 'bg-success text-success-foreground hover:bg-success/90',
      confirmLabel: '批准',
    },
    REQUEST_CHANGES: {
      title: '请求更改',
      desc: '表示需要作者修改后才能合并。',
      icon: <X className="w-4 h-4 text-destructive" />,
      confirmClass: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      confirmLabel: '请求更改',
    },
    COMMENT: {
      title: '提交评论',
      desc: '添加评审评论，不改变 PR 的合并状态。',
      icon: <MessageCircle className="w-4 h-4 text-primary" />,
      confirmClass: 'bg-primary text-primary-foreground hover:bg-primary/90',
      confirmLabel: '提交评论',
    },
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
        <p className="text-foreground">无法加载 PR 信息</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>仓库</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}/pulls`)}>Pull Requests</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(-1)}>#{pr.number}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">Diff</span>
      </div>

      {/* 标题栏 + 操作 */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-foreground text-balance">{pr.title}</h1>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            <span>{files.length} 个文件变更</span>
            <span className="text-success">+{pr.additions} 行</span>
            <span className="text-destructive">-{pr.deletions} 行</span>
            <span>{reviewComments.length} 条行内评论</span>
          </div>
        </div>

        {/* 快速评审按钮组 */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs border border-border text-muted-foreground hover:bg-secondary gap-1"
            onClick={() => setReviewDialog('COMMENT')}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span className="hidden md:inline">评论</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs border border-destructive/40 text-destructive hover:bg-destructive/10 gap-1"
            onClick={() => setReviewDialog('REQUEST_CHANGES')}
          >
            <X className="w-3.5 h-3.5" />
            <span className="hidden md:inline">请求更改</span>
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs bg-success text-success-foreground hover:bg-success/90 gap-1"
            onClick={() => setReviewDialog('APPROVE')}
          >
            <Check className="w-3.5 h-3.5" />
            <span className="hidden md:inline">批准</span>
          </Button>
        </div>
      </div>

      {/* 展示模式切换 */}
      <div className="flex items-center gap-1 bg-secondary rounded-lg p-1 w-fit">
        <button
          type="button"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors ${mode === 'unified' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setMode('unified')}
        >
          <AlignJustify className="w-3.5 h-3.5" />
          合并视图
        </button>
        <button
          type="button"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors ${mode === 'side' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setMode('side')}
        >
          <Columns2 className="w-3.5 h-3.5" />
          分屏视图
        </button>
      </div>

      {/* 文件 Diff 列表 */}
      <div className="space-y-3">
        {files.map((file) => (
          <FileDiffCard
            key={file.filename}
            file={file}
            mode={mode}
            commentGroups={commentGroups}
            prHead={pr.head.sha}
            owner={owner!}
            repo={repo!}
            pullNumber={Number(number)}
            onCommentAdded={handleCommentAdded}
          />
        ))}
      </div>

      {/* 快速评审 Dialog */}
      <AlertDialog open={!!reviewDialog} onOpenChange={(open) => { if (!open) { setReviewDialog(null); setReviewBody(''); } }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          {reviewDialog && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-foreground flex items-center gap-2 text-balance">
                  {reviewDialogMeta[reviewDialog].icon}
                  {reviewDialogMeta[reviewDialog].title}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground text-sm">
                  {reviewDialogMeta[reviewDialog].desc}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="py-2">
                <Textarea
                  value={reviewBody}
                  onChange={(e) => setReviewBody(e.target.value)}
                  placeholder="添加评审说明（可选）..."
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none text-sm min-h-24"
                  rows={4}
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-border hover:bg-secondary">取消</AlertDialogCancel>
                <AlertDialogAction
                  className={reviewDialogMeta[reviewDialog].confirmClass}
                  onClick={handleSubmitReview}
                  disabled={submittingReview}
                >
                  {submittingReview
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />提交中...</>
                    : reviewDialogMeta[reviewDialog].confirmLabel
                  }
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
