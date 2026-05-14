// 提交历史页

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Clock,
  ChevronRight,
  GitCommit,
  Plus,
  Minus,
  ExternalLink,
  GitBranch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getCommits, getCommit, getBranches, formatRelativeTime } from '@/services/github';
import type { GitHubCommit, GitHubBranch } from '@/types/types';
import { toast } from 'sonner';
import { pageCache } from '@/lib/page-cache';

export default function CommitsPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedCommit, setSelectedCommit] = useState<GitHubCommit | null>(null);
  const [commitDetailLoading, setCommitDetailLoading] = useState(false);

  useEffect(() => {
    if (!owner || !repo) return;
    getBranches(owner, repo)
      .then((result) => {
        setBranches(result.data);
        if (result.data.length > 0) setSelectedBranch(result.data[0].name);
      })
      .catch(console.error);
  }, [owner, repo]);

  const loadCommits = useCallback(async (pageNum = 1, append = false, force = false) => {
    if (!owner || !repo || !selectedBranch) return;
    if (pageNum === 1) setLoading(true);

    const cacheKey = `commits:${owner}/${repo}:${selectedBranch}:p1`;
    if (pageNum === 1 && !append && !force) {
      const cached = pageCache.get<{ commits: GitHubCommit[]; hasNextPage: boolean }>(cacheKey);
      if (cached) {
        setCommits(cached.commits);
        setHasNextPage(cached.hasNextPage);
        setPage(1);
        setLoading(false);
        return;
      }
    }

    try {
      const result = await getCommits(owner, repo, {
        sha: selectedBranch,
        per_page: 30,
        page: pageNum,
      });
      if (append) {
        setCommits((prev) => [...prev, ...result.data]);
      } else {
        setCommits(result.data);
        pageCache.set(cacheKey, { commits: result.data, hasNextPage: result.hasNextPage });
      }
      setHasNextPage(result.hasNextPage);
      setPage(pageNum);
    } catch (err) {
      toast.error('加载提交历史失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [owner, repo, selectedBranch]);

  useEffect(() => {
    if (selectedBranch) loadCommits(1);
  }, [loadCommits, selectedBranch]);

  const handleViewCommit = async (sha: string) => {
    if (!owner || !repo) return;
    setCommitDetailLoading(true);
    try {
      const detail = await getCommit(owner, repo, sha);
      setSelectedCommit(detail);
    } catch (err) {
      toast.error('加载提交详情失败');
      console.error(err);
    } finally {
      setCommitDetailLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>仓库</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">提交历史</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <GitCommit className="w-5 h-5 text-primary" />
          提交历史
        </h1>
        <Select value={selectedBranch} onValueChange={setSelectedBranch}>
          <SelectTrigger className="bg-secondary border-border text-foreground w-40 h-9">
            <GitBranch className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="选择分支" />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border max-h-48">
            {branches.map((branch) => (
              <SelectItem key={branch.name} value={branch.name} className="text-foreground font-mono text-sm">
                {branch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 提交列表 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="p-4 flex items-center gap-3">
                <Skeleton className="w-8 h-8 rounded-full bg-muted" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-2/3 bg-muted mb-1.5" />
                  <Skeleton className="h-4 w-1/3 bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : commits.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">暂无提交记录</div>
        ) : (
          <div className="divide-y divide-border">
            {commits.map((commit) => (
              <div
                key={commit.sha}
                className="p-4 hover:bg-secondary/50 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <Avatar className="w-8 h-8 shrink-0">
                    <AvatarImage src={commit.author?.avatar_url} />
                    <AvatarFallback className="bg-secondary text-xs">
                      {commit.commit.author.name.substring(0, 1)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      className="text-sm font-medium text-foreground group-hover:text-accent transition-colors text-left line-clamp-2 text-balance w-full"
                      onClick={() => handleViewCommit(commit.sha)}
                    >
                      {commit.commit.message.split('\n')[0]}
                    </button>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {commit.commit.author.name}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(commit.commit.author.date)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="text-xs bg-secondary border border-border px-2 py-1 rounded font-mono text-accent hover:bg-secondary/80 transition-colors"
                      onClick={() => handleViewCommit(commit.sha)}
                    >
                      {commit.sha.substring(0, 7)}
                    </button>
                    <a
                      href={commit.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:bg-secondary">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Button>
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {hasNextPage && !loading && (
        <div className="text-center">
          <Button
            variant="outline"
            className="border-border hover:bg-secondary"
            onClick={() => loadCommits(page + 1, true)}
          >
            加载更多
          </Button>
        </div>
      )}

      {/* 提交详情弹窗 */}
      <Dialog open={!!selectedCommit} onOpenChange={() => setSelectedCommit(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground text-base font-medium">
              提交详情
            </DialogTitle>
          </DialogHeader>
          {commitDetailLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full bg-muted" />
              <Skeleton className="h-4 w-2/3 bg-muted" />
            </div>
          ) : selectedCommit ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground">{selectedCommit.commit.message}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span>{selectedCommit.commit.author.name}</span>
                  <span>{formatRelativeTime(selectedCommit.commit.author.date)}</span>
                  <code className="font-mono text-accent">{selectedCommit.sha.substring(0, 12)}</code>
                </div>
              </div>
              {selectedCommit.stats && (
                <div className="flex items-center gap-3 text-sm bg-secondary rounded-lg px-3 py-2">
                  <span className="text-muted-foreground">{selectedCommit.stats.total} 个改动</span>
                  <span className="text-primary flex items-center gap-1"><Plus className="w-3.5 h-3.5" />{selectedCommit.stats.additions}</span>
                  <span className="text-destructive flex items-center gap-1"><Minus className="w-3.5 h-3.5" />{selectedCommit.stats.deletions}</span>
                </div>
              )}
              {selectedCommit.files && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">变更文件 ({selectedCommit.files.length})</p>
                  <div className="space-y-2">
                    {selectedCommit.files.map((file) => (
                      <div key={file.filename} className="bg-secondary border border-border rounded-md overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                          <code className="text-xs font-mono text-foreground flex-1 min-w-0 truncate">{file.filename}</code>
                          <span className="text-xs text-primary shrink-0">+{file.additions}</span>
                          <span className="text-xs text-destructive shrink-0">-{file.deletions}</span>
                        </div>
                        {file.patch && (
                          <pre className="text-xs p-2 font-mono overflow-x-auto max-h-40">
                            {file.patch.split('\n').slice(0, 20).map((line, i) => (
                              <span
                                key={i}
                                className={`block ${
                                  line.startsWith('+') ? 'text-primary' :
                                  line.startsWith('-') ? 'text-destructive' :
                                  line.startsWith('@@') ? 'text-accent' :
                                  'text-muted-foreground'
                                }`}
                              >
                                {line}
                              </span>
                            ))}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
