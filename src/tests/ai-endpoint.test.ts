import { describe, expect, it } from 'vitest';
import { normalizeBaseEndpoint, normalizeChatEndpoint } from '@/lib/ai-endpoint';

describe('custom endpoint normalization', () => {
  it('appends chat/completions to a base url', () => {
    expect(normalizeChatEndpoint('http://127.0.0.1:17890/v1')).toBe('http://127.0.0.1:17890/v1/chat/completions');
    expect(normalizeChatEndpoint('http://127.0.0.1:17890/v1/')).toBe('http://127.0.0.1:17890/v1/chat/completions');
    expect(normalizeChatEndpoint('  http://127.0.0.1:17890/v1  ')).toBe('http://127.0.0.1:17890/v1/chat/completions');
  });

  it('keeps a complete chat url unchanged', () => {
    expect(normalizeChatEndpoint('https://api.example.com/v1/chat/completions'))
      .toBe('https://api.example.com/v1/chat/completions');
  });

  it('strips chat/completions to get the base url', () => {
    expect(normalizeBaseEndpoint('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1');
    expect(normalizeBaseEndpoint('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
  });

  it('handles empty input', () => {
    expect(normalizeChatEndpoint('')).toBe('');
    expect(normalizeChatEndpoint(undefined)).toBe('');
    expect(normalizeBaseEndpoint('   ')).toBe('');
  });
});