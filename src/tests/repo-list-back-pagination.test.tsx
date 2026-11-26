import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import RouteScrollManager from '@/components/system/RouteScrollManager';
import i18n from '@/i18n';
import { pageCache } from '@/lib/page-cache';
import ReposPage from '@/pages/ReposPage';
import StarredPage from '@/pages/StarredPage';
import { getAllStarredRepos, getUserRepos } from '@/services/github';
import type { GitHubRepo } from '@/types/types';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, login: 'octocat' } }),
}));

vi.mock('@/services/github', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/github')>(),
  getAllStarredRepos: vi.fn(),
  getUserRepos: vi.fn(),
}));

function repo(id: number): GitHubRepo {
  const name = `repo-${String(id).padStart(2, '0')}`;
  return {
    id,
    name,
    full_name: `octocat/${name}`,
    owner: { login: 'octocat' },
    stargazers_count: 0,
    forks_count: 0,
    open_issues_count: 0,
    default_branch: 'main',
    pushed_at: '2026-01-01T00:00:00Z',
  } as GitHubRepo;
}

function RepoDetail() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>Back to list</button>;
}

function renderRoutes(path: string) {
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(3000);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(
    <MemoryRouter>
      <RouteScrollManager />
      <Routes>
        <Route path="/" element={<Link to={path}>Open list</Link>} />
        <Route path="/repos" element={<ReposPage />} />
        <Route path="/starred" element={<StarredPage />} />
        <Route path="/repos/:owner/:repo" element={<RepoDetail />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('link', { name: 'Open list' }));
}

afterEach(() => {
  pageCache.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('restores the expanded repository list after back and continues from the next page', async () => {
  const getRepos = vi.mocked(getUserRepos).mockImplementation(async ({ page = 1 } = {}) => ({
    data: [repo(page)], hasNextPage: page < 3,
  }));
  renderRoutes('/repos');
  await screen.findByText('repo-01');
  fireEvent.click(screen.getByRole('button', { name: i18n.t('加载更多') }));
  fireEvent.click(await screen.findByText('repo-02'));
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000);
  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));

  expect(await screen.findByText('repo-02')).toBeVisible();
  expect(getRepos).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('加载更多') }));
  expect(await screen.findByText('repo-03')).toBeVisible();
  expect(getRepos).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3 }));
  expect(screen.queryByRole('button', { name: i18n.t('加载更多') })).toBeNull();
});

it('reloads previously opened pages automatically if the repository cache was evicted', async () => {
  const getRepos = vi.mocked(getUserRepos).mockReset().mockImplementation(async ({ page = 1 } = {}) => ({
    data: [repo(page)], hasNextPage: page < 3,
  }));
  renderRoutes('/repos');
  await screen.findByText('repo-01');
  fireEvent.click(screen.getByRole('button', { name: i18n.t('加载更多') }));
  fireEvent.click(await screen.findByText('repo-02'));
  pageCache.clear();
  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));
  expect(await screen.findByText('repo-02')).toBeVisible();
  expect(getRepos.mock.calls.map(([options]) => options?.page)).toEqual([1, 2, 1, 2]);
});

it('restores the expanded starred list, search and scroll position after back', async () => {
  const getStarred = vi.mocked(getAllStarredRepos)
    .mockResolvedValue(Array.from({ length: 70 }, (_, index) => repo(index + 1)));
  renderRoutes('/starred');
  await screen.findByText('repo-01');
  const search = screen.getByRole('textbox');
  fireEvent.change(search, { target: { value: 'repo-' } });
  fireEvent.click(screen.getByRole('button', { name: i18n.t('加载更多') }));

  vi.stubGlobal('scrollY', 850);
  fireEvent.scroll(window);
  await waitFor(() => expect(sessionStorage.getItem('githubm_scroll_position:/starred')).toBe('850'));
  fireEvent.click(await screen.findByText('repo-45'));
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10 * 60 * 1000);
  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));

  expect(await screen.findByText('repo-60')).toBeVisible();
  expect(screen.getByRole('textbox')).toHaveValue('repo-');
  expect(screen.queryByText('repo-61')).toBeNull();
  expect(window.scrollTo).toHaveBeenCalledWith({ top: 850, left: 0, behavior: 'auto' });
  expect(getStarred).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('加载更多') }));
  expect(screen.getByText('repo-70')).toBeVisible();
});
