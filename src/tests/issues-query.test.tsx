import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import IssuesPage from '@/pages/IssuesPage';
import { searchIssues } from '@/services/github';
import type { GitHubIssue, GitHubSearchResult, GitHubUser } from '@/types/types';

vi.mock('@/services/github', () => ({
  searchIssues: vi.fn(),
  formatRelativeTime: () => '',
  getRepoLabels: async () => [],
  getRepoMilestones: async () => [],
}));

function issueResult(title: string): GitHubSearchResult<GitHubIssue> {
  return {
    total_count: 1, incomplete_results: false,
    items: [{
      id: 1, number: 1, title, state: 'open', body: null,
      user: { login: 'alice', avatar_url: '' } as GitHubUser,
      labels: [], assignees: [], comments: 0, milestone: null,
      created_at: '2025-01-01', updated_at: '2025-01-01', closed_at: null, html_url: '',
    }],
  };
}

it('keeps the selected issues filter when a stale response arrives afterward', async () => {
  let resolveOpen!: (value: GitHubSearchResult<GitHubIssue>) => void;
  vi.mocked(searchIssues).mockImplementation(query => query.includes('state:open')
    ? new Promise(resolve => { resolveOpen = resolve; })
    : Promise.resolve(issueResult('Closed response')));
  render(
    <MemoryRouter initialEntries={['/repos/a/b/issues']}>
      <Routes><Route path="/repos/:owner/:repo/issues" element={<IssuesPage />} /></Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText('已关闭'));
  expect(await screen.findByText('Closed response')).toBeVisible();
  await act(async () => { resolveOpen(issueResult('Stale open response')); });
  expect(screen.queryByText('Stale open response')).toBeNull();
  expect(screen.getByText('Closed response')).toBeVisible();
});
