/**
 * FileTree —— 仓库文件树组件
 *
 * 交互设计：
 * - 懒加载：展开文件夹时才请求子节点，不一次性拉全量
 * - 展开/收起状态持久化到组件生命周期（切换文件不重置）
 * - 右键/长按弹出上下文菜单（新建文件、新建文件夹、重命名、删除）
 * - Hover 时右侧显示快捷操作按钮（新建文件/文件夹）
 * - 当前选中节点高亮（与 URL 路径同步）
 * - 顶部快捷搜索（本地过滤已加载节点）
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  FilePlus,
  FolderPlus,
  RefreshCw,
  Search,
  X,
  Pencil,
  Trash2,
  MoreHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getFileIconInfo } from '@/components/common/FileIcon';
import { getRepoContents } from '@/services/github';
import type { GitHubContent } from '@/types/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';

// ── 类型 ────────────────────────────────────────────────────────────────────

type NodeStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface TreeNode {
  item: GitHubContent;
  children: TreeNode[] | null; // null = 未加载，[] = 已加载但为空
  status: NodeStatus;
}

export interface FileTreeProps {
  owner: string;
  repo: string;
  branch: string;
  /** 当前已选中的文件路径（用于高亮） */
  activePath?: string;
  /** 点击文件时回调（由父组件决定如何导航） */
  onFileClick?: (item: GitHubContent) => void;
  /** 触发新建文件，传入所在目录路径 */
  onNewFile?: (dirPath: string) => void;
  /** 触发新建文件夹，传入所在目录路径 */
  onNewFolder?: (dirPath: string) => void;
  /** 触发重命名 */
  onRename?: (item: GitHubContent) => void;
  /** 触发删除 */
  onDelete?: (item: GitHubContent) => void;
  /** 外部触发刷新用 key（递增则重新加载根节点） */
  refreshKey?: number;
  className?: string;
}

// ── 辅助：排序目录在前 ────────────────────────────────────────────────────

function sortItems(items: GitHubContent[]): GitHubContent[] {
  return [...items].sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (a.type !== 'dir' && b.type === 'dir') return 1;
    return a.name.localeCompare(b.name);
  });
}

// ── 单个树节点 ───────────────────────────────────────────────────────────────

