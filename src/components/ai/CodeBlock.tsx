// AI 对话 — 代码容器：黑色背景、可折叠、一键复制
import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import i18n from '@/i18n';

const AUTO_COLLAPSE_LINES = 18;
const MAX_BODY_HEIGHT = 420;

export default function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const lines = useMemo(() => code.split('\n'), [code]);
  const collapsible = lines.length > AUTO_COLLAPSE_LINES;
  const [open, setOpen] = useState(!collapsible);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 忽略复制失败（部分 WebView 无剪贴板权限）
    }
  };

  return (
    <div className="my-2 w-full min-w-0 overflow-hidden rounded-xl bg-[#0d1117] ring-1 ring-white/10">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[10px] uppercase tracking-wide text-zinc-400 transition-colors hover:text-zinc-100"
        >
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span className="min-w-0 truncate font-mono normal-case">{lang || 'code'}</span>
          {collapsible && !open && (
            <span className="shrink-0 text-[10px] text-zinc-500">{i18n.t('{{count}} 行', { count: lines.length })}</span>
          )}
        </button>
        <button
          type="button"
          onClick={copy}
          title={i18n.t('复制代码')}
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
        >
          {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
          {copied ? i18n.t('已复制') : i18n.t('复制')}
        </button>
      </div>

      {open ? (
        <div className="overflow-auto" style={{ maxHeight: MAX_BODY_HEIGHT }}>
          <pre className="p-3 text-[12px] font-mono leading-relaxed whitespace-pre">
            <code className="text-zinc-100">{code}</code>
          </pre>
        </div>
      ) : (
        <div className="px-3 py-2 text-[11px] text-zinc-500">
          {i18n.t('代码已折叠，点击标题展开')}
        </div>
      )}
    </div>
  );
}