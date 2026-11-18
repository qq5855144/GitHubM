import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSecureItem, setSecureItem, removeSecureItem } from '@/lib/secureStorage';

interface Bridge {
  secureGet?: (key: string) => string | null;
  secureSet?: (key: string, value: string) => boolean;
  secureRemove?: (key: string) => void;
}

function setBridge(bridge?: Bridge) {
  Object.defineProperty(window, 'AndroidBridge', {
    value: bridge,
    configurable: true,
    writable: true,
  });
}

describe('secureStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    setBridge(undefined);
  });

  afterEach(() => {
    setBridge(undefined);
    localStorage.clear();
  });

  it('falls back to localStorage without AndroidBridge', () => {
    setSecureItem('token', 'plain');
    expect(localStorage.getItem('token')).toBe('plain');
    expect(getSecureItem('token')).toBe('plain');
    removeSecureItem('token');
    expect(getSecureItem('token')).toBeNull();
  });

  it('migrates an existing localStorage value into secure storage once', () => {
    const store = new Map<string, string>();
    const secureSet = vi.fn((key: string, value: string) => {
      store.set(key, value);
      return true;
    });
    setBridge({
      secureGet: key => store.get(key) ?? null,
      secureSet,
      secureRemove: key => store.delete(key),
    });
    localStorage.setItem('token', 'legacy-token');

    expect(getSecureItem('token')).toBe('legacy-token');
    expect(secureSet).toHaveBeenCalledWith('token', 'legacy-token');
    expect(localStorage.getItem('token')).toBeNull();
    expect(getSecureItem('token')).toBe('legacy-token');
  });

  it('writes through the bridge and keeps localStorage empty', () => {
    const store = new Map<string, string>();
    setBridge({
      secureGet: key => store.get(key) ?? null,
      secureSet: (key, value) => { store.set(key, value); return true; },
      secureRemove: key => store.delete(key),
    });

    setSecureItem('token', 'secure-token');
    expect(localStorage.getItem('token')).toBeNull();
    expect(getSecureItem('token')).toBe('secure-token');

    removeSecureItem('token');
    expect(getSecureItem('token')).toBeNull();
  });
});
