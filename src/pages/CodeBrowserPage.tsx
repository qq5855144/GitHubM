// 代码浏览页（含在线编辑 + 文件树 + 右键上下文菜单 + 全屏编辑 + 文件图标 + 图片预览）

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import FileTree from '@/components/code/FileTree';
import {
  ChevronRight,
  ArrowLeft,
  Download,
  Copy,
  Pencil,
  X,
  Save,
  Plus,
  FilePlus,
  FolderPlus,
  Trash2,
  MoveRight,
  Loader2,
  Upload,
  XCircle,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  History,
  FolderOpen,
  ClipboardCopy,
  Link,
  FileEdit,
  Image as ImageIcon,
  Search,
  ChevronUp,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  PanelLeftOpen,
  PanelLeftClose,
  MoreHorizontal,
  GitBranch,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  getRepoContents,
  getBranches,
  updateFileContent,
  createFileContent,
  deleteFileContent,
  getFileInfo,
  deleteFolderContents,
} from '@/services/github';
import { useAuth } from '@/contexts/AuthContext';
import type { GitHubContent, GitHubBranch } from '@/types/types';
import { toast } from 'sonner';
import { decodeBase64Content } from '@/lib/utils';
import { getFileIconInfo, isImageFile } from '@/components/common/FileIcon';

/**
 * 带认证下载文件（raw.githubusercontent.com 私有仓库需 Bearer token）。
 *
 * Android：检测到 AndroidBridge 时直接将 URL + token 交给原生 DownloadManager，
 *   避免 WebView 将 raw URL 拦截为"在线查看"而非下载。
 * 浏览器：fetch + Authorization header → Blob → <a download>，
 *   确保私有仓库文件正常下载且文件名正确。
 */
