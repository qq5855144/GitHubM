import { useMemo, useEffect, useState } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { useTheme } from '@/contexts/ThemeContext';
import type { editor } from 'monaco-editor';

// 配置 Monaco 从国内镜像加载，并设置中文包
loader.config({
  paths: {
    vs: 'https://registry.npmmirror.com/monaco-editor/0.55.1/files/min/vs'
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
  onMount?: (editor: editor.IStandaloneCodeEditor) => void;
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
}: CodeEditorProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const language = useMemo(() => getLanguage(fileName), [fileName]);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return (
    <div className="w-full h-full bg-background overflow-hidden">
      <Editor
        value={value}
        language={language}
        theme={isDark ? 'vs-dark' : 'light'}
        onChange={(v) => onChange && onChange(v ?? '')}
        onMount={(editor) => {
          if (onMount) onMount(editor);
          if (autoFocus) {
            editor.focus();
          }
        }}
        options={{
          readOnly,
          fontSize: isMobile ? 12 : fontSize,
          fontFamily: "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', Menlo, Monaco, Consolas, monospace",
          lineNumbers: isMobile ? 'off' : 'on',
          lineNumbersMinChars: isMobile ? 0 : 3,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: isMobile ? 'on' : 'off', // 移动端自动换行，避免横向滚动条影响阅读体验
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
          contextmenu: true,
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
            horizontal: isMobile ? 'hidden' : 'auto',
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
