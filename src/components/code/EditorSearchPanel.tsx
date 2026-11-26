import { useState, useEffect, useMemo, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { searchMatchesEffect } from './codemirror-search';
import i18n from "@/i18n";

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
): Match[] | null {
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
    return null;
  }
}

export function EditorSearchPanel({ view: editor, visible, onClose, readOnly, content }: EditorSearchPanelProps) {
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showReplace, setShowReplace] = useState(false);

  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);

  const [currentIndex, setCurrentIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const result = useMemo(() => visible ? findMatches(content, searchText, useRegex, matchCase, wholeWord) : [],
    [visible, content, searchText, useRegex, matchCase, wholeWord]);
  const matches = result ?? [];
  const activeIndex = Math.min(currentIndex, Math.max(0, matches.length - 1));

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  useEffect(() => {
    editor?.dispatch({ effects: searchMatchesEffect.of({ matches: result ?? [], activeIndex: result?.length ? activeIndex : -1 }) });
  }, [editor, result, activeIndex]);

  const revealMatch = (idx: number) => {
    if (!editor || matches.length === 0) return;
    const match = matches[idx];
    editor.dispatch({
      selection: { anchor: match.from, head: match.to },
      effects: EditorView.scrollIntoView(match.from, { y: 'center' }),
    });
  };

  const nextMatch = () => {
    if (matches.length === 0) return;
    const nextIdx = (activeIndex + 1) % matches.length;
    setCurrentIndex(nextIdx);
    revealMatch(nextIdx);
  };

  const prevMatch = () => {
    if (matches.length === 0) return;
    const prevIdx = (activeIndex - 1 + matches.length) % matches.length;
    setCurrentIndex(prevIdx);
    revealMatch(prevIdx);
  };

  const handleReplace = () => {
    if (!editor || matches.length === 0 || readOnly) return;
    const match = matches[activeIndex];

    editor.dispatch({
      changes: { from: match.from, to: match.to, insert: replaceText },
    });
  };

  const handleReplaceAll = () => {
    if (!editor || matches.length === 0 || readOnly) return;

    editor.dispatch({
      changes: matches.map(({ from, to }) => ({ from, to, insert: replaceText })),
    });
  };

  if (!visible) return null;

  return (
    <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-border bg-card px-3 py-2">
      <div className="flex flex-col gap-3 max-w-2xl mx-auto w-full">
        <div className="flex justify-between items-center text-xs text-muted-foreground">
          <span aria-live="polite" className={!result ? 'text-destructive' : undefined}>
            {!result ? i18n.t('正则表达式无效') : `${i18n.t('搜索结果:')}${matches.length > 0 ? `${activeIndex + 1} / ${matches.length}` : (searchText ? '0' : '')}`}
          </span>
          <div className="flex items-center gap-1">
            <Toggle size="sm" pressed={matchCase} onPressedChange={pressed => { setMatchCase(pressed); setCurrentIndex(0); }} className="h-6 px-2 text-xs font-mono data-[state=on]:bg-secondary" title={i18n.t('区分大小写')}>Cc</Toggle>
            <Toggle size="sm" pressed={wholeWord} onPressedChange={pressed => { setWholeWord(pressed); setCurrentIndex(0); }} className="h-6 px-2 text-xs font-mono data-[state=on]:bg-secondary" title={i18n.t('全字匹配')}>W</Toggle>
            <Toggle size="sm" pressed={useRegex} onPressedChange={pressed => { setUseRegex(pressed); setCurrentIndex(0); }} className="h-6 px-2 text-xs font-mono data-[state=on]:bg-secondary" title={i18n.t('正则表达式')}>.*</Toggle>
          </div>
        </div>

        <div className="flex items-center gap-1 relative">
          <Input
            ref={searchInputRef}
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setCurrentIndex(0); }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter') {
                if (!editor || !matches.length) return;
                const selection = editor.state.selection.main;
                const match = matches[activeIndex];
                if (selection.from !== match.from || selection.to !== match.to) revealMatch(activeIndex);
                else if (e.shiftKey) prevMatch();
                else nextMatch();
              }
            }}
            placeholder={i18n.t('查找')}
            aria-label={i18n.t('查找')}
            aria-invalid={!result}
            className={readOnly ? "h-9 bg-secondary/50 text-sm" : "h-9 pr-8 bg-secondary/50 text-sm"}
          />
          {!readOnly && (
            <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-7 w-7 text-muted-foreground"
              aria-label={i18n.t('替换')} aria-expanded={showReplace} onClick={() => setShowReplace(!showReplace)}>
              {showReplace ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          )}
        </div>

        {showReplace && !readOnly && (
          <div className="flex items-center gap-1">
            <Input
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Escape') onClose();
                if (e.key === 'Enter') handleReplace();
              }}
              placeholder={i18n.t('替换')}
              aria-label={i18n.t('替换')}
              className="h-9 bg-secondary/50 text-sm"
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button variant="secondary" size="sm" className="h-8 text-xs px-4 rounded-full" onClick={prevMatch} disabled={matches.length === 0}>
              {i18n.t('上个')}</Button>
            <Button variant="secondary" size="sm" className="h-8 text-xs px-4 rounded-full" onClick={nextMatch} disabled={matches.length === 0}>
              {i18n.t('下个')}</Button>
            {!readOnly && (
              <>
                <Button variant="secondary" size="sm" className="h-8 text-xs px-4 rounded-full" onClick={handleReplace} disabled={matches.length === 0 || !showReplace}>
                  {i18n.t('替换')}</Button>
                <Button variant="secondary" size="sm" className="h-8 text-xs px-4 rounded-full" onClick={handleReplaceAll} disabled={matches.length === 0 || !showReplace}>
                  {i18n.t('全部')}</Button>
              </>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground rounded-full" aria-label={i18n.t('关闭搜索')} onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