async function downloadCodeFile(url: string, filename: string, token: string): Promise<void> {
  const bridge = (window as unknown as {
    AndroidBridge?: { downloadFile?: (u: string, f: string, t: string) => void }
  }).AndroidBridge;
  if (bridge?.downloadFile) {
    bridge.downloadFile(url, filename, token);
    return;
  }
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

type ActionMode =
  | 'edit'
  | 'new-file'
  | 'new-folder'
  | 'delete-file'
  | 'delete-folder'
  | 'rename'
  | 'move'
  | 'upload';

interface UploadFile {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'skipped';
  error?: string;
  targetPath: string;
}

/**
 * 将 File 转换为 base64 字符串（GitHub Contents API 所需格式）。
 *
 * 使用 readAsArrayBuffer 读取原始字节，而非 readAsDataURL。
 * 原因：readAsDataURL 对 text/* MIME 文件在部分浏览器/系统上会做字符集转换，
 * 导致含非 ASCII 字符（中文注释、特殊符号）的代码文件字节改变，上传后出现乱码。
 * readAsArrayBuffer 始终读取文件的原始字节，不做任何编码解释，可保证上传内容与源文件完全一致。
 * 分块处理（8 KB/块）防止 String.fromCharCode spread 在大文件时触发 stack overflow。
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer);
      const CHUNK = 8192;
      let binary = '';
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      resolve(btoa(binary));
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsArrayBuffer(file);
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// 将 base64 文件内容转为 data URI 用于图片预览
function base64ToDataUri(base64: string, filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp', ico: 'image/x-icon',
  };
  const mime = mimeMap[ext] || 'image/png';
  return `data:${mime};base64,${base64}`;
}

// 文件图标组件
function FileItemIcon({ filename, isDir, isOpen = false, size = 'w-4 h-4' }: {
  filename: string;
  isDir: boolean;
  isOpen?: boolean;
  size?: string;
}) {
  const { Icon, color } = getFileIconInfo(filename, isDir, isOpen);
  return <Icon className={`${size} ${color} shrink-0`} />;
}

export default function CodeBrowserPage() {
  const { owner, repo, '*': filePath = '' } = useParams<{ owner: string; repo: string; '*': string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [contents, setContents] = useState<GitHubContent[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null); // 原始 base64（用于图片）
  const [currentFile, setCurrentFile] = useState<GitHubContent | null>(null);
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>('');
  const [loading, setLoading] = useState(true);

  // 操作状态
  const [actionMode, setActionMode] = useState<ActionMode | null>(null);
  const [actionTarget, setActionTarget] = useState<GitHubContent | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);

  // 编辑器全屏
  const [editorFullscreen, setEditorFullscreen] = useState(false);

  // 编辑器显示选项
  const [editorFontSize, setEditorFontSize] = useState(14);   // px，范围 10-22

  // 编辑器搜索
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIndex, setSearchMatchIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);       // 高亮覆盖层
  const lineNumRef = useRef<HTMLDivElement>(null);         // 行号滚动容器
  const scrollContainerRef = useRef<HTMLDivElement>(null); // 编辑区滚动容器（普通 div，非 textarea，避免 iOS 唤起输入法）
  const skipNavClickRef = useRef(false);                   // 防止 pointerdown 与 click 双触发

  // 表单字段
  const [editContent, setEditContent] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTo, setRenameTo] = useState('');
  const [moveTo, setMoveTo] = useState('');

  // 上传状态
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [uploadCommitMsg, setUploadCommitMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [skipExisting, setSkipExisting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // 判断当前文件是否是图片
  const currentIsImage = currentFile ? isImageFile(currentFile.name) : false;

  // 文件树状态
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [treeOpen, setTreeOpen] = useState(false);       // 移动端 Sheet 展开
  const [treeVisible, setTreeVisible] = useState(true);  // 桌面端显隐
  // 由文件树触发新建时记录目标目录（用于绕过 URL filePath）
  const [pendingDirPath, setPendingDirPath] = useState<string | null>(null);

  const loadContents = useCallback(async () => {
    if (!owner || !repo || !currentBranch) return;
    setLoading(true);
    setFileContent(null);
    setFileBase64(null);
    setCurrentFile(null);
    // 加载新路径时重置编辑器状态
    setEditorFullscreen(false);
    setActionMode(null);
    setEditContent('');
    setCommitMsg('');
    setShowSearch(false);
    setSearchQuery('');
    setSearchMatchIndex(0);
    try {
      const data = await getRepoContents(owner, repo, filePath, currentBranch);
      if (Array.isArray(data)) {
        const sorted = [...data].sort((a, b) => {
          if (a.type === 'dir' && b.type !== 'dir') return -1;
          if (a.type !== 'dir' && b.type === 'dir') return 1;
          return a.name.localeCompare(b.name);
        });
        setContents(sorted);
      } else {
        setCurrentFile(data);
        if (data.content && data.encoding === 'base64') {
          const raw = data.content.replace(/\n/g, '');
          setFileBase64(raw);
          if (!isImageFile(data.name)) {
            const decoded = decodeBase64Content(data.content);
            setFileContent(decoded);
            // 文本文件：直接在此原子性地打开编辑器，避免 useEffect 竞态
            setEditContent(decoded);
            setCommitMsg(`Update ${data.name}`);
            setActionMode('edit');
            setEditorFullscreen(true);
          }
        } else {
          setFileContent('（无法解码文件内容）');
        }
      }
    } catch (err) {
      toast.error('加载文件内容失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [owner, repo, filePath, currentBranch]);

  useEffect(() => {
    if (!owner || !repo) return;
    getBranches(owner, repo)
      .then((result) => {
        setBranches(result.data);
        if (result.data.length > 0 && !currentBranch) {
          setCurrentBranch(result.data[0].name);
        }
      })
      .catch(console.error);
  }, [owner, repo, currentBranch]);

  useEffect(() => { loadContents(); }, [loadContents]);

  // 关闭操作：非编辑模式直接清理；编辑模式返回上级目录
  // replace=true 时用 replace 导航，避免关闭后按返回键重新打开编辑器
  const closeAction = (returnToParent = false) => {
    setActionMode(null);
    setActionTarget(null);
    setCommitMsg('');
    setNewFileName('');
    setNewFileContent('');
    setNewFolderName('');
    setRenameTo('');
    setMoveTo('');
    setDeleteProgress(null);
    setEditorFullscreen(false);
    setShowSearch(false);
    setSearchQuery('');
    setSearchMatchIndex(0);
    if (returnToParent && filePath) {
      const parentParts = filePath.split('/').slice(0, -1);
      // replace: true 将当前文件路由条目替换为父目录，而非新增入栈，
      // 这样用户按返回键时不会重新打开编辑器
      navigate(
        `/repos/${owner}/${repo}/code${parentParts.length ? '/' + parentParts.join('/') : ''}`,
        { replace: true }
      );
    }
  };

  const openAction = (mode: ActionMode, target?: GitHubContent, dirPath?: string) => {
    setActionMode(mode);
    setActionTarget(target || null);
    // 文件树触发时记录目标目录；未传则清空（沿用 URL filePath）
    setPendingDirPath(dirPath !== undefined ? dirPath : null);
    if (mode === 'edit' && fileContent) {
      setEditContent(fileContent);
      setCommitMsg(`Update ${currentFile?.name || 'file'}`);
      setEditorFullscreen(true);
    }
    if (mode === 'new-file') { setNewFileName(''); setNewFileContent(''); setCommitMsg('Add new file'); }
    if (mode === 'new-folder') { setNewFolderName(''); setCommitMsg('Add new folder'); }
    if (mode === 'upload') { setUploadFiles([]); setUploadCommitMsg('Upload files'); setUploadProgress(0); setSkipExisting(false); }
    if (mode === 'rename' && target) setRenameTo(target.name);
    if (mode === 'move' && target) setMoveTo(target.path);
  };

  // ─── 保存编辑 ───
  const handleSaveEdit = async () => {
    if (!owner || !repo || !currentFile || !commitMsg.trim()) { toast.error('请填写提交信息'); return; }
    setActionBusy(true);
    try {
      await updateFileContent(owner, repo, currentFile.path, {
        message: commitMsg.trim(),
        content: btoa(unescape(encodeURIComponent(editContent))),
        sha: currentFile.sha,
        branch: currentBranch,
      });
      toast.success('文件已保存并提交');
      // 直接导航到上级目录，不更新 fileContent（避免触发响应式副作用）
      closeAction(true);
    } catch (err) { toast.error(err instanceof Error ? err.message : '保存失败'); }
    finally { setActionBusy(false); }
  };

  // ─── 新建文件 ───
  const handleCreateFile = async () => {
    if (!owner || !repo || !newFileName.trim()) { toast.error('请填写文件名'); return; }
    const baseDir = pendingDirPath !== null ? pendingDirPath : filePath;
    const targetPath = baseDir ? `${baseDir}/${newFileName.trim()}` : newFileName.trim();
    const finalMsg = commitMsg.trim() || `Add ${newFileName.trim()}`;
    setActionBusy(true);
    try {
      const existing = await getFileInfo(owner, repo, targetPath, currentBranch);
      if (existing) { toast.error('文件已存在，请换一个名字'); return; }
      const b64 = newFileContent ? btoa(unescape(encodeURIComponent(newFileContent))) : btoa('');
      await createFileContent(owner, repo, targetPath, { message: finalMsg, content: b64, branch: currentBranch });
      toast.success(`已创建文件 ${newFileName.trim()}`);
      closeAction();
      loadContents();
      setTreeRefreshKey(k => k + 1);
    } catch (err) { toast.error(err instanceof Error ? err.message : '创建失败'); }
    finally { setActionBusy(false); }
  };

  // ─── 新建文件夹 ───
  const handleCreateFolder = async () => {
    if (!owner || !repo || !newFolderName.trim()) { toast.error('请填写文件夹名'); return; }
    const baseDir = pendingDirPath !== null ? pendingDirPath : filePath;
    const gitkeepPath = baseDir ? `${baseDir}/${newFolderName.trim()}/.gitkeep` : `${newFolderName.trim()}/.gitkeep`;
    const finalMsg = commitMsg.trim() || `Add ${newFolderName.trim()} folder`;
    setActionBusy(true);
    try {
      await createFileContent(owner, repo, gitkeepPath, { message: finalMsg, content: btoa(''), branch: currentBranch });
      toast.success(`已创建文件夹 ${newFolderName.trim()}`);
      closeAction();
      loadContents();
      setTreeRefreshKey(k => k + 1);
    } catch (err) { toast.error(err instanceof Error ? err.message : '创建失败'); }
    finally { setActionBusy(false); }
  };

  // ─── 上传文件 ───
  const addUploadFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const prefix = filePath ? `${filePath}/` : '';
    const newItems: UploadFile[] = Array.from(fileList).map((f) => ({
      id: `${f.name}-${f.lastModified}-${Math.random()}`,
      file: f, status: 'pending',
      targetPath: `${prefix}${f.name}`,
    }));
    setUploadFiles((prev) => [...prev, ...newItems]);
  }, [filePath]);

  const handleUpload = async () => {
    if (!owner || !repo) return;
    const pending = uploadFiles.filter((f) => f.status === 'pending' || f.status === 'error');
    if (pending.length === 0) { toast.error('没有待上传的文件'); return; }
    const msg = uploadCommitMsg.trim() || 'Upload files';
    setUploading(true);
    setUploadProgress(0);
    let ok = 0, fail = 0, skip = 0;
    for (let i = 0; i < pending.length; i++) {
      const f = pending[i];
      const tp = f.targetPath.replace(/^\/+/, '');
      if (!tp) {
        setUploadFiles((p) => p.map((x) => x.id === f.id ? { ...x, status: 'error', error: '路径不能为空' } : x));
        fail++; continue;
      }
      setUploadFiles((p) => p.map((x) => x.id === f.id ? { ...x, status: 'uploading' } : x));
      try {
        const base64 = await fileToBase64(f.file);
        const existing = await getFileInfo(owner, repo, tp, currentBranch);
        if (existing && skipExisting) {
          setUploadFiles((p) => p.map((x) => x.id === f.id ? { ...x, status: 'skipped' } : x));
          skip++;
        } else if (existing) {
          await updateFileContent(owner, repo, tp, { message: msg, content: base64, sha: existing.sha, branch: currentBranch });
          setUploadFiles((p) => p.map((x) => x.id === f.id ? { ...x, status: 'success' } : x));
          ok++;
        } else {
          await createFileContent(owner, repo, tp, { message: msg, content: base64, branch: currentBranch });
          setUploadFiles((p) => p.map((x) => x.id === f.id ? { ...x, status: 'success' } : x));
          ok++;
        }
      } catch (err) {
        const msg2 = err instanceof Error ? err.message : '上传失败';
        setUploadFiles((p) => p.map((x) => x.id === f.id ? { ...x, status: 'error', error: msg2 } : x));
        fail++;
      }
      setUploadProgress(Math.round(((i + 1) / pending.length) * 100));
    }
    setUploading(false);
    const parts = [ok > 0 && `${ok} 个成功`, skip > 0 && `${skip} 个跳过`, fail > 0 && `${fail} 个失败`].filter(Boolean).join('，');
    if (fail === 0) { toast.success(`上传完成：${parts}`); loadContents(); }
    else toast.warning(`上传完成：${parts}`);
  };

  // ─── 删除文件 ───
  const handleDeleteFile = async () => {
    if (!owner || !repo || !actionTarget || !commitMsg.trim()) { toast.error('请填写提交信息'); return; }
    setActionBusy(true);
    try {
      await deleteFileContent(owner, repo, actionTarget.path, {
        message: commitMsg.trim(), sha: actionTarget.sha, branch: currentBranch,
      });
      toast.success(`已删除文件 ${actionTarget.name}`);
      setTreeRefreshKey(k => k + 1);
      closeAction();
      if (currentFile?.path === actionTarget.path) {
        const parentParts = filePath.split('/').slice(0, -1);
        navigate(`/repos/${owner}/${repo}/code${parentParts.length ? '/' + parentParts.join('/') : ''}`);
      } else { loadContents(); }
    } catch (err) { toast.error(err instanceof Error ? err.message : '删除失败'); }
    finally { setActionBusy(false); }
  };

  // ─── 删除文件夹 ───
  const handleDeleteFolder = async () => {
    if (!owner || !repo || !actionTarget || !commitMsg.trim()) { toast.error('请填写提交信息'); return; }
    setActionBusy(true);
    setDeleteProgress({ done: 0, total: 0 });
    try {
      const result = await deleteFolderContents(
        owner, repo, actionTarget.path, currentBranch, commitMsg.trim(),
        (done, total) => setDeleteProgress({ done, total })
      );
      if (result.failed === 0) toast.success(`已删除文件夹 ${actionTarget.name}（共 ${result.success} 个文件）`);
      else toast.warning(`删除完成：${result.success} 个成功，${result.failed} 个失败`);
      setTreeRefreshKey(k => k + 1);
      closeAction();
      loadContents();
    } catch (err) { toast.error(err instanceof Error ? err.message : '删除失败'); }
    finally { setActionBusy(false); setDeleteProgress(null); }
  };

  // ─── 重命名 ───
  const handleRename = async () => {
    if (!owner || !repo || !actionTarget || !renameTo.trim() || !commitMsg.trim()) {
      toast.error('请填写新名称和提交信息'); return;
    }
    if (renameTo.trim() === actionTarget.name) { toast.error('新名称与原名称相同'); return; }
    setActionBusy(true);
    try {
      const dirParts = actionTarget.path.split('/');
      dirParts[dirParts.length - 1] = renameTo.trim();
      const newPath = dirParts.join('/');
      if (actionTarget.type === 'file') {
        const fileInfo = await getFileInfo(owner, repo, actionTarget.path, currentBranch);
        if (!fileInfo || !fileInfo.content) throw new Error('无法读取文件内容');
        await createFileContent(owner, repo, newPath, { message: `${commitMsg.trim()} (rename)`, content: fileInfo.content.replace(/\n/g, ''), branch: currentBranch });
        await deleteFileContent(owner, repo, actionTarget.path, { message: `${commitMsg.trim()} (remove old)`, sha: actionTarget.sha, branch: currentBranch });
        toast.success(`已重命名为 ${renameTo.trim()}`);
        setTreeRefreshKey(k => k + 1);
        closeAction();
        navigate(`/repos/${owner}/${repo}/code/${newPath}`);
      } else {
        toast.info('文件夹重命名需要一段时间，请稍候...');
        const treeData = await getRepoContents(owner, repo, actionTarget.path, currentBranch) as GitHubContent[];
        const allFiles: Array<{ path: string; content: string; sha: string }> = [];
        const collectFiles = async (items: GitHubContent[]) => {
          for (const item of items) {
            if (item.type === 'file') {
              const info = await getFileInfo(owner, repo, item.path, currentBranch);
              if (info?.content) allFiles.push({ path: item.path, content: info.content.replace(/\n/g, ''), sha: info.sha });
            } else if (item.type === 'dir') {
              const sub = await getRepoContents(owner, repo, item.path, currentBranch) as GitHubContent[];
              await collectFiles(sub);
            }
          }
        };
        await collectFiles(treeData);
        for (const f of allFiles) {
          const newFilePath = newPath + f.path.substring(actionTarget.path.length);
          await createFileContent(owner, repo, newFilePath, { message: `${commitMsg.trim()} (rename)`, content: f.content, branch: currentBranch });
        }
        for (const f of allFiles) {
          await deleteFileContent(owner, repo, f.path, { message: `${commitMsg.trim()} (remove old)`, sha: f.sha, branch: currentBranch });
        }
        toast.success(`已重命名文件夹为 ${renameTo.trim()}`);
        setTreeRefreshKey(k => k + 1);
        closeAction();
        loadContents();
      }
    } catch (err) { toast.error(err instanceof Error ? err.message : '重命名失败'); }
    finally { setActionBusy(false); }
  };

  // ─── 移动文件 ───
  const handleMove = async () => {
    if (!owner || !repo || !actionTarget || !moveTo.trim() || !commitMsg.trim()) {
      toast.error('请填写目标路径和提交信息'); return;
    }
    if (moveTo.trim() === actionTarget.path) { toast.error('目标路径与当前路径相同'); return; }
    if (actionTarget.type !== 'file') { toast.error('暂只支持移动文件'); return; }
    setActionBusy(true);
    try {
      const fileInfo = await getFileInfo(owner, repo, actionTarget.path, currentBranch);
      if (!fileInfo?.content) throw new Error('无法读取文件内容');
      await createFileContent(owner, repo, moveTo.trim(), { message: `${commitMsg.trim()} (move to ${moveTo.trim()})`, content: fileInfo.content.replace(/\n/g, ''), branch: currentBranch });
      await deleteFileContent(owner, repo, actionTarget.path, { message: `${commitMsg.trim()} (remove original)`, sha: actionTarget.sha, branch: currentBranch });
      toast.success(`已移动到 ${moveTo.trim()}`);
      setTreeRefreshKey(k => k + 1);
      closeAction();
      loadContents();
    } catch (err) { toast.error(err instanceof Error ? err.message : '移动失败'); }
    finally { setActionBusy(false); }
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    toast.success('路径已复制');
  };

  const handleCopyRawLink = (path: string) => {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${currentBranch}/${path}`;
    navigator.clipboard.writeText(rawUrl);
    toast.success('Raw 链接已复制');
  };

  const pathParts = filePath ? filePath.split('/') : [];
  const navigateTo = (parts: string[]) => navigate(`/repos/${owner}/${repo}/code/${parts.join('/')}`);

  // 文件右键菜单项
  const FileContextMenuContent = ({ item }: { item: GitHubContent }) => (
    <ContextMenuContent className="bg-popover border-border w-48">
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={() => navigate(`/repos/${owner}/${repo}/code/${item.path}`)}>
        <FileItemIcon filename={item.name} isDir={false} size="w-3.5 h-3.5 mr-2" />
        查看文件
      </ContextMenuItem>
      {!isImageFile(item.name) && (
        <ContextMenuItem className="text-foreground cursor-pointer text-sm"
          onClick={() => navigate(`/repos/${owner}/${repo}/code/${item.path}`)}>
          <Pencil className="w-3.5 h-3.5 mr-2" />编辑文件
        </ContextMenuItem>
      )}
      {item.download_url && (
        <ContextMenuItem className="text-foreground cursor-pointer text-sm"
          onClick={async () => {
            try {
              await downloadCodeFile(item.download_url!, item.name, token ?? '');
            } catch {
              toast.error('下载失败，请检查网络或权限');
            }
          }}>
          <Download className="w-3.5 h-3.5 mr-2" />下载文件
        </ContextMenuItem>
      )}
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={() => handleCopyPath(item.path)}>
        <ClipboardCopy className="w-3.5 h-3.5 mr-2" />复制路径
      </ContextMenuItem>
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={() => handleCopyRawLink(item.path)}>
        <Link className="w-3.5 h-3.5 mr-2" />复制 Raw 链接
      </ContextMenuItem>
      <ContextMenuSeparator className="bg-border" />
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={() => openAction('rename', item)}>
        <Pencil className="w-3.5 h-3.5 mr-2" />重命名
      </ContextMenuItem>
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={() => openAction('move', item)}>
        <MoveRight className="w-3.5 h-3.5 mr-2" />移动到...
      </ContextMenuItem>
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={() => navigate(`/repos/${owner}/${repo}/commits/${currentBranch}?path=${item.path}`)}>
        <History className="w-3.5 h-3.5 mr-2" />查看历史
      </ContextMenuItem>
      <ContextMenuSeparator className="bg-border" />
      <ContextMenuItem className="text-destructive cursor-pointer text-sm focus:text-destructive"
        onClick={() => { setCommitMsg(`Delete ${item.name}`); openAction('delete-file', item); }}>
        <Trash2 className="w-3.5 h-3.5 mr-2" />删除文件
      </ContextMenuItem>
    </ContextMenuContent>
  );

  // 文件夹右键菜单项
  const FolderContextMenuContent = ({ item }: { item: GitHubContent }) => (
    <ContextMenuContent className="bg-popover border-border w-52">
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={() => navigate(`/repos/${owner}/${repo}/code/${item.path}`)}>
        <FolderOpen className="w-3.5 h-3.5 mr-2 text-yellow-400" />打开文件夹
      </ContextMenuItem>
      <ContextMenuSeparator className="bg-border" />
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={() => { navigate(`/repos/${owner}/${repo}/code/${item.path}`); setTimeout(() => openAction('new-file'), 100); }}>
        <FilePlus className="w-3.5 h-3.5 mr-2" />新建文件
      </ContextMenuItem>
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={() => { navigate(`/repos/${owner}/${repo}/code/${item.path}`); setTimeout(() => openAction('new-folder'), 100); }}>
        <FolderPlus className="w-3.5 h-3.5 mr-2" />新建子文件夹
      </ContextMenuItem>
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={() => { navigate(`/repos/${owner}/${repo}/code/${item.path}`); setTimeout(() => openAction('upload'), 100); }}>
        <Upload className="w-3.5 h-3.5 mr-2" />上传文件
      </ContextMenuItem>
      <ContextMenuSeparator className="bg-border" />
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={() => handleCopyPath(item.path)}>
        <ClipboardCopy className="w-3.5 h-3.5 mr-2" />复制路径
      </ContextMenuItem>
      <ContextMenuItem className="text-foreground cursor-pointer text-sm"
        onClick={() => openAction('rename', item)}>
        <Pencil className="w-3.5 h-3.5 mr-2" />重命名
      </ContextMenuItem>
      <ContextMenuSeparator className="bg-border" />
      <ContextMenuItem className="text-destructive cursor-pointer text-sm focus:text-destructive"
        onClick={() => { setCommitMsg(`Delete folder ${item.name}`); openAction('delete-folder', item); }}>
        <Trash2 className="w-3.5 h-3.5 mr-2" />删除文件夹
      </ContextMenuItem>
    </ContextMenuContent>
  );

  // 全屏编辑器：计算搜索匹配（提升到组件级别，避免子组件重挂载导致焦点丢失）
  const fsLineCount = editContent.split('\n').length;
  const fsIsLarge = fsLineCount > 500;

  // 用 useMemo 稳定匹配结果，避免每次渲染产生新数组导致 useCallback 失效
  const fsSearchMatches = useMemo<Array<{ start: number; end: number }>>(() => {
    if (!editorFullscreen || !searchQuery.trim()) return [];
    const lower = editContent.toLowerCase();
    const q = searchQuery.toLowerCase();
    const matches: Array<{ start: number; end: number }> = [];
    let pos = 0;
    while (pos < lower.length) {
      const idx = lower.indexOf(q, pos);
      if (idx === -1) break;
      matches.push({ start: idx, end: idx + q.length });
      // 非重叠匹配：跳过整个关键词长度，防止重叠导致高亮节点越界串位
      pos = idx + q.length;
    }
    return matches;
  }, [editorFullscreen, searchQuery, editContent]);

  const fsMatchCount = fsSearchMatches.length;
  const fsSafeIndex = fsMatchCount > 0 ? ((searchMatchIndex % fsMatchCount) + fsMatchCount) % fsMatchCount : 0;

  // 构建高亮 JSX 节点（用于 pre 覆盖层）
  const fsHighlightNodes = useMemo(() => {
    if (fsSearchMatches.length === 0) {
      // 无搜索时直接渲染透明文本（保持布局一致）
      return <span>{editContent}</span>;
    }
    const nodes: React.ReactNode[] = [];
    let last = 0;
    fsSearchMatches.forEach((match, i) => {
      if (last < match.start) nodes.push(<span key={`t${i}`}>{editContent.slice(last, match.start)}</span>);
      const isCurrent = i === fsSafeIndex;
      nodes.push(
        <mark
          key={`m${i}`}
          style={{
            backgroundColor: isCurrent ? 'hsl(var(--primary) / 0.55)' : 'rgba(253,224,71,0.45)',
            color: 'inherit',
            borderRadius: '2px',
            outline: isCurrent ? '1px solid hsl(var(--primary))' : 'none',
          }}
        >
          {editContent.slice(match.start, match.end)}
        </mark>
      );
      last = match.end;
    });
    if (last < editContent.length) nodes.push(<span key="tail">{editContent.slice(last)}</span>);
    // 必须在末尾补一个零宽字符，防止 pre 比 textarea 矮一行
    nodes.push('\u200b');
    return <>{nodes}</>;
  }, [fsSearchMatches, fsSafeIndex, editContent]);

  // 滚动同步：滚动容器 div → 行号列（不涉及 textarea，避免 iOS 唤起输入法）
  const fsSyncScroll = useCallback(() => {
    if (!scrollContainerRef.current || !lineNumRef.current) return;
    lineNumRef.current.scrollTop = scrollContainerRef.current.scrollTop;
  }, []);

  const fsJumpToMatch = useCallback((idx: number, matches: Array<{ start: number; end: number }>) => {
    if (!scrollContainerRef.current || !highlightRef.current || matches.length === 0) return;
    const safeIdx = ((idx % matches.length) + matches.length) % matches.length;
    // requestAnimationFrame：等 React 用新 fsSafeIndex 重渲染完 mark 元素后再读取位置
    requestAnimationFrame(() => {
      if (!scrollContainerRef.current || !highlightRef.current) return;
      const marks = highlightRef.current.querySelectorAll('mark');
      const targetMark = marks[safeIdx] as HTMLElement | undefined;
      if (targetMark) {
        const markTop = targetMark.offsetTop;
        const viewHeight = scrollContainerRef.current.clientHeight;
        // 滚动普通 div，绝不触碰 textarea.scrollTop，彻底消除 iOS 唤起输入法
        scrollContainerRef.current.scrollTop = Math.max(0, markTop - viewHeight / 2);
        fsSyncScroll();
      }
    });
  }, [fsSyncScroll]);

  const fsHandleSearchNext = useCallback(() => {
    if (fsMatchCount === 0) return;
    const next = (fsSafeIndex + 1) % fsMatchCount;
    setSearchMatchIndex(next);
    fsJumpToMatch(next, fsSearchMatches);
  }, [fsMatchCount, fsSafeIndex, fsSearchMatches, fsJumpToMatch]);

  const fsHandleSearchPrev = useCallback(() => {
    if (fsMatchCount === 0) return;
    const prev = (fsSafeIndex - 1 + fsMatchCount) % fsMatchCount;
    setSearchMatchIndex(prev);
    fsJumpToMatch(prev, fsSearchMatches);
  }, [fsMatchCount, fsSafeIndex, fsSearchMatches, fsJumpToMatch]);

  const fsHandleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.shiftKey ? fsHandleSearchPrev() : fsHandleSearchNext(); }
    if (e.key === 'Escape') {
      setShowSearch(false);
      setSearchQuery('');
      textareaRef.current?.focus();
    }
  }, [fsHandleSearchNext, fsHandleSearchPrev]);

  const fsHandleEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      setShowSearch(true);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, []);

  // 编辑器打开时聚焦 textarea
  useEffect(() => {
    if (actionMode === 'edit') {
      const timer = setTimeout(() => textareaRef.current?.focus(), 80);
      return () => clearTimeout(timer);
    }
  }, [actionMode]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ─── 全屏编辑器（fixed overlay，仅移动端 / 小屏） ─── */}
      {editorFullscreen && actionMode === 'edit' && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col md:hidden">
          {/* ── 顶栏 ── */}
          <div className="flex items-center gap-2 px-4 h-12 shrink-0 border-b border-border bg-card/95 backdrop-blur-sm">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:bg-secondary h-8 gap-1.5 shrink-0"
              onClick={() => closeAction(true)}
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm hidden sm:inline">返回</span>
            </Button>
            <div className="w-px h-5 bg-border shrink-0" />
            <div className="flex-1 min-w-0" />
            <div className="flex items-center gap-1 shrink-0">
              {currentBranch && (
                <Badge variant="outline" className="border-border text-muted-foreground hidden sm:flex items-center gap-1 h-6 text-xs mr-1">
                  <GitBranch className="w-3 h-3" />{currentBranch}
                </Badge>
              )}
              {currentFile && (
                <span className="text-xs text-muted-foreground hidden md:block mr-2">
                  {formatFileSize(currentFile.size)} · {fsLineCount} 行
                </span>
              )}
              {/* 缩小字号 */}
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 text-muted-foreground hover:bg-secondary"
                onClick={() => setEditorFontSize(s => Math.max(10, s - 1))}
                disabled={editorFontSize <= 10}
                title={`缩小字号 (${editorFontSize}px)`}
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              {/* 字号显示 */}
              <span className="text-xs text-muted-foreground w-8 text-center tabular-nums">{editorFontSize}</span>
              {/* 放大字号 */}
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 text-muted-foreground hover:bg-secondary"
                onClick={() => setEditorFontSize(s => Math.min(22, s + 1))}
                disabled={editorFontSize >= 22}
                title={`放大字号 (${editorFontSize}px)`}
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <div className="w-px h-4 bg-border shrink-0 mx-0.5" />
              {/* 搜索 */}
              <Button
                variant={showSearch ? 'secondary' : 'ghost'}
                size="icon"
                className="w-8 h-8 text-muted-foreground hover:bg-secondary"
                onClick={() => {
                  const next = !showSearch;
                  setShowSearch(next);
                  if (next) setTimeout(() => searchInputRef.current?.focus(), 50);
                  else { setSearchQuery(''); textareaRef.current?.focus(); }
                }}
                title="搜索 (Ctrl+F)"
              >
                <Search className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 text-muted-foreground hover:bg-secondary"
                onClick={() => { navigator.clipboard.writeText(editContent); toast.success('代码已复制'); }}
                title="复制内容"
              >
                <Copy className="w-4 h-4" />
              </Button>
              {currentFile?.download_url && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 text-muted-foreground hover:bg-secondary"
                  title="下载文件"
                  onClick={async () => {
                    try {
                      await downloadCodeFile(currentFile.download_url!, currentFile.name, token ?? '');
                    } catch {
                      toast.error('下载失败，请检查网络或权限');
                    }
                  }}
                >
                  <Download className="w-4 h-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="w-8 h-8 text-muted-foreground hover:bg-secondary"
                onClick={() => closeAction(true)}
                title="关闭"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* ── 搜索栏（可展开） ── */}
          {showSearch && (
            <div className="flex items-center gap-2 px-4 h-11 shrink-0 border-b border-border bg-secondary/40">
              <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSearchMatchIndex(0); }}
                onKeyDown={fsHandleSearchKeyDown}
                placeholder="搜索代码... (Enter 下一个 · Shift+Enter 上一个)"
                className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none border-none font-mono"
              />
              <span className="text-xs text-muted-foreground shrink-0 min-w-[4rem] text-right">
                {searchQuery.trim() ? (fsMatchCount === 0 ? '无匹配' : `${fsSafeIndex + 1} / ${fsMatchCount}`) : ''}
              </span>
              {/*
                上/下跳转按钮：用 onPointerDown（鼠标+触摸均在焦点变更之前触发）+
                e.preventDefault() 阻止焦点转移，彻底消除 iOS 唤起输入法。
                onClick 仅作 lint 合规保留，用 skipNavClickRef 去重防止双触发。
                键盘（Space/Enter）只触发 click，skipNavClickRef 为 false，照常执行。
              */}
              <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:bg-secondary shrink-0"
                onPointerDown={(e) => { e.preventDefault(); skipNavClickRef.current = true; fsHandleSearchPrev(); }}
                onClick={() => { if (skipNavClickRef.current) { skipNavClickRef.current = false; return; } fsHandleSearchPrev(); }}
                disabled={fsMatchCount === 0} title="上一个 (Shift+Enter)">
                <ChevronUp className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:bg-secondary shrink-0"
                onPointerDown={(e) => { e.preventDefault(); skipNavClickRef.current = true; fsHandleSearchNext(); }}
                onClick={() => { if (skipNavClickRef.current) { skipNavClickRef.current = false; return; } fsHandleSearchNext(); }}
                disabled={fsMatchCount === 0} title="下一个 (Enter)">
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:bg-secondary shrink-0"
                onClick={() => { setShowSearch(false); setSearchQuery(''); textareaRef.current?.focus(); }}
                title="关闭搜索 (Esc)">
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          {/* ── 代码编辑区（中间）：pre 高亮层 + textarea 透明覆盖层 ── */}
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {/* 行号列（与 textarea 同步滚动） */}
            {!fsIsLarge && (
              <div
                ref={lineNumRef}
                className="w-12 shrink-0 overflow-hidden bg-secondary/40 border-r border-border select-none"
                aria-hidden="true"
              >
                <div style={{ padding: '1rem 0.25rem 1rem 0' }}>
                  {editContent.split('\n').map((_, i) => (
                    <div
                      key={i}
                      className="text-right text-muted-foreground/50 font-mono"
                      style={{ fontSize: `${editorFontSize}px`, lineHeight: '1.625' }}
                    >
                      {i + 1}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 编辑区容器 */}
            <div className="relative flex-1 min-h-0 overflow-hidden bg-background">
              {/*
                架构：scrollContainerRef(div) > sizing-div > pre(高亮,普通流) + textarea(绝对覆盖,overflow:hidden)
                滚动由普通 div 承担，textarea 完全不参与滚动。
                设置 div.scrollTop 不会触发 iOS Safari 唤起输入法。
              */}
              <div
                ref={scrollContainerRef}
                onScroll={fsSyncScroll}
                style={{
                  position: 'absolute', inset: 0,
                  overflowY: 'scroll', overflowX: 'hidden',
                }}
              >
                {/* 内容尺寸容器：由 pre 的自然高度决定，textarea 绝对覆盖 */}
                <div style={{ position: 'relative' }}>
                  {/* 高亮层：正常文档流，自动高度，撑起滚动内容区 */}
                  <pre
                    ref={highlightRef}
                    aria-hidden="true"
                    style={{
                      margin: 0, padding: '1rem',
                      pointerEvents: 'none',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      fontSize: `${editorFontSize}px`,
                      lineHeight: '1.625',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      color: 'hsl(var(--foreground))',
                      boxSizing: 'border-box',
                      // 无 overflow，正常流自动高度
                    }}
                  >
                    {fsHighlightNodes}
                  </pre>

                  {/*
                    编辑层：绝对覆盖 pre，overflow:hidden（不独立滚动）。
                    浏览器光标超出可视区时会滚动最近的可滚动祖先（即 scrollContainerRef div），
                    不会触碰 textarea 本身的滚动 API，彻底消除 iOS 唤起输入法问题。
                  */}
                  <textarea
                    ref={textareaRef}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onKeyDown={fsHandleEditorKeyDown}
                    spellCheck={false}
                    style={{
                      position: 'absolute', inset: 0,
                      width: '100%', height: '100%',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      fontSize: `${editorFontSize}px`,
                      lineHeight: '1.625',
                      padding: '1rem',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      resize: 'none',
                      border: 'none', outline: 'none', borderRadius: 0,
                      background: 'transparent',
                      color: 'transparent',
                      caretColor: 'hsl(var(--foreground))',
                      boxSizing: 'border-box',
                      overflow: 'hidden', // 不独立滚动！
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── 底栏 ── */}
          <div className="flex items-center gap-3 px-4 h-14 shrink-0 border-t border-border bg-card/95 backdrop-blur-sm">
            <div className="flex-1 min-w-0">
              <Input
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                placeholder="提交信息（必填）..."
                className="h-9 bg-secondary border-border text-foreground placeholder:text-muted-foreground text-sm"
              />
            </div>
            <Button variant="ghost" size="sm"
              className="h-9 text-muted-foreground border border-border hover:bg-secondary shrink-0"
              onClick={() => closeAction(true)}>
              <X className="w-3.5 h-3.5 mr-1.5" />取消
            </Button>
            <Button size="sm" className="h-9 bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
              onClick={handleSaveEdit} disabled={actionBusy || !commitMsg.trim()}>
              {actionBusy
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />提交中...</>
                : <><Save className="w-3.5 h-3.5 mr-1.5" />保存并提交</>
              }
            </Button>
          </div>
        </div>
      )}

      {/* ─── 顶栏：面包屑 + 移动端树按钮 + 桌面端树切换 ─── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/80 shrink-0 min-h-[44px]">
        {/* 移动端：展开文件树按钮 */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden h-8 w-8 text-muted-foreground hover:bg-secondary shrink-0"
          onClick={() => setTreeOpen(true)}
          title="打开文件树"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </Button>

        {/* 面包屑 */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground flex-1 min-w-0 overflow-x-auto whitespace-nowrap scrollbar-none">
          <button type="button" className="hover:text-primary transition-colors shrink-0" onClick={() => navigate('/repos')}>仓库</button>
          <ChevronRight className="w-3 h-3 shrink-0" />
          <button type="button" className="hover:text-primary transition-colors shrink-0 max-w-[120px] truncate" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
          <ChevronRight className="w-3 h-3 shrink-0" />
          <button type="button" className="hover:text-primary transition-colors shrink-0" onClick={() => navigate(`/repos/${owner}/${repo}/code`)}>代码</button>
          {pathParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
              <button
                type="button"
                className={`text-sm ${i === pathParts.length - 1 ? 'text-foreground font-medium' : 'text-primary hover:underline'}`}
                onClick={() => i < pathParts.length - 1 ? navigateTo(pathParts.slice(0, i + 1)) : undefined}
              >
                {part}
              </button>
            </span>
          ))}
        </div>

        {/* 桌面端：当前分支显示（只读，切换在文件树里） */}
        {currentBranch && (
          <Badge variant="outline" className="border-border text-muted-foreground hidden md:flex items-center gap-1 h-6 text-xs shrink-0">
            <GitBranch className="w-3 h-3" />{currentBranch}
          </Badge>
        )}

        {/* 桌面端：收起/展开侧边树 */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:flex h-8 w-8 text-muted-foreground hover:bg-secondary shrink-0"
          onClick={() => setTreeVisible(v => !v)}
          title={treeVisible ? '收起文件树' : '展开文件树'}
        >
          {treeVisible ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
        </Button>
      </div>

      {/* ─── 主体：左侧文件树 + 右侧内容 ─── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* 桌面端固定侧边树 */}
        {treeVisible && (
          <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-border bg-sidebar overflow-hidden">
            <FileTree
              owner={owner!}
              repo={repo!}
              branch={currentBranch}
              branches={branches}
              onBranchChange={setCurrentBranch}
              activePath={filePath || undefined}
              refreshKey={treeRefreshKey}
              onFileClick={(item) => navigate(`/repos/${owner}/${repo}/code/${item.path}`)}
              onNewFile={(dirPath) => openAction('new-file', undefined, dirPath)}
              onNewFolder={(dirPath) => openAction('new-folder', undefined, dirPath)}
              onUpload={(dirPath) => { setPendingDirPath(dirPath); openAction('upload', undefined, dirPath); }}
              onRename={(item) => openAction('rename', item)}
              onMove={(item) => openAction('move', item)}
              onDelete={(item) => {
                setCommitMsg(`Delete ${item.name}`);
                openAction(item.type === 'dir' ? 'delete-folder' : 'delete-file', item);
              }}
              onDownload={(item) => {
                if (item.download_url) {
                  downloadCodeFile(item.download_url, item.name, token ?? '').catch(() =>
                    toast.error('下载失败，请检查网络或权限')
                  );
                }
              }}
            />
          </aside>
        )}

        {/* 移动端：Sheet 抽屉文件树 */}
        <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
          <SheetContent side="left" className="w-72 p-0 flex flex-col bg-sidebar">
            <SheetHeader className="px-3 py-2 border-b border-border">
              <SheetTitle className="text-sm font-medium text-foreground">{repo} 文件树</SheetTitle>
            </SheetHeader>
            <div className="flex-1 min-h-0 overflow-hidden">
              <FileTree
                owner={owner!}
                repo={repo!}
                branch={currentBranch}
                branches={branches}
                onBranchChange={(b) => { setCurrentBranch(b); setTreeOpen(false); }}
                activePath={filePath || undefined}
                refreshKey={treeRefreshKey}
                onFileClick={(item) => { navigate(`/repos/${owner}/${repo}/code/${item.path}`); setTreeOpen(false); }}
                onNewFile={(dirPath) => { openAction('new-file', undefined, dirPath); setTreeOpen(false); }}
                onNewFolder={(dirPath) => { openAction('new-folder', undefined, dirPath); setTreeOpen(false); }}
                onUpload={(dirPath) => { setPendingDirPath(dirPath); openAction('upload', undefined, dirPath); setTreeOpen(false); }}
                onRename={(item) => { openAction('rename', item); setTreeOpen(false); }}
                onMove={(item) => { openAction('move', item); setTreeOpen(false); }}
                onDelete={(item) => {
                  setCommitMsg(`Delete ${item.name}`);
                  openAction(item.type === 'dir' ? 'delete-folder' : 'delete-file', item);
                  setTreeOpen(false);
                }}
                onDownload={(item) => {
                  if (item.download_url) {
                    downloadCodeFile(item.download_url, item.name, token ?? '').catch(() =>
                      toast.error('下载失败，请检查网络或权限')
                    );
                  }
                  setTreeOpen(false);
                }}
              />
            </div>
          </SheetContent>
        </Sheet>

        {/* 右侧内容区 */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* ─── 桌面端内联编辑器（md+ 直接嵌入右侧面板） ─── */}
          {actionMode === 'edit' && (
            <div className="hidden md:flex flex-col flex-1 min-h-0">
              {/* 编辑器顶栏 */}
              <div className="flex items-center gap-2 px-3 h-11 shrink-0 border-b border-border bg-card/95">
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <FileItemIcon filename={currentFile?.name ?? ''} isDir={false} size="w-4 h-4" />
                  <span className="text-sm font-mono text-foreground truncate">{currentFile?.name}</span>
                  {currentFile && (
                    <span className="text-xs text-muted-foreground hidden lg:inline">
                      · {formatFileSize(currentFile.size)} · {fsLineCount} 行
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* 缩小字号 */}
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:bg-secondary"
                    onClick={() => setEditorFontSize(s => Math.max(10, s - 1))} disabled={editorFontSize <= 10}
                    title={`缩小字号 (${editorFontSize}px)`}>
                    <ZoomOut className="w-3.5 h-3.5" />
                  </Button>
                  <span className="text-xs text-muted-foreground w-7 text-center tabular-nums">{editorFontSize}</span>
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:bg-secondary"
                    onClick={() => setEditorFontSize(s => Math.min(22, s + 1))} disabled={editorFontSize >= 22}
                    title={`放大字号 (${editorFontSize}px)`}>
                    <ZoomIn className="w-3.5 h-3.5" />
                  </Button>
                  <div className="w-px h-4 bg-border shrink-0 mx-0.5" />
                  {/* 搜索 */}
                  <Button variant={showSearch ? 'secondary' : 'ghost'} size="icon"
                    className="w-7 h-7 text-muted-foreground hover:bg-secondary"
                    onClick={() => { const next = !showSearch; setShowSearch(next); if (next) setTimeout(() => searchInputRef.current?.focus(), 50); else { setSearchQuery(''); textareaRef.current?.focus(); } }}
                    title="搜索 (Ctrl+F)">
                    <Search className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:bg-secondary"
                    onClick={() => { navigator.clipboard.writeText(editContent); toast.success('代码已复制'); }}
                    title="复制内容">
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                  {currentFile?.download_url && (
                    <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:bg-secondary"
                      title="下载文件"
                      onClick={async () => { try { await downloadCodeFile(currentFile.download_url!, currentFile.name, token ?? ''); } catch { toast.error('下载失败'); } }}>
                      <Download className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:bg-secondary"
                    onClick={() => closeAction(true)} title="关闭编辑器">
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* 搜索栏 */}
              {showSearch && (
                <div className="flex items-center gap-2 px-3 h-10 shrink-0 border-b border-border bg-secondary/40">
                  <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <input ref={searchInputRef} type="text" value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setSearchMatchIndex(0); }}
                    onKeyDown={fsHandleSearchKeyDown}
                    placeholder="搜索代码... (Enter 下一个)"
                    className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none border-none font-mono" />
                  <span className="text-xs text-muted-foreground shrink-0 min-w-[4rem] text-right">
                    {searchQuery.trim() ? (fsMatchCount === 0 ? '无匹配' : `${fsSafeIndex + 1} / ${fsMatchCount}`) : ''}
                  </span>
                  <Button variant="ghost" size="icon" className="w-6 h-6 text-muted-foreground hover:bg-secondary shrink-0"
                    onPointerDown={(e) => { e.preventDefault(); skipNavClickRef.current = true; fsHandleSearchPrev(); }}
                    onClick={() => { if (skipNavClickRef.current) { skipNavClickRef.current = false; return; } fsHandleSearchPrev(); }}
                    disabled={fsMatchCount === 0} title="上一个">
                    <ChevronUp className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="w-6 h-6 text-muted-foreground hover:bg-secondary shrink-0"
                    onPointerDown={(e) => { e.preventDefault(); skipNavClickRef.current = true; fsHandleSearchNext(); }}
                    onClick={() => { if (skipNavClickRef.current) { skipNavClickRef.current = false; return; } fsHandleSearchNext(); }}
                    disabled={fsMatchCount === 0} title="下一个">
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="w-6 h-6 text-muted-foreground hover:bg-secondary shrink-0"
                    onClick={() => { setShowSearch(false); setSearchQuery(''); textareaRef.current?.focus(); }}
                    title="关闭搜索 (Esc)">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}

              {/* 代码编辑区 */}
              <div className="flex-1 min-h-0 flex overflow-hidden">
                {/* 行号 */}
                {!fsIsLarge && (
                  <div ref={lineNumRef}
                    className="w-10 shrink-0 overflow-hidden bg-secondary/40 border-r border-border select-none"
                    aria-hidden="true">
                    <div style={{ padding: '0.75rem 0.25rem 0.75rem 0' }}>
                      {editContent.split('\n').map((_, i) => (
                        <div key={i} className="text-right text-muted-foreground/50 font-mono"
                          style={{ fontSize: `${editorFontSize}px`, lineHeight: '1.625' }}>
                          {i + 1}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* 编辑区容器 */}
                <div className="relative flex-1 min-h-0 overflow-hidden bg-background">
                  <div ref={scrollContainerRef} onScroll={fsSyncScroll}
                    style={{ position: 'absolute', inset: 0, overflowY: 'scroll', overflowX: 'hidden' }}>
                    <div style={{ position: 'relative' }}>
                      <pre ref={highlightRef} aria-hidden="true"
                        style={{
                          margin: 0, padding: '0.75rem 1rem',
                          pointerEvents: 'none',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          fontSize: `${editorFontSize}px`, lineHeight: '1.625',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                          color: 'hsl(var(--foreground))', boxSizing: 'border-box',
                        }}>
                        {fsHighlightNodes}
                      </pre>
                      <textarea ref={textareaRef} value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={fsHandleEditorKeyDown}
                        spellCheck={false}
                        style={{
                          position: 'absolute', inset: 0, width: '100%', height: '100%',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          fontSize: `${editorFontSize}px`, lineHeight: '1.625',
                          padding: '0.75rem 1rem',
                          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                          resize: 'none', border: 'none', outline: 'none', borderRadius: 0,
                          background: 'transparent', color: 'transparent',
                          caretColor: 'hsl(var(--foreground))',
                          boxSizing: 'border-box', overflow: 'hidden',
                        }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* 底栏：提交 */}
              <div className="flex items-center gap-2 px-3 h-12 shrink-0 border-t border-border bg-card/95">
                <div className="flex-1 min-w-0">
                  <Input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)}
                    placeholder="提交信息（必填）..."
                    className="h-8 bg-secondary border-border text-foreground placeholder:text-muted-foreground text-sm" />
                </div>
                <Button variant="ghost" size="sm"
                  className="h-8 text-xs text-muted-foreground border border-border hover:bg-secondary shrink-0 px-3"
                  onClick={() => closeAction(true)}>
                  <X className="w-3 h-3 mr-1" />取消
                </Button>
                <Button size="sm" className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 px-3"
                  onClick={handleSaveEdit} disabled={actionBusy || !commitMsg.trim()}>
                  {actionBusy
                    ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />提交中...</>
                    : <><Save className="w-3 h-3 mr-1" />保存并提交</>}
                </Button>
              </div>
            </div>
          )}

          {/* 路径操作工具条（非编辑状态，或移动端编辑状态） */}
          <div className={`flex items-center gap-2 px-3 py-1.5 border-b border-border bg-secondary/20 shrink-0 ${actionMode === 'edit' ? 'md:hidden' : ''}`}>
            {filePath ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:bg-secondary gap-1 shrink-0 px-2"
                onClick={() => {
                  const parentParts = pathParts.slice(0, -1);
                  navigate(`/repos/${owner}/${repo}/code${parentParts.length > 0 ? '/' + parentParts.join('/') : ''}`);
                }}>
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">返回上级</span>
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground px-1 font-mono">/</span>
            )}
            <div className="flex-1" />
            {/* 目录操作按钮（仅目录页显示） */}
            {!currentFile && !loading && (
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground border border-border hover:bg-secondary gap-1 px-2"
                  onClick={() => openAction('new-file')}>
                  <FilePlus className="w-3 h-3" /><span className="hidden sm:inline">新建文件</span>
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground border border-border hover:bg-secondary gap-1 px-2"
                  onClick={() => openAction('new-folder')}>
                  <FolderPlus className="w-3 h-3" /><span className="hidden sm:inline">新建文件夹</span>
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground border border-border hover:bg-secondary gap-1 px-2"
                  onClick={() => openAction('upload')}>
                  <Upload className="w-3 h-3" /><span className="hidden sm:inline">上传</span>
                </Button>
              </div>
            )}
            {/* 文件查看时的操作栏 */}
            {currentFile && !loading && (
              <div className="flex items-center gap-1 shrink-0">
                {currentFile.download_url && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:bg-secondary gap-1 px-2"
                    title="下载文件"
                    onClick={async () => {
                      try { await downloadCodeFile(currentFile.download_url!, currentFile.name, token ?? ''); }
                      catch { toast.error('下载失败'); }
                    }}>
                    <Download className="w-3.5 h-3.5" /><span className="hidden sm:inline">下载</span>
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:bg-secondary gap-1 px-2"
                  title="复制路径"
                  onClick={() => { navigator.clipboard.writeText(currentFile.path); toast.success('路径已复制'); }}>
                  <ClipboardCopy className="w-3.5 h-3.5" /><span className="hidden md:inline">复制路径</span>
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:bg-secondary gap-1 px-2"
                  title="查看提交历史"
                  onClick={() => navigate(`/repos/${owner}/${repo}/commits/${currentBranch}?path=${currentFile.path}`)}>
                  <History className="w-3.5 h-3.5" /><span className="hidden md:inline">历史</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-secondary shrink-0">
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => { const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${currentBranch}/${currentFile.path}`; navigator.clipboard.writeText(rawUrl); toast.success('Raw 链接已复制'); }}>
                      <Link className="w-3.5 h-3.5 mr-2" />复制 Raw 链接
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => openAction('rename', currentFile)}>
                      <Pencil className="w-3.5 h-3.5 mr-2" />重命名
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openAction('move', currentFile)}>
                      <MoveRight className="w-3.5 h-3.5 mr-2" />移动到...
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => { setCommitMsg(`Delete ${currentFile.name}`); openAction('delete-file', currentFile); }}>
                      <Trash2 className="w-3.5 h-3.5 mr-2" />删除文件
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          {/* 内容区域（非编辑状态，或移动端） */}
          <div className={`flex-1 min-h-0 overflow-y-auto ${actionMode === 'edit' ? 'md:hidden' : ''}`}>
      <div className="bg-card border-x-0 overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-9 bg-muted rounded" />)}
          </div>
        ) : currentFile ? (
          /* 文件内容 */
          <div>
            {/* 图片预览 */}
            {currentIsImage && fileBase64 ? (
              <div>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
                  <div className="flex items-center gap-2">
                    <FileItemIcon filename={currentFile.name} isDir={false} size="w-4 h-4" />
                    <span className="text-sm font-mono text-foreground">{currentFile.name}</span>
                    <span className="text-xs text-muted-foreground">{formatFileSize(currentFile.size)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs border-border text-muted-foreground px-1.5 py-0 h-4 flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" />图片预览
                    </Badge>
                    {currentFile.download_url && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:bg-secondary h-8"
                        onClick={async () => {
                          try {
                            await downloadCodeFile(currentFile.download_url!, currentFile.name, token ?? '');
                          } catch {
                            toast.error('下载失败，请检查网络或权限');
                          }
                        }}
                      >
                        <Download className="w-3.5 h-3.5 mr-1" />下载
                      </Button>
                    )}
                  </div>
                </div>
                <div className="p-6 flex flex-col items-center gap-4">
                  <img
                    src={base64ToDataUri(fileBase64, currentFile.name)}
                    alt={currentFile.name}
                    className="max-w-full max-h-[60vh] object-contain rounded-lg border border-border shadow-md"
                  />
                  <p className="text-xs text-muted-foreground">
                    {currentFile.name} · {formatFileSize(currentFile.size)}
                  </p>
                </div>
              </div>
            ) : (
              /* 文本文件 - 移动端等待全屏编辑器打开时的占位 */
              <div className="flex md:hidden flex-col items-center justify-center py-16 gap-4">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <FileEdit className="w-6 h-6 text-primary animate-pulse" />
                  <span className="text-sm">正在打开编辑器...</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileItemIcon filename={currentFile.name} isDir={false} size="w-4 h-4" />
                  <span className="text-sm font-mono text-foreground/70">{currentFile.path}</span>
                </div>
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        ) : (
          /* 目录列表 */
          <div className="divide-y divide-border">
            {contents.length === 0 ? (
              <div className="py-12 text-center">
                <FolderOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">空目录</p>
                <Button variant="ghost" size="sm" className="mt-3 h-8 text-xs text-muted-foreground border border-border hover:bg-secondary"
                  onClick={() => openAction('new-file')}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />创建第一个文件
                </Button>
              </div>
            ) : (
              contents.map((item) => {
                const isDir = item.type === 'dir';
                return (
                  <ContextMenu key={item.sha}>
                    <ContextMenuTrigger asChild>
                      <div className="flex items-center group hover:bg-secondary/50 transition-colors cursor-pointer">
                        {/* 主点击区 */}
                        <button
                          type="button"
                          className="flex-1 flex items-center gap-3 px-4 py-2.5 text-left min-w-0"
                          onClick={() => navigate(`/repos/${owner}/${repo}/code/${item.path}`)}
                        >
                          <FileItemIcon filename={item.name} isDir={isDir} size="w-4 h-4" />
                          <span className={`text-sm font-mono flex-1 min-w-0 truncate ${isDir ? 'text-foreground font-medium' : 'text-foreground/90'} group-hover:text-primary transition-colors`}>
                            {item.name}
                          </span>
                          {item.size > 0 && (
                            <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                              {item.size < 1024 ? `${item.size} B` : `${(item.size / 1024).toFixed(1)} KB`}
                            </span>
                          )}
                        </button>
                        {/* Hover 快捷操作（桌面端 hover 显示，移动端靠右键菜单） */}
                        <div
                          className="hidden md:flex items-center gap-0.5 mr-2 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {!isDir && item.download_url && (
                            <Button variant="ghost" size="icon"
                              className="h-6 w-6 text-muted-foreground hover:bg-secondary hover:text-foreground"
                              title="下载"
                              onClick={async (e) => { e.stopPropagation(); try { await downloadCodeFile(item.download_url!, item.name, token ?? ''); } catch { toast.error('下载失败'); } }}>
                              <Download className="w-3 h-3" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon"
                            className="h-6 w-6 text-muted-foreground hover:bg-secondary hover:text-foreground"
                            title="复制路径"
                            onClick={(e) => { e.stopPropagation(); handleCopyPath(item.path); }}>
                            <ClipboardCopy className="w-3 h-3" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon"
                                className="h-6 w-6 text-muted-foreground hover:bg-secondary hover:text-foreground"
                                title="更多操作">
                                <MoreHorizontal className="w-3 h-3" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onClick={() => openAction('rename', item)}>
                                <Pencil className="w-3.5 h-3.5 mr-2" />重命名
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openAction('move', item)}>
                                <MoveRight className="w-3.5 h-3.5 mr-2" />移动到...
                              </DropdownMenuItem>
                              {!isDir && (
                                <DropdownMenuItem onClick={() => handleCopyRawLink(item.path)}>
                                  <Link className="w-3.5 h-3.5 mr-2" />复制 Raw 链接
                                </DropdownMenuItem>
                              )}
                              {!isDir && (
                                <DropdownMenuItem onClick={() => navigate(`/repos/${owner}/${repo}/commits/${currentBranch}?path=${item.path}`)}>
                                  <History className="w-3.5 h-3.5 mr-2" />查看历史
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => { setCommitMsg(`Delete ${item.name}`); openAction(isDir ? 'delete-folder' : 'delete-file', item); }}>
                                <Trash2 className="w-3.5 h-3.5 mr-2" />删除{isDir ? '文件夹' : '文件'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mr-3 group-hover:text-primary transition-colors md:group-hover:opacity-0" />
                      </div>
                    </ContextMenuTrigger>
                    {isDir
                      ? <FolderContextMenuContent item={item} />
                      : <FileContextMenuContent item={item} />
                    }
                  </ContextMenu>
                );
              })
            )}
          </div>
        )}
      </div>
          </div>{/* end overflow-y-auto */}
        </div>{/* end 右侧内容区 */}
      </div>{/* end 主体左右布局 */}

      {/* ── 新建文件对话框 ── */}
      <Dialog open={actionMode === 'new-file'} onOpenChange={(open) => { if (!open) closeAction(); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <FilePlus className="w-4 h-4 text-primary" />新建文件
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">文件名 *</Label>
              <Input value={newFileName} onChange={(e) => setNewFileName(e.target.value)} placeholder="example.txt"
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono" />
              {(() => { const d = pendingDirPath !== null ? pendingDirPath : filePath; return d ? <p className="text-xs text-muted-foreground">将在 <code className="font-mono bg-secondary px-1 rounded">{d}/</code> 目录下创建</p> : <p className="text-xs text-muted-foreground">将在根目录下创建</p>; })()}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">文件内容（可选）</Label>
              <Textarea value={newFileContent} onChange={(e) => setNewFileContent(e.target.value)}
                placeholder="在此输入文件内容..." rows={6}
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono text-xs resize-none" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">提交信息 *</Label>
              <Input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder={`Create ${newFileName || 'file'}`}
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="border border-border text-muted-foreground hover:bg-secondary" onClick={() => closeAction()}>取消</Button>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleCreateFile} disabled={actionBusy || !newFileName.trim()}>
              {actionBusy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />创建中...</> : <><FilePlus className="w-4 h-4 mr-2" />创建文件</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 新建文件夹对话框 ── */}
      <Dialog open={actionMode === 'new-folder'} onOpenChange={(open) => { if (!open) closeAction(); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <FolderPlus className="w-4 h-4 text-primary" />新建文件夹
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">文件夹名称 *</Label>
              <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="my-folder"
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono" />
              <p className="text-xs text-muted-foreground">会自动在文件夹内创建 <code className="font-mono bg-secondary px-1 rounded">.gitkeep</code> 占位文件</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">提交信息 *</Label>
              <Input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder={`Create folder ${newFolderName || 'folder'}`}
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="border border-border text-muted-foreground hover:bg-secondary" onClick={() => closeAction()}>取消</Button>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleCreateFolder} disabled={actionBusy || !newFolderName.trim()}>
              {actionBusy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />创建中...</> : <><FolderPlus className="w-4 h-4 mr-2" />创建文件夹</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 删除文件确认 ── */}
      <AlertDialog open={actionMode === 'delete-file'} onOpenChange={(open) => { if (!open) closeAction(); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">确认删除文件</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              将删除 <code className="font-mono text-foreground bg-secondary px-1.5 py-0.5 rounded">{actionTarget?.path}</code>，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2">
            <Label className="text-sm font-normal text-foreground">提交信息 *</Label>
            <Input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder={`Delete ${actionTarget?.name}`}
              className="mt-1.5 bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary" onClick={() => closeAction()}>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteFile} disabled={actionBusy || !commitMsg.trim()}>
              {actionBusy ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── 删除文件夹确认 ── */}
      <AlertDialog open={actionMode === 'delete-folder'} onOpenChange={(open) => { if (!open) closeAction(); }}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">确认删除文件夹</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              将递归删除 <code className="font-mono text-foreground bg-secondary px-1.5 py-0.5 rounded">{actionTarget?.path}</code> 下的所有文件，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-1 py-2 space-y-2">
            <div>
              <Label className="text-sm font-normal text-foreground">提交信息 *</Label>
              <Input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder={`Delete folder ${actionTarget?.name}`}
                className="mt-1.5 bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>
            {deleteProgress && (
              <p className="text-xs text-muted-foreground">正在删除... {deleteProgress.done}/{deleteProgress.total}</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border hover:bg-secondary" onClick={() => closeAction()}>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteFolder} disabled={actionBusy || !commitMsg.trim()}>
              {actionBusy ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />删除中...</> : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── 重命名对话框 ── */}
      <Dialog open={actionMode === 'rename'} onOpenChange={(open) => { if (!open) closeAction(); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground">重命名 {actionTarget?.type === 'dir' ? '文件夹' : '文件'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-muted-foreground">当前名称</Label>
              <p className="text-sm font-mono text-foreground bg-secondary rounded px-3 py-2">{actionTarget?.name}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">新名称 *</Label>
              <Input value={renameTo} onChange={(e) => setRenameTo(e.target.value)} placeholder="新名称..."
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">提交信息 *</Label>
              <Input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder={`Rename ${actionTarget?.name} to ${renameTo || '...'}`}
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="border border-border text-muted-foreground hover:bg-secondary" onClick={() => closeAction()}>取消</Button>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleRename}
              disabled={actionBusy || !renameTo.trim() || !commitMsg.trim()}>
              {actionBusy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />处理中...</> : '确认重命名'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 移动文件对话框 ── */}
      <Dialog open={actionMode === 'move'} onOpenChange={(open) => { if (!open) closeAction(); }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <MoveRight className="w-4 h-4 text-primary" />移动文件
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-muted-foreground">当前路径</Label>
              <p className="text-sm font-mono text-foreground bg-secondary rounded px-3 py-2">{actionTarget?.path}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">目标路径 *</Label>
              <Input value={moveTo} onChange={(e) => setMoveTo(e.target.value)} placeholder="src/new/location/file.txt"
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground font-mono" />
              <p className="text-xs text-muted-foreground">请输入完整路径（含文件名），如 <code className="font-mono">src/utils/helper.ts</code></p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">提交信息 *</Label>
              <Input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder={`Move ${actionTarget?.name}`}
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="border border-border text-muted-foreground hover:bg-secondary" onClick={() => closeAction()}>取消</Button>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleMove}
              disabled={actionBusy || !moveTo.trim() || !commitMsg.trim()}>
              {actionBusy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />移动中...</> : <><MoveRight className="w-4 h-4 mr-2" />确认移动</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 上传文件对话框 ── */}
      <Dialog open={actionMode === 'upload'} onOpenChange={(open) => { if (!open) { setActionMode(null); } }}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-2xl bg-card border-border max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" />上传文件到
              <code className="font-mono text-sm bg-secondary px-1.5 py-0.5 rounded">
                {filePath || '根目录'}
              </code>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-normal text-foreground">提交信息</Label>
              <Input value={uploadCommitMsg} onChange={(e) => setUploadCommitMsg(e.target.value)} placeholder="Upload files"
                className="bg-secondary border-border text-foreground placeholder:text-muted-foreground" />
            </div>

            <div className="flex items-center gap-2">
              <input id="skip-cb" type="checkbox" checked={skipExisting}
                onChange={(e) => setSkipExisting(e.target.checked)}
                className="w-4 h-4 accent-primary" />
              <label htmlFor="skip-cb" className="text-sm text-foreground cursor-pointer">跳过已存在的文件（不覆盖）</label>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); addUploadFiles(e.dataTransfer.files); }}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
              }`}
              onClick={() => uploadInputRef.current?.click()}
            >
              <input ref={uploadInputRef} type="file" multiple className="hidden"
                onChange={(e) => addUploadFiles(e.target.files)} />
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-foreground font-medium">点击或拖放文件到此处</p>
              <p className="text-xs text-muted-foreground mt-1">支持多文件，上传至当前路径</p>
            </div>

            {uploadFiles.length > 0 && (
              <div className="bg-secondary/40 border border-border rounded-xl overflow-hidden">
                <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="text-foreground font-medium">{uploadFiles.length} 个文件</span>
                    {uploadFiles.filter(f => f.status === 'pending').length > 0 &&
                      <Badge variant="outline" className="text-xs border-border text-muted-foreground">{uploadFiles.filter(f => f.status === 'pending').length} 待上传</Badge>}
                    {uploadFiles.filter(f => f.status === 'success').length > 0 &&
                      <Badge className="bg-success/10 text-success border-success/30 text-xs">{uploadFiles.filter(f => f.status === 'success').length} 成功</Badge>}
                    {uploadFiles.filter(f => f.status === 'error').length > 0 &&
                      <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs">{uploadFiles.filter(f => f.status === 'error').length} 失败</Badge>}
                  </div>
                  <div className="flex gap-1.5">
                    {uploadFiles.some(f => f.status === 'error') && (
                      <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:bg-secondary border border-border"
                        onClick={() => setUploadFiles(p => p.map(f => f.status === 'error' ? { ...f, status: 'pending', error: undefined } : f))}>
                        <RefreshCw className="w-3 h-3 mr-1" />重试
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:bg-secondary border border-border"
                      onClick={() => setUploadFiles([])}>清空</Button>
                  </div>
                </div>
                <div className="divide-y divide-border max-h-52 overflow-y-auto">
                  {uploadFiles.map((f) => (
                    <div key={f.id} className="flex items-center gap-2.5 px-3 py-2">
                      <div className="shrink-0">
                        {f.status === 'pending' && <FileItemIcon filename={f.file.name} isDir={false} size="w-4 h-4" />}
                        {f.status === 'uploading' && <Loader2 className="w-4 h-4 text-warning animate-spin" />}
                        {f.status === 'success' && <CheckCircle2 className="w-4 h-4 text-success" />}
                        {f.status === 'error' && <XCircle className="w-4 h-4 text-destructive" />}
                        {f.status === 'skipped' && <AlertCircle className="w-4 h-4 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-foreground truncate">{f.file.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(f.file.size)}</span>
                        </div>
                        <input type="text" value={f.targetPath}
                          onChange={(e) => setUploadFiles(p => p.map(x => x.id === f.id ? { ...x, targetPath: e.target.value } : x))}
                          disabled={f.status !== 'pending' && f.status !== 'error'}
                          className="w-full mt-0.5 text-xs font-mono bg-transparent border-0 border-b border-dashed border-border/60 focus:outline-none focus:border-primary text-muted-foreground disabled:opacity-50 px-0"
                          placeholder="目标路径..." />
                        {f.error && <p className="text-xs text-destructive mt-0.5">{f.error}</p>}
                        {f.status === 'skipped' && <p className="text-xs text-muted-foreground mt-0.5">文件已存在，已跳过</p>}
                      </div>
                      {(f.status === 'pending' || f.status === 'error') && (
                        <Button variant="ghost" size="icon" className="w-6 h-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                          onClick={() => setUploadFiles(p => p.filter(x => x.id !== f.id))}>
                          <X className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {uploading && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>上传中...</span><span>{uploadProgress}%</span>
                </div>
                <Progress value={uploadProgress} className="h-1.5" />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" className="border border-border text-muted-foreground hover:bg-secondary"
              onClick={() => setActionMode(null)}>关闭</Button>
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={handleUpload}
              disabled={uploading || uploadFiles.filter(f => f.status === 'pending' || f.status === 'error').length === 0}>
              {uploading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />上传中...</>
                : <><Upload className="w-4 h-4 mr-2" />提交上传（{uploadFiles.filter(f => f.status === 'pending' || f.status === 'error').length} 个）</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
