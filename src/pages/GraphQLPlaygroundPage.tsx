// GraphQL Playground - 交互式 GitHub GraphQL 查询工具

import { useState, useCallback } from 'react';
import {
  Play,
  Clock,
  Trash2,
  Copy,
  ChevronDown,
  ChevronRight,
  BookOpen,
  AlertCircle,
  CheckCircle2,
  Braces,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { graphqlQuery } from '@/services/github-graphql';
import { toast } from 'sonner';

// 预设查询模板
const TEMPLATES = [
  {
    id: 'viewer',
    name: '当前用户信息',
    description: '获取已登录用户的基本信息',
    query: `query GetViewer {
  viewer {
    login
    name
    email
    bio
    company
    location
    followers { totalCount }
    following { totalCount }
    repositories { totalCount }
    createdAt
  }
}`,
    variables: '{}',
  },
  {
    id: 'contributions',
    name: '贡献热力图',
    description: '获取用户年度贡献统计数据',
    query: `query GetContributions($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
            contributionLevel
          }
        }
      }
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
    }
  }
}`,
    variables: '{\n  "login": "your-username"\n}',
  },
  {
    id: 'pinned',
    name: 'Pinned 仓库',
    description: '获取用户置顶的仓库列表',
    query: `query GetPinnedRepos($login: String!) {
  user(login: $login) {
    pinnedItems(first: 6, types: REPOSITORY) {
      nodes {
        ... on Repository {
          name
          nameWithOwner
          description
          stargazerCount
          forkCount
          isPrivate
          primaryLanguage {
            name
            color
          }
          url
        }
      }
    }
  }
}`,
    variables: '{\n  "login": "your-username"\n}',
  },
  {
    id: 'discussions',
    name: '仓库讨论列表',
    description: '获取仓库的讨论话题（GraphQL 独有）',
    query: `query GetDiscussions($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    discussions(first: 10, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number
        title
        url
        isAnswered
        upvoteCount
        createdAt
        author { login avatarUrl }
        category { name emoji }
        comments { totalCount }
      }
    }
    discussionCategories(first: 10) {
      nodes {
        name
        emoji
        description
      }
    }
  }
}`,
    variables: '{\n  "owner": "owner-name",\n  "repo": "repo-name"\n}',
  },
  {
    id: 'pr-reviews',
    name: 'PR Code Review',
    description: '获取 Pull Request 的审查状态（包含 reviewDecision）',
    query: `query GetPRReviews($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      title
      reviewDecision
      mergeable
      reviewRequests(first: 10) {
        nodes {
          requestedReviewer {
            ... on User { login avatarUrl }
          }
        }
      }
      reviews(first: 20) {
        nodes {
          state
          body
          submittedAt
          author { login avatarUrl }
        }
      }
    }
  }
}`,
    variables: '{\n  "owner": "owner-name",\n  "repo": "repo-name",\n  "number": 1\n}',
  },
];

// 历史记录存储 key
const HISTORY_KEY = 'gql_playground_history';

interface HistoryItem {
  id: string;
  query: string;
  variables: string;
  timestamp: string;
  success: boolean;
  duration: number;
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryItem[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 20)));
  } catch {
    // 忽略存储失败
  }
}

