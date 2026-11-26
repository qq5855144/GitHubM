import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NetworkStatusBanner } from '@/components/NetworkStatusBanner';
import i18n from '@/i18n';

afterEach(() => vi.restoreAllMocks());

it('only displays a status banner on network recovery', () => {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
  render(<NetworkStatusBanner />);

  expect(screen.queryByRole('status')).toBeNull();
  act(() => { window.dispatchEvent(new Event('online')); });
  expect(screen.getByRole('status')).toHaveTextContent(i18n.t('网络已恢复'));
  act(() => { window.dispatchEvent(new Event('offline')); });
  expect(screen.queryByRole('status')).toBeNull();
});
