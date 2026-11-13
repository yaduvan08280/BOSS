import { describe, expect, it } from 'vitest';
import { checkMachine, kotMachine, orderItemMachine, orderMachine } from '../machines/pos';
import { transition } from '../machines/transition';
import { escpos, twoCols } from './escpos';
import { cashTotal, splitEqually, tableState, ticketAge, upiLink } from './pos';

describe('POS rules (phase 15)', () => {
  it('P1: a table’s state on the floor follows its order', () => {
    expect([
      tableState(null),
      tableState({ status: 'OPEN', fired: 0 }),
      tableState({ status: 'OPEN', fired: 3 }),
      tableState({ status: 'BILLED', fired: 3 }),
      tableState({ status: 'PAID', fired: 3 }),
    ]).toEqual(['FREE', 'SEATED', 'ORDERED', 'BILLED', 'PAID']);
  });

  it('P8: a ticket’s timer turns amber, then red', () => {
    const t0 = Date.UTC(2026, 10, 14, 13, 0);
    const at = (min: number) => ticketAge(t0, t0 + min * 60_000);
    expect([at(0), at(9), at(10), at(19), at(25)]).toEqual([
      { minutes: 0, tone: 'ok' },
      { minutes: 9, tone: 'ok' },
      { minutes: 10, tone: 'warn' },
      { minutes: 19, tone: 'warn' },
      { minutes: 25, tone: 'bad' },
    ]);
  });

  it('P20: an equal split adds up exactly; P24: the UPI link; P31: cash by denomination', () => {
    expect(splitEqually(1000_00, 3)).toEqual([333_34, 333_33, 333_33]);
    expect(splitEqually(999, 2).reduce((a, b) => a + b)).toBe(999);
    expect(upiLink('courtyard@hdfc', 'The Courtyard', 1234_50, 'Bill INV/0001')).toBe(
      'upi://pay?pa=courtyard%40hdfc&pn=The%20Courtyard&am=1234.50&cu=INR&tn=Bill%20INV%2F0001',
    );
    expect(cashTotal({ 500: 3, 100: 4, 10: 7, 1: 2 })).toBe(1972_00);
  });

  it('P35: a ticket as ESC/POS bytes — initialised, plain ASCII, cut at the end', () => {
    expect(twoCols('Paneer tikka (Half)', '2', 20)).toBe('Paneer tikka (Half 2');
    expect(twoCols('Total', '₹1,234', 16)).toBe('Total   Rs 1,234');
    const bytes = escpos(
      [
        { text: 'KOT 12', bold: true, big: true, align: 'center' },
        { rule: true },
        { cols: ['2 x Butter naan', 'T4'] },
        { text: 'कम तीखा' },
      ],
      24,
    );
    expect([...bytes.slice(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...bytes.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
    const text = String.fromCharCode(...bytes);
    expect(text).toContain('KOT 12\n');
    expect(text).toContain(`${'-'.repeat(24)}\n`);
    expect(text).toContain('2 x Butter naan       T4\n');
    // What the printer's code page may not hold is replaced, never sent raw.
    expect(text).toContain('?? ????\n');
  });

  it('the order, its items, tickets and checks follow their machines', () => {
    const order = (from: string, action: string, roles: string[], ctx = { fired: true, allPaid: false }) =>
      transition(orderMachine, { from, action, roles, ctx } as never).to;
    expect(order('OPEN', 'bill', ['steward'])).toBe('BILLED');
    // Nothing fired: there is nothing to bill, and the order can be cancelled; once fired it can't.
    expect(() => order('OPEN', 'bill', ['steward'], { fired: false, allPaid: false })).toThrow();
    expect(order('OPEN', 'cancel', ['steward'], { fired: false, allPaid: false })).toBe('CANCELLED');
    expect(() => order('OPEN', 'cancel', ['manager'])).toThrow();
    expect([
      order('BILLED', 'settle', ['cashier']),
      order('BILLED', 'settle', ['cashier'], { fired: true, allPaid: true }),
    ]).toEqual(['BILLED', 'PAID']);
    expect(() => order('BILLED', 'reopen', ['steward'])).toThrow();
    const item = (from: string, action: string, role: string) =>
      transition(orderItemMachine, { from, action, roles: [role], ctx: {} } as never).to;
    expect([
      item('HELD', 'fire', 'steward'),
      item('FIRED', 'ready', 'kitchen'),
      item('READY', 'recall', 'kitchen'),
      item('READY', 'serve', 'steward'),
      item('SERVED', 'void', 'manager'),
    ]).toEqual(['FIRED', 'READY', 'FIRED', 'SERVED', 'VOID']);
    expect(() => item('HELD', 'ready', 'kitchen')).toThrow();
    expect(() => item('VOID', 'fire', 'steward')).toThrow();
    const kot = (from: string, action: string) =>
      transition(kotMachine, { from, action, roles: ['kitchen'], ctx: {} } as never).to;
    expect([kot('NEW', 'ready'), kot('READY', 'bump'), kot('BUMPED', 'recall'), kot('NEW', 'bump')]).toEqual([
      'READY',
      'BUMPED',
      'NEW',
      'BUMPED',
    ]);
    expect(() => kot('NEW', 'cancel')).toThrow();
    const check = (from: string, action: string, role: string, due = 0) =>
      transition(checkMachine, { from, action, roles: [role], ctx: { due } } as never).to;
    expect([
      check('OPEN', 'settle', 'cashier', 500),
      check('OPEN', 'settle', 'cashier'),
      check('PAID', 'cancel', 'approver'),
    ]).toEqual(['OPEN', 'PAID', 'CANCELLED']);
    expect(() => check('OPEN', 'cancel', 'cashier')).toThrow();
  });
});
