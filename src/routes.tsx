import { Suspense, lazy } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import RepoOwnerGate from './components/repo/RepoOwnerGate';
import i18n from '@/i18n';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ReposPage = lazy(() => import('./pages/ReposPage'));
const NewRepoPage = lazy(() => import('./pages/NewRepoPage'));
const RepoDetailPage = lazy(() => import('./pages/RepoDetailPage'));
const IssuesPage = lazy(() => import('./pages/IssuesPage'));
const NewIssuePage = lazy(() => import('./pages/NewIssuePage'));
const IssueDetailPage = lazy(() => import('./pages/IssueDetailPage'));
const PullsPage = lazy(() => import('./pages/PullsPage'));
const NewPullPage = lazy(() => import('./pages/NewPullPage'));
const PullDetailPage = lazy(() => import('./pages/PullDetailPage'));
const CodeBrowserPage = lazy(() => import('./pages/CodeBrowserPage'));
const CommitsPage = lazy(() => import('./pages/CommitsPage'));
const CommitDetailPage = lazy(() => import('./pages/CommitDetailPage'));
const BranchesPage = lazy(() => import('./pages/BranchesPage'));
const CollaboratorsPage = lazy(() => import('./pages/CollaboratorsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
const ActivityDetailPage = lazy(() => import('./pages/ActivityDetailPage'));
const ActionsPage = lazy(() => import('./pages/ActionsPage'));
const ActionsSecretsPage = lazy(() => import('./pages/ActionsSecretsPage'));
const GistsPage = lazy(() => import('./pages/GistsPage'));
const GistDetailPage = lazy(() => import('./pages/GistDetailPage'));
const PackagesPage = lazy(() => import('./pages/PackagesPage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const DiscussionsPage = lazy(() => import('./pages/DiscussionsPage'));
const WikiPage = lazy(() => import('./pages/WikiPage'));
const AccountsPage = lazy(() => import('./pages/AccountsPage'));
const ExportPage = lazy(() => import('./pages/ExportPage'));
const UploadPage = lazy(() => import('./pages/UploadPage'));
const PagesDeployPage = lazy(() => import('./pages/PagesDeployPage'));
const ArtifactsPage = lazy(() => import('./pages/ArtifactsPage'));
const AppStoreRepoDetailPage = lazy(() => import('./pages/AppStoreRepoDetailPage'));
const GraphQLPlaygroundPage = lazy(() => import('./pages/GraphQLPlaygroundPage'));
const FollowListPage = lazy(() => import('./pages/FollowListPage'));
const StarredPage = lazy(() => import('./pages/StarredPage'));
const UserProfilePage = lazy(() => import('./pages/UserProfilePage'));
const RepoForksPage = lazy(() => import('./pages/RepoForksPage'));
const StargazersPage = lazy(() => import('./pages/StargazersPage'));
const PrDiffPage = lazy(() => import('./pages/PrDiffPage'));
const AiAssistantV2Page = lazy(() => import('./pages/AiAssistantV2Page'));
const AiSettingsPage = lazy(() => import('./pages/AiSettingsPage'));
const MorePage = lazy(() => import('./pages/MorePage'));

export interface RouteConfig {
  /** 路由标题的 i18n key，渲染时取当前语言，避免模块加载期固化 */
  nameKey: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  /** Accessible without login. Routes without this flag require authentication. Has no effect when RouteGuard is not in use. */
  public?: boolean;
}

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] w-full items-center justify-center">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
    </div>
  );
}

function page(node: ReactNode): ReactNode {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>;
}

export function routeName(route: RouteConfig): string {
  return i18n.t(route.nameKey);
}

export const ASSISTANT_PATH = '/ai-assistant';

export function assistantPage(visible: boolean) {
  return page(<AiAssistantV2Page visible={visible} />);
}

export const routes: RouteConfig[] = [
  // 公开路由
  { nameKey: '登录', path: '/login', element: page(<LoginPage />), public: true },
  // 受保护路由
  { nameKey: '首页', path: '/', element: page(<DashboardPage />) },
  { nameKey: '仓库列表', path: '/repos', element: page(<ReposPage />) },
  { nameKey: '新建仓库', path: '/repos/new', element: page(<NewRepoPage />), visible: false },
  { nameKey: '仓库详情', path: '/repos/:owner/:repo', element: page(<RepoDetailPage />) },
  {
    nameKey: '应用商店详情',
    path: '/store/:owner/:repo',
    element: page(<AppStoreRepoDetailPage />),
    visible: false,
  },
  { nameKey: 'Issues', path: '/repos/:owner/:repo/issues', element: page(<IssuesPage />) },
  { nameKey: '新建 Issue', path: '/repos/:owner/:repo/issues/new', element: page(<NewIssuePage />), visible: false },
  { nameKey: 'Issue 详情', path: '/repos/:owner/:repo/issues/:number', element: page(<IssueDetailPage />) },
  { nameKey: 'Pull Requests', path: '/repos/:owner/:repo/pulls', element: page(<PullsPage />) },
  { nameKey: '新建 PR', path: '/repos/:owner/:repo/pulls/new', element: page(<NewPullPage />), visible: false },
  { nameKey: 'PR 详情', path: '/repos/:owner/:repo/pulls/:number', element: page(<PullDetailPage />) },
  { nameKey: 'PR Diff', path: '/repos/:owner/:repo/pulls/:number/diff', element: page(<PrDiffPage />) },
  { nameKey: '代码浏览', path: '/repos/:owner/:repo/code/*', element: page(<CodeBrowserPage />) },
  { nameKey: '代码浏览根', path: '/repos/:owner/:repo/code', element: page(<CodeBrowserPage />) },
  { nameKey: '提交历史', path: '/repos/:owner/:repo/commits', element: page(<CommitsPage />) },
  { nameKey: '提交详情', path: '/repos/:owner/:repo/commits/:sha', element: page(<CommitDetailPage />) },
  { nameKey: '分支管理', path: '/repos/:owner/:repo/branches', element: page(<BranchesPage />) },
  { nameKey: '协作者', path: '/repos/:owner/:repo/collaborators', element: page(<RepoOwnerGate><CollaboratorsPage /></RepoOwnerGate>) },
  // 新增仓库子功能
  { nameKey: 'Actions', path: '/repos/:owner/:repo/actions', element: page(<ActionsPage />) },
  { nameKey: 'Actions 运行详情', path: '/repos/:owner/:repo/actions/runs/:runId', element: page(<ActionsPage />) },
  { nameKey: 'Actions 密钥与变量', path: '/repos/:owner/:repo/actions/secrets', element: page(<RepoOwnerGate><ActionsSecretsPage /></RepoOwnerGate>) },
  { nameKey: 'Packages', path: '/repos/:owner/:repo/packages', element: page(<PackagesPage />) },
  { nameKey: 'Projects', path: '/repos/:owner/:repo/projects', element: page(<ProjectsPage />) },
  { nameKey: 'Discussions', path: '/repos/:owner/:repo/discussions', element: page(<DiscussionsPage />) },
  { nameKey: 'Wiki', path: '/repos/:owner/:repo/wiki', element: page(<WikiPage />) },
  // 全局功能
  { nameKey: '通知', path: '/notifications', element: page(<NotificationsPage />) },
  { nameKey: '搜索', path: '/search', element: page(<SearchPage />) },
  { nameKey: '活动', path: '/activity', element: page(<ActivityPage />) },
  { nameKey: '活动详情', path: '/activity/:eventId', element: page(<ActivityDetailPage />) },
  { nameKey: 'Gists', path: '/gists', element: page(<GistsPage />) },
  { nameKey: 'Gist 详情', path: '/gists/:gistId', element: page(<GistDetailPage />) },
  { nameKey: '关注列表', path: '/follow-list/:type', element: page(<FollowListPage />) },
  { nameKey: '用户主页', path: '/users/:username', element: page(<UserProfilePage />) },
  { nameKey: '我的收藏', path: '/starred', element: page(<StarredPage />) },
  { nameKey: 'Packages', path: '/packages', element: page(<PackagesPage />) },
  { nameKey: '账号管理', path: '/accounts', element: page(<AccountsPage />) },
  { nameKey: '数据导出', path: '/export', element: page(<ExportPage />) },
  { nameKey: '批量上传', path: '/repos/:owner/:repo/upload', element: page(<RepoOwnerGate><UploadPage /></RepoOwnerGate>) },
  { nameKey: 'Pages 部署', path: '/repos/:owner/:repo/pages', element: page(<RepoOwnerGate><PagesDeployPage /></RepoOwnerGate>) },
  { nameKey: '仓库产物', path: '/repos/:owner/:repo/artifacts', element: page(<ArtifactsPage />) },
  { nameKey: '仓库 Forks', path: '/repos/:owner/:repo/forks', element: page(<RepoForksPage />) },
  { nameKey: '仓库收藏者', path: '/repos/:owner/:repo/stargazers', element: page(<StargazersPage />) },
  { nameKey: '设置', path: '/settings', element: page(<SettingsPage />) },
  { nameKey: 'GraphQL Playground', path: '/graphql-playground', element: page(<GraphQLPlaygroundPage />) },
  { nameKey: 'AI 助手', path: ASSISTANT_PATH, element: null },
  { nameKey: 'AI 助手', path: '/ai-assistant-v1', element: <Navigate to="/ai-assistant" replace />, visible: false },
  { nameKey: 'AI 设置', path: '/ai-settings', element: page(<AiSettingsPage />) },
  { nameKey: 'AI 设置', path: '/ai-settings/:section', element: page(<AiSettingsPage />) },
  { nameKey: '全部功能', path: '/more', element: page(<MorePage />) },
];