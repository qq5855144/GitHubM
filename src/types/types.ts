// GitHub API 相关类型定义

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  twitter_username: string | null;
  public_repos: number;
  public_gists: number;
  followers: number;
  following: number;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: GitHubUser;
  description: string | null;
  private: boolean;
  fork: boolean;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  language: string | null;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  open_issues_count: number;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  size: number;
  topics: string[];
  archived: boolean;
  disabled: boolean;
  visibility: string;
  license: {
    key: string;
    name: string;
    spdx_id: string;
  } | null;
  permissions?: {
    admin: boolean;
    push: boolean;
    pull: boolean;
  };
}

export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  user: GitHubUser;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  milestone: GitHubMilestone | null;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  html_url: string;
  pull_request?: {
    url: string;
    html_url: string;
    merged_at: string | null;
  };
}

export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

export interface GitHubMilestone {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  open_issues: number;
  closed_issues: number;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: GitHubUser;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  user: GitHubUser;
  labels: GitHubLabel[];
  assignees: GitHubUser[];
  milestone: GitHubMilestone | null;
  comments: number;
  review_comments: number;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
  merged: boolean;
  merged_by: GitHubUser | null;
  html_url: string;
  head: {
    label: string;
    ref: string;
    sha: string;
    repo: GitHubRepo | null;
  };
  base: {
    label: string;
    ref: string;
    sha: string;
    repo: GitHubRepo;
  };
  mergeable: boolean | null;
  draft: boolean;
}

export interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
    comment_count: number;
  };
  author: GitHubUser | null;
  committer: GitHubUser | null;
  html_url: string;
  stats?: {
    total: number;
    additions: number;
    deletions: number;
  };
  files?: GitHubFile[];
}

export interface GitHubFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

export interface GitHubBranchDetail {
  name: string;
  commit: {
    sha: string;
    commit: {
      message: string;
      author: {
        name: string;
        date: string;
      };
    };
  };
  protected: boolean;
  ahead_by?: number;
  behind_by?: number;
}

export interface GitHubCollaborator {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
  type: string;
  permissions: {
    pull: boolean;
    triage: boolean;
    push: boolean;
    maintain: boolean;
    admin: boolean;
  };
  role_name: string;
}

export interface GitHubNotification {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  last_read_at: string | null;
  subject: {
    title: string;
    url: string;
    latest_comment_url: string | null;
    type: string;
  };
  repository: GitHubRepo;
}

export interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  content?: string;
  encoding?: string;
}

export interface GitHubSearchResult<T> {
  total_count: number;
  incomplete_results: boolean;
  items: T[];
}

export interface GitHubRateLimit {
  limit: number;
  remaining: number;
  reset: number;
  used: number;
}

export interface GitHubEvent {
  id: string;
  type: string;
  actor: {
    login: string;
    avatar_url: string;
  };
  repo: {
    name: string;
    url: string;
  };
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ApiError {
  message: string;
  status: number;
  documentation_url?: string;
}

export interface AuthState {
  token: string | null;
  user: GitHubUser | null;
  isAuthenticated: boolean;
  rateLimit: GitHubRateLimit | null;
}

export type RepoSortField = 'created' | 'updated' | 'pushed' | 'full_name';
export type IssueSortField = 'created' | 'updated' | 'comments';
export type IssueState = 'open' | 'closed' | 'all';
export type PrState = 'open' | 'closed' | 'all';
export type SortDirection = 'asc' | 'desc';

// ===== GitHub Actions =====
export interface GitHubWorkflow {
  id: number;
  node_id: string;
  name: string;
  path: string;
  state: 'active' | 'deleted' | 'disabled_fork' | 'disabled_inactivity' | 'disabled_manually';
  created_at: string;
  updated_at: string;
  html_url: string;
  badge_url: string;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  node_id: string;
  head_branch: string;
  head_sha: string;
  run_number: number;
  event: string;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | null;
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  workflow_id: number;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at: string;
  triggering_actor: GitHubUser;
  head_commit: {
    id: string;
    message: string;
    timestamp: string;
    author: { name: string; email: string };
  };
}

export interface GitHubWorkflowJob {
  id: number;
  run_id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  started_at: string;
  completed_at: string | null;
  steps: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
    started_at: string | null;
    completed_at: string | null;
  }>;
  html_url: string;
}

// ===== GitHub Packages =====
export interface GitHubPackage {
  id: number;
  name: string;
  package_type: string;
  owner: GitHubUser;
  version_count: number;
  visibility: 'public' | 'private';
  created_at: string;
  updated_at: string;
  html_url: string;
  repository?: GitHubRepo;
}

export interface GitHubPackageVersion {
  id: number;
  name: string;
  package_html_url: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  metadata?: {
    package_type: string;
    container?: { tags: string[] };
  };
}

