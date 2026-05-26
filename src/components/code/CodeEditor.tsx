import { useMemo, useEffect, useState, useRef } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { useTheme } from '@/contexts/ThemeContext';
import type { editor } from 'monaco-editor';

const base = import.meta.env.BASE_URL || '/';
const vsPath = base.endsWith('/') ? `${base}vs` : `${base}/vs`;

// 配置 Monaco 从本地 /vs 目录加载（极大提升加载速度），并配置原生中文包
loader.config({
  paths: {
    vs: vsPath
  },
  'vs/nls': {
    availableLanguages: {
      '*': 'zh-cn'
    }
  }
});

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  fileName?: string;
  readOnly?: boolean;
  fontSize?: number;
  autoFocus?: boolean;
  onMount?: (editor: editor.IStandaloneCodeEditor, monaco: any) => void;
  onSearch?: () => void;
  onCursorChange?: (position: string) => void;
  onSyntaxError?: (errors: { line: number; column: number; message: string }[]) => void;
  onFontSizeChange?: (newSize: number) => void;
  wordWrap?: 'on' | 'off';
}

const extToLanguage: Record<string, string> = {
  js: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  json: 'json', html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', mdx: 'markdown', py: 'python',
  java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', h: 'cpp', hpp: 'cpp',
  cs: 'csharp', go: 'go', rs: 'rust', php: 'php', rb: 'ruby',
  sh: 'shell', bash: 'shell', yaml: 'yaml', yml: 'yaml',
  xml: 'xml', sql: 'sql', vue: 'html', svelte: 'html',
  dockerfile: 'dockerfile', docker: 'dockerfile', kt: 'kotlin',
  swift: 'swift', dart: 'dart', scala: 'scala', r: 'r',
  pl: 'perl', lua: 'lua', ps1: 'powershell', gradle: 'groovy',
  groovy: 'groovy', tf: 'hcl', toml: 'ini', ini: 'ini',
  diff: 'diff', patch: 'diff', log: 'log',
};

function getLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return extToLanguage[ext] || ext || 'plaintext';
}

export function CodeEditor({
  value,
  onChange,
  fileName = '',
  readOnly = false,
  fontSize = 14,
  autoFocus = false,
  onMount,
  onSearch,
  onCursorChange,
  onSyntaxError,
  onFontSizeChange,
  wordWrap = 'off',
}: CodeEditorProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const language = useMemo(() => getLanguage(fileName), [fileName]);
  const [isMobile, setIsMobile] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 移动端双指捏合缩放字号逻辑
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
        // 不阻止默认行为，以免影响其他触摸，但我们可以依赖 touchmove
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && initialDistance !== null) {
        e.preventDefault(); // 阻止浏览器默认缩放
        const currentDistance = getDistance(e.touches);
        const scale = currentDistance / initialDistance;
        // 放大或缩小字号，敏感度可调
        let newSize = Math.round(initialFontSize * scale);
        // 限制字号在 10 到 30 之间
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

  return (
    <div ref={containerRef} className="w-full h-full bg-background overflow-hidden touch-none md:touch-auto">
      <Editor
        value={value}
        language={language}
        theme={isDark ? 'vs-dark' : 'light'}
        onChange={(v) => onChange && onChange(v ?? '')}
        onMount={(editor, monaco) => {
          if (onSearch) {
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
              onSearch();
            });
          }
          if (onCursorChange) {
            editor.onDidChangeCursorPosition((e) => {
              onCursorChange(`${e.position.lineNumber}:${e.position.column}`);
            });
          }
          if (onSyntaxError) {
            editor.onDidChangeModelDecorations(() => {
              const model = editor.getModel();
              if (model) {
                const markers = monaco.editor.getModelMarkers({ resource: model.uri });
                const errors = markers
                  .filter((marker: any) => marker.severity === monaco.MarkerSeverity.Error)
                  .map((marker: any) => ({
                    line: marker.startLineNumber,
                    column: marker.startColumn,
                    message: marker.message,
                  }));
                onSyntaxError(errors);
              }
            });
          }
          if (onMount) onMount(editor, monaco);
          if (autoFocus) {
            editor.focus();
          }
        }}
        options={{
          readOnly,
          fontSize: fontSize,
          fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', Menlo, Monaco, Consolas, monospace",
          lineNumbers: isMobile ? 'off' : 'on',
          lineNumbersMinChars: isMobile ? 0 : 3,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap,
          tabSize: 2,
          detectIndentation: true,
          folding: !isMobile, // 移动端可以关闭折叠，节省空间
          foldingHighlight: true,
          renderLineHighlight: 'line',
          selectOnLineNumbers: true,
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: !isMobile, // 移动端隐藏缩进线使视图更干净
          },
          padding: { top: 12, bottom: 12 },
          contextmenu: !isMobile, // 移动端禁用默认右键菜单，以便长按可以进行原生文本选择
          quickSuggestions: true,
          suggestOnTriggerCharacters: true,
          wordBasedSuggestions: 'currentDocument',
          smoothScrolling: true,
          cursorBlinking: 'smooth',
          cursorSmoothCaretAnimation: 'on',
          colorDecorators: true,
          scrollbar: {
            useShadows: false,
            verticalHasArrows: false,
            horizontalHasArrows: false,
            vertical: 'auto',
            horizontal: isMobile ? (wordWrap === 'on' ? 'hidden' : 'auto') : 'auto',
            verticalScrollbarSize: isMobile ? 4 : 8,
            horizontalScrollbarSize: isMobile ? 4 : 8,
          },
        }}
        loading={
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
            编辑器加载中...
          </div>
        }
      />
    </div>
  );
}
