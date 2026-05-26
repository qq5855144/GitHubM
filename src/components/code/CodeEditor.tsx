import React, { useRef, useMemo, forwardRef, useImperativeHandle, useEffect, useState, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, keymap, ViewUpdate } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
import { undo, redo } from '@codemirror/commands';
import { loadLanguage } from '@uiw/codemirror-extensions-langs';
import { basicSetup } from '@uiw/react-codemirror';
import { searchHighlightField, searchTheme } from './codemirror-search';
import { useTheme } from '@/contexts/ThemeContext';

export interface CodeEditorRef {
  focus: () => void;
  undo: () => boolean;
  redo: () => boolean;
  getValue: () => string;
  getView: () => EditorView | null;
}

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  fileName?: string;
  readOnly?: boolean;
  fontSize?: number;
  autoFocus?: boolean;
  onMount?: () => void;
  onSearch?: () => void;
  onCursorChange?: (position: string) => void;
  onFontSizeChange?: (newSize: number) => void;
  wordWrap?: 'on' | 'off';
}

function getLanguageExtension(fileName: string): Extension | null {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    json: 'json',
    html: 'html', htm: 'html', vue: 'html', svelte: 'html',
    css: 'css', scss: 'css', sass: 'css', less: 'css',
    md: 'markdown', mdx: 'markdown',
    py: 'python', pyw: 'python',
    java: 'java',
    c: 'cpp', cpp: 'cpp', cxx: 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp', hxx: 'cpp',
    cs: 'csharp',
    go: 'go',
    rs: 'rust',
    php: 'php',
    rb: 'ruby',
    sh: 'shell', bash: 'shell', zsh: 'shell',
    yaml: 'yaml', yml: 'yaml',
    xml: 'xml', svg: 'xml',
    sql: 'sql',
    kt: 'kotlin', kts: 'kotlin',
    swift: 'swift',
    dart: 'dart',
    scala: 'scala', sc: 'scala',
    r: 'r',
    lua: 'lua',
    ps1: 'powershell',
    groovy: 'groovy', gradle: 'groovy',
    ini: 'ini', toml: 'ini', cfg: 'ini',
    diff: 'diff', patch: 'diff',
    dockerfile: 'dockerfile',
  };
  const langName = langMap[ext];
  if (!langName) return null;
  return loadLanguage(langName as Parameters<typeof loadLanguage>[0]);
}

export const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>(
  ({
    value,
    onChange,
    fileName = '',
    readOnly = false,
    fontSize = 14,
    autoFocus = false,
    onMount,
    onSearch,
    onCursorChange,
    onFontSizeChange,
    wordWrap = 'off',
  }, ref) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [isMobile, setIsMobile] = useState(false);
    const viewRef = useRef<EditorView | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const onSearchRef = useRef(onSearch);
    const onCursorChangeRef = useRef(onCursorChange);

    useEffect(() => {
      onSearchRef.current = onSearch;
    }, [onSearch]);

    useEffect(() => {
      onCursorChangeRef.current = onCursorChange;
    }, [onCursorChange]);

    useEffect(() => {
      const checkMobile = () => setIsMobile(window.innerWidth < 768);
      checkMobile();
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }, []);

    useImperativeHandle(ref, () => ({
      focus: () => viewRef.current?.focus(),
      undo: () => {
        if (!viewRef.current) return false;
        return undo(viewRef.current);
      },
      redo: () => {
        if (!viewRef.current) return false;
        return redo(viewRef.current);
      },
      getValue: () => viewRef.current?.state.doc.toString() ?? '',
      getView: () => viewRef.current,
    }));

    // 移动端双指捏合缩放字号
    useEffect(() => {
      const container = containerRef.current;
      if (!container || !onFontSizeChange) return;

      let initialDistance: number | null = null;
      let initialFontSize = fontSize;

      const getDistance = (touches: TouchList) => {
        if (touches.length < 2) return 0;
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      };

      const handleTouchStart = (e: TouchEvent) => {
        if (e.touches.length === 2) {
          initialDistance = getDistance(e.touches);
          initialFontSize = fontSize;
        }
      };

      const handleTouchMove = (e: TouchEvent) => {
        if (e.touches.length === 2 && initialDistance !== null) {
          e.preventDefault();
          const currentDistance = getDistance(e.touches);
          const scale = currentDistance / initialDistance;
          let newSize = Math.round(initialFontSize * scale);
          newSize = Math.max(10, Math.min(30, newSize));
          if (newSize !== fontSize) {
            onFontSizeChange(newSize);
          }
        }
      };

      const handleTouchEnd = (e: TouchEvent) => {
        if (e.touches.length < 2) {
          initialDistance = null;
        }
      };

      container.addEventListener('touchstart', handleTouchStart, { passive: true });
      container.addEventListener('touchmove', handleTouchMove, { passive: false });
      container.addEventListener('touchend', handleTouchEnd);
      container.addEventListener('touchcancel', handleTouchEnd);

      return () => {
        container.removeEventListener('touchstart', handleTouchStart);
        container.removeEventListener('touchmove', handleTouchMove);
        container.removeEventListener('touchend', handleTouchEnd);
        container.removeEventListener('touchcancel', handleTouchEnd);
      };
    }, [fontSize, onFontSizeChange]);

    const extensions = useMemo(() => {
      const exts: Extension[] = [
        ...basicSetup({
          lineNumbers: !isMobile,
          foldGutter: !isMobile,
          highlightActiveLineGutter: !isMobile,
          searchKeymap: false, // 自定义搜索快捷键
          tabSize: 2,
        }),
        EditorView.theme({
          '&': { fontSize: `${fontSize}px`, height: '100%', width: '100%' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-content': {
            fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', Menlo, Monaco, Consolas, monospace",
            lineHeight: '1.6',
            minHeight: '100%',
          },
          '.cm-gutters': {
            fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', Menlo, Monaco, Consolas, monospace",
          },
        }),
        searchHighlightField,
        searchTheme,
        isDark ? githubDark : githubLight,
        keymap.of([
          {
            key: 'Mod-f',
            run: () => {
              onSearchRef.current?.();
              return true;
            },
            preventDefault: true,
          },
        ]),
      ];

      const langExt = getLanguageExtension(fileName);
      if (langExt) exts.push(langExt);
      if (wordWrap === 'on') exts.push(EditorView.lineWrapping);

      return exts;
    }, [isMobile, fontSize, isDark, fileName, wordWrap]);

    const handleCreateEditor = useCallback((view: EditorView) => {
      viewRef.current = view;
      if (onMount) onMount();
    }, [onMount]);

    const handleUpdate = useCallback((update: ViewUpdate) => {
      if (update.selectionSet && onCursorChangeRef.current) {
        const { head } = update.state.selection.main;
        const line = update.state.doc.lineAt(head);
        onCursorChangeRef.current(`${line.number}:${head - line.from + 1}`);
      }
    }, []);

    return (
      <div ref={containerRef} className="w-full h-full bg-background overflow-hidden">
        <CodeMirror
          className="h-full w-full [&>div.cm-theme]:h-full"
          value={value}
          height="100%"
          theme="none"
          extensions={extensions}
          editable={!readOnly}
          readOnly={readOnly}
          autoFocus={autoFocus}
          onChange={(v) => onChange && onChange(v)}
          onCreateEditor={handleCreateEditor}
          onUpdate={handleUpdate}
          basicSetup={false}
        />
      </div>
    );
  }
);

CodeEditor.displayName = 'CodeEditor';