// ===== GitHub Projects (Classic) =====
export interface GitHubProject {
  id: number;
  node_id: string;
  number: number;
  name: string;
  body: string | null;
  state: 'open' | 'closed';
  creator: GitHubUser;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface GitHubProjectColumn {
  id: number;
  node_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  cards_url: string;
}

export interface GitHubProjectCard {
  id: number;
  node_id: string;
  note: string | null;
  creator: GitHubUser;
  created_at: string;
  updated_at: string;
  archived: boolean;
  column_id: number;
  content_url?: string;
}

// ===== GitHub Gists =====
export interface GitHubGistFile {
  filename: string;
  type: string;
  language: string | null;
  raw_url: string;
  size: number;
  truncated?: boolean;
  content?: string;
}

export interface GitHubGist {
  id: string;
  node_id: string;
  description: string | null;
  public: boolean;
  owner: GitHubUser;
  user: GitHubUser | null;
  files: Record<string, GitHubGistFile>;
  forks_url: string;
  commits_url: string;
  html_url: string;
  git_pull_url: string;
  git_push_url: string;
  created_at: string;
  updated_at: string;
  comments: number;
  truncated: boolean;
}

export interface GitHubGistDetail extends GitHubGist {
  forks: GitHubGist[];
  history: Array<{
    version: string;
    user: GitHubUser;
    change_status: { total: number; additions: number; deletions: number };
    committed_at: string;
  }>;
}

// ===== GitHub Discussions (REST，有限支持) =====
export interface GitHubDiscussion {
  id: number;
  node_id: string;
  title: string;
  body: string;
  html_url: string;
  author: GitHubUser;
  created_at: string;
  updated_at: string;
  comments: number;
  answer_html_url: string | null;
  category: {
    id: number;
    name: string;
    emoji: string;
    is_answerable: boolean;
  };
  locked: boolean;
}

// ===== GraphQL Discussions（完整支持）=====
export interface GQL_DiscussionAuthor {
  login: string;
  avatarUrl: string;
}

export interface GQL_DiscussionCategory {
  id: string;
  name: string;
  emoji: string;
  description?: string;
  isAnswerable: boolean;
}

export interface GQL_DiscussionCommentReply {
  id: string;
  databaseId?: number;
  body: string;
  createdAt: string;
  author: GQL_DiscussionAuthor | null;
}

export interface GQL_DiscussionComment {
  id: string;
  databaseId?: number;
  body: string;
  createdAt: string;
  upvoteCount: number;
  isAnswer: boolean;
  author: GQL_DiscussionAuthor | null;
  replies?: { nodes: GQL_DiscussionCommentReply[] };
}

export interface GQL_Discussion {
  id: string;
  databaseId?: number;
  number: number;
  title: string;
  body?: string;
  url: string;
  createdAt: string;
  updatedAt?: string;
  locked: boolean;
  isAnswered: boolean;
  upvoteCount: number;
  comments: { totalCount: number } | number;
  author: GQL_DiscussionAuthor | null;
  category: GQL_DiscussionCategory;
  answerChosenAt?: string | null;
  answerChosenBy?: GQL_DiscussionAuthor | null;
}

// ===== GraphQL 贡献热力图 =====
export type ContributionLevel =
  | 'NONE'
  | 'FIRST_QUARTILE'
  | 'SECOND_QUARTILE'
  | 'THIRD_QUARTILE'
  | 'FOURTH_QUARTILE';

export interface ContributionDay {
  date: string;
  contributionCount: number;
  contributionLevel: ContributionLevel;
  weekday: number;
}

export interface ContributionWeek {
  firstDay: string;
  contributionDays: ContributionDay[];
}

export interface ContributionMonth {
  name: string;
  firstDay: string;
  totalWeeks: number;
}

export interface ContributionCalendar {
  totalContributions: number;
  months: ContributionMonth[];
  weeks: ContributionWeek[];
}

// ===== GraphQL Pinned 仓库 =====
export interface GQL_PinnedRepo {
  id: string;
  databaseId?: number;
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  stargazerCount: number;
  forkCount: number;
  isPrivate: boolean;
  primaryLanguage: { name: string; color: string } | null;
}

// ===== GraphQL PR Reviews =====
export type GQL_ReviewState =
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'COMMENTED'
  | 'DISMISSED'
  | 'PENDING';

export type GQL_ReviewDecision =
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'REVIEW_REQUIRED';

export interface GQL_PRReview {
  id: string;
  databaseId?: number;
  state: GQL_ReviewState;
  body: string;
  submittedAt: string;
  author: { login: string; avatarUrl: string } | null;
}

// ===== GraphQL 仓库语言分布 =====
export interface GQL_LanguageEdge {
  size: number;
  node: {
    name: string;
    color: string | null;
  };
}

// ===== Multi-account =====
export interface SavedAccount {
  token: string;
  user: GitHubUser;
  addedAt: string;
}

// ===== Deployments =====
export interface GitHubDeployment {
  id: number;
  sha: string;
  ref: string;
  task: string;
  environment: string;
  description: string | null;
  creator: GitHubUser;
  created_at: string;
  updated_at: string;
  statuses_url: string;
  repository_url: string;
}

export interface GitHubDeploymentStatus {
  id: number;
  state: 'error' | 'failure' | 'inactive' | 'in_progress' | 'queued' | 'pending' | 'success';
  creator: GitHubUser;
  description: string | null;
  environment: string;
  environment_url: string | null;
  log_url: string | null;
  created_at: string;
  updated_at: string;
}
