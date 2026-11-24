import { useLayoutEffect, useState } from 'react';

export interface ChatViewport {
  top: number;
  height: number;
  keyboardOpen: boolean;
}

const KEYBOARD_THRESHOLD = 80;
const NON_TYPING_INPUTS = new Set([
  'button', 'checkbox', 'color', 'date', 'datetime-local', 'file', 'hidden', 'image',
  'month', 'radio', 'range', 'reset', 'submit', 'time', 'week',
]);

function hasTypingFocus(): boolean {
  const element = document.activeElement;
  if (element instanceof HTMLInputElement) {
    return !element.readOnly && !NON_TYPING_INPUTS.has(element.type) && element.inputMode !== 'none';
  }
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && element.inputMode !== 'none';
  return element instanceof HTMLElement && element.isContentEditable && element.inputMode !== 'none';
}

type VirtualKeyboardGeometry = EventTarget & {
  boundingRect: Pick<DOMRectReadOnly, 'top' | 'bottom' | 'height'>;
};

export function useChatViewport(enabled: boolean): ChatViewport | null {
  const [viewport, setViewport] = useState<ChatViewport | null>(null);

  useLayoutEffect(() => {
    if (!enabled) return;
    const visual = window.visualViewport;
    const keyboard = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardGeometry }).virtualKeyboard;
    let frame = 0;
    let restingHeight = 0;
    let previousWidth = 0;
    let keyboardOpen = false;

    const measure = () => {
      const windowHeight = window.innerHeight || document.documentElement.clientHeight;
      const layoutHeight = Math.min(windowHeight, document.documentElement.clientHeight || windowHeight);
      if (layoutHeight <= 0) return;

      const useVisualViewport = visual && visual.height > 0 && Math.abs(visual.scale - 1) < 0.05;
      const top = useVisualViewport ? Math.min(layoutHeight - 1, Math.max(0, visual.offsetTop)) : 0;
      let bottom = useVisualViewport ? Math.min(layoutHeight, top + visual.height) : layoutHeight;
      const keyboardRect = keyboard?.boundingRect;
      const keyboardOverlaysBottom = Boolean(keyboardRect && keyboardRect.height > 0
        && keyboardRect.bottom >= bottom - 1 && keyboardRect.top >= top);
      if (keyboardOverlaysBottom && keyboardRect) bottom = Math.min(bottom, keyboardRect.top);

      const height = Math.max(1, Math.round(bottom - top));
      const focused = hasTypingFocus();
      const width = window.innerWidth;
      if (width !== previousWidth) {
        // 双视口一起缩小时，旋转后的第一帧也可能已经处于键盘打开状态。
        restingHeight = keyboardOpen && focused ? height + KEYBOARD_THRESHOLD : layoutHeight;
        previousWidth = width;
      }

      keyboardOpen = keyboardOverlaysBottom || ((focused || keyboardOpen) && (
        layoutHeight - height >= KEYBOARD_THRESHOLD || restingHeight - height >= KEYBOARD_THRESHOLD
      ));
      if (!keyboardOpen && (!focused || height > restingHeight)) restingHeight = height;

      const roundedTop = Math.round(top);
      setViewport(previous => previous?.top === roundedTop
        && previous.height === height && previous.keyboardOpen === keyboardOpen
        ? previous
        : { top: roundedTop, height, keyboardOpen });
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    visual?.addEventListener('resize', schedule);
    visual?.addEventListener('scroll', schedule);
    keyboard?.addEventListener('geometrychange', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      visual?.removeEventListener('resize', schedule);
      visual?.removeEventListener('scroll', schedule);
      keyboard?.removeEventListener('geometrychange', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
    };
  }, [enabled]);

  return enabled ? viewport : null;
}
