// 文件浏览器插件面板 — 可在 AI 对话中快速浏览仓库文件并插入操作指令
import { memo, useState, useCallback } from 'react';
import {
  Folder, FolderOpen, FileCode2, FileText, File,
  ChevronRight, ChevronDown, Loader2, X, Eye, Pencil, Copy,
  FolderSearch, RefreshCw,
} from 'lucide-react';
import { cn, copyToClipboard } from '@/lib/utils';
import { getRepoContents } from '@/services/github';
import type { GitHubContent } from '@/types/types';
import { toast } from 'sonner';
import i18n from "@/i18n";

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface TreeNode {
  item: GitHubContent;
  children?: TreeNode[];
  expanded?: boolean;
  loading?: boolean;
}

interface FileBrowserPanelProps {
  owner: string;
  repo: string;
  branch: string;
  onInsert: (text: string) => void;
  onClose: () => void;
}

// ── 文件图标 ──────────────────────────────────────────────────────────────────

function FileIcon({ name, type }: { name: string; type: string }) {
  if (type === 'dir') return <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'kt', 'java', 'go', 'rs', 'cpp', 'c', 'cs', 'swift', 'rb', 'php', 'sh', 'yaml', 'yml', 'json', 'toml', 'xml'];
  const docExts = ['md', 'txt', 'rst', 'html', 'css', 'svg'];
  if (codeExts.includes(ext)) return <FileCode2 className="w-3.5 h-3.5 text-blue-500 shrink-0" />;
  if (docExts.includes(ext)) return <FileText className="w-3.5 h-3.5 text-green-500 shrink-0" />;
  return <File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
}

// ── 单行树节点 ────────────────────────────────────────────────────────────────

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  onToggle: (node: TreeNode) => void;
  onFileAction: (item: GitHubContent, action: 'read' | 'edit' | 'copy') => void;
  hoveredPath: string | null;
  setHoveredPath: (p: string | null) => void;
}

const TreeRow = memo(function TreeRow({
  node, depth, onToggle, onFileAction, hoveredPath, setHoveredPath,
}: TreeRowProps) {
  const isDir = node.item.type === 'dir';
  const isHovered = hoveredPath === node.item.path;

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1 py-0.5 px-2 rounded cursor-pointer select-none group transition-colors',
          isHovered ? 'bg-muted' : 'hover:bg-muted/60',
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onMouseEnter={() => setHoveredPath(node.item.path)}
        onMouseLeave={() => setHoveredPath(null)}
        onClick={() => isDir ? onToggle(node) : undefined}
      >
        {/* 展开/收起图标 */}
        <span className="shrink-0 w-3.5">
          {isDir && (
            node.loading
              ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
              : node.expanded
                ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
                : <ChevronRight className="w-3 h-3 text-muted-foreground" />
          )}
        </span>

        {/* 文件/目录图标 */}
        {isDir
          ? (node.expanded
              ? <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              : <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />)
          : <FileIcon name={node.item.name} type={node.item.type} />}

        {/* 名称 */}
        <span className="text-xs truncate flex-1 min-w-0 ml-1">
          {node.item.name}
        </span>

        {/* 文件大小（目录不显示） */}
        {!isDir && node.item.size > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0 opacity-60 mr-1">
            {node.item.size > 1024
              ? `${(node.item.size / 1024).toFixed(1)}k`
              : `${node.item.size}B`}
          </span>
        )}

        {/* 操作按钮（hover 才显示） */}
        {!isDir && isHovered && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              className="p-0.5 rounded hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors"
              title={i18n.t('让 AI 读取此文件')}
              onClick={(e) => { e.stopPropagation(); onFileAction(node.item, 'read'); }}
            >
              <Eye className="w-3 h-3" />
            </button>
            <button
              className="p-0.5 rounded hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors"
              title={i18n.t('让 AI 编辑此文件')}
              onClick={(e) => { e.stopPropagation(); onFileAction(node.item, 'edit'); }}
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              className="p-0.5 rounded hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors"
              title={i18n.t('复制路径')}
              onClick={(e) => { e.stopPropagation(); onFileAction(node.item, 'copy'); }}
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
        )}
        {isDir && isHovered && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              className="p-0.5 rounded hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors"
              title={i18n.t('让 AI 列出此目录')}
              onClick={(e) => { e.stopPropagation(); onFileAction(node.item, 'read'); }}
            >
              <Eye className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* 展开的子节点 */}
      {isDir && node.expanded && node.children && (
        <>
          {node.children.map(child => (
            <TreeRow
              key={child.item.path}
              node={child}
              depth={depth + 1}
              onToggle={onToggle}
              onFileAction={onFileAction}
              hoveredPath={hoveredPath}
              setHoveredPath={setHoveredPath}
            />
          ))}
        </>
      )}
    </>
  );
});

// ── 主组件 ────────────────────────────────────────────────────────────────────

