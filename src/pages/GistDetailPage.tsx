// Gist 详情页

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Code2,
  Globe,
  Lock,
  GitFork,
  Clock,
  Copy,
  Check,
  Pencil,
  Save,
  X,
  MessageSquare,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  getGist,
  updateGist,
  forkGist,
  getGistComments,
  createGistComment,
  formatRelativeTime,
} from '@/services/github';
import type { GitHubGistDetail, GitHubComment } from '@/types/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import i18n from "@/i18n";

export default function GistDetailPage() {
  const { gistId } = useParams<{ gistId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [gist, setGist] = useState<GitHubGistDetail | null>(null);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [editFiles, setEditFiles] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [forking, setForking] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commenting, setCommenting] = useState(false);

  useEffect(() => {
    if (!gistId) return;
    Promise.all([getGist(gistId), getGistComments(gistId)])
      .then(([g, c]) => { setGist(g); setComments(c); })
      .catch((err) => { toast.error(i18n.t('加载 Gist 失败')); console.error(err); })
      .finally(() => setLoading(false));
  }, [gistId]);

  const handleCopy = (filename: string, content: string) => {
    copyToClipboard(content);
    setCopied(filename);
    setTimeout(() => setCopied(null), 2000);
    toast.success(i18n.t('已复制到剪贴板'));
  };

  const handleEditOpen = () => {
    if (!gist) return;
    setEditDesc(gist.description || '');
    const files: Record<string, string> = {};
    Object.entries(gist.files).forEach(([name, f]) => { files[name] = f.content || ''; });
    setEditFiles(files);
    setEditMode(true);
  };

  const handleSave = async () => {
    if (!gistId) return;
    setSaving(true);
    try {
      const files: Record<string, { content: string }> = {};
      Object.entries(editFiles).forEach(([name, content]) => { files[name] = { content }; });
      const updated = await updateGist(gistId, { description: editDesc, files });
      setGist(updated);
      setEditMode(false);
      toast.success(i18n.t('Gist 已更新'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('更新失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleFork = async () => {
    if (!gistId) return;
    setForking(true);
    try {
      const forked = await forkGist(gistId);
      toast.success(i18n.t('已 Fork，跳转到新 Gist'));
      navigate(`/gists/${forked.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('Fork 失败'));
    } finally {
      setForking(false);
    }
  };

  const handleAddComment = async () => {
    if (!gistId || !newComment.trim()) return;
    setCommenting(true);
    try {
      const c = await createGistComment(gistId, newComment.trim());
      setComments((prev) => [...prev, c]);
      setNewComment('');
      toast.success(i18n.t('评论已发布'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('评论失败'));
    } finally {
      setCommenting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-6 w-1/3 bg-muted" />
        <Skeleton className="h-48 bg-muted rounded-lg" />
      </div>
    );
  }

  if (!gist) return null;

  const isOwner = gist.owner?.login === user?.login;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/gists')}>Gists</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground font-mono">{gistId?.substring(0, 8)}...</span>
      </div>

      {/* 标题栏 */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Code2 className="w-5 h-5 text-primary shrink-0" />
            <span className="text-xl font-bold text-foreground font-mono text-balance">
              {Object.keys(gist.files)[0]}
            </span>
            <Badge variant="outline" className={`text-xs ${gist.public ? 'border-primary/40 text-primary' : 'border-border text-muted-foreground'}`}>
              {gist.public ? <><Globe className="w-2.5 h-2.5 mr-1" />{i18n.t('公开')}</> : <><Lock className="w-2.5 h-2.5 mr-1" />{i18n.t('私密')}</>}
            </Badge>
          </div>
          {gist.description && <p className="text-muted-foreground text-sm mt-1 text-pretty">{gist.description}</p>}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
            <span>{gist.owner?.login}</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatRelativeTime(gist.updated_at)}</span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {!isOwner && (
            <Button variant="ghost" size="sm" className="border border-border text-muted-foreground hover:bg-secondary h-8" onClick={handleFork} disabled={forking}>
              <GitFork className="w-3.5 h-3.5 mr-1.5" />{forking ? i18n.t('Fork中...') : 'Fork'}
            </Button>
          )}
          {isOwner && !editMode && (
            <Button variant="ghost" size="sm" className="border border-border text-muted-foreground hover:bg-secondary h-8" onClick={handleEditOpen}>
              <Pencil className="w-3.5 h-3.5 mr-1.5" />{i18n.t('编辑')}</Button>
          )}
        </div>
      </div>

      {/* 编辑模式 */}
      {editMode && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-sm font-normal text-foreground">{i18n.t('描述')}</Label>
            <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className="bg-secondary border-border text-foreground" />
          </div>
          {Object.entries(editFiles).map(([name, content]) => (
            <div key={name} className="space-y-1">
              <Label className="text-sm font-normal text-foreground font-mono">{name}</Label>
              <Textarea
                value={content}
                onChange={(e) => setEditFiles((prev) => ({ ...prev, [name]: e.target.value }))}
                className="bg-secondary border-border text-foreground font-mono text-xs min-h-40 resize-none"
              />
            </div>
          ))}
          <div className="flex gap-3">
            <Button variant="ghost" className="flex-1 border border-border text-muted-foreground hover:bg-secondary" onClick={() => setEditMode(false)}>
              <X className="w-4 h-4 mr-2" />{i18n.t('取消')}</Button>
            <Button className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-2" />{saving ? i18n.t('保存中...') : i18n.t('保存')}
            </Button>
          </div>
        </div>
      )}

      {/* 文件内容 */}
      {!editMode && Object.entries(gist.files).map(([filename, file]) => (
        <div key={filename} className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-secondary/30">
            <span className="text-sm font-mono text-foreground">{filename}</span>
            <div className="flex items-center gap-2">
              {file.language && <Badge variant="outline" className="text-xs border-border text-muted-foreground">{file.language}</Badge>}
              {file.content && (
                <Button variant="ghost" size="sm" className="h-7 text-muted-foreground hover:bg-secondary" onClick={() => handleCopy(filename, file.content!)}>
                  {copied === filename ? <Check className="w-3 h-3 mr-1" /> : <Copy className="w-3 h-3 mr-1" />}
                  {copied === filename ? i18n.t('已复制') : i18n.t('复制')}
                </Button>
              )}
              <a href={file.raw_url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-accent">Raw</a>
            </div>
          </div>
          <div className="overflow-x-auto">
            <pre className="p-4 text-xs font-mono text-foreground leading-relaxed" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {file.content ? file.content.split('\n').map((line, i) => (
                <span key={i} className="flex">
                  <span className="select-none text-muted-foreground w-8 text-right mr-4 shrink-0">{i + 1}</span>
                  <span className="flex-1 min-w-0">{line}</span>
                </span>
              )) : <span className="text-muted-foreground">{i18n.t('（内容过长，请查看 Raw）')}</span>}
            </pre>
          </div>
        </div>
      ))}

      {/* 评论区 */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          {i18n.t('评论 (')}{comments.length})
        </h2>
        {comments.map((comment) => (
          <div key={comment.id} className="flex gap-3">
            <Avatar className="w-8 h-8 shrink-0">
              <AvatarImage src={comment.user.avatar_url} />
              <AvatarFallback className="bg-secondary text-xs">{comment.user.login.substring(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-secondary/30 border-b border-border flex items-center gap-2">
                <span className="text-sm font-medium text-accent">{comment.user.login}</span>
                <span className="text-xs text-muted-foreground">{formatRelativeTime(comment.created_at)}</span>
              </div>
              <p className="p-3 text-sm text-foreground text-pretty">{comment.body}</p>
            </div>
          </div>
        ))}
        <div className="flex gap-3">
          <Avatar className="w-8 h-8 shrink-0">
            <AvatarImage src={user?.avatar_url} />
            <AvatarFallback className="bg-secondary text-xs">{user?.login?.substring(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-2">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={i18n.t('发表评论...')}
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground text-sm resize-none min-h-20"
            />
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleAddComment}
              disabled={commenting || !newComment.trim()}
            >
              <Send className="w-4 h-4 mr-2" />
              {commenting ? i18n.t('发布中...') : i18n.t('发布评论')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
