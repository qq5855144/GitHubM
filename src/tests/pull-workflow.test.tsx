import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PullActions } from '@/components/repo/PullActions';
import { pageCache } from '@/lib/page-cache';
import { gqlSetPullRequestDraft } from '@/services/github-graphql';
import NewPullPage from '@/pages/NewPullPage';
import PrDiffPage from '@/pages/PrDiffPage';
import PullsPage from '@/pages/PullsPage';
import {
  compareBranches, createPullRequest, getAllBranches, getPullRequest, getPullRequestFiles,
  getPullRequests, getPullRequestReviewComments, getRepo, mergePullRequest, submitPullRequestReview,
} from '@/services/github';
import i18n from '@/i18n';
import type { GitHubPullRequest, GitHubRepo, GitHubUser } from '@/types/types';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { login: 'reviewer' } }),
}));
vi.mock('@/services/github-graphql', () => ({ gqlSetPullRequestDraft: vi.fn() }));
vi.mock('@/services/github', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/github')>(),
  compareBranches: vi.fn(),
  createPullRequest: vi.fn(),
  getAllBranches: vi.fn(),
  getPullRequest: vi.fn(),
  getPullRequestFiles: vi.fn(),
  getPullRequests: vi.fn(),
  getPullRequestReviewComments: vi.fn(),
  getRepo: vi.fn(),
  mergePullRequest: vi.fn(),
  submitPullRequestReview: vi.fn(),
}));

const repository = {
  full_name: 'owner/repo', name: 'repo', owner: { login: 'owner' },
  default_branch: 'main', allow_merge_commit: false, allow_squash_merge: true, allow_rebase_merge: false,
  permissions: { admin: false, push: true, pull: true },
} as GitHubRepo;

function makePull(number = 1, sha = 'abcdef1'): GitHubPullRequest {
  return {
    id: number, number, state: 'open', title: `Pull ${number}`,
    user: { login: 'author' } as GitHubUser, labels: [], assignees: [], draft: false,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    body: null, milestone: null, changed_files: 2, comments: 0, review_comments: 0,
    commits: 1, additions: 2, deletions: 0, closed_at: null, merged_at: null, merged: false,
    merged_by: null, html_url: `https://github.com/owner/repo/pull/${number}`,
    mergeable: true, mergeable_state: 'clean',
    head: { ref: 'feature/ui', label: 'owner:feature/ui', repo: repository, sha },
    base: { ref: 'main', label: 'owner:main', repo: repository, sha: '5555555' },
  };
}

const pullsPath = '/repos/owner/repo/pulls';
const branch = { name: 'feature/ui', commit: { sha: 'abcdef1', url: '' }, protected: false };

function BackToList() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Back</button>;
}

function renderPullRoute(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/repos/:owner/:repo/pulls" element={<PullsPage />} />
        <Route path="/repos/:owner/:repo/pulls/new" element={<NewPullPage />} />
        <Route path="/repos/:owner/:repo/pulls/:number" element={<BackToList />} />
        <Route path="/repos/:owner/:repo/pulls/:number/diff" element={<PrDiffPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN');
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.hasPointerCapture ??= vi.fn().mockReturnValue(false);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.mocked(getRepo).mockResolvedValue(repository);
  vi.mocked(getAllBranches).mockResolvedValue([branch]);
  vi.mocked(getPullRequests).mockResolvedValue({ data: [], hasNextPage: false });
});
afterEach(() => {
  pageCache.clear();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it('defaults the target branch, carries the selected source branch, and suggests a title', async () => {
  vi.mocked(compareBranches).mockResolvedValue({
    ahead_by: 1, behind_by: 0, status: 'ahead',
    commits: [{ sha: 'abcdef1', commit: { message: 'Improve picker\nMore detail' } }] as Awaited<ReturnType<typeof compareBranches>>['commits'],
    files: [{ filename: 'picker.ts', status: 'added', additions: 2, deletions: 0, changes: 2 }],
  });
  vi.mocked(createPullRequest).mockResolvedValue(makePull(2));
  renderPullRoute(`${pullsPath}/new?head=feature%2Fui`);
  await screen.findByDisplayValue('Improve picker');
  expect(screen.getByRole('button', { name: i18n.t('目标分支') })).toHaveTextContent('main');
  expect(compareBranches).toHaveBeenCalledWith('owner', 'repo', 'main', 'feature/ui', { fresh: true });
  fireEvent.change(screen.getByLabelText(i18n.t('标题')), { target: { value: 'My own title' } });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('创建 PR') }));
  await screen.findByRole('button', { name: 'Back' });
  expect(createPullRequest).toHaveBeenCalledWith('owner', 'repo', expect.objectContaining({ title: 'My own title', head: 'feature/ui', base: 'main' }));
});

it('links to an existing PR for the branch pair and prevents a duplicate submission', async () => {
  vi.mocked(compareBranches).mockResolvedValue({ ahead_by: 1, behind_by: 0, status: 'ahead', commits: [] });
  vi.mocked(getPullRequests).mockResolvedValue({ data: [makePull(42)], hasNextPage: false });
  renderPullRoute(`${pullsPath}/new?head=feature%2Fui`);
  expect(await screen.findByRole('link', { name: `${i18n.t('打开 PR')} #42` })).toHaveAttribute('href', `${pullsPath}/42`);
  expect(screen.getByRole('button', { name: i18n.t('创建 PR') })).toBeDisabled();
  expect(createPullRequest).not.toHaveBeenCalled();
});