const FileBrowserPanel = memo(function FileBrowserPanel({
  owner, repo, branch, onInsert, onClose,
}: FileBrowserPanelProps) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [rootLoading, setRootLoading] = useState(false);
  const [rootLoaded, setRootLoaded] = useState(false);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  // 加载根目录
  const loadRoot = useCallback(async () => {
    setRootLoading(true);
    try {
      const items = await getRepoContents(owner, repo, '', branch);
      const arr = Array.isArray(items) ? items : [items];
      // 目录排前，文件排后，同类按字母排
      const sorted = arr.sort((a, b) => {
        if (a.type === 'dir' && b.type !== 'dir') return -1;
        if (a.type !== 'dir' && b.type === 'dir') return 1;
        return a.name.localeCompare(b.name);
      });
      setNodes(sorted.map(item => ({ item })));
      setRootLoaded(true);
    } catch {
      toast.error(i18n.t('加载文件树失败'));
    } finally {
      setRootLoading(false);
    }
  }, [owner, repo, branch]);

  // 展开/收起目录
  const handleToggle = useCallback(async (target: TreeNode) => {
    if (target.expanded) {
      // 收起：只更新 expanded 标志，不清除 children（缓存）
      const collapse = (list: TreeNode[]): TreeNode[] =>
        list.map(n => n.item.path === target.item.path
          ? { ...n, expanded: false }
          : { ...n, children: n.children ? collapse(n.children) : undefined });
      setNodes(prev => collapse(prev));
      return;
    }
    if (target.children) {
      // 已有缓存，直接展开
      const expand = (list: TreeNode[]): TreeNode[] =>
        list.map(n => n.item.path === target.item.path
          ? { ...n, expanded: true }
          : { ...n, children: n.children ? expand(n.children) : undefined });
      setNodes(prev => expand(prev));
      return;
    }
    // 标记加载中
    const setLoading = (list: TreeNode[], loading: boolean): TreeNode[] =>
      list.map(n => n.item.path === target.item.path
        ? { ...n, loading }
        : { ...n, children: n.children ? setLoading(n.children, loading) : undefined });
    setNodes(prev => setLoading(prev, true));
    try {
      const items = await getRepoContents(owner, repo, target.item.path, branch);
      const arr = Array.isArray(items) ? items : [items];
      const sorted = arr.sort((a, b) => {
        if (a.type === 'dir' && b.type !== 'dir') return -1;
        if (a.type !== 'dir' && b.type === 'dir') return 1;
        return a.name.localeCompare(b.name);
      });
      const children: TreeNode[] = sorted.map(item => ({ item }));
      const setChildren = (list: TreeNode[]): TreeNode[] =>
        list.map(n => n.item.path === target.item.path
          ? { ...n, loading: false, expanded: true, children }
          : { ...n, children: n.children ? setChildren(n.children) : undefined });
      setNodes(prev => setChildren(prev));
    } catch {
      toast.error(`加载目录失败：${target.item.path}`);
      setNodes(prev => setLoading(prev, false));
    }
  }, [owner, repo, branch]);

  // 文件操作 → 插入文本到输入框
  const handleFileAction = useCallback((item: GitHubContent, action: 'read' | 'edit' | 'copy') => {
    if (action === 'copy') {
      copyToClipboard(item.path).then(() => toast.success(i18n.t('路径已复制')));
      return;
    }
    if (action === 'read') {
      if (item.type === 'dir') {
        onInsert(`请列出目录 \`${item.path}/\` 的文件内容`);
      } else {
        const sizeHint = item.size > 10000
          ? `（文件较大 ${Math.round(item.size / 1024)}KB，请先读取第 1-100 行）`
          : '';
        onInsert(`请读取文件 \`${item.path}\`${sizeHint}`);
      }
    }
    if (action === 'edit') {
      onInsert(`请读取文件 \`${item.path}\`，然后帮我修改：`);
    }
  }, [onInsert]);

  return (
    <div className="flex flex-col h-full min-h-0 border-l border-border bg-card w-full">
      {/* 面板标题栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <FolderSearch className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">{i18n.t('文件浏览器')}</span>
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[80px]">{repo}</span>
        </div>
        <div className="flex items-center gap-0.5">
          {rootLoaded && (
            <button
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title={i18n.t('刷新')}
              onClick={() => { setRootLoaded(false); setNodes([]); loadRoot(); }}
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
          <button
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={onClose}
            title={i18n.t('关闭')}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 文件树内容 */}
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {!rootLoaded ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            {rootLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">{i18n.t('加载文件树…')}</span>
              </>
            ) : (
              <>
                <FolderSearch className="w-6 h-6 opacity-40" />
                <span className="text-xs">{i18n.t('点击加载文件树')}</span>
                <button
                  className="text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  onClick={loadRoot}
                >
                  {i18n.t('加载')}</button>
              </>
            )}
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            {i18n.t('空目录')}</div>
        ) : (
          nodes.map(node => (
            <TreeRow
              key={node.item.path}
              node={node}
              depth={0}
              onToggle={handleToggle}
              onFileAction={handleFileAction}
              hoveredPath={hoveredPath}
              setHoveredPath={setHoveredPath}
            />
          ))
        )}
      </div>

      {/* 底部操作提示 */}
      <div className="px-3 py-1.5 border-t border-border shrink-0">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <Eye className="w-2.5 h-2.5 inline mr-0.5" />{i18n.t('读取 &nbsp;')}<Pencil className="w-2.5 h-2.5 inline mr-0.5" />{i18n.t('编辑 &nbsp;')}<Copy className="w-2.5 h-2.5 inline mr-0.5" />{i18n.t('复制路径')}</p>
      </div>
    </div>
  );
});

export default FileBrowserPanel;
