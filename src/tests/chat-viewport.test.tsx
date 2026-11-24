import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChatViewport } from '@/hooks/use-chat-viewport';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function typingField() {
  const textarea = document.createElement('textarea');
  document.body.append(textarea);
  textarea.focus();
  return textarea;
}

function visualViewport() {
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  return viewport;
}

describe('browser chat viewport', () => {
  it('fits the visible viewport once and follows keyboard panning, then restores after close', async () => {
    vi.stubGlobal('innerHeight', 800);
    const visual = visualViewport();
    const { result } = renderHook(() => useChatViewport(true));
    expect(result.current).toEqual({ top: 0, height: 800, keyboardOpen: false });

    act(() => {
      typingField();
      visual.height = 480;
      visual.offsetTop = 40;
      visual.dispatchEvent(new Event('resize'));
    });
    await waitFor(() => expect(result.current).toEqual({ top: 40, height: 480, keyboardOpen: true }));

    act(() => {
      visual.offsetTop = 60;
      visual.dispatchEvent(new Event('scroll'));
    });
    await waitFor(() => expect(result.current?.top).toBe(60));

    act(() => {
      visual.height = 800;
      visual.offsetTop = 0;
      visual.dispatchEvent(new Event('resize'));
    });
    await waitFor(() => expect(result.current).toEqual({ top: 0, height: 800, keyboardOpen: false }));
    expect(document.activeElement).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('detects a resized layout without visualViewport, even when focus remains after keyboard close', async () => {
    vi.stubGlobal('innerHeight', 800);
    vi.stubGlobal('visualViewport', undefined);
    const { result } = renderHook(() => useChatViewport(true));
    act(() => {
      typingField();
      vi.stubGlobal('innerHeight', 480);
      window.dispatchEvent(new Event('resize'));
    });
    await waitFor(() => expect(result.current).toEqual({ top: 0, height: 480, keyboardOpen: true }));

    act(() => {
      vi.stubGlobal('innerHeight', 800);
      window.dispatchEvent(new Event('resize'));
    });
    await waitFor(() => expect(result.current).toEqual({ top: 0, height: 800, keyboardOpen: false }));
    expect(document.activeElement).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('ignores a stale visual height when the browser also shrank the layout', async () => {
    vi.stubGlobal('innerHeight', 800);
    const visual = visualViewport();
    const { result } = renderHook(() => useChatViewport(true));
    act(() => {
      typingField();
      vi.stubGlobal('innerHeight', 480);
      visual.height = 520;
      visual.dispatchEvent(new Event('resize'));
    });
    await waitFor(() => expect(result.current).toEqual({ top: 0, height: 480, keyboardOpen: true }));
  });

  it('uses reported overlay keyboard geometry and ignores visual changes from pinch zoom', async () => {
    vi.stubGlobal('innerHeight', 800);
    const visual = visualViewport();
    const keyboard = Object.assign(new EventTarget(), { boundingRect: { top: 800, bottom: 800, height: 0 } });
    const original = Object.getOwnPropertyDescriptor(navigator, 'virtualKeyboard');
    Object.defineProperty(navigator, 'virtualKeyboard', { value: keyboard, configurable: true });
    try {
      const { result } = renderHook(() => useChatViewport(true));
      act(() => {
        typingField();
        keyboard.boundingRect = { top: 510, bottom: 800, height: 290 };
        keyboard.dispatchEvent(new Event('geometrychange'));
      });
      await waitFor(() => expect(result.current).toEqual({ top: 0, height: 510, keyboardOpen: true }));

      act(() => {
        keyboard.boundingRect = { top: 800, bottom: 800, height: 0 };
        keyboard.dispatchEvent(new Event('geometrychange'));
        visual.height = 400;
        visual.scale = 2;
        visual.dispatchEvent(new Event('resize'));
      });
      await waitFor(() => expect(result.current).toEqual({ top: 0, height: 800, keyboardOpen: false }));
    } finally {
      if (original) Object.defineProperty(navigator, 'virtualKeyboard', original);
      else Reflect.deleteProperty(navigator, 'virtualKeyboard');
    }
  });

  it('does not apply browser positioning inside the native app', () => {
    vi.stubGlobal('innerHeight', 480);
    const visual = visualViewport();
    const listener = vi.spyOn(visual, 'addEventListener');
    const { result } = renderHook(() => useChatViewport(false));
    expect(result.current).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });
});
