import type { ReactNode } from 'react';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ReposPage from './pages/ReposPage';
import RepoDetailPage from './pages/RepoDetailPage';
import IssuesPage from './pages/IssuesPage';
import IssueDetailPage from './pages/IssueDetailPage';
import PullsPage from './pages/PullsPage';
import PullDetailPage from './pages/PullDetailPage';
import CodeBrowserPage from './pages/CodeBrowserPage';
import CommitsPage from './pages/CommitsPage';
import BranchesPage from './pages/BranchesPage';
import CollaboratorsPage from './pages/CollaboratorsPage';
import NotificationsPage from './pages/NotificationsPage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import ActivityPage from './pages/ActivityPage';
import ActionsPage from './pages/ActionsPage';
import GistsPage from './pages/GistsPage';
import GistDetailPage from './pages/GistDetailPage';
import PackagesPage from './pages/PackagesPage';
import ProjectsPage from './pages/ProjectsPage';
import DiscussionsPage from './pages/DiscussionsPage';
import WikiPage from './pages/WikiPage';
import AccountsPage from './pages/AccountsPage';
import ExportPage from './pages/ExportPage';
import UploadPage from './pages/UploadPage';
import PagesDeployPage from './pages/PagesDeployPage';
import ArtifactsPage from './pages/ArtifactsPage';
import GraphQLPlaygroundPage from './pages/GraphQLPlaygroundPage';
import FollowListPage from './pages/FollowListPage';
import StarredPage from './pages/StarredPage';
import RepoForksPage from './pages/RepoForksPage';
import StargazersPage from './pages/StargazersPage';
import PrDiffPage from './pages/PrDiffPage';
import AiAssistantPage from './pages/AiAssistantPage';

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  /** Accessible without login. Routes without this flag require authentication. Has no effect when RouteGuard is not in use. */
  public?: boolean;
}

export const routes: RouteConfig[] = [
  // 公开路由
  { name: '登录', path: '/login', element: <LoginPage />, public: true },
  // 受保护路由
  { name: '首页', path: '/', element: <DashboardPage /> },
  { name: '仓库列表', path: '/repos', element: <ReposPage /> },
  { name: '仓库详情', path: '/repos/:owner/:repo', element: <RepoDetailPage /> },
  { name: 'Issues', path: '/repos/:owner/:repo/issues', element: <IssuesPage /> },
  { name: 'Issue 详情', path: '/repos/:owner/:repo/issues/:number', element: <IssueDetailPage /> },
  { name: 'Pull Requests', path: '/repos/:owner/:repo/pulls', element: <PullsPage /> },
  { name: 'PR 详情', path: '/repos/:owner/:repo/pulls/:number', element: <PullDetailPage /> },
  { name: 'PR Diff', path: '/repos/:owner/:repo/pulls/:number/diff', element: <PrDiffPage /> },
  { name: '代码浏览', path: '/repos/:owner/:repo/code/*', element: <CodeBrowserPage /> },
  { name: '代码浏览根', path: '/repos/:owner/:repo/code', element: <CodeBrowserPage /> },
  { name: '提交历史', path: '/repos/:owner/:repo/commits', element: <CommitsPage /> },
  { name: '分支管理', path: '/repos/:owner/:repo/branches', element: <BranchesPage /> },
  { name: '协作者', path: '/repos/:owner/:repo/collaborators', element: <CollaboratorsPage /> },
  // 新增仓库子功能
  { name: 'Actions', path: '/repos/:owner/:repo/actions', element: <ActionsPage /> },
  { name: 'Packages', path: '/repos/:owner/:repo/packages', element: <PackagesPage /> },
  { name: 'Projects', path: '/repos/:owner/:repo/projects', element: <ProjectsPage /> },
  { name: 'Discussions', path: '/repos/:owner/:repo/discussions', element: <DiscussionsPage /> },
  { name: 'Wiki', path: '/repos/:owner/:repo/wiki', element: <WikiPage /> },
  // 全局功能
  { name: '通知', path: '/notifications', element: <NotificationsPage /> },
  { name: '搜索', path: '/search', element: <SearchPage /> },
  { name: '活动', path: '/activity', element: <ActivityPage /> },
  { name: 'Gists', path: '/gists', element: <GistsPage /> },
  { name: 'Gist 详情', path: '/gists/:gistId', element: <GistDetailPage /> },
  { name: '关注列表', path: '/follow-list/:type', element: <FollowListPage /> },
  { name: '我的收藏', path: '/starred', element: <StarredPage /> },
  { name: 'Packages', path: '/packages', element: <PackagesPage /> },
  { name: '账号管理', path: '/accounts', element: <AccountsPage /> },
  { name: '数据导出', path: '/export', element: <ExportPage /> },
  { name: '批量上传', path: '/repos/:owner/:repo/upload', element: <UploadPage /> },
  { name: 'Pages 部署', path: '/repos/:owner/:repo/pages', element: <PagesDeployPage /> },
  { name: '仓库产物', path: '/repos/:owner/:repo/artifacts', element: <ArtifactsPage /> },
  { name: '仓库 Forks', path: '/repos/:owner/:repo/forks', element: <RepoForksPage /> },
  { name: '仓库收藏者', path: '/repos/:owner/:repo/stargazers', element: <StargazersPage /> },
  { name: '设置', path: '/settings', element: <SettingsPage /> },
  { name: 'GraphQL Playground', path: '/graphql-playground', element: <GraphQLPlaygroundPage /> },
  { name: 'AI 助手', path: '/ai-assistant', element: <AiAssistantPage /> },
];
