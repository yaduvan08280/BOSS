import { describe, expect, it } from 'vitest';
import { NOTIFY_EVENTS } from './catalog';
import { isQuiet, nextSendTime } from './quiet';
import { defaultRules, defaultTemplates, renderText, templateVariables, toNumberedTemplate } from './render';

describe('catalog', () => {
  it('covers every event in CLAUDE.md §7.3, plus the system ones', () => {
    expect(
      NOTIFY_EVENTS.filter((e) => e.module === 'notify')
        .map((e) => e.event)
        .sort(),
    ).toEqual(['notify.escalation', 'notify.telegram_code', 'notify.test']);
    const expected = {
      delegation: 10,
      checklist: 6,
      slip: 4,
      ticket: 6,
      ea: 3,
      fms: 6,
      hr: 8,
      ims: 5,
      crm: 6,
    };
    for (const [module, n] of Object.entries(expected)) {
      expect(
        NOTIFY_EVENTS.filter((e) => e.module === module),
        module,
      ).toHaveLength(n);
    }
  });
  it('uses the same placeholders in English and Hindi', () => {
    for (const e of NOTIFY_EVENTS) {
      const en = templateVariables(e.title.en + e.body.en).sort();
      const hi = templateVariables(e.title.hi + e.body.hi).sort();
      expect(hi, e.event).toEqual(en);
    }
  });
  it('builds a template per event, channel and language, and a rule per event', () => {
    const t = defaultTemplates();
    expect(t).toHaveLength(NOTIFY_EVENTS.length * 3 * 2);
    expect(new Set(t.map((x) => `${x.code}:${x.language}`)).size).toBe(t.length);
    expect(t.find((x) => x.code === 'delegation_assigned_wa')?.status).toBe('DRAFT');
    expect(defaultRules().find((r) => r.event === 'crm.payment_due')?.channels).toEqual([
      'whatsapp',
      'email',
    ]);
  });
});

describe('rendering', () => {
  it('fills names and never leaves braces', () => {
    expect(
      renderText('Hi {{ doer }}, due {{due}} {{missing}}', { doer: 'Sandeep', due: '05/11 18:00' }),
    ).toBe('Hi Sandeep, due 05/11 18:00 —');
  });
  it('numbers WhatsApp placeholders in order of first use', () => {
    expect(toNumberedTemplate('{{a}} and {{b}} and {{a}}')).toEqual({
      text: '{{1}} and {{2}} and {{1}}',
      names: ['a', 'b'],
    });
  });
});

describe('quiet hours (21:00–07:00 IST by default)', () => {
  const tz = 'Asia/Kolkata';
  it('knows when it is quiet', () => {
    expect(isQuiet(new Date('2026-11-02T16:00:00Z'), tz)).toBe(true); // 21:30 IST
    expect(isQuiet(new Date('2026-11-02T01:00:00Z'), tz)).toBe(true); // 06:30 IST
    expect(isQuiet(new Date('2026-11-02T06:30:00Z'), tz)).toBe(false); // 12:00 IST
  });
  it('moves a message to 07:00 the next morning', () => {
    expect(nextSendTime(new Date('2026-11-02T16:00:00Z'), tz).toISOString()).toBe('2026-11-03T01:30:00.000Z');
    const noon = new Date('2026-11-02T06:30:00Z');
    expect(nextSendTime(noon, tz)).toBe(noon);
  });
});
