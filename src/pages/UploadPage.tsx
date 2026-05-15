// 批量上传本地文件到 GitHub 仓库

import { useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Upload,
  X,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  FolderOpen,
  GitCommit,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createFileContent,
  updateFileContent,
  getFileInfo,
  getRepoBranches,
} from '@/services/github';
import { toast } from 'sonner';

interface UploadFile {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error' | 'skipped';
  error?: string;
  targetPath?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result 形如 "data:text/plain;base64,xxxx"
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

export default function UploadPage() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const [files, setFiles] = useState<UploadFile[]>([]);
  const [branch, setBranch] = useState('main');
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branchLoaded, setBranchLoaded] = useState(false);
  const [targetDir, setTargetDir] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [skipExisting, setSkipExisting] = useState(false);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles: UploadFile[] = Array.from(fileList).map((f) => ({
      id: `${f.name}-${f.lastModified}-${Math.random()}`,
      file: f,
      status: 'pending',
      targetPath: (targetDir ? `${targetDir.replace(/\/$/, '')}/` : '') + f.name,
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  }, [targetDir]);

  const loadBranches = async () => {
    if (!owner || !repo || branchLoaded) return;
    setLoadingBranches(true);
    try {
      const data = await getRepoBranches(owner, repo);
      const names = data.map((b) => b.name);
      setBranches(names);
      // 设置默认分支
      const defaultBranch = names.find((n) => n === 'main') || names.find((n) => n === 'master') || names[0];
      if (defaultBranch) setBranch(defaultBranch);
      setBranchLoaded(true);
    } catch {
      toast.error('加载分支列表失败');
    } finally {
      setLoadingBranches(false);
    }
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const updateFilePath = (id: string, path: string) => {
    setFiles((prev) => prev.map((f) => f.id === id ? { ...f, targetPath: path } : f));
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleUpload = async () => {
    if (!owner || !repo) return;
    if (files.length === 0) { toast.error('请先选择要上传的文件'); return; }
    const pendingFiles = files.filter((f) => f.status === 'pending' || f.status === 'error');
    if (pendingFiles.length === 0) { toast.error('没有待上传的文件'); return; }
    if (!commitMsg.trim()) { toast.error('请填写提交信息'); return; }
    if (!branch.trim()) { toast.error('请选择目标分支'); return; }

    setUploading(true);
    setProgress(0);
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (let i = 0; i < pendingFiles.length; i++) {
      const f = pendingFiles[i];
      const targetPath = (f.targetPath || f.file.name).replace(/^\/+/, '');
      if (!targetPath) {
        setFiles((prev) => prev.map((x) => x.id === f.id ? { ...x, status: 'error', error: '路径不能为空' } : x));
        failCount++;
        continue;
      }

      setFiles((prev) => prev.map((x) => x.id === f.id ? { ...x, status: 'uploading' } : x));
      try {
        const base64 = await fileToBase64(f.file);
        // 检查文件是否已存在（用于判断 create 或 update）
        const existingFile = await getFileInfo(owner, repo, targetPath, branch);

        if (existingFile && skipExisting) {
          setFiles((prev) => prev.map((x) => x.id === f.id ? { ...x, status: 'skipped' } : x));
          skipCount++;
        } else if (existingFile) {
          await updateFileContent(owner, repo, targetPath, {
            message: commitMsg,
            content: base64,
            sha: existingFile.sha,
            branch,
          });
          setFiles((prev) => prev.map((x) => x.id === f.id ? { ...x, status: 'success' } : x));
          successCount++;
        } else {
          await createFileContent(owner, repo, targetPath, {
            message: commitMsg,
            content: base64,
            branch,
          });
          setFiles((prev) => prev.map((x) => x.id === f.id ? { ...x, status: 'success' } : x));
          successCount++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '上传失败';
        setFiles((prev) => prev.map((x) => x.id === f.id ? { ...x, status: 'error', error: msg } : x));
        failCount++;
      }
      setProgress(Math.round(((i + 1) / pendingFiles.length) * 100));
    }

    setUploading(false);
    const parts = [
      successCount > 0 && `${successCount} 个成功`,
      skipCount > 0 && `${skipCount} 个已跳过`,
      failCount > 0 && `${failCount} 个失败`,
    ].filter(Boolean).join('，');
    if (failCount === 0) toast.success(`上传完成：${parts}`);
    else toast.warning(`上传完成：${parts}`);
  };

  const retryFailed = () => {
    setFiles((prev) => prev.map((f) => f.status === 'error' ? { ...f, status: 'pending', error: undefined } : f));
  };

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const successCount = files.filter((f) => f.status === 'success').length;
  const errorCount = files.filter((f) => f.status === 'error').length;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      {/* 面包屑 */}
      {owner && repo && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
          <button type="button" className="hover:text-accent" onClick={() => navigate('/repos')}>仓库</button>
          <ChevronRight className="w-3 h-3" />
          <button type="button" className="hover:text-accent" onClick={() => navigate(`/repos/${owner}/${repo}`)}>{owner}/{repo}</button>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground">批量上传</span>
        </div>
      )}

      <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
        <Upload className="w-5 h-5 text-primary" />
        批量上传文件
      </h1>

      {/* 配置区 */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 目标分支 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-normal text-foreground">目标分支</Label>
            <div className="flex gap-2">
              {branches.length > 0 ? (
                <Select value={branch} onValueChange={setBranch}>
                  <SelectTrigger className="bg-secondary border-border text-foreground h-9 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {branches.map((b) => (
                      <SelectItem key={b} value={b} className="text-foreground text-sm">{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className="bg-secondary border-border text-foreground placeholder:text-muted-foreground flex-1 h-9"
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground border border-border hover:bg-secondary shrink-0"
                onClick={loadBranches}
                disabled={loadingBranches}
                title="加载分支列表"
              >
                {loadingBranches ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </Button>
            </div>
          </div>
          {/* 目标目录 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-normal text-foreground">上传目录（可选）</Label>
            <Input
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
              placeholder="如 src/assets 或留空上传到根目录"
              className="bg-secondary border-border text-foreground placeholder:text-muted-foreground h-9"
            />
          </div>
        </div>
        {/* 提交信息 */}
        <div className="space-y-1.5">
          <Label className="text-sm font-normal text-foreground">提交信息 *</Label>
          <Textarea
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder="上传文件..."
            className="bg-secondary border-border text-foreground placeholder:text-muted-foreground resize-none min-h-14"
          />
        </div>
        {/* 跳过已存在 */}
        <div className="flex items-center gap-2">
          <input
            id="skip-existing"
            type="checkbox"
            checked={skipExisting}
            onChange={(e) => setSkipExisting(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
          <label htmlFor="skip-existing" className="text-sm text-foreground cursor-pointer">
            跳过已存在的文件（不覆盖）
          </label>
        </div>
      </div>

      {/* 拖放区 */}
      <div
        ref={dropRef}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
        }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <FolderOpen className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-foreground font-medium">点击或拖放文件到此处</p>
        <p className="text-sm text-muted-foreground mt-1">支持多文件选择，最多 100 个文件</p>
      </div>

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 text-sm flex-wrap">
              <span className="text-foreground font-medium">{files.length} 个文件</span>
              {pendingCount > 0 && <Badge variant="outline" className="text-xs border-border text-muted-foreground">{pendingCount} 待上传</Badge>}
              {successCount > 0 && <Badge className="bg-success/10 text-success border-success/30 text-xs">{successCount} 成功</Badge>}
              {errorCount > 0 && <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs">{errorCount} 失败</Badge>}
            </div>
            <div className="flex gap-2">
              {errorCount > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground border border-border hover:bg-secondary" onClick={retryFailed}>
                  <RefreshCw className="w-3 h-3 mr-1" />重试失败
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground border border-border hover:bg-secondary" onClick={() => setFiles([])}>
                清空列表
              </Button>
            </div>
          </div>
          <div className="divide-y divide-border max-h-72 overflow-y-auto">
            {files.map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                {/* 状态图标 */}
                <div className="shrink-0">
                  {f.status === 'pending' && <FileText className="w-4 h-4 text-muted-foreground" />}
                  {f.status === 'uploading' && <Loader2 className="w-4 h-4 text-warning animate-spin" />}
                  {f.status === 'success' && <CheckCircle2 className="w-4 h-4 text-success" />}
                  {f.status === 'error' && <XCircle className="w-4 h-4 text-destructive" />}
                  {f.status === 'skipped' && <AlertCircle className="w-4 h-4 text-muted-foreground" />}
                </div>
                {/* 文件信息 & 路径编辑 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-foreground truncate">{f.file.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(f.file.size)}</span>
                  </div>
                  <input
                    type="text"
                    value={f.targetPath || ''}
                    onChange={(e) => updateFilePath(f.id, e.target.value)}
                    disabled={f.status !== 'pending' && f.status !== 'error'}
                    className="w-full mt-0.5 text-xs font-mono bg-transparent border-0 border-b border-dashed border-border/60 focus:outline-none focus:border-primary text-muted-foreground disabled:opacity-50 px-0"
                    placeholder="目标路径..."
                  />
                  {f.error && <p className="text-xs text-destructive mt-0.5">{f.error}</p>}
                  {f.status === 'skipped' && <p className="text-xs text-muted-foreground mt-0.5">文件已存在，已跳过</p>}
                </div>
                {/* 移除按钮 */}
                {(f.status === 'pending' || f.status === 'error') && (
                  <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0" onClick={() => removeFile(f.id)}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 上传进度 */}
      {uploading && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>上传中...</span>
            <span>{progress}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-3">
        <Button
          variant="ghost"
          className="border border-border text-muted-foreground hover:bg-secondary"
          onClick={() => navigate(`/repos/${owner}/${repo}`)}
        >
          取消
        </Button>
        <Button
          className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={handleUpload}
          disabled={uploading || files.filter((f) => f.status === 'pending' || f.status === 'error').length === 0}
        >
          {uploading ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />上传中</>
          ) : (
            <><GitCommit className="w-4 h-4 mr-2" />提交上传 ({files.filter((f) => f.status === 'pending' || f.status === 'error').length} 个文件)</>
          )}
        </Button>
      </div>
    </div>
  );
}
