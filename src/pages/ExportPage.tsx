// 数据导出

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  FileJson,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Database,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getUserRepos,
  getIssues,
  getPullRequests,
  getCommits,
  getUserEvents,
} from '@/services/github';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type ExportFormat = 'json' | 'csv';
type ExportType = 'repos' | 'issues' | 'pulls' | 'commits' | 'activity';

interface ExportTask {
  id: ExportType;
  label: string;
  description: string;
  needsRepo: boolean;
}

const EXPORT_TASKS: ExportTask[] = [
  { id: 'repos', label: '仓库列表', description: '导出所有仓库信息（名称、描述、语言、星标数等）', needsRepo: false },
  { id: 'issues', label: 'Issue 列表', description: '导出指定仓库的 Issues（标题、状态、标签等）', needsRepo: true },
  { id: 'pulls', label: 'Pull Request 列表', description: '导出指定仓库的 PRs（标题、状态、分支等）', needsRepo: true },
  { id: 'commits', label: '提交历史', description: '导出指定仓库的提交记录', needsRepo: true },
  { id: 'activity', label: '个人活动记录', description: '导出最近 100 条用户活动事件', needsRepo: false },
];

function objectsToCSV(data: Record<string, unknown>[]): string {
  if (!data.length) return '';
  const keys = Object.keys(data[0]);
  const header = keys.join(',');
  const rows = data.map((row) =>
    keys.map((k) => {
      const val = row[k];
      const str = val === null || val === undefined ? '' : String(val).replace(/"/g, '""');
      return `"${str}"`;
    }).join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * 触发文件下载。
 *
 * Android WebView 环境：
 *   blob URL 无法被 DownloadManager 处理。
 *   检测到 AndroidBridge 时将文本内容 Base64 编码后直接传给原生，
 *   由原生写入设备「下载」文件夹，彻底绕过 blob URL。
 *
 * 浏览器环境：
 *   保持原有 Blob → <a download> 流程。
 */
function downloadFile(content: string, filename: string, mime: string) {
  // Android WebView 原生写文件（绕过 blob URL 限制）
  const bridge = (window as unknown as { AndroidBridge?: { saveBlobData?: (f: string, m: string, b: string) => void } }).AndroidBridge;
  if (bridge?.saveBlobData) {
    try {
      // 处理多字节字符（中文/Unicode）：先 encodeURIComponent，再 unescape，再 btoa
      const base64 = btoa(unescape(encodeURIComponent(content)));
      bridge.saveBlobData(filename, mime, base64);
    } catch {
      toast.error('导出失败，请稍后重试');
    }
    return;
  }
  // 浏览器环境：Blob → <a download>
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [repoInput, setRepoInput] = useState('');
  const [format, setFormat] = useState<ExportFormat>('json');
  const [loading, setLoading] = useState<ExportType | null>(null);
  const [exported, setExported] = useState<Set<string>>(new Set());

  const getOwnerRepo = () => {
    const parts = repoInput.trim().split('/');
    if (parts.length === 2) return { owner: parts[0], repo: parts[1] };
    if (user && parts.length === 1 && parts[0]) return { owner: user.login, repo: parts[0] };
    return null;
  };

  const handleExport = async (task: ExportTask) => {
    if (!user) return;
    if (task.needsRepo && !repoInput.trim()) {
      toast.error('请先输入仓库名称（owner/repo 格式）');
      return;
    }

    setLoading(task.id);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rawData: any[] = [];
      const ownerRepo = getOwnerRepo();
      const ts = new Date().toISOString().split('T')[0];

      if (task.id === 'repos') {
        const res = await getUserRepos({ per_page: 100, page: 1 });
        rawData = res.data.map((r) => ({
          name: r.name,
          full_name: r.full_name,
          description: r.description,
          private: r.private,
          language: r.language,
          stars: r.stargazers_count,
          forks: r.forks_count,
          open_issues: r.open_issues_count,
          created_at: r.created_at,
          updated_at: r.updated_at,
          html_url: r.html_url,
        }));
      } else if (task.id === 'issues' && ownerRepo) {
        const res = await getIssues(ownerRepo.owner, ownerRepo.repo, { state: 'all', per_page: 100 });
        rawData = res.data.map((i) => ({
          number: i.number,
          title: i.title,
          state: i.state,
          labels: i.labels.map((l) => l.name).join(', '),
          author: i.user.login,
          comments: i.comments,
          created_at: i.created_at,
          updated_at: i.updated_at,
          html_url: i.html_url,
        }));
      } else if (task.id === 'pulls' && ownerRepo) {
        const res = await getPullRequests(ownerRepo.owner, ownerRepo.repo, { state: 'all', per_page: 100 });
        rawData = res.data.map((p) => ({
          number: p.number,
          title: p.title,
          state: p.state,
          draft: p.draft,
          merged: p.merged_at ? true : false,
          head: p.head.label,
          base: p.base.label,
          author: p.user.login,
          created_at: p.created_at,
          updated_at: p.updated_at,
          html_url: p.html_url,
        }));
      } else if (task.id === 'commits' && ownerRepo) {
        const res = await getCommits(ownerRepo.owner, ownerRepo.repo, { per_page: 100 });
        rawData = res.data.map((c) => ({
          sha: c.sha.substring(0, 7),
          message: c.commit.message.split('\n')[0],
          author: c.commit.author.name,
          email: c.commit.author.email,
          date: c.commit.author.date,
          html_url: c.html_url,
        }));
      } else if (task.id === 'activity') {
        const data = await getUserEvents(user.login, 1);
        rawData = (Array.isArray(data) ? data : []).map((e) => ({
          id: e.id,
          type: e.type,
          repo: e.repo.name,
          actor: e.actor.login,
          created_at: e.created_at,
        }));
      }

      const filename = `${task.id}-export-${ts}.${format}`;
      if (format === 'json') {
        downloadFile(JSON.stringify(rawData, null, 2), filename, 'application/json');
      } else {
        downloadFile(objectsToCSV(rawData as Record<string, unknown>[]), filename, 'text/csv;charset=utf-8;');
      }

      setExported((prev) => new Set([...prev, task.id]));
      toast.success(`${task.label}已导出 (${rawData.length} 条数据)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
        <Database className="w-5 h-5 text-primary" />
        数据导出
      </h1>

      {/* 全局设置 */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <p className="text-sm font-semibold text-foreground">导出设置</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-sm font-normal text-foreground">目标仓库（需要仓库数据时）</Label>
            <Input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="owner/repo 或 repo（使用当前账号）"
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-normal text-foreground">导出格式</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
              <SelectTrigger className="bg-secondary border-border text-foreground h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="json" className="text-foreground">
                  <div className="flex items-center gap-2"><FileJson className="w-3.5 h-3.5 text-warning" />JSON</div>
                </SelectItem>
                <SelectItem value="csv" className="text-foreground">
                  <div className="flex items-center gap-2"><FileSpreadsheet className="w-3.5 h-3.5 text-success" />CSV</div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* 导出任务列表 */}
      <div className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border">
        {EXPORT_TASKS.map((task) => {
          const isLoading = loading === task.id;
          const isDone = exported.has(task.id);
          return (
            <div key={task.id} className="flex items-center gap-4 p-4 group hover:bg-secondary/30 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-secondary/80 flex items-center justify-center shrink-0">
                {format === 'json' ? (
                  <FileJson className="w-5 h-5 text-warning" />
                ) : (
                  <FileSpreadsheet className="w-5 h-5 text-success" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{task.label}</p>
                  {task.needsRepo && (
                    <Badge variant="outline" className="text-xs border-border text-muted-foreground">需要仓库</Badge>
                  )}
                  {isDone && (
                    <Badge className="bg-success/10 text-success border-success/30 text-xs flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />已导出
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="border border-border text-muted-foreground hover:bg-secondary h-8 shrink-0"
                onClick={() => handleExport(task)}
                disabled={isLoading || !!loading}
              >
                {isLoading ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />导出中</>
                ) : (
                  <><Download className="w-3.5 h-3.5 mr-1.5" />导出</>
                )}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="bg-secondary/50 border border-border rounded-lg p-3 flex gap-2 text-xs text-muted-foreground">
        <AlertCircle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <p>数据导出受 GitHub API 速率限制，每次最多导出 100 条记录。如需更多数据，请使用 GitHub 官方数据导出功能。</p>
      </div>
    </div>
  );
}
