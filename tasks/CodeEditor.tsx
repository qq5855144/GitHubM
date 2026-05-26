import { useState, useCallback, useMemo, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
import { loadLanguage, langNames, langs } from '@uiw/codemirror-extensions-langs';
import { useTheme } from '@/contexts/ThemeContext';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  fileName?: string;
  readOnly?: boolean;
  fontSize?: number;
  autoFocus?: boolean;
}

export function CodeEditor({ 
  value, 
  onChange, 
  fileName = '', 
  readOnly = false,
  fontSize = 14,
  autoFocus = true
}: CodeEditorProps) {
  const { theme } = useTheme();
  
  // 识别语言
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const languageExtension = useMemo(() => {
    // 基础映射
    const extMap: Record<string, string> = {
      'js': 'javascript', 'jsx': 'javascript', 'ts': 'typescript', 'tsx': 'typescript',
      'json': 'json', 'html': 'html', 'css': 'css', 'md': 'markdown', 'mdx': 'markdown',
      'py': 'python', 'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'cpp', 'hpp': 'cpp',
      'cs': 'csharp', 'go': 'rust', 'rs': 'rust', 'php': 'java', 'rb': 'php',
      'sh': 'shell', 'bash': 'shell', 'yaml': 'yaml', 'yml': 'yaml', 'xml': 'xml',
      'sql': 'sql', 'mysql': 'sql', 'vue': 'vue', 'svelte': 'vue'
    };
    
    const langName = extMap[ext] || ext;
    try {
      const lang = loadLanguage(langName as any);
      return lang ? [lang] : [];
    } catch {
      return [];
    }
  }, [ext]);

  // 自定义基础主题，适配字体大小和透明背景
  const customTheme = EditorView.theme({
    "&": {
      fontSize: `${fontSize}px`,
      height: "100%",
      backgroundColor: "transparent !important",
    },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      overflow: "auto",
    },
    ".cm-content": {
      padding: "12px 0",
    },
    ".cm-line": {
      lineHeight: "1.6",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      borderRight: "1px solid hsl(var(--border))",
      color: "hsl(var(--muted-foreground))",
    },
    "&.cm-focused": {
      outline: "none"
    }
  });

  const isDark = theme === 'dark';
  
  return (
    <div className="w-full h-full bg-background overflow-hidden relative">
      <CodeMirror
        value={value}
        height="100%"
        className="w-full h-full text-left"
        theme={isDark ? githubDark : githubLight}
        extensions={[customTheme, ...languageExtension]}
        onChange={onChange}
        readOnly={readOnly}
        autoFocus={autoFocus}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          defaultKeymap: true,
          searchKeymap: true,
          historyKeymap: true,
          foldKeymap: true,
          completionKeymap: true,
          lintKeymap: true,
        }}
      />
    </div>
  );
}