export default function GraphQLPlaygroundPage() {
  const [query, setQuery] = useState(TEMPLATES[0].query);
  const [variables, setVariables] = useState(TEMPLATES[0].variables);
  const [result, setResult] = useState<unknown>(null);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(true);
  const [variablesOpen, setVariablesOpen] = useState(true);

  const handleExecute = useCallback(async () => {
    if (!query.trim()) return;
    setExecuting(true);
    setError(null);
    setResult(null);

    let vars: Record<string, unknown> = {};
    if (variables.trim()) {
      try {
        vars = JSON.parse(variables) as Record<string, unknown>;
      } catch {
        setError('Variables 不是合法的 JSON 格式');
        setExecuting(false);
        return;
      }
    }

    const start = performance.now();
    try {
      const res = await graphqlQuery(query, vars);
      const duration = Math.round(performance.now() - start);
      setResult(res);
      setExecutionTime(duration);

      const histItem: HistoryItem = {
        id: Date.now().toString(),
        query,
        variables,
        timestamp: new Date().toISOString(),
        success: !res.errors || res.errors.length === 0,
        duration,
      };
      const updated = [histItem, ...history].slice(0, 20);
      setHistory(updated);
      saveHistory(updated);

      if (res.errors && res.errors.length > 0) {
        toast.error(`查询出错：${res.errors[0].message}`);
      } else {
        toast.success(`查询成功 (${duration}ms)`);
      }
    } catch (err) {
      const duration = Math.round(performance.now() - start);
      setExecutionTime(duration);
      const msg = err instanceof Error ? err.message : '查询失败';
      setError(msg);
      toast.error(msg);

      const histItem: HistoryItem = {
        id: Date.now().toString(),
        query,
        variables,
        timestamp: new Date().toISOString(),
        success: false,
        duration,
      };
      const updated = [histItem, ...history].slice(0, 20);
      setHistory(updated);
      saveHistory(updated);
    } finally {
      setExecuting(false);
    }
  }, [query, variables, history]);

  const handleCopyResult = () => {
    if (!result) return;
    navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    toast.success('已复制到剪贴板');
  };

  const handleClearHistory = () => {
    setHistory([]);
    saveHistory([]);
    toast.success('历史记录已清除');
  };

  const loadTemplate = (t: (typeof TEMPLATES)[0]) => {
    setQuery(t.query);
    setVariables(t.variables);
    setResult(null);
    setError(null);
    setExecutionTime(null);
  };

  const loadFromHistory = (item: HistoryItem) => {
    setQuery(item.query);
    setVariables(item.variables);
    setResult(null);
    setError(null);
    setHistoryOpen(false);
  };

  // JSON 语法高亮（简单的字符串着色）
  const formatJSON = (data: unknown): string => {
    return JSON.stringify(data, null, 2);
  };

  const resultHasErrors =
    result !== null &&
    typeof result === 'object' &&
    (result as Record<string, unknown>).errors !== undefined &&
    Array.isArray((result as Record<string, unknown>).errors) &&
    ((result as Record<string, unknown>).errors as unknown[]).length > 0;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      {/* 页头 */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2 text-balance">
            <Braces className="w-5 h-5 text-primary" />
            GraphQL Playground
          </h1>
          <p className="text-sm text-muted-foreground mt-1 text-pretty">
            直接对 GitHub GraphQL API 执行查询，支持所有查询和变更操作
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {executionTime !== null && (
            <Badge variant="outline" className={`text-xs border-border ${resultHasErrors ? 'text-destructive border-destructive/30' : 'text-success border-success/30'}`}>
              {resultHasErrors ? '⚠ 有错误' : '✓'} {executionTime}ms
            </Badge>
          )}
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-9"
            onClick={handleExecute}
            disabled={executing || !query.trim()}
          >
            <Play className="w-4 h-4 mr-1.5" />
            {executing ? '执行中...' : '执行查询'}
          </Button>
        </div>
      </div>

      {/* 模板快捷选择 */}
      <Collapsible open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors w-full text-left"
          >
            <BookOpen className="w-4 h-4 text-primary" />
            查询模板
            <span className="text-xs text-muted-foreground">({TEMPLATES.length} 个)</span>
            {templatesOpen ? <ChevronDown className="w-3.5 h-3.5 ml-auto" /> : <ChevronRight className="w-3.5 h-3.5 ml-auto" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="text-left bg-card border border-border rounded-lg p-3 hover:border-primary/50 hover:bg-secondary/30 transition-all group"
                onClick={() => loadTemplate(t)}
              >
                <div className="text-sm font-medium text-foreground group-hover:text-primary mb-1">{t.name}</div>
                <div className="text-xs text-muted-foreground text-pretty">{t.description}</div>
              </button>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* 主编辑区 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 左侧：查询编辑器 */}
        <div className="space-y-3">
          {/* 查询输入 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">GraphQL Query</label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary"
                onClick={() => { setQuery(''); setResult(null); setError(null); }}
              >
                <Trash2 className="w-3 h-3 mr-1" />清空
              </Button>
            </div>
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`# 在此输入 GraphQL 查询\nquery {\n  viewer {\n    login\n  }\n}`}
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none font-mono text-sm min-h-72"
              rows={18}
              spellCheck={false}
            />
          </div>

          {/* Variables 输入 */}
          <Collapsible open={variablesOpen} onOpenChange={setVariablesOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors w-full text-left"
              >
                Variables（JSON）
                {variablesOpen ? <ChevronDown className="w-3.5 h-3.5 ml-auto" /> : <ChevronRight className="w-3.5 h-3.5 ml-auto" />}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Textarea
                value={variables}
                onChange={(e) => setVariables(e.target.value)}
                placeholder={'{\n  "key": "value"\n}'}
                className="mt-1.5 bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none font-mono text-sm min-h-32"
                rows={6}
                spellCheck={false}
              />
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* 右侧：结果展示 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-foreground">结果</label>
            {result !== null && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary"
                onClick={handleCopyResult}
              >
                <Copy className="w-3 h-3 mr-1" />复制
              </Button>
            )}
          </div>

          <div className="bg-secondary border border-border rounded-md min-h-72 overflow-auto max-h-[600px]">
            {executing ? (
              <div className="flex items-center justify-center h-48">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <span className="text-sm">查询执行中...</span>
                </div>
              </div>
            ) : error ? (
              <div className="p-4">
                <div className="flex items-start gap-2 text-destructive mb-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span className="text-sm font-medium">请求错误</span>
                </div>
                <pre className="text-xs text-destructive/80 font-mono whitespace-pre-wrap break-words">{error}</pre>
              </div>
            ) : result === null ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <Play className="w-10 h-10 mb-3 opacity-30" />
                <span className="text-sm">点击「执行查询」运行</span>
                <span className="text-xs mt-1">结果将在此展示</span>
              </div>
            ) : (
              <div className="p-4">
                {resultHasErrors && (
                  <div className="flex items-center gap-2 text-destructive mb-3 bg-destructive/10 rounded-md px-3 py-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="text-xs">响应包含错误，请检查下方 errors 字段</span>
                  </div>
                )}
                {!resultHasErrors && result !== null && (
                  <div className="flex items-center gap-2 text-success mb-3 bg-success/10 rounded-md px-3 py-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span className="text-xs">查询成功 · {executionTime}ms</span>
                  </div>
                )}
                <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
                  {formatJSON(result)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 历史记录 */}
      {history.length > 0 && (
        <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
          <div className="flex items-center justify-between">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
              >
                <Clock className="w-4 h-4 text-muted-foreground" />
                查询历史
                <span className="text-xs text-muted-foreground">({history.length} 条)</span>
                {historyOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={handleClearHistory}
            >
              <Trash2 className="w-3 h-3 mr-1" />清除历史
            </Button>
          </div>
          <CollapsibleContent>
            <div className="mt-2 bg-card border border-border rounded-lg divide-y divide-border overflow-hidden">
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="w-full text-left px-4 py-3 hover:bg-secondary/30 transition-colors group"
                  onClick={() => loadFromHistory(item)}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${item.success ? 'bg-success' : 'bg-destructive'}`} />
                    <code className="text-xs font-mono text-foreground flex-1 min-w-0 truncate">
                      {item.query.trim().split('\n')[0].slice(0, 80)}
                    </code>
                    <span className="text-xs text-muted-foreground shrink-0">{item.duration}ms</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(item.timestamp).toLocaleTimeString('zh-CN')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
