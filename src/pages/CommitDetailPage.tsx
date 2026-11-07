import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  GitCommit,
  Minus,
  Plus,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { UserLink } from '@/components/common/UserLink';
import { formatRelativeTime, getCommit } from '@/services/github';
import type { GitHubCommit } from '@/types/types';
import { toast } from 'sonner';
import i18n from '@/i18n';

export default function CommitDetailPage() {
  const { owner, repo, sha } = useParams<{ owner: string; repo: string; sha: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [commit, setCommit] = useState<GitHubCommit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!owner || !repo || !sha) return;
    // 兼容旧链接：/commits/:branch 实际是分支历史，不是提交 SHA
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
      const params = new URLSearchParams(location.search);
      params.set('branch', sha);
      navigate(`/repos/${owner}/${repo}/commits?${params.toString()}`, { replace: true });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCommit(owner, repo, sha)
      .then((detail) => {
        if (!cancelled) setCommit(detail);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : i18n.t('加载提交详情失败');
        setError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [owner, repo, sha, location.search, navigate]);

  const shortSha = sha ? sha.substring(0, 7) : '';

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}/commits`)}>{i18n.t('提交历史')}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground font-mono">{shortSha}</span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2 min-w-0">
          <GitCommit className="w-5 h-5 text-primary shrink-0" />
          <span className="truncate">{i18n.t('提交详情')}</span>
        </h1>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground shrink-0" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" />{i18n.t('返回')}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="bg-card border border-border rounded-xl p-5 space-y-3">
            <Skeleton className="h-5 w-2/3 bg-muted" />
            <Skeleton className="h-4 w-1/3 bg-muted" />
          </div>
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full bg-muted rounded-xl" />)}
        </div>
      ) : error || !commit ? (
        <div className="bg-card border border-border rounded-xl py-16 text-center">
          <GitCommit className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium">{i18n.t('加载提交详情失败')}</p>
          <p className="text-sm text-muted-foreground mt-1 break-all">{error || shortSha}</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate(`/repos/${owner}/${repo}/commits`)}>
            {i18n.t('返回提交历史')}
          </Button>
        </div>
      ) : (
        <>
          <div className="bg-card border border-border rounded-xl p-4 md:p-5 space-y-4 min-w-0">
            <div className="flex items-start gap-3 min-w-0">
              {commit.author ? (
                <UserLink login={commit.author.login} className="shrink-0">
                  <Avatar className="w-9 h-9">
                    <AvatarImage src={commit.author.avatar_url} />
                    <AvatarFallback className="bg-secondary text-xs">
                      {commit.commit.author.name.substring(0, 1)}
                    </AvatarFallback>
                  </Avatar>
                </UserLink>
              ) : (
                <Avatar className="w-9 h-9 shrink-0">
                  <AvatarFallback className="bg-secondary text-xs">
                    {commit.commit.author.name.substring(0, 1)}
                  </AvatarFallback>
                </Avatar>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-base font-medium text-foreground whitespace-pre-wrap break-words">{commit.commit.message}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                  <span>{commit.commit.author.name}</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatRelativeTime(commit.commit.author.date)}</span>
                  <code className="font-mono text-accent break-all">{commit.sha}</code>
                </div>
              </div>
              <a href={commit.html_url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground" title={i18n.t('在 GitHub 查看')}>
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </a>
            </div>

            {commit.stats && (
              <div className="flex items-center gap-3 text-sm bg-secondary rounded-lg px-3 py-2 flex-wrap">
                <span className="text-muted-foreground">{commit.stats.total} {i18n.t('个改动')}</span>
                <span className="text-primary flex items-center gap-1"><Plus className="w-3.5 h-3.5" />{commit.stats.additions}</span>
                <span className="text-destructive flex items-center gap-1"><Minus className="w-3.5 h-3.5" />{commit.stats.deletions}</span>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{i18n.t('变更文件')} ({commit.files?.length || 0})</p>
            </div>
            {(commit.files || []).map((file) => (
              <div key={file.filename} className="bg-card border border-border rounded-xl overflow-hidden min-w-0">
                <div className="flex items-start gap-2 px-4 py-2.5 border-b border-border min-w-0">
                  <code className="text-xs font-mono text-foreground flex-1 min-w-0 break-all">{file.filename}</code>
                  <Badge variant="outline" className="text-[10px] shrink-0 border-border text-muted-foreground">{file.status}</Badge>
                  <span className="text-xs text-primary shrink-0">+{file.additions}</span>
                  <span className="text-xs text-destructive shrink-0">-{file.deletions}</span>
                </div>
                {file.patch ? (
                  <pre className="w-full text-xs p-3 font-mono whitespace-pre-wrap break-all max-h-[30rem] overflow-y-auto">
                    {file.patch.split('\n').map((line, index) => (
                      <span
                        key={index}
                        className={`block whitespace-pre-wrap break-all ${
                          line.startsWith('+') ? 'text-primary' :
                          line.startsWith('-') ? 'text-destructive' :
                          line.startsWith('@@') ? 'text-accent' :
                          'text-muted-foreground'
                        }`}
                      >
                        {line || ' '}
                      </span>
                    ))}
                  </pre>
                ) : (
                  <div className="px-4 py-3 text-xs text-muted-foreground">{i18n.t('无文本差异')}</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
