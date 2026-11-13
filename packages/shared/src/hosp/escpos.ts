/**
 * Phase 15 — ESC/POS for thermal printers (pure: bytes in, bytes out). Only the commands every 58 / 80 mm
 * printer knows: initialise, bold, double height, alignment, feed and cut. Text is sent as plain ASCII; other
 * characters (₹, Hindi) are replaced, because code pages differ from printer to printer.
 */
const ESC = 0x1b;
const GS = 0x1d;
export type PrintLine =
  | { text: string; bold?: boolean; big?: boolean; align?: 'left' | 'center' | 'right' }
  | { cols: [string, string]; bold?: boolean }
  | { rule: true };

const ascii = (s: string) => s.replace(/₹/g, 'Rs ').replace(/[^\x20-\x7e]/g, '?');
/** Two columns on one line: the left text cut to fit, the right text flush right. */
export function twoCols(left: string, right: string, width: number) {
  const r = ascii(right);
  const room = Math.max(1, width - r.length - 1);
  const l = ascii(left).slice(0, room);
  return l + ' '.repeat(width - l.length - r.length) + r;
}

export function escpos(lines: PrintLine[], width = 42): Uint8Array {
  const out: number[] = [ESC, 0x40];
  const text = (s: string) => {
    for (const ch of ascii(s)) out.push(ch.charCodeAt(0));
    out.push(0x0a);
  };
  for (const line of lines) {
    if ('rule' in line) {
      text('-'.repeat(width));
      continue;
    }
    out.push(ESC, 0x45, line.bold ? 1 : 0);
    if ('cols' in line) {
      text(twoCols(line.cols[0], line.cols[1], width));
      continue;
    }
    out.push(ESC, 0x61, line.align === 'center' ? 1 : line.align === 'right' ? 2 : 0);
    out.push(GS, 0x21, line.big ? 0x11 : 0x00);
    text(line.text);
    out.push(GS, 0x21, 0x00, ESC, 0x61, 0);
  }
  // Feed three lines and cut.
  out.push(ESC, 0x64, 3, GS, 0x56, 0x42, 0x00);
  return Uint8Array.from(out);
}
