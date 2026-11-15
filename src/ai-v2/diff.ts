// AI V2 — 轻量行级 Diff（用于写操作确认预览）
export function buildUnifiedDiff(
  oldText: string,
  newText: string,
  options: { context?: number; maxLines?: number } = {},
): string {
  const context = options.context ?? 2;
  const maxLines = options.maxLines ?? 400;
  const oldLines = oldText ? oldText.replace(/\r\n/g, '\n').split('\n') : [];
  const newLines = newText ? newText.replace(/\r\n/g, '\n').split('\n') : [];
  if (oldLines.length > 700 || newLines.length > 700) {
    return [
      `旧文件 ${oldLines.length} 行 → 新文件 ${newLines.length} 行`,
      `新增 ${Math.max(0, newLines.length - oldLines.length)} 行，删除 ${Math.max(0, oldLines.length - newLines.length)} 行`,
      '（文件较大，已省略逐行 Diff，请查看内容预览）',
    ].join('\n');
  }

  // LCS 行级 diff
  const n = oldLines.length;
  const m = newLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: Array<{ type: ' ' | '-' | '+'; text: string; oldLine?: number; newLine?: number }> = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: ' ', text: oldLines[i], oldLine: oldNo++, newLine: newNo++ });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: '-', text: oldLines[i], oldLine: oldNo++ });
      i++;
    } else {
      ops.push({ type: '+', text: newLines[j], newLine: newNo++ });
      j++;
    }
  }
  while (i < n) ops.push({ type: '-', text: oldLines[i++], oldLine: oldNo++ });
  while (j < m) ops.push({ type: '+', text: newLines[j++], newLine: newNo++ });

  const changed = ops
    .map((op, index) => op.type === ' ' ? -1 : index)
    .filter(index => index >= 0);
  if (!changed.length) return '没有内容变化。';

  const keep = new Set<number>();
  for (const index of changed) {
    for (let k = index - context; k <= index + context; k++) {
      if (k >= 0 && k < ops.length) keep.add(k);
    }
  }

  const out: string[] = [];
  let previous = -2;
  for (let index = 0; index < ops.length; index++) {
    if (!keep.has(index)) continue;
    if (index > previous + 1) out.push('...');
    const op = ops[index];
    const oldStart = op.oldLine ?? ops.slice(0, index + 1).reverse().find(item => item.oldLine)?.oldLine ?? 1;
    const newStart = op.newLine ?? ops.slice(0, index + 1).reverse().find(item => item.newLine)?.newLine ?? 1;
    if (index === 0 || (index > previous + 1)) {
      out.push(`@@ -${oldStart} +${newStart} @@`);
    }
    out.push(`${op.type}${op.text}`);
    previous = index;
    if (out.length >= maxLines) {
      out.push('...（Diff 已截断）');
      break;
    }
  }
  return out.join('\n');
}