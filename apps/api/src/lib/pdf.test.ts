import { describe, expect, it } from 'vitest';
import { renderPdf, scriptRuns } from './pdf';

describe('PDF text', () => {
  it('sets Hindi and the rupee sign in the Devanagari font and leaves the rest alone', () => {
    expect(scriptRuns('Muster register')).toBe('Muster register');
    expect(scriptRuns('₹1,250')).toEqual([{ text: '₹', font: 'Deva' }, '1,250']);
    expect(scriptRuns('राजेश गोयल (Owner)')).toEqual([{ text: 'राजेश गोयल', font: 'Deva' }, ' (Owner)']);
    expect(scriptRuns('Total ₹500 — अनीता')).toEqual([
      'Total ',
      { text: '₹', font: 'Deva' },
      '500 — ',
      { text: 'अनीता', font: 'Deva' },
    ]);
  });

  it('renders a document with Hindi names and rupees', async () => {
    const pdf = await renderPdf({
      content: [
        { text: 'हाज़िरी रजिस्टर — November', bold: true },
        {
          table: {
            body: [
              ['Name', 'Pay'],
              ['अनीता वर्मा', '₹12,500'],
              ['Ravi Kumar', { text: '₹9,000', bold: true }],
            ],
          },
        },
      ],
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // The Devanagari font is embedded (its name is in the file), not only Helvetica.
    expect(pdf.toString('latin1')).toContain('NotoSansDevanagari');
  });
});
