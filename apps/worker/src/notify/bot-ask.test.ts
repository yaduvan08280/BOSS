import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma } from '@mono/db';
import { bootstrapCompany, setTestLlm, setTestStt } from '@mono/api/services';
import { onText, onVoice } from './bot-handlers';

/** Questions on Telegram — typed after /ask, or spoken — answered through Ask with the asker's rights. */
const db = createPrisma();
let companyId = '';
let tag = '';
const scope = () => ({ companyIds: [companyId] });
const chat = () => `ask${tag}`;
const answers: unknown[] = [];
const asked: string[] = [];

const plan = {
  answerable: true,
  why: '',
  view: 'people',
  columns: [],
  filters: [],
  groupBy: null,
  aggregate: { fn: 'count', column: null },
  orderBy: null,
  limit: 50,
  report: null,
};

beforeAll(async () => {
  tag = `${Date.now() % 1_000_000}${Math.floor(Math.random() * 100)}`;
  const { company, owner } = await bootstrapCompany(db, {
    companyName: `Bot Ask ${tag}`,
    ownerName: 'Owner',
    ownerEmail: `ask${tag}@x.in`,
    ownerPassword: 'Secret123',
  });
  companyId = company.id;
  await db.user.update({ where: { id: owner!.id }, data: { telegramChatId: chat() } });
  setTestLlm((id) =>
    id === companyId
      ? {
          provider: 'anthropic',
          model: 'test',
          async complete(req) {
            asked.push(req.messages.at(-1)!.content);
            return { text: String(answers.shift()), usage: { inputTokens: 1, outputTokens: 1 } };
          },
          async json(req) {
            asked.push(req.messages.at(-1)!.content);
            return { data: req.schema.parse(answers.shift()), usage: { inputTokens: 1, outputTokens: 1 } };
          },
        }
      : null,
  );
}, 60_000);
afterAll(async () => {
  setTestLlm(null);
  setTestStt(null);
  await db.$disconnect();
});

describe('asking on Telegram', () => {
  it('/ask answers a typed question; a bare /ask says how', async () => {
    answers.push(plan, 'There is 1 person.');
    const r = await onText(db, scope(), chat(), '/ask how many people do we have?', 'MONO', undefined, 's');
    expect(r.text).toContain('There is 1 person.');
    expect(asked[0]).toContain('how many people');
    expect((await onText(db, scope(), chat(), '/ask', 'MONO', undefined, 's')).text).toContain('/ask');
  }, 60_000);

  it('a voice message is written down, asked, and answered with what was heard', async () => {
    setTestStt((audio) => `how many people (${audio.length} bytes)`);
    answers.push(plan, 'One.');
    const text = await onVoice(db, scope(), chat(), 's', {
      seconds: 6,
      fetch: async () => ({ data: Buffer.from('abcd'), mime: 'audio/ogg' }),
    });
    expect(text).toContain('You asked: "how many people (4 bytes)"');
    expect(text).toContain('One.');
  }, 60_000);

  it('a clip that is too long, a chat nobody linked, and no speech service each get a plain answer', async () => {
    const clip = { seconds: 6, fetch: async () => ({ data: Buffer.from('x'), mime: 'audio/ogg' }) };
    expect(await onVoice(db, scope(), chat(), 's', { ...clip, seconds: 500 })).toContain('under two minutes');
    expect(await onVoice(db, scope(), 'nobody', 's', clip)).toBe('Link your Telegram first.');
    setTestStt(null);
    expect(await onVoice(db, scope(), chat(), 's', clip)).toContain('speech to text');
  }, 60_000);
});
