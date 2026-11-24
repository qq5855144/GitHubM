// PR 详情页

import { useState, useEffect } from 'react';
import { Link, useLocation, useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
  getRepo,
  samePullRevision,
  formatRelativeTime,
} from '@/services/github';
import { gqlGetPRReviews } from '@/services/github-graphql';
import type {
  GitHubPullRequest,
  GitHubComment,
  GitHubFile,
  GitHubRepo,
  GQL_PRReview,
  GQL_ReviewDecision,
} from '@/types/types';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import { UserLink } from '@/components/common/UserLink';
import { useAuth } from '@/contexts/AuthContext';
import { PullActions } from '@/components/repo/PullActions';
import { toast } from 'sonner';
import i18n from "@/i18n";

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
    case 'APPROVED': return i18n.t('已批准');
    case 'CHANGES_REQUESTED': return i18n.t('请求更改');
    case 'COMMENTED': return i18n.t('留下评论');
    case 'DISMISSED': return i18n.t('已忽略');
    default: return i18n.t('待审查');
  }
}

/** Review Decision 横幅 */
function ReviewDecisionBanner({ decision }: { decision: GQL_ReviewDecision | null }) {
  if (!decision) return null;
  if (decision === 'APPROVED') {
    return (
      <div className="flex items-center gap-2 bg-success/10 border border-success/30 rounded-lg px-4 py-2.5">
        <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
        <span className="text-sm text-success font-medium">{i18n.t('评审已通过')}</span>
      </div>
    );
  }
  if (decision === 'CHANGES_REQUESTED') {
    return (
      <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-4 py-2.5">
        <XCircleIcon className="w-4 h-4 text-destructive shrink-0" />
        <span className="text-sm text-destructive font-medium">{i18n.t('有审查者请求更改')}</span>
      </div>
    );
  }
  if (decision === 'REVIEW_REQUIRED') {
    return (
      <div className="flex items-center gap-2 bg-warning/10 border border-warning/30 rounded-lg px-4 py-2.5">
        <Shield className="w-4 h-4 text-warning shrink-0" />
        <span className="text-sm text-warning font-medium">{i18n.t('仓库规则要求评审批准')}</span>
      </div>
    );
  }
  return null;
}

export default function PullDetailPage() {
  const { owner, repo, number } = useParams<{ owner: string; repo: string; number: string }>();
  return <PullDetail key={`${owner}/${repo}/${number}`} owner={owner!} repo={repo!} number={Number(number)} />;
}

