import type { ReactNode } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { isRepoOwner } from '@/lib/repoPermissions';

/** 仅仓库 owner 可进入的管理页；非 owner 直接回到仓库主页。 */
export default function RepoOwnerGate({ children }: { children: ReactNode }) {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const { user } = useAuth();
  if (!owner || !repo) return <Navigate to="/repos" replace />;
  if (!isRepoOwner(owner, user?.login)) return <Navigate to={`/repos/${owner}/${repo}`} replace />;
  return <>{children}</>;
}
