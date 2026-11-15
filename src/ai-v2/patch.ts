// AI V2 — 将 unified diff 应用到已有文件
interface ParsedLine {
  type: '+' | '-' | ' ';
  text: string;
}

interface ParsedHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: ParsedLine[];
}

function parseHunks(diff: string): ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;
  for (const line of diff.replace(/\r\n/g, '\n').split('\n')) {
    const header = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('\\ No newline at end of file')) continue;
    if (line.startsWith('+')) current.lines.push({ type: '+', text: line.slice(1) });
    else if (line.startsWith('-')) current.lines.push({ type: '-', text: line.slice(1) });
    else if (line.startsWith(' ')) current.lines.push({ type: ' ', text: line.slice(1) });
    else if (line === '') current.lines.push({ type: ' ', text: '' });
  }
  if (!hunks.length) throw new Error('没有找到可应用的 @@ Hunk');
  return hunks;
}

export function applyUnifiedDiff(original: string, diff: string): string {
  const hunks = parseHunks(diff);
  const oldLines = original.replace(/\r\n/g, '\n').split('\n');
  const output: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const start = Math.max(0, hunk.oldStart - 1);
    if (start < cursor) throw new Error(`Hunk 位置重叠：@@ -${hunk.oldStart}`);
    if (start > oldLines.length) throw new Error(`Hunk 超出文件范围：@@ -${hunk.oldStart}`);
    output.push(...oldLines.slice(cursor, start));
    let index = start;

    for (const line of hunk.lines) {
      if (line.type === '+') {
        output.push(line.text);
        continue;
      }
      if (index >= oldLines.length || oldLines[index] !== line.text) {
        throw new Error(`第 ${index + 1} 行与当前文件不一致，可能已被修改`);
      }
      if (line.type === ' ') output.push(line.text);
      index++;
    }
    cursor = index;
  }

  output.push(...oldLines.slice(cursor));
  return output.join('\n');
}

export function diffStats(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions };
}