/**
 * Does the file's start match the type the browser claimed? (A renamed .exe or .html is refused even when it says
 * "image/png".) Text types must not contain NUL bytes.
 */
export function looksLike(mime: string, head: Buffer): boolean {
  const at = (offset: number, ...bytes: number[]) => bytes.every((b, i) => head[offset + i] === b);
  const ascii = (offset: number, text: string) =>
    head.subarray(offset, offset + text.length).toString('latin1') === text;
  const ftyp = (brands: string[]) => ascii(4, 'ftyp') && brands.some((b) => ascii(8, b));
  switch (mime) {
    case 'image/png':
      return at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/jpeg':
      return at(0, 0xff, 0xd8, 0xff);
    case 'image/webp':
      return ascii(0, 'RIFF') && ascii(8, 'WEBP');
    case 'image/heic':
      return ftyp(['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1']);
    case 'application/pdf':
      return head.subarray(0, 1024).includes(Buffer.from('%PDF-'));
    case 'text/csv':
      return !head.includes(0);
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return at(0, 0x50, 0x4b, 0x03, 0x04);
    case 'application/vnd.ms-excel':
      return at(0, 0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    case 'audio/webm':
      return at(0, 0x1a, 0x45, 0xdf, 0xa3);
    case 'audio/ogg':
      return ascii(0, 'OggS');
    case 'audio/mpeg':
      return ascii(0, 'ID3') || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0);
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'video/mp4':
      return ascii(4, 'ftyp');
    default:
      return false;
  }
}
