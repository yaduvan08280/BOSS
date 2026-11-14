import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pdfmake from 'pdfmake';

let ready = false;
let deva = false;
const FONT_FILES = new Set(['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']);

/** Where the Devanagari font files are: beside the API in the repo and in the server image. */
function fontDir(): string | null {
  const cwd = process.cwd();
  const places = [
    process.env.MONO_FONTS_DIR,
    join(cwd, 'apps/api/assets/fonts'),
    join(cwd, 'assets/fonts'),
    join(cwd, '../api/assets/fonts'),
  ].filter((p): p is string => Boolean(p));
  return (
    places.map((p) => resolve(p)).find((p) => existsSync(join(p, 'NotoSansDevanagari-Regular.ttf'))) ?? null
  );
}

// Hindi (Devanagari and its extensions, the joiners that shape it) and the rupee sign, which Helvetica lacks.
const DEVA = /[ऀ-ॿ꣠-ꣿ᳐-᳿‌‍₹]/;
const RUNS = /([ऀ-ॿ꣠-ꣿ᳐-᳿‌‍₹]+(?:[ ऀ-ॿ꣠-ꣿ᳐-᳿‌‍₹]*[ऀ-ॿ꣠-ꣿ᳐-᳿‌‍₹])?)/;

/** A text split so Hindi and ₹ are set in the Devanagari font and the rest in Helvetica. */
export function scriptRuns(text: string): string | (string | { text: string; font: string })[] {
  if (!DEVA.test(text)) return text;
  return text
    .split(RUNS)
    .filter((part) => part !== '')
    .map((part) => (DEVA.test(part) ? { text: part, font: 'Deva' } : part));
}

/** Walk a document definition and give every text with Hindi or ₹ its font runs. */
function withFonts(node: unknown): unknown {
  if (typeof node === 'string') {
    const runs = scriptRuns(node);
    return typeof runs === 'string' ? node : { text: runs };
  }
  if (Array.isArray(node)) return node.map(withFonts);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'text' && typeof value === 'string') out[key] = scriptRuns(value);
    else if (typeof value === 'function') out[key] = value;
    else out[key] = withFonts(value);
  }
  return out;
}

/**
 * Server-side PDFs (pdfmake). Latin text uses the built-in Helvetica (no font file); Hindi names and the rupee
 * sign use Noto Sans Devanagari from the API's own assets folder. Nothing else is read from disk and nothing
 * from the network while rendering. Without the font files the text is set in Helvetica as before.
 */
export async function renderPdf(doc: Record<string, unknown>): Promise<Buffer> {
  if (!ready) {
    const dir = fontDir();
    const regular = dir ? join(dir, 'NotoSansDevanagari-Regular.ttf') : '';
    const bold = dir ? join(dir, 'NotoSansDevanagari-Bold.ttf') : '';
    deva = Boolean(dir);
    pdfmake.setFonts({
      Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
      },
      ...(deva ? { Deva: { normal: regular, bold, italics: regular, bolditalics: bold } } : {}),
    });
    pdfmake.setUrlAccessPolicy(() => false);
    // Only the built-in font names and MONO's own two font files; no other file is ever read.
    pdfmake.setLocalAccessPolicy(
      (path) => FONT_FILES.has(path) || (deva && (path === regular || path === bold)),
    );
    ready = true;
  }
  const body = deva ? (withFonts(doc) as Record<string, unknown>) : doc;
  return pdfmake.createPdf({ defaultStyle: { font: 'Helvetica', fontSize: 9 }, ...body }).getBuffer();
}
