// GitHub Discussions 讨论区（GraphQL API 完整实现）

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  MessageCircle,
  Plus,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  ThumbsUp,
  Send,
  Lock,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import {
  gqlGetDiscussions,
  gqlGetDiscussionComments,
  gqlCreateDiscussion,
  gqlAddDiscussionComment,
  gqlMarkAnswerComment,
  gqlDeleteDiscussionComment,
} from '@/services/github-graphql';
import { formatRelativeTime } from '@/services/github';
import type { GQL_Discussion, GQL_DiscussionCategory, GQL_DiscussionComment } from '@/types/types';
import { toast } from 'sonner';

/** 讨论评论展开面板 */
function DiscussionComments({
  owner,
  repo,
  discussion,
  onClose,
}: {
  owner: string;
  repo: string;
  discussion: GQL_Discussion;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<GQL_DiscussionComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    gqlGetDiscussionComments(owner, repo, discussion.number)
      .then(({ comments: c }) => setComments(c))
      .catch(() => toast.error('加载评论失败'))
      .finally(() => setLoading(false));
  }, [owner, repo, discussion.number]);

  const handleSubmitComment = async () => {
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      const comment = await gqlAddDiscussionComment(discussion.id, newComment.trim());
      setComments((prev) => [...prev, comment]);
      setNewComment('');
      toast.success('评论已发布');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!submitting && newComment.trim()) handleSubmitComment();
    }
  };

  const handleMarkAnswer = async (commentId: string) => {
    try {
      await gqlMarkAnswerComment(commentId);
      setComments((prev) =>
        prev.map((c) => ({ ...c, isAnswer: c.id === commentId }))
      );
      toast.success('已标记为最佳答案 ✅');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDeleteComment = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await gqlDeleteDiscussionComment(deleteTarget);
      setComments((prev) => prev.filter((c) => c.id !== deleteTarget));
      toast.success('评论已删除');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="border-t border-border bg-secondary/20 px-4 py-4 space-y-4">
      {/* 讨论正文 */}
      {discussion.body && (
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Avatar className="w-6 h-6">
              <AvatarImage src={discussion.author?.avatarUrl} />
              <AvatarFallback className="text-xs bg-secondary">{discussion.author?.login?.[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium text-foreground">{discussion.author?.login}</span>
            <span className="text-xs text-muted-foreground">{formatRelativeTime(discussion.createdAt)}</span>
          </div>
          <div className="text-sm text-muted-foreground prose-sm max-w-none">
            <MarkdownRenderer content={discussion.body} />
          </div>
        </div>
      )}

      {/* 评论列表 */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="w-8 h-8 rounded-full bg-muted shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24 bg-muted" />
                <Skeleton className="h-16 w-full bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">暂无评论，成为第一个回复的人</p>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className={`bg-card border rounded-lg p-4 ${comment.isAnswer ? 'border-success/50 bg-success/5' : 'border-border'}`}
            >
              <div className="flex items-start gap-3">
                <Avatar className="w-7 h-7 shrink-0 mt-0.5">
                  <AvatarImage src={comment.author?.avatarUrl} />
                  <AvatarFallback className="text-xs bg-secondary">{comment.author?.login?.[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-sm font-medium text-foreground">{comment.author?.login}</span>
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(comment.createdAt)}</span>
                    {comment.isAnswer && (
                      <Badge className="bg-success/10 text-success border-success/30 text-xs flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />最佳答案
                      </Badge>
                    )}
                    {comment.upvoteCount > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <ThumbsUp className="w-3 h-3" />{comment.upvoteCount}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-foreground prose-sm max-w-none">
                    <MarkdownRenderer content={comment.body} />
                  </div>
                </div>
                {/* 操作按钮 */}
                <div className="flex items-center gap-1 shrink-0">
                  {discussion.category.isAnswerable && !comment.isAnswer && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-7 h-7 text-muted-foreground hover:text-success hover:bg-success/10"
                      title="标记为最佳答案"
                      onClick={() => handleMarkAnswer(comment.id)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-7 h-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="删除评论"
                    onClick={() => setDeleteTarget(comment.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新评论输入 */}
      <div className="space-y-2">
        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="撰写回复（支持 Markdown）..."
          className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none text-sm min-h-20"
          rows={3}
        />
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Ctrl+Enter 快速提交</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="border-border hover:bg-secondary" onClick={onClose}>
              收起
            </Button>
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleSubmitComment}
              disabled={submitting || !newComment.trim()}
            >
              <Send className="w-3.5 h-3.5 mr-1.5" />
              {submitting ? '发布中...' : '发布回复'}
            </Button>
          </div>
        </div>
      </div>

      {/* 删除评论确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">确认删除评论？</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary">取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteComment}
              disabled={deleting}
            >
              {deleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function DiscussionsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();

  const [discussions, setDiscussions] = useState<GQL_Discussion[]>([]);
  const [categories, setCategories] = useState<GQL_DiscussionCategory[]>([]);
  const [repositoryId, setRepositoryId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 创建讨论
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newCategoryId, setNewCategoryId] = useState('');
  const [creating, setCreating] = useState(false);

  const loadDiscussions = useCallback(async (categoryId?: string) => {
    if (!owner || !repo) return;
    setLoading(true);
    setError(null);
    try {
      const result = await gqlGetDiscussions(owner, repo, {
        first: 30,
        categoryId: categoryId && categoryId !== 'all' ? categoryId : undefined,
      });
      setDiscussions(result.discussions);
      setCategories(result.categories);
      setRepositoryId(result.repositoryId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GraphQL 查询失败');
    } finally {
      setLoading(false);
    }
  }, [owner, repo]);

  useEffect(() => {
    loadDiscussions();
  }, [loadDiscussions]);

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
    loadDiscussions(value !== 'all' ? value : undefined);
  };

  const handleCreateDiscussion = async () => {
    if (!newTitle.trim() || !newCategoryId || !repositoryId) return;
    setCreating(true);
    try {
      const discussion = await gqlCreateDiscussion(repositoryId, newCategoryId, newTitle.trim(), newBody.trim());
      setDiscussions((prev) => [discussion, ...prev]);
      setCreateOpen(false);
      setNewTitle('');
      setNewBody('');
      setNewCategoryId('');
      toast.success('讨论已创建 🎉');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const getCommentCount = (d: GQL_Discussion): number => {
    if (typeof d.comments === 'number') return d.comments;
    return d.comments?.totalCount ?? 0;
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate('/repos')}>仓库</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">Discussions</span>
      </div>

      {/* 页头 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-primary" />
          讨论区
          <Badge variant="outline" className="text-xs border-border text-muted-foreground font-normal">
            GraphQL
          </Badge>
        </h1>
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) {
              setNewTitle('');
              setNewBody('');
              setNewCategoryId('');
            }
          }}
          modal={false}
        >
          <DialogTrigger asChild>
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-1.5" />新建讨论
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-foreground">发起新讨论</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-normal text-foreground">分类</Label>
                <Select value={newCategoryId} onValueChange={setNewCategoryId}>
                  <SelectTrigger className="bg-secondary border-border text-foreground">
                    <SelectValue placeholder={categories.length === 0 ? '暂无可用分类' : '选择讨论分类...'} />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border z-[200]">
                    {categories.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">暂无分类数据</div>
                    ) : (
                      categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id} className="text-foreground">
                          {cat.emoji} {cat.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-normal text-foreground">标题</Label>
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="讨论标题..."
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-normal text-foreground">内容（支持 Markdown）</Label>
                <Textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder="详细描述你的问题或想法..."
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none min-h-32"
                  rows={6}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="border-border hover:bg-secondary" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleCreateDiscussion}
                  disabled={creating || !newTitle.trim() || !newCategoryId}
                >
                  {creating ? '创建中...' : '发布讨论'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* 分类筛选 */}
      {!loading && categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => handleCategoryChange('all')}
            className={`px-3 py-1.5 rounded-full text-xs transition-colors shrink-0 ${selectedCategory === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
          >
            全部
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => handleCategoryChange(cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs transition-colors shrink-0 ${selectedCategory === cat.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}
            >
              {cat.emoji} {cat.name}
            </button>
          ))}
        </div>
      )}

      {/* 内容区 */}
      {loading ? (
        <div className="bg-card border border-border rounded-lg divide-y divide-border">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="p-4">
              <Skeleton className="h-5 w-2/3 bg-muted mb-2" />
              <Skeleton className="h-4 w-1/3 bg-muted" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="bg-card border border-border rounded-lg py-16 text-center px-6">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-foreground font-semibold mb-2">无法加载讨论数据</p>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">{error}</p>
          <Button size="sm" onClick={() => loadDiscussions()} className="bg-primary text-primary-foreground hover:bg-primary/90">
            重新加载
          </Button>
        </div>
      ) : discussions.length === 0 ? (
        <div className="bg-card border border-border rounded-lg py-16 text-center px-6">
          <MessageCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-foreground font-semibold mb-2">该仓库暂无讨论</p>
          <p className="text-sm text-muted-foreground mb-6">点击右上角「新建讨论」发起第一个话题</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border">
          {discussions.map((d) => (
            <div key={d.id}>
              {/* 讨论行 */}
              <div
                role="button"
                tabIndex={0}
                className="p-4 hover:bg-secondary/30 transition-colors cursor-pointer group"
                onClick={() => toggleExpand(d.id)}
                onKeyDown={(e) => e.key === 'Enter' && toggleExpand(d.id)}
              >
                <div className="flex items-start gap-3">
                  <MessageCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors text-balance">
                        {d.title}
                      </span>
                      {d.isAnswered && (
                        <Badge className="bg-success/10 text-success border-success/30 text-xs flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />已解答
                        </Badge>
                      )}
                      {d.locked && (
                        <Badge variant="outline" className="text-xs border-border text-muted-foreground flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" />已锁定
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span>{d.category?.emoji} {d.category?.name}</span>
                      <span>·</span>
                      <span>{d.author?.login}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />{formatRelativeTime(d.createdAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" />{getCommentCount(d)} 条回复
                      </span>
                      {d.upvoteCount > 0 && (
                        <span className="flex items-center gap-1">
                          <ThumbsUp className="w-3 h-3" />{d.upvoteCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-muted-foreground">
                    {expandedId === d.id
                      ? <ChevronUp className="w-4 h-4" />
                      : <ChevronDown className="w-4 h-4" />}
                  </div>
                </div>
              </div>
              {/* 展开评论区 */}
              {expandedId === d.id && owner && repo && (
                <DiscussionComments
                  owner={owner}
                  repo={repo}
                  discussion={d}
                  onClose={() => setExpandedId(null)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
