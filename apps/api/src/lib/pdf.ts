import pdfmake from 'pdfmake';

let ready = false;
const FONT_FILES = new Set(['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']);

/**
 * Server-side PDFs (pdfmake). The built-in Helvetica needs no font files; nothing is read from disk
 * or the network while rendering.
 */
export async function renderPdf(doc: Record<string, unknown>): Promise<Buffer> {
  if (!ready) {
    pdfmake.setFonts({
      Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
      },
    });
    pdfmake.setUrlAccessPolicy(() => false);
    // Only the built-in font names; no other file is ever read.
    pdfmake.setLocalAccessPolicy((path) => FONT_FILES.has(path));
    ready = true;
  }
  return pdfmake.createPdf({ defaultStyle: { font: 'Helvetica', fontSize: 9 }, ...doc }).getBuffer();
}
