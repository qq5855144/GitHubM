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

  it('refuses plaintext fallback when the native bridge write fails', () => {
    setBridge({
      secureGet: () => null,
      secureSet: () => false,
      secureRemove: () => undefined,
    });
    expect(() => setSecureItem('token', 'secret-token')).toThrow('安全存储不可用');
    expect(localStorage.getItem('token')).toBeNull();
  });
  it('does not read a legacy plaintext value when the native bridge read fails', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setBridge({
      secureGet: () => { throw new Error('keystore broken'); },
      secureSet: () => false,
      secureRemove: () => undefined,
    });
    localStorage.setItem('token', 'legacy-plaintext');
    expect(getSecureItem('token')).toBeNull();
    errorSpy.mockRestore();
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
