// PR 详情页

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  GitPullRequest,
  GitMerge,
  XCircle,
  MessageSquare,
  Send,
  ChevronRight,
  FileDiff,
  GitBranch,
  Plus,
  Minus,
  Check,
  X,
  AlertCircle,
  UserCheck,
  CheckCircle2,
  XCircle as XCircleIcon,
  MessageCircle,
  Clock,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  getPullRequest,
  getPullRequestFiles,
  getPullRequestComments,
  createPullRequestComment,
  mergePullRequest,
  updatePullRequest,
  formatRelativeTime,
} from '@/services/github';
import { gqlGetPRReviews } from '@/services/github-graphql';
import type {
  GitHubPullRequest,
  GitHubComment,
  GitHubFile,
  GQL_PRReview,
  GQL_ReviewDecision,
} from '@/types/types';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
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

/** Review 状态图标与颜色 */
function ReviewStateIcon({ state }: { state: GQL_PRReview['state'] }) {
  switch (state) {
    case 'APPROVED':
      return <CheckCircle2 className="w-4 h-4 text-success" />;
    case 'CHANGES_REQUESTED':
      return <XCircleIcon className="w-4 h-4 text-destructive" />;
    case 'COMMENTED':
      return <MessageCircle className="w-4 h-4 text-muted-foreground" />;
    case 'DISMISSED':
      return <XCircleIcon className="w-4 h-4 text-muted-foreground" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
}

/** Review 状态标签文字 */
function reviewStateText(state: GQL_PRReview['state']): string {
  switch (state) {
    case 'APPROVED': return '已批准';
    case 'CHANGES_REQUESTED': return '请求更改';
    case 'COMMENTED': return '留下评论';
    case 'DISMISSED': return '已忽略';
    default: return '待审查';
  }
}

/** Review Decision 横幅 */
function ReviewDecisionBanner({ decision }: { decision: GQL_ReviewDecision | null }) {
  if (!decision) return null;
  if (decision === 'APPROVED') {
    return (
      <div className="flex items-center gap-2 bg-success/10 border border-success/30 rounded-lg px-4 py-2.5">
        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
        <span className="text-sm text-success font-medium">所有审查者已批准，可以合并</span>
      </div>
    );
  }
  if (decision === 'CHANGES_REQUESTED') {
    return (
      <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-2.5">
        <XCircleIcon className="w-4 h-4 text-destructive shrink-0" />
        <span className="text-sm text-destructive font-medium">有审查者请求更改，需要修复后才能合并</span>
      </div>
    );
  }
  if (decision === 'REVIEW_REQUIRED') {
    return (
      <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-4 py-2.5">
        <Shield className="w-4 h-4 text-warning shrink-0" />
        <span className="text-sm text-warning font-medium">需要至少一个审查批准才能合并</span>
      </div>
    );
  }
  return null;
}

export default function PullDetailPage() {
  const { owner, repo, number } = useParams<{ owner: string; repo: string; number: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pr, setPr] = useState<GitHubPullRequest | null>(null);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [files, setFiles] = useState<GitHubFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  // GraphQL Reviews 数据
  const [reviews, setReviews] = useState<GQL_PRReview[]>([]);
  const [reviewDecision, setReviewDecision] = useState<GQL_ReviewDecision | null>(null);
  const [requestedReviewers, setRequestedReviewers] = useState<Array<{ login: string; avatarUrl: string }>>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);

  useEffect(() => {
    if (!owner || !repo || !number) return;
    const load = async () => {
      setLoading(true);
      try {
        const [prData, commentsData, filesData] = await Promise.all([
          getPullRequest(owner, repo, Number(number)),
          getPullRequestComments(owner, repo, Number(number)),
          getPullRequestFiles(owner, repo, Number(number)),
        ]);
        setPr(prData);
        setComments(commentsData);
        setFiles(filesData);
      } catch (err) {
        toast.error('加载 PR 详情失败');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [owner, repo, number]);

  // 独立加载 GraphQL Reviews 数据
  useEffect(() => {
    if (!owner || !repo || !number) return;
    setReviewsLoading(true);
    gqlGetPRReviews(owner, repo, Number(number))
      .then(({ reviews: r, reviewDecision: rd, requestedReviewers: rr }) => {
        setReviews(r);
        setReviewDecision(rd);
        setRequestedReviewers(rr);
      })
      .catch(() => {
        // 静默失败，Reviews 面板不影响主功能
      })
      .finally(() => setReviewsLoading(false));
  }, [owner, repo, number]);

  const handleComment = async () => {
    if (!owner || !repo || !number || !newComment.trim()) return;
    setSubmitting(true);
    try {
      const comment = await createPullRequestComment(owner, repo, Number(number), newComment.trim());
      setComments((prev) => [...prev, comment]);
      setNewComment('');
      toast.success('评论已发布');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败');
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

  const handleMerge = async () => {
    if (!owner || !repo || !number) return;
    setMerging(true);
    try {
      await mergePullRequest(owner, repo, Number(number), { merge_method: 'merge' });
      toast.success('Pull Request 已合并！');
      const updated = await getPullRequest(owner, repo, Number(number));
      setPr(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '合并失败');
    } finally {
      setMerging(false);
    }
  };

  const handleClose = async () => {
    if (!owner || !repo || !number || !pr) return;
    setClosing(true);
    try {
      const newState = pr.state === 'open' ? 'closed' : 'open';
      const updated = await updatePullRequest(owner, repo, Number(number), { state: newState });
      setPr(updated);
      toast.success(newState === 'closed' ? 'PR 已关闭' : 'PR 已重新打开');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setClosing(false);
    }
  };

  const getPrIcon = () => {
    if (!pr) return null;
    if (pr.merged) return <GitMerge className="w-5 h-5 text-chart-4" />;
    if (pr.state === 'closed') return <XCircle className="w-5 h-5 text-destructive" />;
    return <GitPullRequest className="w-5 h-5 text-primary" />;
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-full bg-muted" />
        <Skeleton className="h-32 w-full bg-muted" />
      </div>
    );
  }

  if (!pr) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
        <p className="text-foreground">PR 不存在</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>仓库</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}/pulls`)}>Pull Requests</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">#{pr.number}</span>
      </div>

      {/* PR 标题 */}
      <div className="flex items-start gap-3">
        <div className="mt-1 shrink-0">{getPrIcon()}</div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-foreground text-balance">
            {pr.title}
            <span className="text-muted-foreground font-normal ml-2">#{pr.number}</span>
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap text-sm text-muted-foreground">
            <span>{pr.user.login}</span>
            <span>·</span>
            <span>{formatRelativeTime(pr.created_at)} 创建</span>
            <div className="flex items-center gap-1">
              <GitBranch className="w-3.5 h-3.5" />
              <code className="font-mono text-xs">{pr.head.ref}</code>
              <span>→</span>
              <code className="font-mono text-xs">{pr.base.ref}</code>
            </div>
          </div>
        </div>
      </div>

      {/* 统计信息 */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
          <FileDiff className="w-4 h-4 text-muted-foreground" />
          <span className="text-muted-foreground">{pr.changed_files} 个文件</span>
          <span className="text-primary">+{pr.additions}</span>
          <span className="text-destructive">-{pr.deletions}</span>
        </div>
        <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <span className="text-muted-foreground">{pr.comments + pr.review_comments} 条评论</span>
        </div>
      </div>

      {/* GraphQL：Review Decision 横幅 */}
      {!reviewsLoading && <ReviewDecisionBanner decision={reviewDecision} />}

      {/* 操作按钮 */}
      {pr.state === 'open' && (
        <div className="flex flex-wrap gap-3 bg-card border border-border rounded-lg p-4">
          {!pr.merged && pr.state === 'open' && (
            <>
              <Button
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => setMergeConfirmOpen(true)}
                disabled={merging}
              >
                <GitMerge className="w-4 h-4 mr-2" />
                {merging ? '合并中...' : '合并 Pull Request'}
              </Button>
              <Button
                variant="outline"
                className="border-border hover:bg-secondary"
                onClick={handleClose}
                disabled={closing}
              >
                <X className="w-4 h-4 mr-2" />
                关闭 PR
              </Button>
            </>
          )}
        </div>
      )}

      {pr.state === 'closed' && !pr.merged && (
        <div className="flex gap-3 bg-card border border-border rounded-lg p-4">
          <Button
            variant="outline"
            className="border-primary text-primary hover:bg-primary/10"
            onClick={handleClose}
            disabled={closing}
          >
            <Check className="w-4 h-4 mr-2" />
            重新打开 PR
          </Button>
        </div>
      )}

      {/* 主内容标签 */}
      <Tabs defaultValue="description">
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="description" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground">
            描述与评论
          </TabsTrigger>
          <TabsTrigger value="reviews" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground">
            审查 {reviews.length > 0 ? `(${reviews.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="files" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground">
            文件变更 ({files.length})
          </TabsTrigger>
        </TabsList>

        {/* 描述与评论 */}
        <TabsContent value="description" className="space-y-4">
          {/* PR 正文 */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-secondary/30">
              <Avatar className="w-6 h-6">
                <AvatarImage src={pr.user.avatar_url} />
                <AvatarFallback className="bg-secondary text-xs">{pr.user.login[0]}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium text-foreground">{pr.user.login}</span>
              <span className="text-xs text-muted-foreground">{formatRelativeTime(pr.created_at)}</span>
              <Badge variant="outline" className="ml-auto text-xs border-border text-muted-foreground">作者</Badge>
            </div>
            <div className="p-4">
              {pr.body ? (
                <MarkdownRenderer content={pr.body} />
              ) : (
                <p className="text-muted-foreground text-sm italic">无描述</p>
              )}
            </div>
          </div>

          {/* 评论列表 */}
          {comments.map((comment) => (
            <div key={comment.id} className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-secondary/30">
                <Avatar className="w-6 h-6">
                  <AvatarImage src={comment.user.avatar_url} />
                  <AvatarFallback className="bg-secondary text-xs">{comment.user.login[0]}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium text-foreground">{comment.user.login}</span>
                <span className="text-xs text-muted-foreground">{formatRelativeTime(comment.created_at)}</span>
              </div>
              <div className="p-4">
                <MarkdownRenderer content={comment.body} />
              </div>
            </div>
          ))}

          {/* 添加评论 */}
          {user && (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="p-4 space-y-3">
                <Textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={handleCommentKeyDown}
                  placeholder="撰写评论（支持 Markdown）..."
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none font-mono text-sm min-h-24"
                  rows={4}
                />
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Ctrl+Enter 快速提交</span>
                  <Button
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={handleComment}
                    disabled={submitting || !newComment.trim()}
                    size="sm"
                  >
                    {submitting ? '发布中...' : <><Send className="w-3.5 h-3.5 mr-1.5" />发布评论</>}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* GraphQL Reviews 标签页 */}
        <TabsContent value="reviews" className="space-y-4">
          {reviewsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-8 h-8 rounded-full bg-muted" />
                    <Skeleton className="h-4 w-32 bg-muted" />
                    <Skeleton className="h-5 w-16 bg-muted ml-auto" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* 待审查的 Reviewers */}
              {requestedReviewers.length > 0 && (
                <div className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <UserCheck className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">待审查</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {requestedReviewers.map((r) => (
                      <div key={r.login} className="flex items-center gap-2 bg-secondary/50 rounded-lg px-3 py-2">
                        <Avatar className="w-5 h-5">
                          <AvatarImage src={r.avatarUrl} />
                          <AvatarFallback className="text-[10px] bg-muted">{r.login[0]}</AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-foreground">{r.login}</span>
                        <Clock className="w-3 h-3 text-muted-foreground" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reviews 记录 */}
              {reviews.length === 0 && requestedReviewers.length === 0 ? (
                <div className="bg-card border border-border rounded-lg py-12 text-center">
                  <UserCheck className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">该 PR 暂无 Code Review 记录</p>
                </div>
              ) : (
                reviews.map((review) => (
                  <div
                    key={review.id}
                    className={`bg-card border rounded-lg overflow-hidden ${
                      review.state === 'APPROVED' ? 'border-success/40' :
                      review.state === 'CHANGES_REQUESTED' ? 'border-destructive/40' :
                      'border-border'
                    }`}
                  >
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-secondary/30">
                      <Avatar className="w-6 h-6">
                        <AvatarImage src={review.author?.avatarUrl} />
                        <AvatarFallback className="text-xs bg-muted">{review.author?.login?.[0] || '?'}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium text-foreground">{review.author?.login}</span>
                      <span className="text-xs text-muted-foreground">{formatRelativeTime(review.submittedAt)}</span>
                      <div className="ml-auto flex items-center gap-1.5">
                        <ReviewStateIcon state={review.state} />
                        <span className={`text-xs font-medium ${
                          review.state === 'APPROVED' ? 'text-success' :
                          review.state === 'CHANGES_REQUESTED' ? 'text-destructive' :
                          'text-muted-foreground'
                        }`}>{reviewStateText(review.state)}</span>
                      </div>
                    </div>
                    {review.body && (
                      <div className="p-4">
                        <MarkdownRenderer content={review.body} />
                      </div>
                    )}
                  </div>
                ))
              )}
            </>
          )}
        </TabsContent>

        {/* 文件变更 */}
        <TabsContent value="files" className="space-y-3">
          {files.map((file) => (
            <div key={file.filename} className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-secondary/30">
                <code className="text-xs text-foreground font-mono flex-1 min-w-0 truncate">{file.filename}</code>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="flex items-center gap-1 text-xs text-primary">
                    <Plus className="w-3 h-3" />{file.additions}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-destructive">
                    <Minus className="w-3 h-3" />{file.deletions}
                  </span>
                  <Badge variant="outline" className="text-xs border-border text-muted-foreground">{file.status}</Badge>
                </div>
              </div>
              {file.patch && (
                <div className="overflow-x-auto">
                  <pre className="text-xs p-4 font-mono leading-relaxed whitespace-pre-wrap text-foreground">
                    {file.patch.split('\n').map((line, i) => (
                      <span
                        key={i}
                        className={`block ${
                          line.startsWith('+') ? 'bg-primary/10 text-primary' :
                          line.startsWith('-') ? 'bg-destructive/10 text-destructive' :
                          line.startsWith('@@') ? 'text-accent' :
                          'text-muted-foreground'
                        }`}
                      >
                        {line}
                      </span>
                    ))}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </TabsContent>
      </Tabs>

      {/* 合并 PR 二次确认 */}
      <AlertDialog open={mergeConfirmOpen} onOpenChange={setMergeConfirmOpen}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground flex items-center gap-2">
              <GitMerge className="w-4 h-4 text-primary" />
              确认合并 Pull Request？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground text-sm space-y-2">
              <span>将把分支 </span>
              <code className="font-mono text-foreground bg-secondary px-1.5 py-0.5 rounded text-xs">{pr.head.ref}</code>
              <span> 合并到 </span>
              <code className="font-mono text-foreground bg-secondary px-1.5 py-0.5 rounded text-xs">{pr.base.ref}</code>
              <span>，合并后不可撤销。</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => { setMergeConfirmOpen(false); handleMerge(); }}
              disabled={merging}
            >
              <GitMerge className="w-4 h-4 mr-2" />
              确认合并
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
