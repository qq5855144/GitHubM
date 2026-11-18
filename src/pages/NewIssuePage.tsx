// 新建 Issue 页面

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ChevronRight, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createIssue, getRepoLabels, getRepoMilestones } from '@/services/github';
import type { GitHubLabel, GitHubMilestone } from '@/types/types';
import { pageCache } from '@/lib/page-cache';
import { toast } from 'sonner';
import i18n from '@/i18n';

export default function NewIssuePage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [labels, setLabels] = useState('');
  const [assignees, setAssignees] = useState('');
  const [milestone, setMilestone] = useState('__none');
  const [repoLabels, setRepoLabels] = useState<GitHubLabel[]>([]);
  const [repoMilestones, setRepoMilestones] = useState<GitHubMilestone[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!owner || !repo) return;
    let cancelled = false;
    Promise.all([
      getRepoLabels(owner, repo).catch(() => [] as GitHubLabel[]),
      getRepoMilestones(owner, repo).catch(() => [] as GitHubMilestone[]),
    ]).then(([labelList, milestoneList]) => {
      if (cancelled) return;
      setRepoLabels(labelList);
      setRepoMilestones(milestoneList);
    });
    return () => { cancelled = true; };
  }, [owner, repo]);

  const handleCreate = async () => {
    if (!owner || !repo) return;
    if (!title.trim()) {
      toast.error(i18n.t('请输入 Issue 标题'));
      return;
    }
    setCreating(true);
    try {
      const issue = await createIssue(owner, repo, {
        title: title.trim(),
        body: body.trim() || undefined,
        labels: labels.split(',').map((value) => value.trim()).filter(Boolean),
        assignees: assignees.split(',').map((value) => value.trim()).filter(Boolean),
        milestone: milestone === '__none' ? undefined : Number(milestone),
      });
      pageCache.invalidate(`issues:${owner}/${repo}:`);
      toast.success(i18n.t('Issue 创建成功！'));
      navigate(`/repos/${owner}/${repo}/issues/${issue.number}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n.t('创建失败'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate('/repos')}>{i18n.t('仓库')}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
        <ChevronRight className="w-3 h-3" />
        <button type="button" className="hover:text-accent transition-colors" onClick={() => navigate(`/repos/${owner}/${repo}/issues`)}>Issues</button>
        <ChevronRight className="w-3 h-3" />
        <span className="text-foreground">{i18n.t('新建 Issue')}</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <AlertCircle className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">{i18n.t('创建 Issue')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{i18n.t('描述问题、建议或任务')}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 md:p-5 space-y-5">
        <div className="space-y-1.5">
          <Label className="text-sm font-normal text-foreground">{i18n.t('标题 *')}</Label>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={i18n.t('Issue 标题')}
            className="bg-secondary border-border text-foreground placeholder:text-muted-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-normal text-foreground">{i18n.t('描述（支持 Markdown）')}</Label>
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={i18n.t('详细描述问题...')}
            className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-y font-mono text-sm min-h-40"
            rows={8}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-normal text-foreground">{i18n.t('标签（逗号分隔）')}</Label>
            <Input value={labels} onChange={(event) => setLabels(event.target.value)} placeholder={i18n.t('bug, enhancement')} className="bg-secondary border-border text-foreground" />
            {repoLabels.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {repoLabels.slice(0, 8).map((label) => (
                  <button
                    key={label.id}
                    type="button"
                    className="text-[11px] px-1.5 py-0.5 rounded border"
                    style={{ borderColor: `#${label.color}50`, color: `#${label.color}`, backgroundColor: `#${label.color}12` }}
                    onClick={() => {
                      const current = labels.split(',').map((value) => value.trim()).filter(Boolean);
                      if (!current.includes(label.name)) setLabels([...current, label.name].join(', '));
                    }}
                  >
                    {label.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-normal text-foreground">{i18n.t('负责人（逗号分隔）')}</Label>
            <Input value={assignees} onChange={(event) => setAssignees(event.target.value)} placeholder={i18n.t('负责人用户名')} className="bg-secondary border-border text-foreground" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-normal text-foreground">{i18n.t('里程碑')}</Label>
          <Select value={milestone} onValueChange={setMilestone}>
            <SelectTrigger className="bg-secondary border-border text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border max-h-60">
              <SelectItem value="__none" className="text-foreground">{i18n.t('无里程碑')}</SelectItem>
              {repoMilestones.map((item) => (
                <SelectItem key={item.id} value={String(item.number)} className="text-foreground">{item.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
          <Button
            type="button"
            variant="outline"
            className="sm:flex-1 border-border hover:bg-secondary"
            onClick={() => navigate(`/repos/${owner}/${repo}/issues`)}
            disabled={creating}
          >
            {i18n.t('取消')}
          </Button>
          <Button
            type="button"
            className="sm:flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={handleCreate}
            disabled={creating || !title.trim()}
          >
            {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            {creating ? i18n.t('提交中...') : i18n.t('提交 Issue')}
          </Button>
        </div>
      </div>
    </div>
  );
}