// Issue 列表页

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  Plus,
  Filter,
  ChevronRight,
  Tag,
  Search,
  X,
  SlidersHorizontal,
  Flag,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserLink } from '@/components/common/UserLink';
import {
  formatRelativeTime,
  getRepoLabels,
  getRepoMilestones,
  searchIssues,
} from '@/services/github';
import type { GitHubIssue, GitHubLabel, GitHubMilestone, IssueState, IssueSortField, SortDirection } from '@/types/types';
import { useDebounce } from '@/hooks/use-debounce';
import { toast } from 'sonner';
import { pageCache } from '@/lib/page-cache';
import i18n from "@/i18n";

export default function IssuesPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [labels, setLabels] = useState<GitHubLabel[]>([]);
  const [milestones, setMilestones] = useState<GitHubMilestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [page, setPage] = useState(1);
  const [stateFilter, setStateFilter] = useState<IssueState | 'all'>('open');
  const [sortField, setSortField] = useState<IssueSortField>('created');
  const [sortDirection] = useState<SortDirection>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [labelFilter, setLabelFilter] = useState('');
  const [milestoneFilter, setMilestoneFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  const loadIssues = useCallback(async (pageNum = 1, append = false, force = false) => {
    if (!owner || !repo) return;
    if (pageNum === 1) setLoading(true);
    const query = debouncedSearch.trim();
    const cacheKey = `issues:${owner}/${repo}:${stateFilter}:${sortField}:${labelFilter}:${milestoneFilter}:${assigneeFilter}:${query}:p1`;
    if (pageNum === 1 && !append && !force) {
      const cached = pageCache.get<{ issues: GitHubIssue[]; hasNextPage: boolean }>(cacheKey);
      if (cached) {
        setIssues(cached.issues);
        setHasNextPage(cached.hasNextPage);
        setPage(1);
        setLoading(false);
        return;
      }
    }
    try {
      let issuesOnly: GitHubIssue[];
      let nextPage: boolean;
      const q = [
        `repo:${owner}/${repo}`,
        'is:issue',
        stateFilter === 'all' ? '' : `state:${stateFilter}`,
        labelFilter ? `label:"${labelFilter}"` : '',
        milestoneFilter ? `milestone:"${milestoneFilter}"` : '',
        assigneeFilter.trim() ? `assignee:${assigneeFilter.trim()}` : '',
        query,
      ].filter(Boolean).join(' ');
      const result = await searchIssues(q, {
        sort: sortField,
        order: sortDirection,
        per_page: 30,
        page: pageNum,
      });
      issuesOnly = result.items;
      nextPage = pageNum * 30 < result.total_count;
      if (append) {
        setIssues((prev) => [...prev, ...issuesOnly]);
      } else {
        setIssues(issuesOnly);
        pageCache.set(cacheKey, { issues: issuesOnly, hasNextPage: nextPage });
      }
      setHasNextPage(nextPage);
      setPage(pageNum);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('加载 Issue 失败'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [owner, repo, stateFilter, sortField, sortDirection, labelFilter, milestoneFilter, assigneeFilter, debouncedSearch]);
  useEffect(() => {
    loadIssues(1);
    if (owner && repo) {
      getRepoLabels(owner, repo).then(setLabels).catch(console.error);
      getRepoMilestones(owner, repo).then(setMilestones).catch(console.error);
    }
  }, [loadIssues, owner, repo]);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">Issues</span>
      </div>

      {/* 页头 */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-foreground">Issues</h1>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => navigate(`/repos/${owner}/${repo}/issues/new`)}>
          <Plus className="w-4 h-4 mr-2" />
          {i18n.t('新建 Issue')}
        </Button>
      </div>

      {/* 标签列表 */}
      {labels.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Tag className="w-4 h-4 text-muted-foreground" />
          {labels.slice(0, 8).map((label) => (
            <Badge
              key={label.id}
              variant="outline"
              className={`text-xs h-5 px-2 cursor-pointer transition-all ${labelFilter === label.name ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : 'opacity-80 hover:opacity-100'}`}
              style={{
                borderColor: `#${label.color}50`,
                backgroundColor: `#${label.color}20`,
                color: `#${label.color}`,
              }}
              onClick={() => setLabelFilter(labelFilter === label.name ? '' : label.name)}
            >
              {label.name}
            </Badge>
          ))}
        </div>
      )}

      {/* 筛选栏 */}
      <div className="rounded-xl border border-border bg-card p-3 space-y-3">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-secondary/40 p-1">
          {([['open', i18n.t('开放')], ['closed', i18n.t('已关闭')], ['all', i18n.t('全部')]] as const).map(([value, label]) => (
            <button key={value} type="button" className={`h-8 rounded-md text-sm font-medium transition-colors ${stateFilter === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setStateFilter(value)}>{label}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-t text-muted-foreground" />
            <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={i18n.t('搜索标题或正文…')} className="bg-secondary border-border text-foreground pl-9 h-10" />
          </div>
          <Button variant="outline" className="h-10 shrink-0 border-border hover:bg-secondary" onClick={() => setFilterOpen(true)}>
            <SlidersHorizontal className="w-4 h-4 mr-1.5" />{i18n.t('筛选')}
            {(labelFilter || milestoneFilter || assigneeFilter) && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{[labelFilter, milestoneFilter, assigneeFilter].filter(Boolean).length}</span>}
          </Button>
        </div>
        {(labelFilter || milestoneFilter || assigneeFilter) && (
          <div className="flex flex-wrap gap-1.5">
            {labelFilter && <Badge variant="outline" className="text-xs h-6 border-primary/30 text-primary"><Tag className="w-3 h-3 mr-1" />{labelFilter}<button type="button" className="ml-1" onClick={() => setLabelFilter('')}><X className="w-3 h-3" /></button></Badge>}
            {milestoneFilter && <Badge variant="outline" className="text-xs h-6 border-primary/30 text-primary"><Flag className="w-3 h-3 mr-1" />{milestoneFilter}<button type="button" className="ml-1" onClick={() => setMilestoneFilter('')}><X className="w-3 h-3" /></button></Badge>}
            {assigneeFilter && <Badge variant="outline" className="text-xs h-6 border-primary/30 text-primary"><Users className="w-3 h-3 mr-1" />{assigneeFilter}<button type="button" className="ml-1" onClick={() => setAssigneeFilter('')}><X className="w-3 h-3" /></button></Badge>}
          </div>
        )}
      </div>
      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-[calc(100%-2rem)] md:max-w-md bg-card border-border">
          <DialogHeader><DialogTitle className="text-foreground">{i18n.t('筛选 Issues')}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{i18n.t('标签')}</Label><Select value={labelFilter || '__all'} onValueChange={(v) => setLabelFilter(v === '__all' ? '' : v)}><SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-popover border-border max-h-60"><SelectItem value="__all" className="text-foreground">{i18n.t('全部标签')}</SelectItem>{labels.map((label) => <SelectItem key={label.id} value={label.name} className="text-foreground">{label.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{i18n.t('里程碑')}</Label><Select value={milestoneFilter || '__all'} onValueChange={(v) => setMilestoneFilter(v === '__all' ? '' : v)}><SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-popover border-border max-h-60"><SelectItem value="__all" className="text-foreground">{i18n.t('全部里程碑')}</SelectItem>{milestones.map((milestone) => <SelectItem key={milestone.id} value={milestone.title} className="text-foreground">{milestone.title}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{i18n.t('负责人')}</Label><Input value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} placeholder={i18n.t('负责人用户名')} className="bg-secondary border-border text-foreground" /></div>
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{i18n.t('排序')}</Label><Select value={sortField} onValueChange={(v) => setSortField(v as IssueSortField)}><SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger><SelectContent className="bg-popover border-border"><SelectItem value="created" className="text-foreground">{i18n.t('创建时间')}</SelectItem><SelectItem value="updated" className="text-foreground">{i18n.t('更新时间')}</SelectItem><SelectItem value="comments" className="text-foreground">{i18n.t('评论数')}</SelectItem></SelectContent></Select></div>
            <div className="flex gap-2 pt-1"><Button variant="outline" className="flex-1 border-border" onClick={() => { setLabelFilter(''); setMilestoneFilter(''); setAssigneeFilter(''); }}>{i18n.t('清空筛选')}</Button><Button className="flex-1 bg-primary text-primary-foreground" onClick={() => setFilterOpen(false)}>{i18n.t('完成')}</Button></div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Issue 列表 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {loading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="p-4">
                <Skeleton className="h-5 w-2/3 bg-muted mb-2" />
                <Skeleton className="h-4 w-1/3 bg-muted" />
              </div>
            ))}
          </div>
        ) : issues.length === 0 ? (
          <div className="py-16 text-center">
            {stateFilter === 'open' ? (
              <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            ) : (
              <CheckCircle2 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            )}
            <p className="text-foreground font-medium">{i18n.t('暂无')}{stateFilter === 'open' ? i18n.t('开放') : i18n.t('已关闭')} {i18n.t('的 Issue')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {issues.map((issue) => (
              <button
                key={issue.id}
                type="button"
                className="w-full p-4 hover:bg-secondary/50 transition-colors text-left group"
                onClick={() => navigate(`/repos/${owner}/${repo}/issues/${issue.number}`)}
              >
                <div className="flex items-start gap-3">
                  {issue.state === 'open' ? (
                    <AlertCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground group-hover:text-accent transition-colors text-balance">
                        {issue.title}
                      </span>
                      {issue.labels.map((label) => (
                        <Badge
                          key={label.id}
                          variant="outline"
                          className="text-xs h-4 px-1.5 shrink-0"
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
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        #{issue.number} · {formatRelativeTime(issue.created_at)} {i18n.t('· 由')} <UserLink login={issue.user.login} className="hover:text-accent hover:underline">{issue.user.login}</UserLink> {i18n.t('创建')}</span>
                      {issue.assignees.length > 0 && (
                        <div className="flex items-center gap-1">
                          {issue.assignees.slice(0, 3).map((a) => (
                            <Avatar key={a.id} className="w-4 h-4">
                              <AvatarImage src={a.avatar_url} />
                              <AvatarFallback className="text-xs">{a.login[0]}</AvatarFallback>
                            </Avatar>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {issue.comments > 0 && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <MessageSquare className="w-3.5 h-3.5" />
                      {issue.comments}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {hasNextPage && !loading && (
        <div className="text-center">
          <Button
            variant="outline"
            className="border-border hover:bg-secondary"
            onClick={() => loadIssues(page + 1, true)}
          >
            {i18n.t('加载更多')}</Button>
        </div>
      )}
    </div>
  );
}
