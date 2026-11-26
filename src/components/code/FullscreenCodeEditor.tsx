import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import type { EditorView } from '@codemirror/view';
import { ArrowLeft, BookOpen, Braces, Copy, Download, Loader2, MoreHorizontal, Pencil, Redo2, Save, Search, Undo2, WrapText, ZoomIn, ZoomOut } from 'lucide-react';
import { toast } from 'sonner';
import { CodeEditor, type CodeEditorRef } from './CodeEditor';
import { EditorSearchPanel } from './EditorSearchPanel';
import { EDITOR_QUICK_SYMBOLS } from './codeBrowserUtils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  dialogStyle?: CSSProperties;
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

export function FullscreenCodeEditor({
  name, path, branch, content, viewport, dialogStyle, dirty, saving, modalOpen, notice, onChange, onSave, onBack, onDownload,
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
  const [symbolsOpen, setSymbolsOpen] = useState(false);

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
      if (symbolsOpen) setSymbolsOpen(false);
      else if (menuOpen) setMenuOpen(false);
      else if (modalOpen) onBack();
      else if (searchOpen) setSearchOpen(false);
      else if (reading) setReading(false);
      else onBack();
    };
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (dirty && !reading && !saving && !modalOpen && !symbolsOpen) onSave();
    };
    window.addEventListener('githubm:android-back', handleBack);
    window.addEventListener('keydown', handleSaveShortcut);
    return () => {
      window.removeEventListener('githubm:android-back', handleBack);
      window.removeEventListener('keydown', handleSaveShortcut);
    };
  }, [dirty, menuOpen, modalOpen, onBack, onSave, reading, saving, searchOpen, symbolsOpen]);

  const searchLabel = i18n.t('搜索 / 替换');
  const saveLabel = i18n.t('保存并提交');
  const backLabel = i18n.t('关闭编辑器');
  const undoLabel = i18n.t('撤销');
  const redoLabel = i18n.t('重做');
  const symbolsLabel = i18n.t('插入符号');
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
        className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-2 pb-1 pt-1 sm:gap-2 sm:px-3"
        style={bridge || viewport?.keyboardOpen ? undefined : { paddingTop: 'calc(0.25rem + env(safe-area-inset-top, 0px))' }}
      >
        <Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label={backLabel} title={backLabel} onClick={onBack} disabled={saving}>
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1 px-1" title={path}>
          <h1 className="truncate text-sm font-semibold">{name}</h1>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate">{branch}</span>
            {dirty && <span className="shrink-0 text-warning">· {i18n.t('未保存')}</span>}
          </p>
        </div>
        <Button type="button" variant={searchOpen ? 'secondary' : 'ghost'} size="icon" className="shrink-0"
          aria-label={searchLabel} aria-expanded={searchOpen} title={searchLabel} onClick={() => setSearchOpen(open => !open)}>
          <Search aria-hidden="true" />
        </Button>
        {!reading && (
          <Button type="button" size="icon" className="shrink-0 sm:w-auto sm:px-3" aria-label={saveLabel} title={saveLabel}
            disabled={!dirty || saving} onClick={onSave}>
            {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            <span className="hidden sm:inline">{saveLabel}</span>
          </Button>
        )}
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
        className="flex shrink-0 items-center gap-1 border-t border-border bg-card px-2 py-1 sm:gap-2 sm:px-3"
        style={bridge || viewport?.keyboardOpen ? undefined : { paddingBottom: 'calc(0.25rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {!reading && (
          <>
            <Button type="button" variant="ghost" size="icon" className="shrink-0"
              aria-label={undoLabel} title={undoLabel} disabled={saving}
              onPointerDown={keepEditorFocus} onClick={() => { editorRef.current?.undo(); }}>
              <Undo2 aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="shrink-0"
              aria-label={redoLabel} title={redoLabel} disabled={saving}
              onPointerDown={keepEditorFocus} onClick={() => { editorRef.current?.redo(); }}>
              <Redo2 aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="shrink-0"
              aria-label={symbolsLabel} title={symbolsLabel} disabled={saving} onClick={() => setSymbolsOpen(true)}>
              <Braces aria-hidden="true" />
            </Button>
          </>
        )}
        <Button type="button" variant={wrap ? 'secondary' : 'ghost'} size="icon" className="shrink-0"
          aria-label={wrapLabel} aria-pressed={wrap} title={wrapLabel}
          onPointerDown={keepEditorFocus} onClick={() => setWrap(value => !value)}>
          <WrapText aria-hidden="true" />
        </Button>
        <span className="ml-auto min-w-0 truncate px-1 text-xs tabular-nums text-muted-foreground" ref={cursorRef}>1:1</span>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={i18n.t('更多操作')} title={i18n.t('更多操作')}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
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
            <DropdownMenuSeparator />
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
      </footer>
      <Dialog open={symbolsOpen} onOpenChange={setSymbolsOpen}>
        <DialogContent className="max-w-[min(24rem,calc(100%-1.5rem))] overflow-y-auto" style={dialogStyle} aria-describedby={undefined} onCloseAutoFocus={event => event.preventDefault()}>
          <DialogHeader><DialogTitle>{i18n.t('插入符号')}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-5 gap-1.5">
            {EDITOR_QUICK_SYMBOLS.map(({ label, value }) => (
              <Button key={label} type="button" variant="outline" className="min-w-0 px-0 font-mono" onClick={() => {
                setSymbolsOpen(false);
                editorRef.current?.insertText(value);
              }}>{label}</Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
