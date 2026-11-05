import { describe, expect, it } from 'vitest';
import { looksLike } from './sniff';

describe('upload type check', () => {
  it('accepts real files and refuses ones dressed up as something else', () => {
    expect(looksLike('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      true,
    );
    expect(looksLike('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLike('application/pdf', Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(looksLike('text/csv', Buffer.from('code,name\nRM-1,Resin\n'))).toBe(true);
    expect(looksLike('audio/webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1]))).toBe(true);
    expect(looksLike('video/mp4', Buffer.from('\0\0\0\x18ftypmp42', 'latin1'))).toBe(true);
    // An HTML page or a Windows program calling itself a photo or a PDF.
    expect(looksLike('image/png', Buffer.from('<html><script>alert(1)</script>'))).toBe(false);
    expect(looksLike('application/pdf', Buffer.from('MZ\x90\0\x03', 'latin1'))).toBe(false);
    expect(looksLike('text/csv', Buffer.from([0x4d, 0x5a, 0, 0]))).toBe(false);
    expect(looksLike('image/svg+xml', Buffer.from('<svg/>'))).toBe(false);
  });
});
