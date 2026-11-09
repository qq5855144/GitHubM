import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAllBranches } from '@/services/github';

function branch(name: string) {
  return {
    name,
    commit: { sha: `sha-${name}`, url: `https://api.github.com/commits/${name}` },
    protected: false,
  };
}

describe('getAllBranches', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads every branch page instead of only the first 30', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => branch(`feat-${index}`));
    const secondPage = [branch('main'), branch('release'), branch('zeta')];
    const requestedPages: string[] = [];

    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = new URL(String(input));
      const page = url.searchParams.get('page') || '1';
      requestedPages.push(page);
      const data = page === '1' ? firstPage : secondPage;
      const link = page === '1'
        ? `<https://api.github.com/repositories/1/branches?per_page=100&page=2>; rel="next"`
        : '';
      return {
        ok: true,
        status: 200,
        headers: new Headers(link ? { Link: link } : {}),
        json: async () => data,
      } as Response;
    }));

    const result = await getAllBranches('branch-pagination-owner', 'branch-pagination-repo');

    expect(requestedPages).toEqual(['1', '2']);
    expect(result).toHaveLength(103);
    expect(result.some((item) => item.name === 'main')).toBe(true);
    expect(result.some((item) => item.name === 'zeta')).toBe(true);
  });
});