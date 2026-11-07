// 全部功能页 —— 功能导航总览（功能地图）
//
// 背景：PC 端有侧边栏可直达所有功能；Android 端原生底部导航仅有 5 个 Tab
//（首页/仓库/AI/搜索/我的），其余约 28 个功能页此前无任何快捷入口。
// 本页作为"功能地图"，从顶部导航栏九宫格按钮进入，补齐移动端功能可达性。

import { Link } from 'react-router-dom';
import {
  Home,
  BookOpen,
  Bell,
  Search,
  Activity,
  Code2,
  Package2,
  Users,
  Download,
  Braces,
  Sparkles,
  Settings,
  Star,
  GitPullRequest,
  GitBranch,
  History,
  FileCode2,
  GitFork,
  Eye,
  Upload,
  Globe,
  MessageSquare,
  FolderKanban,
  NotebookPen,
  ListTodo,
  Zap,
  Boxes,
  type LucideIcon,
} from 'lucide-react';

interface GlobalFeature {
  label: string;
  desc: string;
  path: string;
  icon: LucideIcon;
}

interface RepoFeature {
  label: string;
  sub: string;
}

// ── 全局功能（无需进入仓库即可使用） ─────────────────────────────
const globalFeatures: GlobalFeature[] = [
  { label: '首页', desc: '仪表盘总览', path: '/', icon: Home },
  { label: '仓库列表', desc: '创建/删除/编辑仓库', path: '/repos', icon: BookOpen },
  { label: '通知', desc: '未读通知与批量已读', path: '/notifications', icon: Bell },
  { label: '搜索', desc: '全局搜索仓库/代码/用户', path: '/search', icon: Search },
  { label: '我的收藏', desc: '已 Star 的仓库', path: '/starred', icon: Star },
  { label: '活动', desc: '动态时间线', path: '/activity', icon: Activity },
  { label: 'Gists', desc: '代码片段管理', path: '/gists', icon: Code2 },
  { label: 'Packages', desc: '软件包制品', path: '/packages', icon: Package2 },
  { label: '账号管理', desc: '多账号切换', path: '/accounts', icon: Users },
  { label: '数据导出', desc: '导出仓库/Issue 数据', path: '/export', icon: Download },
  { label: 'GraphQL Playground', desc: 'GraphQL 调试台', path: '/graphql-playground', icon: Braces },
  { label: 'AI 助手', desc: 'AI 任务规划与执行', path: '/ai-assistant', icon: Sparkles },
  { label: '设置', desc: '外观/账号/AI 配置', path: '/settings', icon: Settings },
];

// ── 仓库内功能（需先进入某个仓库，再通过仓库详情页访问） ──────────
const repoFeatures: RepoFeature[] = [
  { label: 'Issues', sub: '/issues' },
  { label: 'Pull Requests', sub: '/pulls' },
  { label: 'PR Diff', sub: '/pulls/{n}/diff' },
  { label: '代码浏览', sub: '/code' },
  { label: '提交历史', sub: '/commits' },
  { label: '分支管理', sub: '/branches' },
  { label: '协作者', sub: '/collaborators' },
  { label: 'Actions', sub: '/actions' },
  { label: 'Packages', sub: '/packages' },
  { label: 'Projects', sub: '/projects' },
  { label: 'Discussions', sub: '/discussions' },
  { label: 'Wiki', sub: '/wiki' },
  { label: '批量上传', sub: '/upload' },
  { label: 'Pages 部署', sub: '/pages' },
  { label: '仓库产物', sub: '/artifacts' },
  { label: 'Forks', sub: '/forks' },
  { label: 'Stargazers', sub: '/stargazers' },
];

const repoIcons: Record<string, LucideIcon> = {
  'Issues': ListTodo,
  'Pull Requests': GitPullRequest,
  'PR Diff': FileCode2,
  '代码浏览': FileCode2,
  '提交历史': History,
  '分支管理': GitBranch,
  '协作者': Users,
  'Actions': Zap,
  'Packages': Package2,
  'Projects': FolderKanban,
  'Discussions': MessageSquare,
  'Wiki': NotebookPen,
  '批量上传': Upload,
  'Pages 部署': Globe,
  '仓库产物': Boxes,
  'Forks': GitFork,
  'Stargazers': Eye,
};

export default function MorePage() {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      {/* 页头说明 */}
      <div>
        <h1 className="text-lg font-semibold text-foreground">全部功能</h1>
        <p className="text-sm text-muted-foreground mt-1">
          GitHubM 提供 30+ 功能模块。移动端底部导航仅保留 5 个核心入口，
          其余功能均可从此处直达；「仓库内功能」请先进入目标仓库。
        </p>
      </div>

      {/* 全局功能网格 */}
      <section>
        <h2 className="text-sm font-medium text-foreground mb-3">全局功能</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {globalFeatures.map((f) => {
            const Icon = f.icon;
            return (
              <Link
                key={f.path}
                to={f.path}
                className="group bg-card border border-border rounded-xl p-4 hover:shadow-sm transition-colors flex flex-col gap-2"
              >
                <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                    {f.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 仓库内功能 */}
      <section>
        <h2 className="text-sm font-medium text-foreground mb-1">仓库内功能</h2>
        <p className="text-xs text-muted-foreground mb-3">
          进入任意仓库详情页后，可在其标签页/菜单中访问以下模块：
        </p>
        <div className="flex flex-wrap gap-2">
          {repoFeatures.map((f) => {
            const Icon = repoIcons[f.label] ?? FileCode2;
            return (
              <span
                key={f.label}
                className="inline-flex items-center gap-1.5 bg-secondary/60 border border-border
                           rounded-full px-3 py-1.5 text-xs text-foreground/80"
              >
                <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                {f.label}
                <span className="text-muted-foreground/70 font-mono">{f.sub}</span>
              </span>
            );
          })}
        </div>
      </section>
    </div>
  );
}