function PullDetail({ owner, repo, number }: { owner: string; repo: string; number: number }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const pullsPath = `/repos/${owner}/${repo}/pulls`;
  const detailPath = `${pullsPath}/${number}`;
  const fromList = (location.state as { fromList?: string } | null)?.fromList;
  const backFromDetail = fromList === pullsPath || fromList?.startsWith(`${pullsPath}?`);
  const [pr, setPr] = useState<GitHubPullRequest | null>(null);
  const [repository, setRepository] = useState<GitHubRepo | null>(null);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [commentsError, setCommentsError] = useState(false);
  const [files, setFiles] = useState<GitHubFile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [retry, setRetry] = useState(0);
  const [reviews, setReviews] = useState<GQL_PRReview[]>([]);
  const [reviewDecision, setReviewDecision] = useState<GQL_ReviewDecision | null>(null);
  const [requestedReviewers, setRequestedReviewers] = useState<Array<{ login: string; avatarUrl: string }>>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewsError, setReviewsError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPullRequest(owner, repo, number, { fresh: true }).then((data) => {
      if (!cancelled) setPr(data);
    }).catch((err) => {
      if (!cancelled) setLoadError(err instanceof Error ? err.message : i18n.t('加载 PR 详情失败'));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    getRepo(owner, repo).then((data) => {
      if (!cancelled) setRepository(data);
    }).catch(() => {});
    getPullRequestComments(owner, repo, number).then((data) => {
      if (!cancelled) setComments(data);
    }).catch(() => { if (!cancelled) setCommentsError(true); });
    getPullRequestFiles(owner, repo, number).then(({ data }) => {
      if (!cancelled) setFiles(data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [owner, repo, number, retry]);

  useEffect(() => {
    let cancelled = false;
    gqlGetPRReviews(owner, repo, number)
      .then(({ reviews: result, reviewDecision: decision, requestedReviewers: reviewers }) => {
        if (cancelled) return;
        setReviews(result);
        setReviewDecision(decision);
        setRequestedReviewers(reviewers);
      })
      .catch(() => { if (!cancelled) setReviewsError(true); })
      .finally(() => { if (!cancelled) setReviewsLoading(false); });
    return () => { cancelled = true; };
  }, [owner, repo, number, retry]);

  const pendingMergeCheck = pr?.state === 'open' && !pr.draft && pr.mergeable === null;
  useEffect(() => {
    if (!pendingMergeCheck) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      getPullRequest(owner, repo, number, { fresh: true }).then((latest) => {
        if (cancelled) return;
        setPr((current) => current && samePullRevision(current, latest) && current.mergeable === null
          ? { ...current, mergeable: latest.mergeable, mergeable_state: latest.mergeable_state }
          : current);
      }).catch(() => {});
    }, 1500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [owner, repo, number, pendingMergeCheck]);

  const handleComment = async () => {
    if (!owner || !repo || !number || !newComment.trim()) return;
    setSubmitting(true);
    try {
      const comment = await createPullRequestComment(owner, repo, Number(number), newComment.trim());
      setComments((prev) => [...prev, comment]);
      setNewComment('');
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

  const getPrIcon = () => {
    if (!pr) return null;
    if (pr.merged || pr.merged_at) return <GitMerge className="w-5 h-5 text-chart-4" />;
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
        <p className="mb-3 break-words text-foreground">{loadError || i18n.t('PR 不存在')}</p>
        <Button variant="outline" onClick={() => { setLoading(true); setLoadError(''); setRetry(retry + 1); }}>{i18n.t('重试')}</Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => backFromDetail ? navigate(-1) : navigate(pullsPath)}>Pull Requests</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">#{pr.number}</span>
      </div>

      {/* PR 标题 */}
      <div className="flex items-start gap-3">
        <div className="mt-1 shrink-0">{getPrIcon()}</div>
        <div className="flex-1 min-w-0">
          <h1 className="break-words text-xl font-bold text-foreground">
            {pr.title}
            <span className="text-muted-foreground font-normal ml-2">#{pr.number}</span>
          </h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap text-sm text-muted-foreground">
            <Badge variant="outline">{pr.merged || pr.merged_at ? i18n.t('已合并') : pr.state === 'closed' ? i18n.t('已关闭') : pr.draft ? i18n.t('草稿') : i18n.t('开放')}</Badge>
            <span>{pr.user.login}</span>
            <span>·</span>
            <span>{formatRelativeTime(pr.created_at)} {i18n.t('创建')}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-1 break-all">
              <GitBranch className="w-3.5 h-3.5" />
              <code className="font-mono text-xs">{pr.head.repo?.full_name === pr.base.repo?.full_name ? pr.head.ref : pr.head.label || pr.head.ref}</code>
              <span>→</span>
              <code className="font-mono text-xs">{pr.base.ref}</code>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-start gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" asChild>
            <Link to={`${detailPath}/diff`}>
              <FileDiff className="h-4 w-4" />
              {pr.state === 'open' && user ? i18n.t('查看变更 / 评审') : i18n.t('查看变更')}
            </Link>
          </Button>
          <PullActions owner={owner} repo={repo} pr={pr} repository={repository} login={user?.login} onUpdate={setPr} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{pr.changed_files} {i18n.t('个文件')}</span>
          <span className="text-primary">+{pr.additions}</span>
          <span className="text-destructive">-{pr.deletions}</span>
          <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{pr.comments + pr.review_comments} {i18n.t('条评论')}</span>
        </div>
      </div>
      {!reviewsLoading && <ReviewDecisionBanner decision={reviewDecision} />}

      {/* 主内容标签 */}
      <Tabs defaultValue={params.get('tab') === 'reviews' ? 'reviews' : 'description'}>
        <TabsList className="bg-secondary border border-border">
          <TabsTrigger value="description" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground">
            {i18n.t('描述与评论')}</TabsTrigger>
          <TabsTrigger value="reviews" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground">
            {i18n.t('审查')}{reviews.length > 0 ? `(${reviews.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="files" className="data-[state=active]:bg-card data-[state=active]:text-foreground text-muted-foreground">
            {i18n.t('文件变更')} ({pr.changed_files})
          </TabsTrigger>
        </TabsList>

        {/* 描述与评论 */}
        <TabsContent value="description" className="space-y-4">
          {/* PR 正文 */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-secondary/30">
              <UserLink login={pr.user.login} className="flex items-center gap-2">
                <Avatar className="w-6 h-6">
                  <AvatarImage src={pr.user.avatar_url} />
                  <AvatarFallback className="bg-secondary text-xs">{pr.user.login[0]}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium text-foreground hover:text-accent">{pr.user.login}</span>
              </UserLink>
              <span className="text-xs text-muted-foreground">{formatRelativeTime(pr.created_at)}</span>
              <Badge variant="outline" className="ml-auto text-xs border-border text-muted-foreground">{i18n.t('作者')}</Badge>
            </div>
            <div className="p-4">
              {pr.body ? (
                <MarkdownRenderer content={pr.body} repoContext={owner && repo ? { owner, repo } : undefined} />
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
              </div>
              <div className="p-4">
                <MarkdownRenderer content={comment.body} repoContext={owner && repo ? { owner, repo } : undefined} />
              </div>
            </div>
          ))}

          {commentsError && <p role="status" className="text-sm text-muted-foreground">{i18n.t('暂时无法加载评论')}</p>}

          {/* 添加评论 */}
          {user && (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
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
                  <span className="text-xs text-muted-foreground">{i18n.t('Ctrl+Enter 快速提交')}</span>
                  <Button
                    className="bg-primary text-primary-foreground hover:bg-primary/90"
                    onClick={handleComment}
                    disabled={submitting || !newComment.trim()}
                    size="sm"
                  >
                    {submitting ? i18n.t('发布中...') : <><Send className="w-3.5 h-3.5 mr-1.5" />{i18n.t('发布评论')}</>}
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
          ) : reviewsError ? (
            <p role="status" className="p-3 text-sm text-muted-foreground">{i18n.t('暂时无法加载评审记录')}</p>
          ) : (
            <>
              {/* 待审查的 Reviewers */}
              {requestedReviewers.length > 0 && (
                <div className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <UserCheck className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{i18n.t('待审查')}</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {requestedReviewers.map((r) => (
                      <div key={r.login} className="flex items-center gap-2 bg-secondary/50 rounded-lg px-3 py-2">
                        <UserLink login={r.login} className="flex items-center gap-2">
                          <Avatar className="w-5 h-5">
                            <AvatarImage src={r.avatarUrl} />
                            <AvatarFallback className="text-[10px] bg-muted">{r.login[0]}</AvatarFallback>
                          </Avatar>
                          <span className="text-xs text-foreground hover:text-accent">{r.login}</span>
                        </UserLink>
                        <Clock className="w-3 h-3 text-muted-foreground" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reviews 记录 */}
              {reviews.length === 0 ? (
                <div className="bg-card border border-border rounded-lg py-12 text-center">
                  <UserCheck className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">{i18n.t('该 PR 暂无 Code Review 记录')}</p>
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
                      <UserLink login={review.author?.login || ''} className="flex items-center gap-2">
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={review.author?.avatarUrl} />
                          <AvatarFallback className="text-xs bg-muted">{review.author?.login?.[0] || '?'}</AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium text-foreground hover:text-accent">{review.author?.login}</span>
                      </UserLink>
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
                        <MarkdownRenderer content={review.body} repoContext={owner && repo ? { owner, repo } : undefined} />
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
          {(!files || files.length < pr.changed_files) && (
            <Button size="sm" variant="outline" asChild><Link to={`${detailPath}/diff`}>{i18n.t('查看全部文件')}</Link></Button>
          )}
          {files?.map((file) => (
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

    </div>
  );
}
