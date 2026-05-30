// DiffBlock：AI 返回的 unified diff 高亮渲染组件
// 支持解析标准 unified diff 格式，行级增/删/上下文三色区分
// 提供「复制 Diff」和「一键应用」快捷操作

import { useState, useCallback } from 'react';
import { Copy, Check, GitMerge, ChevronDown, ChevronRight, FileCode2 } from 'lucide-react';
import { cn, copyToClipboard } from '@/lib/utils';
import i18n from "@/i18n";

// ── 类型 ─────────────────────────────────────────────────────────────────────

type LineType = 'add' | 'del' | 'ctx' | 'hunk' | 'file';

interface DiffLine {
  type: LineType;
  content: string;         // 原始行文本（含前缀 +/-/空格）
  oldNum?: number;         // 旧文件行号
  newNum?: number;         // 新文件行号
}

interface DiffHunk {
  header: string;          // @@ -x,y +a,b @@ 行
  lines: DiffLine[];
}

interface DiffFile {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
}

// ── 解析器 ───────────────────────────────────────────────────────────────────

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let curFile: DiffFile | null = null;
  let curHunk: DiffHunk | null = null;
  let oldLine = 1, newLine = 1;

  const lines = raw.split('\n');

  for (const line of lines) {
    // 新文件头
    if (line.startsWith('--- ')) {
      if (curFile) files.push(curFile);
      curFile = { oldPath: line.slice(4), newPath: '', hunks: [] };
      curHunk = null;
      continue;
    }
    if (line.startsWith('+++ ') && curFile) {
      curFile.newPath = line.slice(4);
      continue;
    }
    // Hunk 头
    if (line.startsWith('@@') && curFile) {
      if (curHunk) curFile.hunks.push(curHunk);
      // 解析行号偏移 @@ -oldStart,oldCount +newStart,newCount @@
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldLine = parseInt(m[1]); newLine = parseInt(m[2]); }
      curHunk = { header: line, lines: [] };
      continue;
    }
    if (!curHunk) continue;

    if (line.startsWith('+')) {
      curHunk.lines.push({ type: 'add', content: line, newNum: newLine++ });
    } else if (line.startsWith('-')) {
      curHunk.lines.push({ type: 'del', content: line, oldNum: oldLine++ });
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — 跳过
    } else {
      // 上下文行（空格开头）
      curHunk.lines.push({ type: 'ctx', content: line, oldNum: oldLine++, newNum: newLine++ });
    }
  }

  if (curHunk && curFile) curFile.hunks.push(curHunk);
  if (curFile) files.push(curFile);

  return files;
}

// ── 辅助：去除文件路径的 a/ b/ 前缀 ─────────────────────────────────────────

function cleanPath(p: string) {
  return p.replace(/^[ab]\//, '').replace(/^\/?dev\/null$/, '/dev/null');
}

// ── 行高亮颜色 ────────────────────────────────────────────────────────────────

const lineStyle: Record<LineType, string> = {
  add:  'bg-green-500/10 text-green-800 dark:text-green-300 border-l-2 border-green-500/50',
  del:  'bg-red-500/10 text-red-800 dark:text-red-300 border-l-2 border-red-500/50',
  ctx:  'text-muted-foreground',
  hunk: 'bg-primary/5 text-primary font-mono text-[10px]',
  file: 'bg-muted/40 font-mono text-[10px] text-foreground',
};

const linePrefix: Record<LineType, string> = {
  add:  '+', del: '-', ctx: ' ', hunk: '', file: '',
};

// ── 子组件：单个文件 diff ─────────────────────────────────────────────────────

interface DiffFileBlockProps {
  file: DiffFile;
  onApply?: (path: string) => void;
}

function DiffFileBlock({ file, onApply }: DiffFileBlockProps) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const displayPath = cleanPath(file.newPath || file.oldPath);
  const addCount = file.hunks.flatMap(h => h.lines).filter(l => l.type === 'add').length;
  const delCount = file.hunks.flatMap(h => h.lines).filter(l => l.type === 'del').length;

  const handleCopy = useCallback(() => {
    const text = file.hunks.map(h =>
      [h.header, ...h.lines.map(l => l.content)].join('\n')
    ).join('\n');
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [file.hunks]);

  return (
    <div className="rounded-lg border border-border overflow-hidden text-xs font-mono">
      {/* 文件头 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border">
        <button
          onClick={() => setExpanded(v => !v)}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5" />
            : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <FileCode2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="flex-1 min-w-0 text-foreground truncate font-medium">{displayPath}</span>

        {/* 增删计数徽章 */}
        <div className="flex items-center gap-1 shrink-0">
          {addCount > 0 && (
            <span className="text-[10px] font-sans font-medium text-green-600 dark:text-green-400 bg-green-500/10 rounded px-1.5 py-0.5">
              +{addCount}
            </span>
          )}
          {delCount > 0 && (
            <span className="text-[10px] font-sans font-medium text-red-600 dark:text-red-400 bg-red-500/10 rounded px-1.5 py-0.5">
              -{delCount}
            </span>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopy}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={i18n.t('复制 Diff')}
          >
            {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
          </button>
          {onApply && displayPath !== '/dev/null' && (
            <button
              onClick={() => onApply(displayPath)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-sans font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
              title={i18n.t('让 AI 将此修改应用到仓库')}
            >
              <GitMerge className="w-3 h-3" />
              {i18n.t('应用')}</button>
          )}
        </div>
      </div>

      {/* Hunk 列表 */}
      {expanded && (
        <div className="overflow-x-auto">
          {file.hunks.map((hunk, hi) => (
            <div key={hi}>
              {/* Hunk 头：@@ 行 */}
              <div className={cn('px-3 py-0.5 select-none', lineStyle.hunk)}>
                {hunk.header}
              </div>
              {/* 代码行 */}
              {hunk.lines.map((line, li) => (
                <div
                  key={li}
                  className={cn('flex items-start min-w-0 select-text', lineStyle[line.type])}
                >
                  {/* 行号列 */}
                  <span className="shrink-0 w-10 text-right pr-2 pl-1 text-[10px] text-muted-foreground/50 select-none border-r border-border/40 mr-2 leading-5">
                    {line.oldNum ?? ''}
                  </span>
                  <span className="shrink-0 w-10 text-right pr-2 text-[10px] text-muted-foreground/50 select-none border-r border-border/40 mr-3 leading-5">
                    {line.newNum ?? ''}
                  </span>
                  {/* 前缀符号 */}
                  <span className="shrink-0 w-3 font-bold leading-5 select-none">
                    {linePrefix[line.type]}
                  </span>
                  {/* 代码内容（去掉第一个字符的前缀） */}
                  <span className="flex-1 min-w-0 break-all leading-5 pr-3 whitespace-pre-wrap">
                    {line.content.slice(1)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 主组件：DiffBlock ─────────────────────────────────────────────────────────

interface DiffBlockProps {
  /** 原始 diff 文本（unified diff 格式） */
  raw: string;
  /** 点击「应用」时的回调，参数为目标文件路径 */
  onApply?: (filePath: string) => void;
}

export default function DiffBlock({ raw, onApply }: DiffBlockProps) {
  const files = parseDiff(raw);

  // 解析失败 / 空内容时降级展示
  if (!files.length) {
    return (
      <pre className="rounded-lg border border-border bg-muted/40 p-3 text-xs font-mono overflow-x-auto whitespace-pre text-foreground">
        {raw}
      </pre>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-full min-w-0">
      {files.map((file, i) => (
        <DiffFileBlock key={i} file={file} onApply={onApply} />
      ))}
    </div>
  );
}
