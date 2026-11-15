import { describe, expect, it } from 'vitest';
import { applyUnifiedDiff, diffStats } from '@/ai-v2/patch';

const diff = `--- a.txt
+++ a.txt
@@ -1,3 +1,3 @@
 line1
-line2
+changed
 line3`;

describe('AI patch apply', () => {
  it('applies a unified diff', () => {
    expect(applyUnifiedDiff('line1\nline2\nline3', diff)).toBe('line1\nchanged\nline3');
  });

  it('applies multiple hunks', () => {
    const multiple = `--- a.txt
+++ a.txt
@@ -1,2 +1,2 @@
 a
-b
+B
@@ -4,2 +4,3 @@
 d
 e
+f`;
    expect(applyUnifiedDiff('a\nb\nc\nd\ne', multiple)).toBe('a\nB\nc\nd\ne\nf');
  });

  it('fails when the file has changed', () => {
    expect(() => applyUnifiedDiff('line1\nother\nline3', diff)).toThrow('不一致');
  });

  it('counts additions and deletions', () => {
    expect(diffStats(diff)).toEqual({ additions: 1, deletions: 1 });
  });
});