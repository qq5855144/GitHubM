import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { EditorView } from '@codemirror/view';
import { ArrowLeft, BookOpen, Copy, Download, Loader2, MoreHorizontal, Pencil, Redo2, Save, Search, Undo2, WrapText, ZoomIn, ZoomOut } from 'lucide-react';
import { toast } from 'sonner';
import { CodeEditor, type CodeEditorRef } from './CodeEditor';
import { EditorSearchPanel } from './EditorSearchPanel';
import { EDITOR_QUICK_SYMBOLS } from './codeBrowserUtils';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { ChatViewport } from '@/hooks/use-chat-viewport';
import { copyToClipboard } from '@/lib/utils';
import i18n from '@/i18n';

interface FullscreenCodeEditorProps {
  name: string;
  path: string;
  branch: string;
  content: string;
  viewport: ChatViewport | null;
  dirty: boolean;
  saving: boolean;
  modalOpen: boolean;
  notice?: ReactNode;
  onChange: (value: string) => void;
  onSave: () => void;
  onBack: () => void;
  onDownload?: () => Promise<void>;
}

type EditorBridge = { setCodeEditorFullscreen?: (active: boolean) => void };
const toolbarButtonClass = 'shrink-0 rounded-xl hover:bg-white/10 hover:text-white focus-visible:ring-1 focus-visible:ring-white/70 [&_svg]:size-5';

