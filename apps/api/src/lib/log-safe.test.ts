import { describe, expect, it } from 'vitest';
import { reqForLog, safeUrl } from './log-safe';

describe('what the log keeps of a request', () => {
  it('never writes a link that is itself a secret', () => {
    expect(safeUrl('/api/public/booking/abcd1234efgh5678/cancel')).toBe('/api/public/booking/abcd…/cancel');
    expect(safeUrl('/api/hooks/gateway/whk_9f8e7d6c5b4a')).toBe('/api/hooks/gateway/whk_…');
    expect(safeUrl('/api/public/pulse/0123456789abcdef?x=1')).toBe('/api/public/pulse/0123…?x=1');
    expect(safeUrl('/api/integrations/google-drive/callback?code=4/0AbCdEf&state=xyz&scope=drive.file')).toBe(
      '/api/integrations/google-drive/callback?code=…&state=…&scope=drive.file',
    );
  });
  it('leaves ordinary addresses as they are', () => {
    expect(safeUrl('/api/tasks?tab=done&from=2026-11-01')).toBe('/api/tasks?tab=done&from=2026-11-01');
    expect(safeUrl('/api/pos/orders/abc123')).toBe('/api/pos/orders/abc123');
  });
  it('keeps no headers and no body', () => {
    const kept = reqForLog({
      method: 'POST',
      url: '/api/auth/login',
      ip: '10.0.0.7',
      ...({ headers: { cookie: 'mono_at=secret' }, body: { password: 'x' } } as object),
    });
    expect(kept).toEqual({ method: 'POST', url: '/api/auth/login', remoteAddress: '10.0.0.7' });
    expect(JSON.stringify(kept)).not.toMatch(/secret|password/);
  });
});
