// Issue 附件上传：把图片 / 文件写进仓库，返回可直接插入正文的 Markdown。
// GitHub 没有对 PAT 开放的 issue 附件接口（网页上传走的是 session 专用的 assets 端点），
// 所以这里用仓库 contents API 落盘，再引用 raw 地址。
import { createFileContent, getRepo } from '@/services/github';
import i18n from '@/i18n';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ASSET_DIR = 'githubm-assets/issues';

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = () => reject(new Error(i18n.t('读取文件失败')));
    reader.readAsDataURL(file);
  });
}

function sanitizeName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const base = dot > 0 ? name.slice(0, dot) : name;
  const safeBase = base.replace(/[^\w.-]+/g, '-').slice(0, 40) || 'file';
  const safeExt = ext.replace(/[^\w.]+/g, '').slice(0, 10);
  return `${safeBase}${safeExt}`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export interface UploadAttachmentParams {
  owner: string;
  repo: string;
  file: File;
  /** 默认用仓库默认分支 */
  branch?: string;
}

/** 上传单个附件，返回 Markdown 片段（图片为 ![]()，其余为 []()） */
export async function uploadIssueAttachment({ owner, repo, file, branch }: UploadAttachmentParams): Promise<string> {
  if (!owner || !repo) throw new Error(i18n.t('缺少仓库信息'));
  if (file.size > MAX_FILE_SIZE) throw new Error(i18n.t('文件超过 5MB，请压缩后再上传'));

  let targetBranch = branch;
  if (!targetBranch) {
    const repoData = await getRepo(owner, repo);
    targetBranch = repoData?.default_branch || 'main';
  }

  const suffix = Math.random().toString(36).slice(2, 7);
  const path = `${ASSET_DIR}/${timestamp()}-${suffix}-${sanitizeName(file.name)}`;
  const content = await fileToBase64(file);

  await createFileContent(owner, repo, path, {
    message: `chore(assets): 上传 Issue 附件 ${file.name}`,
    content,
    branch: targetBranch,
  });

  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(targetBranch)}/${encodePath(path)}`;
  return file.type.startsWith('image/') ? `![${file.name}](${rawUrl})` : `[${file.name}](${rawUrl})`;
}

/** 供 UI 展示的提示文案 */
export const ATTACHMENT_HINT = `附件会上传到仓库 ${ASSET_DIR}/ 并插入 Markdown`;