function TreeNodeRow({
  node,
  depth,
  isExpanded,
  isActive,
  onToggle,
  onFileClick,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  filterText,
}: {
  node: TreeNode;
  depth: number;
  isExpanded: boolean;
  isActive: boolean;
  onToggle: (path: string) => void;
  onFileClick?: (item: GitHubContent) => void;
  onNewFile?: (dirPath: string) => void;
  onNewFolder?: (dirPath: string) => void;
  onRename?: (item: GitHubContent) => void;
  onDelete?: (item: GitHubContent) => void;
  filterText: string;
}) {
  const { item, status } = node;
  const isDir = item.type === 'dir';
  const { Icon, color } = getFileIconInfo(item.name, isDir, isExpanded);

  const handleClick = () => {
    if (isDir) {
      onToggle(item.path);
    } else {
      onFileClick?.(item);
    }
  };

  // 名称高亮匹配文字
  const nameNode = useMemo(() => {
    if (!filterText) return <span>{item.name}</span>;
    const idx = item.name.toLowerCase().indexOf(filterText.toLowerCase());
    if (idx === -1) return <span>{item.name}</span>;
    return (
      <span>
        {item.name.slice(0, idx)}
        <mark className="bg-yellow-400/40 text-foreground rounded-[2px]">
          {item.name.slice(idx, idx + filterText.length)}
        </mark>
        {item.name.slice(idx + filterText.length)}
      </span>
    );
  }, [item.name, filterText]);

  const contextActions = (
    <>
      {isDir && (
        <>
          <ContextMenuItem onClick={() => onNewFile?.(item.path)}>
            <FilePlus className="w-3.5 h-3.5 mr-2" />新建文件
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onNewFolder?.(item.path)}>
            <FolderPlus className="w-3.5 h-3.5 mr-2" />新建文件夹
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onClick={() => onRename?.(item)}>
        <Pencil className="w-3.5 h-3.5 mr-2" />重命名
      </ContextMenuItem>
      <ContextMenuItem
        onClick={() => onDelete?.(item)}
        className="text-destructive focus:text-destructive"
      >
        <Trash2 className="w-3.5 h-3.5 mr-2" />删除
      </ContextMenuItem>
    </>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group flex items-center gap-0.5 py-[3px] pr-1 rounded-md cursor-pointer select-none',
            'hover:bg-secondary/60 transition-colors',
            isActive && 'bg-primary/10 hover:bg-primary/15',
          )}
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
          onClick={handleClick}
        >
          {/* 展开/收起箭头 */}
          <span className="w-4 h-4 flex items-center justify-center shrink-0">
            {isDir && (
              status === 'loading' ? (
                <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
              ) : isExpanded ? (
                <ChevronDown className="w-3 h-3 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
              )
            )}
          </span>

          {/* 文件/文件夹图标 */}
          <Icon className={cn('w-4 h-4 shrink-0', color)} />

          {/* 名称 */}
          <span
            className={cn(
              'flex-1 min-w-0 truncate text-sm ml-1.5',
              isActive ? 'text-primary font-medium' : 'text-foreground/85',
            )}
          >
            {nameNode}
          </span>

          {/* Hover 快捷按钮（仅文件夹显示） */}
          {isDir && (
            <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted/70"
                title="新建文件"
                onClick={e => { e.stopPropagation(); onNewFile?.(item.path); }}
              >
                <FilePlus className="w-3 h-3 text-muted-foreground" />
              </button>
              <button
                type="button"
                className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted/70"
                title="新建文件夹"
                onClick={e => { e.stopPropagation(); onNewFolder?.(item.path); }}
              >
                <FolderPlus className="w-3 h-3 text-muted-foreground" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted/70"
                    onClick={e => e.stopPropagation()}
                  >
                    <MoreHorizontal className="w-3 h-3 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem onClick={() => onRename?.(item)}>
                    <Pencil className="w-3.5 h-3.5 mr-2" />重命名
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onDelete?.(item)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-2" />删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        {contextActions}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── 递归渲染树 ───────────────────────────────────────────────────────────────

function TreeNodeList({
  nodes,
  depth,
  expandedPaths,
  activePath,
  onToggle,
  onFileClick,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  filterText,
}: {
  nodes: TreeNode[];
  depth: number;
  expandedPaths: Set<string>;
  activePath?: string;
  onToggle: (path: string) => void;
  onFileClick?: (item: GitHubContent) => void;
  onNewFile?: (dirPath: string) => void;
  onNewFolder?: (dirPath: string) => void;
  onRename?: (item: GitHubContent) => void;
  onDelete?: (item: GitHubContent) => void;
  filterText: string;
}) {
  return (
    <>
      {nodes.map(node => {
        const isExpanded = expandedPaths.has(node.item.path);
        const isActive = activePath === node.item.path;
        return (
          <div key={node.item.path}>
            <TreeNodeRow
              node={node}
              depth={depth}
              isExpanded={isExpanded}
              isActive={isActive}
              onToggle={onToggle}
              onFileClick={onFileClick}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
              onRename={onRename}
              onDelete={onDelete}
              filterText={filterText}
            />
            {/* 子节点 */}
            {node.item.type === 'dir' && isExpanded && node.children && node.children.length > 0 && (
              <TreeNodeList
                nodes={node.children}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                activePath={activePath}
                onToggle={onToggle}
                onFileClick={onFileClick}
                onNewFile={onNewFile}
                onNewFolder={onNewFolder}
                onRename={onRename}
                onDelete={onDelete}
                filterText={filterText}
              />
            )}
            {/* 空文件夹提示 */}
            {node.item.type === 'dir' && isExpanded && node.children?.length === 0 && (
              <div
                className="text-xs text-muted-foreground/60 py-1 italic"
                style={{ paddingLeft: `${(depth + 1) * 12 + 22}px` }}
              >
                空文件夹
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── 主组件 ───────────────────────────────────────────────────────────────────

export default function FileTree({
  owner,
  repo,
  branch,
  activePath,
  onFileClick,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  refreshKey,
  className,
}: FileTreeProps) {
  const navigate = useNavigate();

  // 根节点列表
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [rootStatus, setRootStatus] = useState<NodeStatus>('idle');

  // 展开状态（path → true/false）
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // 节点缓存 path → TreeNode（方便更新子节点）
  const nodeMapRef = useRef<Map<string, TreeNode>>(new Map());

  // 搜索
  const [searchText, setSearchText] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 加载目录内容
  const loadDir = useCallback(async (path: string): Promise<TreeNode[]> => {
    const data = await getRepoContents(owner, repo, path, branch);
    const items = Array.isArray(data) ? sortItems(data as GitHubContent[]) : [];
    return items.map(item => {
      const existing = nodeMapRef.current.get(item.path);
      if (existing) return existing;
      const node: TreeNode = { item, children: null, status: 'idle' };
      nodeMapRef.current.set(item.path, node);
      return node;
    });
  }, [owner, repo, branch]);

  // 加载根节点
  const loadRoot = useCallback(async () => {
    setRootStatus('loading');
    nodeMapRef.current.clear();
    try {
      const nodes = await loadDir('');
      setRoots(nodes);
      setRootStatus('loaded');
    } catch {
      setRootStatus('error');
    }
  }, [loadDir]);

  useEffect(() => {
    if (owner && repo && branch) loadRoot();
  }, [loadRoot, refreshKey]);

  // 展开初始路径：若 activePath 有值，自动展开祖先节点
  useEffect(() => {
    if (!activePath) return;
    const parts = activePath.split('/');
    if (parts.length <= 1) return;
    const ancestors = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
    setExpandedPaths(prev => {
      const next = new Set(prev);
      ancestors.forEach(p => next.add(p));
      return next;
    });
  }, [activePath]);

  // 切换展开/收起
  const handleToggle = useCallback(async (path: string) => {
    const isExpanded = expandedPaths.has(path);
    if (isExpanded) {
      setExpandedPaths(prev => { const n = new Set(prev); n.delete(path); return n; });
      return;
    }
    // 展开：检查是否需要加载
    const node = nodeMapRef.current.get(path);
    if (!node) return;

    setExpandedPaths(prev => new Set([...prev, path]));

    if (node.children !== null) return; // 已加载

    // 标记 loading
    node.status = 'loading';
    setRoots(prev => [...prev]); // 触发重渲染

    try {
      const children = await loadDir(path);
      node.children = children;
      node.status = 'loaded';
    } catch {
      node.status = 'error';
      node.children = [];
    }
    setRoots(prev => [...prev]);
  }, [expandedPaths, loadDir]);

  // 文件点击默认行为（如果父组件不传 onFileClick）
  const handleFileClick = useCallback((item: GitHubContent) => {
    if (onFileClick) {
      onFileClick(item);
    } else {
      navigate(`/repos/${owner}/${repo}/code/${item.path}`);
    }
  }, [onFileClick, navigate, owner, repo]);

  // 搜索过滤（本地过滤，只过滤名字，不过滤未展开子节点）
  const filteredRoots = useMemo(() => {
    if (!searchText.trim()) return roots;
    const q = searchText.toLowerCase();
    // 递归收集所有已加载节点中匹配的
    function collect(nodes: TreeNode[]): TreeNode[] {
      const result: TreeNode[] = [];
      for (const n of nodes) {
        const matches = n.item.name.toLowerCase().includes(q);
        if (matches) result.push(n);
        if (n.children) result.push(...collect(n.children));
      }
      return result;
    }
    return collect(roots);
  }, [roots, searchText]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* 顶栏：根目录操作 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
        <span className="flex-1 text-xs font-medium text-muted-foreground truncate uppercase tracking-wide px-1">
          文件浏览
        </span>
        <button
          type="button"
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted/70 transition-colors"
          title="在根目录新建文件"
          onClick={() => onNewFile?.('')}
        >
          <FilePlus className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
        <button
          type="button"
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted/70 transition-colors"
          title="在根目录新建文件夹"
          onClick={() => onNewFolder?.('')}
        >
          <FolderPlus className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
        <button
          type="button"
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted/70 transition-colors"
          title="搜索文件"
          onClick={() => {
            setShowSearch(v => !v);
            setTimeout(() => searchInputRef.current?.focus(), 50);
          }}
        >
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
        <button
          type="button"
          className={cn('h-6 w-6 flex items-center justify-center rounded hover:bg-muted/70 transition-colors', rootStatus === 'loading' && 'pointer-events-none')}
          title="刷新"
          onClick={loadRoot}
        >
          <RefreshCw className={cn('w-3.5 h-3.5 text-muted-foreground', rootStatus === 'loading' && 'animate-spin')} />
        </button>
      </div>

      {/* 搜索框 */}
      {showSearch && (
        <div className="px-2 py-1.5 border-b border-border shrink-0">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="搜索文件名..."
              className="h-7 pl-6 pr-6 text-xs bg-secondary border-border"
            />
            {searchText && (
              <button
                type="button"
                className="absolute right-1.5 top-1/2 -translate-y-1/2"
                onClick={() => setSearchText('')}
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 树体 */}
      <ScrollArea className="flex-1">
        <div className="py-1 px-1">
          {rootStatus === 'loading' && roots.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {rootStatus === 'error' && (
            <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
              <p className="text-xs">加载失败</p>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={loadRoot}>
                <RefreshCw className="w-3 h-3 mr-1" />重试
              </Button>
            </div>
          )}
          {rootStatus === 'loaded' && (
            <TreeNodeList
              nodes={searchText.trim() ? filteredRoots : roots}
              depth={0}
              expandedPaths={searchText.trim() ? new Set(filteredRoots.map(n => n.item.path)) : expandedPaths}
              activePath={activePath}
              onToggle={handleToggle}
              onFileClick={handleFileClick}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
              onRename={onRename}
              onDelete={onDelete}
              filterText={searchText}
            />
          )}
          {rootStatus === 'loaded' && filteredRoots.length === 0 && searchText && (
            <p className="text-xs text-muted-foreground text-center py-6">
              没有匹配的文件
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
