/** 只有仓库所有者本人才能看到仓库管理/文件写入入口。 */
export function isRepoOwner(
  repoOwner: string | null | undefined,
  currentLogin: string | null | undefined,
): boolean {
  if (!repoOwner || !currentLogin) return false;
  return repoOwner.trim().toLowerCase() === currentLogin.trim().toLowerCase();
}
