import { Suspense, lazy } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import i18n from '@/i18n';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ReposPage = lazy(() => import('./pages/ReposPage'));
const RepoDetailPage = lazy(() => import('./pages/RepoDetailPage'));
const IssuesPage = lazy(() => import('./pages/IssuesPage'));
const IssueDetailPage = lazy(() => import('./pages/IssueDetailPage'));
const PullsPage = lazy(() => import('./pages/PullsPage'));
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
  name: string;
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

export const routes: RouteConfig[] = [
  // 公开路由
  { name: i18n.t('登录'), path: '/login', element: page(<LoginPage />), public: true },
  // 受保护路由
  { name: i18n.t('首页'), path: '/', element: page(<DashboardPage />) },
  { name: i18n.t('仓库列表'), path: '/repos', element: page(<ReposPage />) },
  { name: i18n.t('仓库详情'), path: '/repos/:owner/:repo', element: page(<RepoDetailPage />) },
  { name: 'Issues', path: '/repos/:owner/:repo/issues', element: page(<IssuesPage />) },
  { name: i18n.t('Issue 详情'), path: '/repos/:owner/:repo/issues/:number', element: page(<IssueDetailPage />) },
  { name: 'Pull Requests', path: '/repos/:owner/:repo/pulls', element: page(<PullsPage />) },
  { name: i18n.t('PR 详情'), path: '/repos/:owner/:repo/pulls/:number', element: page(<PullDetailPage />) },
  { name: 'PR Diff', path: '/repos/:owner/:repo/pulls/:number/diff', element: page(<PrDiffPage />) },
  { name: i18n.t('代码浏览'), path: '/repos/:owner/:repo/code/*', element: page(<CodeBrowserPage />) },
  { name: i18n.t('代码浏览根'), path: '/repos/:owner/:repo/code', element: page(<CodeBrowserPage />) },
  { name: i18n.t('提交历史'), path: '/repos/:owner/:repo/commits', element: page(<CommitsPage />) },
  { name: i18n.t('提交详情'), path: '/repos/:owner/:repo/commits/:sha', element: page(<CommitDetailPage />) },
  { name: i18n.t('分支管理'), path: '/repos/:owner/:repo/branches', element: page(<BranchesPage />) },
  { name: i18n.t('协作者'), path: '/repos/:owner/:repo/collaborators', element: page(<CollaboratorsPage />) },
  // 新增仓库子功能
  { name: 'Actions', path: '/repos/:owner/:repo/actions', element: page(<ActionsPage />) },
  { name: 'Actions 运行详情', path: '/repos/:owner/:repo/actions/runs/:runId', element: page(<ActionsPage />) },
  { name: i18n.t('Actions 密钥与变量'), path: '/repos/:owner/:repo/actions/secrets', element: page(<ActionsSecretsPage />) },
  { name: 'Packages', path: '/repos/:owner/:repo/packages', element: page(<PackagesPage />) },
  { name: 'Projects', path: '/repos/:owner/:repo/projects', element: page(<ProjectsPage />) },
  { name: 'Discussions', path: '/repos/:owner/:repo/discussions', element: page(<DiscussionsPage />) },
  { name: 'Wiki', path: '/repos/:owner/:repo/wiki', element: page(<WikiPage />) },
  // 全局功能
  { name: i18n.t('通知'), path: '/notifications', element: page(<NotificationsPage />) },
  { name: i18n.t('搜索'), path: '/search', element: page(<SearchPage />) },
  { name: i18n.t('活动'), path: '/activity', element: page(<ActivityPage />) },
  { name: i18n.t('活动详情'), path: '/activity/:eventId', element: page(<ActivityDetailPage />) },
  { name: 'Gists', path: '/gists', element: page(<GistsPage />) },
  { name: i18n.t('Gist 详情'), path: '/gists/:gistId', element: page(<GistDetailPage />) },
  { name: i18n.t('关注列表'), path: '/follow-list/:type', element: page(<FollowListPage />) },
  { name: i18n.t('用户主页'), path: '/users/:username', element: page(<UserProfilePage />) },
  { name: i18n.t('我的收藏'), path: '/starred', element: page(<StarredPage />) },
  { name: 'Packages', path: '/packages', element: page(<PackagesPage />) },
  { name: i18n.t('账号管理'), path: '/accounts', element: page(<AccountsPage />) },
  { name: i18n.t('数据导出'), path: '/export', element: page(<ExportPage />) },
  { name: i18n.t('批量上传'), path: '/repos/:owner/:repo/upload', element: page(<UploadPage />) },
  { name: i18n.t('Pages 部署'), path: '/repos/:owner/:repo/pages', element: page(<PagesDeployPage />) },
  { name: i18n.t('仓库产物'), path: '/repos/:owner/:repo/artifacts', element: page(<ArtifactsPage />) },
  { name: i18n.t('仓库 Forks'), path: '/repos/:owner/:repo/forks', element: page(<RepoForksPage />) },
  { name: i18n.t('仓库收藏者'), path: '/repos/:owner/:repo/stargazers', element: page(<StargazersPage />) },
  { name: i18n.t('设置'), path: '/settings', element: page(<SettingsPage />) },
  { name: 'GraphQL Playground', path: '/graphql-playground', element: page(<GraphQLPlaygroundPage />) },
  { name: i18n.t('AI 助手'), path: '/ai-assistant', element: page(<AiAssistantV2Page />) },
  { name: i18n.t('AI 助手'), path: '/ai-assistant-v1', element: <Navigate to="/ai-assistant" replace />, visible: false },
  { name: i18n.t('AI 设置'), path: '/ai-settings', element: page(<AiSettingsPage />) },
  { name: i18n.t('AI 设置'), path: '/ai-settings/:section', element: page(<AiSettingsPage />) },
  { name: '全部功能', path: '/more', element: page(<MorePage />) },
];