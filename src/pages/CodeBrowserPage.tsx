// 代码浏览页（含在线编辑 + 文件树 + 右键上下文菜单 + 全屏编辑 + 文件图标 + 图片预览）

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import FileTree from '@/components/code/FileTree';
import MarkdownRenderer from '@/components/common/MarkdownRenderer';
import { CodeEditor } from '@/components/code/CodeEditor';
import type { CodeEditorRef } from '@/components/code/CodeEditor';
import { EditorSearchPanel } from '@/components/code/EditorSearchPanel';
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
  TerminalSquare,
  Maximize2,
  Minimize2,
  Undo2,
  Redo2,
  Menu,
  BookOpen,
  WrapText,
  MessageSquare,
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
import { decodeBase64Content, copyToClipboard } from '@/lib/utils';
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

export interface EditorSyntaxError {
  line: number;
  column: number;
  message: string;
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

// ── 代码浏览页面内导航栈（sessionStorage，标签页级）────────────────────────
// 用于在点击面包屑时回溯 browser history，而非推入新条目（避免"返回"跳到错误位置）
function codeNavKey(owner: string, repo: string) {
  return `code_nav_${owner}_${repo}`;
}
function getCodeNavStack(owner: string, repo: string): string[] {
  try { return JSON.parse(sessionStorage.getItem(codeNavKey(owner, repo)) || '[]'); }
  catch { return []; }
}
function setCodeNavStack(owner: string, repo: string, stack: string[]) {
  try { sessionStorage.setItem(codeNavKey(owner, repo), JSON.stringify(stack)); }
  catch { /* ignore */ }
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
  const [isReadingMode, setIsReadingMode] = useState(false);

  // 编辑器显示选项
  const [editorFontSize, setEditorFontSize] = useState(14);   // px，范围 10-22

  // 编辑器搜索面板状态
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [cursorPosition, setCursorPosition] = useState('1:1');
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>(
    window.innerWidth < 768 ? 'on' : 'off'
  );
  
  // 语法错误状态
  const [syntaxErrors, setSyntaxErrors] = useState<EditorSyntaxError[]>([]);
  const [showSyntaxWarning, setShowSyntaxWarning] = useState(false);

  // 编辑器搜索
  const editorRef = useRef<CodeEditorRef | null>(null);

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
            setEditorFullscreen(window.innerWidth < 768);
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

  // ── 导航栈同步：每次 filePath 变化时更新 sessionStorage 导航栈 ───────────────
  // 这样面包屑点击时可以通过 navigate(-n) 回溯，而不是 push 新条目
  useEffect(() => {
    if (!owner || !repo) return;
    const fullPath = `/repos/${owner}/${repo}/code${filePath ? '/' + filePath : ''}`;
    const stack = getCodeNavStack(owner, repo);
    // 如果目标已在栈中（用户用浏览器返回/前进），截断到该点以保持同步
    const existingIdx = stack.lastIndexOf(fullPath);
    if (existingIdx >= 0) {
      setCodeNavStack(owner, repo, stack.slice(0, existingIdx + 1));
    } else {
      setCodeNavStack(owner, repo, [...stack, fullPath]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, filePath]);

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
  const handleSaveEdit = async (force = false) => {
    if (!owner || !repo || !currentFile || !commitMsg.trim()) { toast.error('请填写提交信息'); return; }
    if (syntaxErrors.length > 0 && !force) {
      setShowSyntaxWarning(true);
      return;
    }
    setShowSyntaxWarning(false);
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
    copyToClipboard(path);
    toast.success('路径已复制');
  };

  const handleCopyRawLink = (path: string) => {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${currentBranch}/${path}`;
    copyToClipboard(rawUrl);
    toast.success('Raw 链接已复制');
  };

  const pathParts = filePath ? filePath.split('/') : [];

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
  // 编辑器打开时聚焦
  useEffect(() => {
    if (actionMode === 'edit') {
      const timer = setTimeout(() => editorRef.current?.focus(), 80);
      return () => clearTimeout(timer);
    }
  }, [actionMode]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background text-foreground">
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ─── 桌面端：Activity Bar ─── */}
        <div className="hidden md:flex flex-col w-12 border-r border-border bg-sidebar shrink-0 items-center py-3 gap-4 z-10">
        <Button variant="ghost" size="icon" className={`w-10 h-10 rounded-xl ${treeVisible ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setTreeVisible(true)} title="资源管理器">
          <FolderOpen className="w-5 h-5" />
        </Button>
        <Button variant="ghost" size="icon" className="w-10 h-10 rounded-xl text-muted-foreground hover:text-foreground" onClick={() => setShowSearchPanel(true)} title="搜索">
          <Search className="w-5 h-5" />
        </Button>
        <div className="mt-auto mb-2 flex flex-col gap-4">
          <Button variant="ghost" size="icon" className="w-10 h-10 rounded-xl text-muted-foreground hover:text-foreground" onClick={() => navigate('/repos')} title="返回仓库列表">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* ─── 主体内容区布局 ─── */}
      <div className="flex flex-1 min-w-0 h-full overflow-hidden flex-col md:flex-row">
        
        {/* === 原顶部结构变身为内容区头部 === */}
        <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-border bg-card/80 shrink-0 min-h-[44px]">
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
          {/* 移动端保留面包屑等 */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground flex-1 min-w-0 overflow-x-auto whitespace-nowrap scrollbar-none">
          <button type="button" className="hover:text-primary transition-colors shrink-0" onClick={() => navigate('/repos')}>仓库</button>
          <ChevronRight className="w-3 h-3 shrink-0" />
          <button type="button" className="hover:text-primary transition-colors shrink-0 max-w-[120px] truncate" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
          <ChevronRight className="w-3 h-3 shrink-0" />
          <button type="button" className="hover:text-primary transition-colors shrink-0" onClick={() => navigate(`/repos/${owner}/${repo}/code`)}>代码</button>
          {pathParts.map((part, i) => {
            // 渲染时预计算目标路径字符串，onClick 绑定不可变常量，消除闭包时序问题
            const targetPath = pathParts.slice(0, i + 1).join('/');
            const targetFullPath = `/repos/${owner}/${repo}/code/${targetPath}`;
            const isLast = i === pathParts.length - 1;
            // 面包屑跳转：若目标路径已在导航栈中，使用 navigate(-n) 回溯历史，
            // 而非 push 新条目；这样返回键能正确回到上一个位置
            const handleBreadcrumbClick = () => {
              const stack = getCodeNavStack(owner!, repo!);
              const targetIdx = stack.lastIndexOf(targetFullPath);
              const currentIdx = stack.length - 1;
              if (targetIdx >= 0 && targetIdx < currentIdx) {
                navigate(targetIdx - currentIdx); // 负数 = 回溯 N 步
              } else {
                navigate(targetFullPath); // 历史中没有则正常 push
              }
            };
            return (
              <span key={targetPath} className="flex items-center gap-1 shrink-0">
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
                <button
                  type="button"
                  className={`text-sm ${isLast ? 'text-foreground font-medium cursor-default' : 'text-primary hover:underline cursor-pointer'}`}
                  onClick={isLast ? undefined : handleBreadcrumbClick}
                >
                  {part}
                </button>
              </span>
            );
          })}
        </div>

        {/* 移动端：分支切换按钮 */}
        {branches.length > 0 && currentBranch && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="md:hidden h-7 px-2 text-xs gap-1 border-border hover:bg-secondary shrink-0 max-w-[110px]"
                title="切换分支"
              >
                <GitBranch className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="truncate font-mono">{currentBranch}</span>
                <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 max-h-64 overflow-y-auto">
              {branches.map((b) => (
                <DropdownMenuItem
                  key={b.name}
                  onClick={() => setCurrentBranch(b.name)}
                  className={`font-mono text-xs gap-2 ${b.name === currentBranch ? 'text-primary font-semibold' : ''}`}
                >
                  <GitBranch className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1">{b.name}</span>
                  {b.name === currentBranch && (
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* 桌面端：当前分支显示（只读，切换在文件树里） */}
        {currentBranch && (
          <Badge variant="outline" className="border-border text-muted-foreground hidden md:flex items-center gap-1 h-6 text-xs shrink-0">
            <GitBranch className="w-3 h-3" />{currentBranch}
          </Badge>
        )}

        </div>

        {/* ─── 主体结构 (Sidebar + Main) ─── */}
        <div className="flex flex-1 min-w-0 h-full overflow-hidden">
          
          {/* 桌面端固定侧边树 */}
          {treeVisible && (
            <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-border bg-sidebar overflow-hidden flex-1">
              <div className="h-10 px-4 flex items-center justify-between border-b border-border shrink-0">
                <span className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">资源管理器</span>
                <Button variant="ghost" size="icon" className="w-6 h-6 text-muted-foreground hover:bg-secondary" onClick={() => setTreeVisible(false)} title="收起侧边栏">
                  <PanelLeftClose className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
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
          </div>
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

        {/* ─── 主内容区 ─── */}
        <div className="flex-1 min-w-0 flex flex-col h-full bg-background relative overflow-hidden">
          
          {/* 桌面端 Editor Tabs */}
          {filePath && (
            <div className="hidden md:flex flex-col shrink-0">
              <div className="flex items-end px-2 pt-2 h-9 bg-muted/30">
                <div className="flex items-center gap-2 px-3 h-7 bg-background border-t border-x border-border rounded-t-sm text-sm text-foreground shrink-0 cursor-pointer min-w-[120px] max-w-[200px]">
                  <FileItemIcon filename={currentFile?.name ?? ''} isDir={false} size="w-4 h-4" />
                  <span className="truncate flex-1">{currentFile?.name}</span>
                  <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-full p-0.5" onClick={(e) => { e.stopPropagation(); closeAction(true); }} />
                </div>
              </div>
              <div className="flex items-center px-4 h-7 border-b border-border bg-background text-xs text-muted-foreground shrink-0 overflow-x-auto whitespace-nowrap scrollbar-none">
                <span className="hover:text-foreground cursor-pointer" onClick={() => navigate('/repos')}>仓库</span>
                <ChevronRight className="w-3 h-3 mx-1 opacity-50" />
                <span className="hover:text-foreground cursor-pointer" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</span>
                <ChevronRight className="w-3 h-3 mx-1 opacity-50" />
                <span className="hover:text-foreground cursor-pointer" onClick={() => navigate(`/repos/${owner}/${repo}/code`)}>代码</span>
                {pathParts.map((part, i) => {
                  const targetPath = pathParts.slice(0, i + 1).join('/');
                  const targetFullPath = `/repos/${owner}/${repo}/code/${targetPath}`;
                  const isLast = i === pathParts.length - 1;
                  const handleBreadcrumbClick = () => {
                    const stack = getCodeNavStack(owner!, repo!);
                    const targetIdx = stack.lastIndexOf(targetFullPath);
                    const currentIdx = stack.length - 1;
                    if (targetIdx >= 0 && targetIdx < currentIdx) {
                      navigate(targetIdx - currentIdx);
                    } else {
                      navigate(targetFullPath);
                    }
                  };
                  return (
                    <span key={targetPath} className="flex items-center shrink-0">
                      <ChevronRight className="w-3 h-3 mx-1 opacity-50" />
                      <span
                        className={`${isLast ? 'text-foreground font-medium' : 'hover:text-foreground cursor-pointer'}`}
                        onClick={isLast ? undefined : handleBreadcrumbClick}
                      >
                        {part}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* 统一编辑器区域 */}
          {actionMode === 'edit' && (
            <div className={`flex flex-col bg-background ${editorFullscreen ? 'fixed inset-0 z-50' : 'hidden md:flex flex-1 min-h-0'}`}>
              {/* 编辑器顶栏 */}
              {!isReadingMode && (
                <div className="flex flex-col">
                  {/* 移动端工具栏 */}
                  <div className="flex md:hidden items-center justify-between px-2 h-12 bg-[#2d2d2d] text-white shrink-0 border-b border-white/10">
                    <Button variant="ghost" size="icon" className="w-10 h-10 text-white hover:bg-white/10" onClick={() => closeAction(true)} title="返回">
                      <ArrowLeft className="w-5 h-5" />
                    </Button>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="w-9 h-9 text-white hover:bg-white/10" onClick={() => editorRef.current?.undo()} title="撤销">
                        <Undo2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-9 h-9 text-white hover:bg-white/10" onClick={() => editorRef.current?.redo()} title="重做">
                        <Redo2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-9 h-9 text-white hover:bg-white/10" onClick={() => setShowSearchPanel(true)} title="搜索/替换">
                        <Search className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-9 h-9 text-white hover:bg-white/10" onClick={() => setIsReadingMode(true)} title="阅读模式">
                        <BookOpen className="w-4 h-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="w-9 h-9 text-white hover:bg-white/10" title="更多">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56 bg-[#2d2d2d] text-white border-white/10" onCloseAutoFocus={(e) => e.preventDefault()}>
                          <div className="flex items-center justify-between px-2 py-1.5">
                            <span className="text-sm">字号</span>
                            <div className="flex items-center gap-1">
                              <Button variant="ghost" size="icon" className="w-7 h-7 hover:bg-white/10"
                                onClick={(e) => { e.preventDefault(); setEditorFontSize(s => Math.max(10, s - 1)); }} disabled={editorFontSize <= 10}>
                                <ZoomOut className="w-4 h-4" />
                              </Button>
                              <span className="text-sm w-6 text-center tabular-nums">{editorFontSize}</span>
                              <Button variant="ghost" size="icon" className="w-7 h-7 hover:bg-white/10"
                                onClick={(e) => { e.preventDefault(); setEditorFontSize(s => Math.min(22, s + 1)); }} disabled={editorFontSize >= 22}>
                                <ZoomIn className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                          <DropdownMenuSeparator className="bg-white/10" />
                          <DropdownMenuItem className="focus:bg-white/10 focus:text-white" onSelect={() => { setWordWrap(w => w === 'on' ? 'off' : 'on'); }}>
                            <WrapText className="w-4 h-4 mr-2" />
                            {wordWrap === 'on' ? '取消自动换行' : '自动换行'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-white/10" />
                          <DropdownMenuItem className="focus:bg-white/10 focus:text-white" onSelect={() => { copyToClipboard(editContent); toast.success('代码已复制'); }}>
                            <Copy className="w-4 h-4 mr-2" />复制内容
                          </DropdownMenuItem>
                          {currentFile?.download_url && (
                            <DropdownMenuItem className="focus:bg-white/10 focus:text-white" onSelect={async () => { try { await downloadCodeFile(currentFile.download_url!, currentFile.name, token ?? ''); } catch { toast.error('下载失败'); } }}>
                              <Download className="w-4 h-4 mr-2" />下载文件
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {/* 移动端文件信息栏 */}
                  <div className="flex md:hidden items-center justify-between px-3 h-8 bg-[#1e1e1e] text-gray-400 text-xs shrink-0 font-mono">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="truncate text-white">{editContent !== currentFile?.content ? '*' : ''}{currentFile?.name}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span>{cursorPosition}</span>
                      <span>UTF-8</span>
                    </div>
                  </div>

                  {/* 桌面端工具栏 */}
                  <div className="hidden md:flex items-center gap-2 px-3 h-11 shrink-0 border-b border-border bg-card/95">
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
                    <Button variant='ghost' size="icon"
                      className="w-7 h-7 text-muted-foreground hover:bg-secondary hidden md:flex"
                      onClick={() => { editorRef.current?.undo(); }}
                      title="撤销 (Ctrl+Z)">
                      <Undo2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant='ghost' size="icon"
                      className="w-7 h-7 text-muted-foreground hover:bg-secondary hidden md:flex"
                      onClick={() => { editorRef.current?.redo(); }}
                      title="重做 (Ctrl+Y)">
                      <Redo2 className="w-3.5 h-3.5" />
                    </Button>
                    <div className="w-px h-4 bg-border shrink-0 hidden md:block mx-0.5" />
                    <Button variant='ghost' size="icon"
                      className="w-7 h-7 text-muted-foreground hover:bg-secondary"
                      onClick={() => setShowSearchPanel(!showSearchPanel)}
                      title="搜索 (Ctrl+F)">
                      <Search className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant='ghost' size="icon"
                      className="w-7 h-7 text-muted-foreground hover:bg-secondary hidden md:flex"
                      onClick={() => setEditorFullscreen(!editorFullscreen)}
                      title={editorFullscreen ? "退出全屏" : "全屏模式"}>
                      {editorFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    </Button>
                    <Button variant='ghost' size="icon"
                      className="w-7 h-7 text-muted-foreground hover:bg-secondary md:hidden"
                      onClick={() => setIsReadingMode(!isReadingMode)}
                      title={isReadingMode ? "退出阅读模式" : "阅读模式"}>
                      {isReadingMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:bg-secondary">
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48" onCloseAutoFocus={(e) => e.preventDefault()}>
                        <div className="flex items-center justify-between px-2 py-1.5">
                          <span className="text-xs text-muted-foreground">字号</span>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="w-6 h-6 hover:bg-secondary"
                              onClick={(e) => { e.preventDefault(); setEditorFontSize(s => Math.max(10, s - 1)); }} disabled={editorFontSize <= 10}>
                              <ZoomOut className="w-3 h-3" />
                            </Button>
                            <span className="text-xs w-5 text-center tabular-nums">{editorFontSize}</span>
                            <Button variant="ghost" size="icon" className="w-6 h-6 hover:bg-secondary"
                              onClick={(e) => { e.preventDefault(); setEditorFontSize(s => Math.min(22, s + 1)); }} disabled={editorFontSize >= 22}>
                              <ZoomIn className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        <DropdownMenuItem onSelect={() => setShowSearchPanel(true)}>
                          <Search className="w-3.5 h-3.5 mr-2" />搜索 / 替换
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => { copyToClipboard(editContent); toast.success('代码已复制'); }}>
                          <Copy className="w-3.5 h-3.5 mr-2" />复制内容
                        </DropdownMenuItem>
                        {currentFile?.download_url && (
                          <DropdownMenuItem onSelect={async () => { try { await downloadCodeFile(currentFile.download_url!, currentFile.name, token ?? ''); } catch { toast.error('下载失败'); } }}>
                            <Download className="w-3.5 h-3.5 mr-2" />下载文件
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <div className="w-px h-4 bg-border shrink-0 mx-0.5" />
                    <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:bg-secondary"
                      onClick={() => closeAction(true)} title="关闭编辑器">
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {/* 桌面端工具栏闭合 */}
                  </div>
                </div>
              )}

              {/* 代码编辑区 */}
              <div className="relative flex-1 min-h-0 flex overflow-hidden">
                {isReadingMode ? (
                  <div className="w-full h-full overflow-y-auto bg-background p-4 md:p-6" style={{ fontSize: editorFontSize }}>
                    <style>{`.reading-mode-markdown pre code { font-size: inherit !important; } .reading-mode-markdown pre { margin: 0; min-height: 100%; border: none; background: transparent; }`}</style>
                    <MarkdownRenderer 
                      content={`\`\`\`${currentFile?.name?.split('.').pop() || 'text'}\n${editContent}\n\`\`\``}
                      className="max-w-none font-mono reading-mode-markdown"
                    />
                  </div>
                ) : (
                  <CodeEditor
                    key={currentFile?.path || currentFile?.name || 'editor'}
                    ref={editorRef}
                    value={editContent}
                    onChange={setEditContent}
                    fileName={currentFile?.name || ''}
                    fontSize={editorFontSize}
                    wordWrap={wordWrap}
                    onFontSizeChange={setEditorFontSize}
                    onSearch={() => setShowSearchPanel(true)}
                    onCursorChange={setCursorPosition}
                  />
                )}
                
                <EditorSearchPanel 
                  view={editorRef.current?.getView() ?? null} 
                  content={editContent}
                  visible={showSearchPanel} 
                  onClose={() => setShowSearchPanel(false)}
                  readOnly={isReadingMode}
                />

                <AlertDialog open={showSyntaxWarning} onOpenChange={setShowSyntaxWarning}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-destructive" />
                        存在语法错误
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        当前代码存在 {syntaxErrors.length} 个语法错误。是否仍要强行保存？
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>返回修改</AlertDialogCancel>
                      <AlertDialogAction onClick={() => {
                        handleSaveEdit(true);
                      }}>强行保存</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                
                {/* 阅读模式悬浮退出按钮 */}
                {isReadingMode && (
                  <Button
                    variant="secondary"
                    size="icon"
                    className="absolute top-4 right-4 z-50 rounded-full shadow-lg h-10 w-10 opacity-80 hover:opacity-100 bg-background border border-border md:hidden"
                    onClick={() => setIsReadingMode(false)}
                    title="退出阅读模式"
                  >
                    <Minimize2 className="w-5 h-5 text-foreground" />
                  </Button>
                )}
              </div>


              {/* 底栏：提交 */}
              {!isReadingMode && (
                <div className="flex flex-col shrink-0 border-t border-border bg-card/95">
                  {syntaxErrors.length > 0 && (
                    <div className="px-3 py-1.5 bg-destructive/10 border-b border-destructive/20 text-xs text-destructive max-h-24 overflow-y-auto">
                      <div className="font-semibold mb-1 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" />发现 {syntaxErrors.length} 个语法错误：</div>
                      <ul className="list-disc list-inside pl-4 space-y-0.5">
                        {syntaxErrors.map((err, i) => (
                          <li key={i}>[{err.line}:{err.column}] {err.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex items-center gap-2 px-3 h-12">
                    <div className="flex-1 min-w-0">
                      <Input value={commitMsg} onChange={(e) => {
                        setCommitMsg(e.target.value);
                        setShowSyntaxWarning(false);
                      }}
                      placeholder="提交信息（必填）..."
                      className="h-8 bg-secondary border-border text-foreground placeholder:text-muted-foreground text-sm" />
                  </div>
                  <Button variant="ghost" size="sm"
                    className="h-8 text-xs text-muted-foreground border border-border hover:bg-secondary shrink-0 px-3"
                    onClick={() => closeAction(true)}>
                    <X className="w-3 h-3 mr-1" />取消
                  </Button>
                  <Button size="sm" className={`h-8 text-xs shrink-0 px-3 ${syntaxErrors.length > 0 ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}
                    onClick={() => handleSaveEdit()} disabled={actionBusy || !commitMsg.trim()}>
                    {actionBusy
                      ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />提交中...</>
                      : <><Save className="w-3 h-3 mr-1" />保存并提交</>}
                  </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 路径操作工具条（非编辑状态，或移动端编辑状态） */}
          <div className={`flex items-center gap-2 px-3 py-1.5 border-b border-border bg-secondary/20 shrink-0 ${actionMode === 'edit' ? 'md:hidden' : ''}`}>
            {filePath ? (
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:bg-secondary gap-1 shrink-0 px-2"
                onClick={() => {
                  // 优先 navigate(-1) 回溯 browser history，回到实际进入此路径的上一页；
                  // 若导航栈少于 2 条（直接访问的 URL），则退回计算的父目录
                  const stack = getCodeNavStack(owner!, repo!);
                  if (stack.length >= 2) {
                    navigate(-1);
                  } else {
                    const parentParts = pathParts.slice(0, -1);
                    navigate(`/repos/${owner}/${repo}/code${parentParts.length > 0 ? '/' + parentParts.join('/') : ''}`);
                  }
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
                  onClick={() => { copyToClipboard(currentFile.path); toast.success('路径已复制'); }}>
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
                    <DropdownMenuItem onClick={() => { const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${currentBranch}/${currentFile.path}`; copyToClipboard(rawUrl); toast.success('Raw 链接已复制'); }}>
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
      </div>
      
      {/* 桌面端 Status Bar */}
      <div className="hidden md:flex items-center justify-between px-3 h-6 border-t border-border bg-[#007acc] text-white text-[10px] shrink-0 font-mono z-20">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1 cursor-pointer hover:bg-white/20 px-1 py-0.5 rounded transition-colors"><GitBranch className="w-3 h-3"/> {currentBranch}</span>
          {syntaxErrors.length > 0 && <span className="flex items-center gap-1 cursor-pointer hover:bg-white/20 px-1 py-0.5 rounded transition-colors"><AlertCircle className="w-3 h-3"/> {syntaxErrors.length}</span>}
        </div>
        <div className="flex items-center gap-4">
          {actionMode === 'edit' && <span className="cursor-pointer hover:bg-white/20 px-1 py-0.5 rounded transition-colors">{cursorPosition}</span>}
          <span className="cursor-pointer hover:bg-white/20 px-1 py-0.5 rounded transition-colors">UTF-8</span>
          <span className="cursor-pointer hover:bg-white/20 px-1 py-0.5 rounded transition-colors">TypeScript React</span>
          <span className="cursor-pointer hover:bg-white/20 px-1 py-0.5 rounded transition-colors">Spaces: 2</span>
        </div>
      </div>
    </div>
    </div>
  );
}