export function FullscreenCodeEditor({
  name, path, branch, content, viewport, dirty, saving, modalOpen, notice, onChange, onSave, onBack, onDownload,
}: FullscreenCodeEditorProps) {
  const bridge = (window as Window & { AndroidBridge?: EditorBridge }).AndroidBridge;
  const editorRef = useRef<CodeEditorRef>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const [fontSize, setFontSize] = useState(14);
  const [wrap, setWrap] = useState(() => window.innerWidth < 768);
  const [reading, setReading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    bridge?.setCodeEditorFullscreen?.(true);
    return () => {
      root.style.overflow = previousOverflow;
      bridge?.setCodeEditorFullscreen?.(false);
    };
  }, [bridge]);

  useEffect(() => {
    const handleBack = (event: Event) => {
      event.preventDefault();
      if (saving) return;
      if (menuOpen) setMenuOpen(false);
      else if (modalOpen) onBack();
      else if (searchOpen) setSearchOpen(false);
      else if (reading) setReading(false);
      else onBack();
    };
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (dirty && !reading && !saving && !modalOpen && !menuOpen) onSave();
    };
    window.addEventListener('githubm:android-back', handleBack);
    window.addEventListener('keydown', handleSaveShortcut);
    return () => {
      window.removeEventListener('githubm:android-back', handleBack);
      window.removeEventListener('keydown', handleSaveShortcut);
    };
  }, [dirty, menuOpen, modalOpen, onBack, onSave, reading, saving, searchOpen]);

  const searchLabel = i18n.t('搜索 / 替换');
  const saveLabel = i18n.t('保存并提交');
  const backLabel = i18n.t('关闭编辑器');
  const undoLabel = i18n.t('撤销');
  const redoLabel = i18n.t('重做');
  const symbolsLabel = i18n.t('插入符号');
  const moreLabel = i18n.t('更多操作');
  const wrapLabel = i18n.t('自动换行');
  const keepEditorFocus = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button === 0 && view?.hasFocus) event.preventDefault();
  };

  return (
    <section
      aria-label={i18n.t('代码编辑器')}
      className="fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-background text-foreground"
      style={viewport ? { top: viewport.top, bottom: 'auto', height: viewport.height } : undefined}
    >
      <header
        className="shrink-0 select-none bg-[#2b2b2b] text-white"
        style={bridge || viewport?.keyboardOpen ? undefined : { paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="grid min-h-12 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-1 border-b border-white/10 px-2">
          <Button type="button" variant="ghost" size="icon" className={toolbarButtonClass}
            aria-label={backLabel} title={backLabel} onClick={onBack} disabled={saving}>
            <ArrowLeft aria-hidden="true" />
          </Button>
          <div className="min-w-0 text-center" title={path}>
            <h1 className="truncate text-base font-semibold leading-5">{name}</h1>
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-[#b6b6bd]">
              <span className="min-w-0 truncate">{branch}</span>
              {dirty && <span className="shrink-0 text-amber-300">· {i18n.t('未保存')}</span>}
            </p>
          </div>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className={`justify-self-end ${toolbarButtonClass}`} aria-label={moreLabel} title={moreLabel}>
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end"
              className="w-48 border-white/10 bg-[#2b2b2b] text-white [--accent:0_0%_23%] [--accent-foreground:0_0%_100%]">
              <div className="flex items-center justify-between gap-1 px-2 py-1 text-xs">
                <span>{i18n.t('字号')}</span>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 ml-auto"
                  aria-label={i18n.t('缩小字号')} onClick={() => setFontSize(size => Math.max(10, size - 1))} disabled={fontSize <= 10}>
                  <ZoomOut aria-hidden="true" />
                </Button>
                <span className="tabular-nums">{fontSize}</span>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7"
                  aria-label={i18n.t('放大字号')} onClick={() => setFontSize(size => Math.min(30, size + 1))} disabled={fontSize >= 30}>
                  <ZoomIn aria-hidden="true" />
                </Button>
              </div>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem onSelect={() => setReading(!reading)}>
                {reading ? <Pencil className="mr-2 h-4 w-4" /> : <BookOpen className="mr-2 h-4 w-4" />}
                {i18n.t(reading ? '退出阅读模式' : '阅读模式')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={async () => {
                if (await copyToClipboard(content)) toast.success(i18n.t('代码已复制'));
                else toast.error(i18n.t('复制失败'));
              }}>
                <Copy className="mr-2 h-4 w-4" />{i18n.t('复制内容')}
              </DropdownMenuItem>
              {onDownload && (
                <DropdownMenuItem onSelect={async () => {
                  try { await onDownload(); } catch { toast.error(i18n.t('下载失败')); }
                }}>
                  <Download className="mr-2 h-4 w-4" />{i18n.t('下载文件')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex h-8 items-center justify-between gap-3 bg-[#1e1e1e] px-3 font-mono text-xs text-[#a4a4ab]">
          <span className="min-w-0 truncate" title={path}>{path}</span>
          <div className="flex shrink-0 items-center gap-3 tabular-nums">
            <span ref={cursorRef}>1:1</span>
            <span>UTF-8</span>
          </div>
        </div>
      </header>

      {notice}
      <EditorSearchPanel view={view} content={content} visible={searchOpen}
        onClose={() => setSearchOpen(false)} readOnly={reading || saving} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeEditor
          ref={editorRef}
          onMount={setView}
          value={content}
          fileName={name}
          onChange={onChange}
          fontSize={fontSize}
          wordWrap={wrap ? 'on' : 'off'}
          readOnly={reading || saving}
          onFontSizeChange={setFontSize}
          onSearch={() => setSearchOpen(true)}
          onCursorChange={position => { if (cursorRef.current) cursorRef.current.textContent = position; }}
        />
      </div>

      <footer
        className="flex min-h-11 shrink-0 select-none items-center gap-1 border-t border-white/10 bg-[#252526] px-1 text-[#d4d4d8]"
        style={bridge || viewport?.keyboardOpen ? undefined : { paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {!reading && (
          <>
            <Button type="button" variant="ghost" size="icon" className={toolbarButtonClass}
              aria-label={undoLabel} title={undoLabel} disabled={saving}
              onPointerDown={keepEditorFocus} onClick={() => { editorRef.current?.undo(); }}>
              <Undo2 aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className={toolbarButtonClass}
              aria-label={redoLabel} title={redoLabel} disabled={saving}
              onPointerDown={keepEditorFocus} onClick={() => { editorRef.current?.redo(); }}>
              <Redo2 aria-hidden="true" />
            </Button>
          </>
        )}
        <Button type="button" variant="ghost" size="icon" className={`${toolbarButtonClass} aria-expanded:bg-white/10 aria-expanded:text-white`}
          aria-label={searchLabel} aria-expanded={searchOpen} title={searchLabel} onClick={() => setSearchOpen(open => !open)}>
          <Search aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className={`${toolbarButtonClass} aria-pressed:bg-white/10 aria-pressed:text-white`}
          aria-label={wrapLabel} aria-pressed={wrap} title={wrapLabel}
          onPointerDown={keepEditorFocus} onClick={() => setWrap(value => !value)}>
          <WrapText aria-hidden="true" />
        </Button>
        {!reading && (
          <>
            <div role="group" aria-label={symbolsLabel}
              className="flex min-w-0 flex-1 touch-pan-x items-center overflow-x-auto overscroll-x-contain border-x border-white/10 px-1 [scrollbar-color:#d4d4d4_transparent]">
              {EDITOR_QUICK_SYMBOLS.map(({ label, value }) => (
                <Button key={label} type="button" variant="ghost" size="icon"
                  className={`${toolbarButtonClass} h-8 min-w-8 w-auto px-1 font-mono text-sm`}
                  aria-label={`${symbolsLabel} ${label}`} disabled={saving}
                  onPointerDown={keepEditorFocus} onClick={() => editorRef.current?.insertText(value)}>
                  {label}
                </Button>
              ))}
            </div>
            <Button type="button" variant="ghost" size="icon" className={toolbarButtonClass}
              aria-label={saveLabel} title={saveLabel} disabled={!dirty || saving} onClick={onSave}>
              {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            </Button>
          </>
        )}
      </footer>
    </section>
  );
}
