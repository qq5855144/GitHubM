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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserLink } from '@/components/common/UserLink';
import {
  getIssues,
  createIssue,
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [newLabels, setNewLabels] = useState('');
  const [newAssignees, setNewAssignees] = useState('');
  const [newMilestone, setNewMilestone] = useState('__none');
  const [creating, setCreating] = useState(false);

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
      if (query) {
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
        issuesOnly = result.items.filter((issue) => !issue.pull_request);
        nextPage = pageNum * 30 < result.total_count;
      } else {
        const result = await getIssues(owner, repo, {
          state: stateFilter,
          sort: sortField,
          direction: sortDirection,
          per_page: 30,
          page: pageNum,
          labels: labelFilter || undefined,
          milestone: milestoneFilter || undefined,
          assignee: assigneeFilter.trim() || undefined,
        });
        issuesOnly = result.data.filter((issue) => !issue.pull_request);
        nextPage = result.hasNextPage;
      }
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
  const handleCreateIssue = async () => {
    if (!owner || !repo) return;
    if (!newTitle.trim()) {
      toast.error(i18n.t('请输入 Issue 标题'));
      return;
    }
    setCreating(true);
    try {
      await createIssue(owner, repo, {
        title: newTitle.trim(),
        body: newBody.trim() || undefined,
        labels: newLabels.split(',').map(value => value.trim()).filter(Boolean),
        assignees: newAssignees.split(',').map(value => value.trim()).filter(Boolean),
        milestone: newMilestone === '__none' ? undefined : Number(newMilestone),
      });
      toast.success(i18n.t('Issue 创建成功！'));
      setCreateDialogOpen(false);
      setNewTitle('');
      setNewBody('');
      setNewLabels('');
      setNewAssignees('');
      setNewMilestone('__none');
      pageCache.invalidate(`issues:${owner}/${repo}:`);
      loadIssues(1, false, true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('创建失败'));
    } finally {
      setCreating(false);
    }
  };

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
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4 mr-2" />
              {i18n.t('新建 Issue')}</Button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined} className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-foreground">{i18n.t('创建 Issue')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">{i18n.t('标题 *')}</Label>
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={i18n.t('Issue 标题')}
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">{i18n.t('描述（支持 Markdown）')}</Label>
                <Textarea
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder={i18n.t('详细描述问题...')}
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none font-mono text-sm"
                  rows={6}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-sm font-normal text-foreground">{i18n.t('标签（逗号分隔）')}</Label>
                  <Input value={newLabels} onChange={(e) => setNewLabels(e.target.value)} placeholder={i18n.t('bug, enhancement')} className="bg-secondary border-border text-foreground" />
                </div>
                <div className="space-y-1">
                  <Label className="text-sm font-normal text-foreground">{i18n.t('负责人（逗号分隔）')}</Label>
                  <Input value={newAssignees} onChange={(e) => setNewAssignees(e.target.value)} placeholder={i18n.t('负责人用户名')} className="bg-secondary border-border text-foreground" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-sm font-normal text-foreground">{i18n.t('里程碑')}</Label>
                <Select value={newMilestone} onValueChange={setNewMilestone}>
                  <SelectTrigger className="bg-secondary border-border text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="__none" className="text-foreground">{i18n.t('无里程碑')}</SelectItem>
                    {milestones.map((milestone) => (
                      <SelectItem key={milestone.id} value={String(milestone.number)} className="text-foreground">{milestone.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 border-border hover:bg-secondary"
                  onClick={() => setCreateDialogOpen(false)}
                >
                  {i18n.t('取消')}</Button>
                <Button
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={handleCreateIssue}
                  disabled={creating || !newTitle.trim()}
                >
                  {creating ? i18n.t('提交中...') : i18n.t('提交 Issue')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
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
      <div className="space-y-3 bg-card border border-border rounded-lg p-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex gap-1 shrink-0">
            {([['open', i18n.t('开放')], ['closed', i18n.t('已关闭')], ['all', i18n.t('全部')]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${stateFilter === value ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                onClick={() => setStateFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={i18n.t('搜索标题或正文…')}
              className="bg-secondary border-border text-foreground pl-9"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={labelFilter || '__all'} onValueChange={(v) => setLabelFilter(v === '__all' ? '' : v)}>
            <SelectTrigger className="bg-secondary border-border text-foreground w-[132px] h-9">
              <Tag className="w-3 h-3 mr-1" />
              <SelectValue placeholder={i18n.t('标签')} />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border max-h-60">
              <SelectItem value="__all" className="text-foreground">{i18n.t('全部标签')}</SelectItem>
              {labels.map((label) => (
                <SelectItem key={label.id} value={label.name} className="text-foreground">{label.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={milestoneFilter || '__all'} onValueChange={(v) => setMilestoneFilter(v === '__all' ? '' : v)}>
            <SelectTrigger className="bg-secondary border-border text-foreground w-[150px] h-9">
              <SelectValue placeholder={i18n.t('里程碑')} />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border max-h-60">
              <SelectItem value="__all" className="text-foreground">{i18n.t('全部里程碑')}</SelectItem>
              {milestones.map((milestone) => (
                <SelectItem key={milestone.id} value={milestone.title} className="text-foreground">{milestone.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            placeholder={i18n.t('负责人 login')}
            className="bg-secondary border-border text-foreground w-[140px] h-9"
          />
          <Select value={sortField} onValueChange={(v) => setSortField(v as IssueSortField)}>
            <SelectTrigger className="bg-secondary border-border text-foreground w-[128px] h-9 ml-auto">
              <Filter className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border">
              <SelectItem value="created" className="text-foreground">{i18n.t('创建时间')}</SelectItem>
              <SelectItem value="updated" className="text-foreground">{i18n.t('更新时间')}</SelectItem>
              <SelectItem value="comments" className="text-foreground">{i18n.t('评论数')}</SelectItem>
            </SelectContent>
          </Select>
          {(labelFilter || milestoneFilter || assigneeFilter || searchQuery) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => { setLabelFilter(''); setMilestoneFilter(''); setAssigneeFilter(''); setSearchQuery(''); }}
            >
              <X className="w-3.5 h-3.5 mr-1" />{i18n.t('清除筛选')}
            </Button>
          )}
        </div>
      </div>
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
