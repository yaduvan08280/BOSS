/** pdfmake 0.3 ships without types; this is the small part MONO uses. */
declare module 'pdfmake' {
  type Fonts = Record<string, { normal: string; bold?: string; italics?: string; bolditalics?: string }>;
  const pdfmake: {
    setFonts(fonts: Fonts): void;
    setUrlAccessPolicy(cb: (url: string) => boolean): void;
    setLocalAccessPolicy(cb: (path: string) => boolean): void;
    createPdf(doc: Record<string, unknown>): { getBuffer(): Promise<Buffer> };
  };
  export default pdfmake;
}
