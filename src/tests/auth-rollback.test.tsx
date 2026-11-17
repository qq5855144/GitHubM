import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import * as github from '@/services/github';

vi.mock('@/services/github', async () => {
  const actual = await vi.importActual<typeof import('@/services/github')>('@/services/github');
  return {
    ...actual,
    getCurrentUser: vi.fn(),
    getRateLimit: vi.fn(),
    setToken: vi.fn(),
  };
});

function Probe() {
  const { login } = useAuth();
  return (
    <button onClick={() => { void login('bad-token').catch(() => undefined); }}>
      login
    </button>
  );
}

describe('AuthContext token rollback', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(github.getCurrentUser).mockReset();
    vi.mocked(github.getRateLimit).mockReset();
    vi.mocked(github.setToken).mockReset();
  });

  it('rolls the module token back when validating a new token fails', async () => {
    vi.mocked(github.getCurrentUser).mockRejectedValue(new Error('401'));
    render(<AuthProvider><Probe /></AuthProvider>);
    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(vi.mocked(github.setToken)).toHaveBeenLastCalledWith(null));
    expect(vi.mocked(github.setToken).mock.calls.map(call => call[0])).toEqual(['bad-token', null]);
  });
});
