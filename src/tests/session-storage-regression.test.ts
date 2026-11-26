import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { idbGet, idbKeys, idbSet } from '@/ai-v2/idbKv';
import { getImageBlob, putImageBlob } from '@/ai-v2/imageStore';
import {
  clearLocalSessions, collectSessionImages, countLocalSessions, deleteSessionMessages,
  loadSessionIndex, loadSessionMessages, registerSessionClearGuard,
  saveSessionIndex, saveSessionMessages,
} from '@/ai-v2/sessionStore';
import { clearRunSnapshot, latestRunSnapshot, saveRunSnapshot } from '@/ai-v2/runStore';
import type { UiChatMessage } from '@/ai-v2/types';

const createdAt = '2025-01-01T00:00:00Z';
const meta = (id: string) => ({ id, title: id, repo: null, createdAt, updatedAt: createdAt });
const messages = (count: number): UiChatMessage[] => Array.from({ length: count }, (_, index) => ({
  id: String(index), role: 'user', content: `Message ${index}`, createdAt,
}));

async function saveIndex(login: string, ids: string[]) {
  await expect(saveSessionIndex(login, { sessions: ids.map(meta), activeId: ids[0] })).resolves.toMatchObject({ ok: true });
}

describe('AI conversation persistence', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearLocalSessions();
  });

  it('opens legacy history, replaces only changed chunks and removes stale chunks after editing', async () => {
    const original = messages(60);
    await idbSet('session_messages:alice:one', original);
    expect(await loadSessionMessages('alice', 'one')).toEqual(original);

    expect(await saveSessionMessages('alice', 'one', original)).toMatchObject({ ok: true });
    const revised = [...original.slice(0, 51), { ...original[51], content: 'Changed' }];
    let projected = 0;
    await saveSessionMessages('alice', 'one', revised, 51, message => { projected++; return message; });
    expect(projected).toBe(4);
    expect(await loadSessionMessages('alice', 'one')).toEqual(revised);

    await saveSessionMessages('alice', 'one', revised.slice(0, 24), 24);
    expect(await idbKeys('session_message_chunk:alice:one:')).toHaveLength(1);
    expect(await loadSessionMessages('alice', 'one')).toEqual(original.slice(0, 24));
  });

  it('clears all account indexes, legacy data, fallback shards and attachment blobs', async () => {
    await saveIndex('alice', ['db']);
    await saveSessionMessages('alice', 'db', messages(25));
    localStorage.setItem('githubm_ai_v2_store:bob', JSON.stringify({ sessions: [meta('local')], activeId: 'local' }));
    localStorage.setItem('githubm_ai_v2_msgs:bob:local', JSON.stringify(messages(5)));
    localStorage.setItem('githubm_ai_v2_session:old', JSON.stringify({ messages: messages(4) }));
    await idbSet('sessions:legacy', { sessions: [{ ...meta('legacy'), messages: messages(3) }], activeId: 'legacy' });
    await putImageBlob('private-image', new Blob(['a']));
    await idbSet('test-independent-data', true);

    expect(await countLocalSessions()).toHaveLength(4);
    const unregister = registerSessionClearGuard(() => false);
    expect(await clearLocalSessions()).toBe(false);
    unregister();
    expect(await clearLocalSessions()).toBe(true);

    expect(await countLocalSessions()).toEqual([]);
    for (const login of ['alice', 'bob', 'legacy']) expect(await loadSessionIndex(login)).toBeNull();
    expect(await loadSessionMessages('alice', 'db')).toEqual([]);
    expect(await loadSessionMessages('bob', 'local')).toEqual([]);
    expect(await idbKeys('session_message_chunk:')).toEqual([]);
    expect(await idbKeys('attach_img:')).toEqual([]);
    expect(localStorage.getItem('githubm_ai_v2_session:old')).toBeNull();
    expect(await idbGet('test-independent-data')).toBe(true);
  });

  it('retains an attachment until its last conversation reference is deleted', async () => {
    await saveIndex('alice', ['first', 'second']);
    const [item] = messages(1);
    item.attachments = [{
      id: 'image', imageBlobId: 'shared', name: 'image.png', kind: 'image', source: 'local', size: 1, content: '',
    }];
    await putImageBlob('shared', new Blob(['x']));
    await saveSessionMessages('alice', 'first', [item]);
    await saveSessionMessages('alice', 'second', [item]);

    await deleteSessionMessages('alice', 'first');
    await collectSessionImages(new Set(['shared']));
    expect(await idbKeys('attach_img:')).toEqual(['attach_img:shared']);
    await deleteSessionMessages('alice', 'second');
    await collectSessionImages(new Set(['shared']));
    expect(await getImageBlob('shared')).toBeNull();
    expect(await idbKeys('attach_img:')).toEqual([]);
  });

  it('keeps pending writes across many other checkpoints and blocks destructive cleanup while unresolved', async () => {
    await saveIndex('alice', ['s0']);
    const template = { assistantId: 'a', title: 'continue', messages: [], capabilities: [], steps: 5, savedAt: createdAt };
    await saveRunSnapshot('alice', {
      ...template, runId: 'original', sessionId: 's0', writeInFlight: true,
      pendingWrite: { id: 'action', callId: 'call', tool: 'update' },
    });
    await Promise.all(Array.from({ length: 16 }, (_, index) => saveRunSnapshot('alice', {
      ...template, runId: `newer-${index}`, sessionId: `s${index}`,
    })));
    expect(await latestRunSnapshot('alice', 's0')).toMatchObject({ runId: 'original', writeInFlight: true });
    expect(await clearLocalSessions()).toBe(false);
    await clearRunSnapshot('alice', 'original');
    expect(await clearLocalSessions()).toBe(true);
  });
});