it('creates a PR from a fork branch into the selected upstream repository', async () => {
  vi.mocked(getRepo).mockResolvedValue({
    ...repository, fork: true,
    parent: { name: 'upstream', full_name: 'maintainer/upstream', default_branch: 'stable', owner: { login: 'maintainer' } as GitHubUser },
  });
  vi.mocked(compareBranches).mockResolvedValue({ ahead_by: 2, behind_by: 0, status: 'ahead', commits: [] });
  vi.mocked(createPullRequest).mockResolvedValue(makePull(2));
  renderPullRoute(`${pullsPath}/new?head=feature%2Fui`);
  fireEvent.keyDown(await screen.findByRole('combobox', { name: i18n.t('目标仓库') }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: /maintainer\/upstream/ }));
  await waitFor(() => expect(compareBranches).toHaveBeenLastCalledWith('maintainer', 'upstream', 'stable', 'owner:feature/ui', { fresh: true }));
  await waitFor(() => expect(screen.getByRole('button', { name: i18n.t('创建 PR') })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: i18n.t('创建 PR') }));
  await waitFor(() => expect(createPullRequest).toHaveBeenCalledWith('maintainer', 'upstream', expect.objectContaining({
    head: 'owner:feature/ui', head_repo: 'repo', base: 'stable',
  })));
});

it('preserves the selected sort/filter and resumes at the next page on back navigation', async () => {
  vi.mocked(getPullRequests).mockImplementation(async (_owner, _repo, { page = 1 } = {}) => (
    { data: [makePull(page)], hasNextPage: page < 3 }
  ));
  renderPullRoute(`${pullsPath}?state=all&sort=updated`);
  await screen.findByRole('link', { name: 'Pull 1' });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('加载更多') }));
  fireEvent.click(await screen.findByRole('link', { name: 'Pull 2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByRole('link', { name: 'Pull 2' })).toBeVisible();
  expect(screen.getByRole('button', { name: i18n.t('全部') })).toHaveAttribute('aria-pressed', 'true');
  expect(getPullRequests).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('加载更多') }));
  await screen.findByRole('link', { name: 'Pull 3' });
  expect(getPullRequests).toHaveBeenLastCalledWith('owner', 'repo', { state: 'all', sort: 'updated', page: 3 });
});

it('checks the latest revision and keeps the merge dialog open when the head changed', async () => {
  vi.mocked(getPullRequest).mockResolvedValue(makePull(1, 'abcdef2'));
  render(<PullActions owner="owner" repo="repo" pr={makePull()} repository={repository} login="reviewer" onUpdate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('合并 PR') }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('combobox')).toHaveTextContent(i18n.t('压缩提交并合并'));
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('确认合并') }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(i18n.t('分支已有更新，请重新检查变更后再合并'));
  expect(getPullRequest).toHaveBeenCalledWith('owner', 'repo', 1, { fresh: true });
  expect(mergePullRequest).not.toHaveBeenCalled();
});

it('uses the enabled merge method and binds the merge to the confirmed head', async () => {
  vi.mocked(getPullRequest).mockResolvedValue(makePull());
  vi.mocked(mergePullRequest).mockResolvedValue({ sha: 'commit', merged: true, message: 'Merged' });
  const onUpdate = vi.fn();
  render(<PullActions owner="owner" repo="repo" pr={makePull()} repository={repository} login="reviewer" onUpdate={onUpdate} />);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('合并 PR') }));
  fireEvent.click(await screen.findByRole('button', { name: i18n.t('确认合并') }));
  await waitFor(() => expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'closed', merged: true })));
  expect(mergePullRequest).toHaveBeenCalledWith('owner', 'repo', 1, { merge_method: 'squash', sha: 'abcdef1' });
});

it('lets the author mark a draft ready for review with a single confirmation', async () => {
  const pr = { ...makePull(), draft: true, node_id: 'PR_node' };
  const onUpdate = vi.fn();
  vi.mocked(gqlSetPullRequestDraft).mockResolvedValue(false);
  render(<PullActions owner="owner" repo="repo" pr={pr} repository={null} login="author" onUpdate={onUpdate} />);
  expect(screen.queryByRole('button', { name: i18n.t('合并 PR') })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('标记为可评审') }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('标记为可评审') }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ draft: false })));
  expect(gqlSetPullRequestDraft).toHaveBeenCalledWith('PR_node', false);
});

it('loads an additional diff page and submits a review against the displayed revision', async () => {
  vi.mocked(getPullRequest).mockResolvedValue(makePull());
  vi.mocked(getPullRequestReviewComments).mockResolvedValue([]);
  vi.mocked(getPullRequestFiles).mockImplementation(async (_owner, _repo, _number, page = 1) => ({
    data: [{ filename: `file-${page}.ts`, status: 'added', additions: 2, deletions: 0, changes: 2 }],
    hasNextPage: page === 1,
  }));
  renderPullRoute(`${pullsPath}/1/diff`);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(i18n.t('加载更多文件')) }));
  expect(await screen.findByText('file-2.ts')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: i18n.t('提交评审') }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(i18n.t('评审说明')), { target: { value: 'Reviewed the changes' } });
  fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('提交评审') }));
  expect(await screen.findByRole('link', { name: i18n.t('查看评审记录') })).toHaveAttribute('href', `${pullsPath}/1?tab=reviews`);
  expect(submitPullRequestReview).toHaveBeenCalledWith('owner', 'repo', 1, { event: 'COMMENT', body: 'Reviewed the changes', commit_id: 'abcdef1' });
});
