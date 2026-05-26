import { useMemo } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { useTheme } from '@/contexts/ThemeContext';
import { monaco } from '@/lib/monaco';
import type { editor } from 'monaco-editor';

// 强制 @monaco-editor/react 使用本地的 monaco 实例，不从 CDN 下载
loader.config({ monaco: monaco as any });

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  fileName?: string;
  readOnly?: boolean;
  fontSize?: number;
  autoFocus?: boolean;
  onMount?: (editor: editor.IStandaloneCodeEditor) => void;
}

// 扩展名到 Monaco language 映射
const extToLanguage: Record<string, string> = {
  js: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  json: 'json',
  html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', mdx: 'markdown',
  py: 'python',
  java: 'java',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', h: 'cpp', hpp: 'cpp',
  cs: 'csharp',
  go: 'go',
  rs: 'rust',
  php: 'php',
  rb: 'ruby',
  sh: 'shell', bash: 'shell',
  yaml: 'yaml', yml: 'yaml',
  xml: 'xml',
  sql: 'sql',
  vue: 'html',
  svelte: 'html',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  kt: 'kotlin',
  swift: 'swift',
  dart: 'dart',
  scala: 'scala',
  r: 'r',
  pl: 'perl',
  lua: 'lua',
  ps1: 'powershell',
  gradle: 'groovy',
  groovy: 'groovy',
  tf: 'hcl',
  toml: 'ini',
  ini: 'ini',
  diff: 'diff',
  patch: 'diff',
  log: 'log',
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
          fontSize,
          fontFamily:
            "ui-monospace, SFMono-Regular, 'Cascadia Code', 'Fira Code', Menlo, Monaco, Consolas, monospace",
          lineNumbers: 'on',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: 'on',
          tabSize: 2,
          detectIndentation: true,
          folding: true,
          foldingHighlight: true,
          renderLineHighlight: 'line',
          selectOnLineNumbers: true,
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            indentation: true,
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
            horizontal: 'auto',
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
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
