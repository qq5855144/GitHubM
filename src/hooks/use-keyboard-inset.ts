import { useEffect, useState } from 'react';

/**
 * 移动端软键盘遮挡高度（px）。
 *
 * 背景：Android 15 边到边（`setDecorFitsSystemWindows(false)`）之后，输入法弹出时
 * `window.innerHeight` 不会收缩，原生侧也不一定会把 IME inset 分发给 WebView，
 * 结果就是「底部固定输入条被键盘盖住」。
 * 但 Chromium 的 `visualViewport` 会随输入法收缩 —— 两者差值就是被键盘吃掉的高度。
 *
 * 用法：把返回值当作 `paddingBottom` 加在页面底部固定区域（输入条容器）上，
 * 输入框就会停在键盘上方。
 *
 * 自洽性：
 * - 若窗口本身被系统 resize（`innerHeight` 同步缩小），差值自然归零，不会重复补偿；
 * - 小于 80px 的变化视为滚动回弹/工具栏伸缩，不计入。
 */
export function useKeyboardInset(enabled = true): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setInset(0);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;

    let rafId = 0;
    const update = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const raw = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));
        const next = raw > 80 ? Math.round(raw) : 0;
        setInset(prev => (Math.abs(prev - next) > 1 ? next : prev));
      });
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('orientationchange', update);
    return () => {
      cancelAnimationFrame(rafId);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [enabled]);

  return inset;
}

export default useKeyboardInset;
