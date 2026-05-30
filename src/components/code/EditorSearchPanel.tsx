import React, { useState, useEffect, useRef, useCallback } from 'react';
import { EditorView } from '@codemirror/view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { searchMatchesEffect } from './codemirror-search';

interface Match {
  from: number;
  to: number;
}

interface EditorSearchPanelProps {
  view: EditorView | null;
  visible: boolean;
  onClose: () => void;
  readOnly?: boolean;
  content: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMatches(
  text: string,
  searchText: string,
  useRegex: boolean,
  matchCase: boolean,
  wholeWord: boolean
): Match[] {
  if (!searchText) return [];

  let pattern: string;
  if (useRegex) {
    pattern = searchText;
  } else {
    pattern = escapeRegex(searchText);
  }
  if (wholeWord) {
    pattern = `\\b${pattern}\\b`;
  }

  const flags = matchCase ? 'g' : 'gi';
  try {
    const regex = new RegExp(pattern, flags);
    const matches: Match[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m[0] === '') {
        // 避免零宽匹配导致无限循环
        regex.lastIndex++;
        continue;
      }
      matches.push({ from: m.index, to: m.index + m[0].length });
    }
    return matches;
  } catch {
    return [];
  }
}

export function EditorSearchPanel({ view: editor, visible, onClose, readOnly, content }: EditorSearchPanelProps) {
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showReplace, setShowReplace] = useState(false);

  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);

  const [matches, setMatches] = useState<Match[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // 关闭时清空搜索
  useEffect(() => {
    if (!visible) {
      editor?.dispatch({ effects: searchMatchesEffect.of({ matches: [], activeIndex: -1 }) });
      setMatches([]);
    }
    if (visible) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [visible, editor]);

  const performSearch = useCallback(() => {
    if (!editor) return;

    if (!searchText) {
      editor.dispatch({ effects: searchMatchesEffect.of({ matches: [], activeIndex: -1 }) });
      setMatches([]);
      return;
    }

    const newMatches = findMatches(content, searchText, useRegex, matchCase, wholeWord);
    setMatches(newMatches);

    const activeIdx = currentIndex >= newMatches.length ? 0 : currentIndex;
    if (newMatches.length > 0 && currentIndex >= newMatches.length) {
      setCurrentIndex(0);
    }

    editor.dispatch({
      effects: searchMatchesEffect.of({ matches: newMatches, activeIndex: activeIdx }),
    });
  }, [editor, content, searchText, useRegex, matchCase, wholeWord, currentIndex]);

  // 搜索参数变化时重新搜索
  useEffect(() => {
    if (visible) {
      performSearch();
    }
  }, [performSearch, visible, searchText, useRegex, matchCase, wholeWord]);

  const revealMatch = (idx: number) => {
    if (!editor || matches.length === 0) return;
    const match = matches[idx];
    editor.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
    });
    editor.dispatch({
      effects: searchMatchesEffect.of({ matches, activeIndex: idx }),
    });
  };

  const nextMatch = () => {
    if (matches.length === 0) return;
    const nextIdx = (currentIndex + 1) % matches.length;
    setCurrentIndex(nextIdx);
    revealMatch(nextIdx);
  };

  const prevMatch = () => {
    if (matches.length === 0) return;
    const prevIdx = (currentIndex - 1 + matches.length) % matches.length;
    setCurrentIndex(prevIdx);
    revealMatch(prevIdx);
  };

  const handleReplace = () => {
    if (!editor || matches.length === 0 || readOnly) return;
    const match = matches[currentIndex];

    editor.dispatch({
      changes: { from: match.from, to: match.to, insert: replaceText },
    });
  };

  const handleReplaceAll = () => {
    if (!editor || matches.length === 0 || readOnly) return;

    // 从后往前替换，避免位置偏移
    const sorted = [...matches].sort((a, b) => b.from - a.from);
    editor.dispatch({
      changes: sorted.map((m) => ({ from: m.from, to: m.to, insert: replaceText })),
    });
  };

  // 文档变化时自动重新搜索
  useEffect(() => {
    if (!editor || !visible) return;
    
    // 使用节流避免频繁搜索导致卡顿
    const timer = setTimeout(() => {
      performSearch();
    }, 300);
    
    return () => clearTimeout(timer);
  }, [content, visible]);

  if (!visible) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 bg-card border-t border-border p-3 shadow-lg animate-in slide-in-from-bottom-2 duration-200">
      <div className="flex flex-col gap-3 max-w-2xl mx-auto w-full">
        <div className="flex justify-between items-center text-xs text-muted-foreground">
          <span>搜索结果: {matches.length > 0 ? `${currentIndex + 1} / ${matches.length}` : (searchText ? '0' : '')}</span>
          <div className="flex items-center gap-1">
            <Toggle size="sm" pressed={matchCase} onPressedChange={setMatchCase} className="h-6 px-2 text-xs font-mono data-[state=on]:bg-secondary" title="区分大小写">Cc</Toggle>
            <Toggle size="sm" pressed={wholeWord} onPressedChange={setWholeWord} className="h-6 px-2 text-xs font-mono data-[state=on]:bg-secondary" title="全字匹配">W</Toggle>
            <Toggle size="sm" pressed={useRegex} onPressedChange={setUseRegex} className="h-6 px-2 text-xs font-mono data-[state=on]:bg-secondary" title="正则表达式">.*</Toggle>
          </div>
        </div>

        <div className="flex items-center gap-1 relative">
          <Input
            ref={searchInputRef}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey) prevMatch();
                else nextMatch();
              }
            }}
            placeholder="查找"
            className="h-9 pr-8 bg-secondary/50 text-sm"
          />
          <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-7 w-7 text-muted-foreground" onClick={() => setShowReplace(!showReplace)}>
            {showReplace ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>

        {showReplace && !readOnly && (
          <div className="flex items-center gap-1">
            <Input
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleReplace();
                }
              }}
              placeholder="替换"
              className="h-9 bg-secondary/50 text-sm"
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" className="h-8 text-xs px-4 rounded-full" onClick={prevMatch} disabled={matches.length === 0}>
              上个
            </Button>
            <Button variant="secondary" size="sm" className="h-8 text-xs px-4 rounded-full" onClick={nextMatch} disabled={matches.length === 0}>
              下个
            </Button>
            {!readOnly && (
              <>
                <Button variant="secondary" size="sm" className="h-8 text-xs px-4 rounded-full" onClick={handleReplace} disabled={matches.length === 0 || !showReplace}>
                  替换
                </Button>
                <Button variant="secondary" size="sm" className="h-8 text-xs px-4 rounded-full" onClick={handleReplaceAll} disabled={matches.length === 0 || !showReplace}>
                  全部
                </Button>
              </>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground rounded-full" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
