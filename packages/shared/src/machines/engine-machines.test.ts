import { describe, expect, it } from 'vitest';
import { engineGraph } from '../engine/modules';
import { eaMachine, type EaContext } from './ea';
import { slipEntryStatus, slipMachine } from './slip';
import { ticketMachine } from './ticket';
import { availableActions, transition } from './transition';

const on = { receiverScreens: true, approverStep: true };

describe('help slip machine', () => {
  it('receiver screens, approver decides', () => {
    expect(slipEntryStatus(on)).toBe('SUBMITTED');
    expect(
      transition(slipMachine, { from: 'SUBMITTED', action: 'forward', roles: ['receiver'], ctx: on }).to,
    ).toBe('WITH_APPROVER');
    expect(
      transition(slipMachine, { from: 'WITH_APPROVER', action: 'approve', roles: ['approver'], ctx: on }).to,
    ).toBe('APPROVED');
    expect(() =>
      transition(slipMachine, { from: 'SUBMITTED', action: 'approve', roles: ['receiver'], ctx: on }),
    ).toThrow(/switched off/);
    expect(() =>
      transition(slipMachine, { from: 'WITH_APPROVER', action: 'approve', roles: ['raiser'], ctx: on }),
    ).toThrow(/role/);
  });

  it('follows the toggles', () => {
    const noScreen = { receiverScreens: false, approverStep: true };
    expect(slipEntryStatus(noScreen)).toBe('WITH_APPROVER');
    expect(
      transition(slipMachine, { from: 'RETURNED', action: 'resubmit', roles: ['raiser'], ctx: noScreen }).to,
    ).toBe('WITH_APPROVER');
    // No approver step: the receiver decides.
    const noApprover = { receiverScreens: true, approverStep: false };
    expect(availableActions(slipMachine, 'SUBMITTED', ['receiver'], noApprover).sort()).toEqual([
      'approve',
      'reject',
      'return',
    ]);
    expect(slipEntryStatus({ receiverScreens: false, approverStep: false })).toBe('SUBMITTED');
  });

  it('raiser closes after the decision or withdraws before it', () => {
    expect(availableActions(slipMachine, 'APPROVED', ['raiser'], on)).toEqual(['close']);
    expect(availableActions(slipMachine, 'RETURNED', ['raiser'], on).sort()).toEqual([
      'resubmit',
      'withdraw',
    ]);
    expect(availableActions(slipMachine, 'CLOSED', ['admin'], on)).toEqual([]);
  });
});

describe('help ticket machine', () => {
  const raiserConfirms = { autoClose: false };
  it('reply → resolve → confirm, or reopen', () => {
    expect(
      transition(ticketMachine, { from: 'OPEN', action: 'reply', roles: ['solver'], ctx: raiserConfirms }).to,
    ).toBe('IN_PROGRESS');
    expect(
      transition(ticketMachine, {
        from: 'IN_PROGRESS',
        action: 'resolve',
        roles: ['solver'],
        ctx: raiserConfirms,
      }).to,
    ).toBe('RESOLVED');
    expect(availableActions(ticketMachine, 'RESOLVED', ['raiser'], raiserConfirms).sort()).toEqual([
      'cancel',
      'comment',
      'confirm',
      'reopen',
    ]);
    expect(
      transition(ticketMachine, {
        from: 'RESOLVED',
        action: 'reopen',
        roles: ['raiser'],
        ctx: raiserConfirms,
      }).to,
    ).toBe('IN_PROGRESS');
  });

  it('auto-closes only when the company chose it', () => {
    expect(() =>
      transition(ticketMachine, {
        from: 'RESOLVED',
        action: 'autoClose',
        roles: ['system'],
        ctx: raiserConfirms,
      }),
    ).toThrow(/switched off/);
    expect(
      transition(ticketMachine, {
        from: 'RESOLVED',
        action: 'autoClose',
        roles: ['system'],
        ctx: { autoClose: true },
      }).to,
    ).toBe('CLOSED');
  });

  it('the coordinator chases but decides nothing', () => {
    expect(availableActions(ticketMachine, 'OPEN', ['coordinator'], raiserConfirms).sort()).toEqual([
      'comment',
      'movePlan',
      'reassign',
    ]);
  });
});

describe('EA machine', () => {
  const ctx: EaContext = {
    informationStage: true,
    waitingStage: true,
    waitingRoom: true,
    missedDayToSomeday: true,
  };
  it('sorts captures into every stage', () => {
    expect(availableActions(eaMachine, 'CAPTURED', ['ea'], ctx).sort()).toEqual([
      'close',
      'delegate',
      'done',
      'schedule',
      'toInformation',
      'toSomeday',
      'toWaiting',
    ]);
  });
  it('respects the waiting cap and switched-off stages', () => {
    expect(() =>
      transition(eaMachine, {
        from: 'CAPTURED',
        action: 'toWaiting',
        roles: ['ea'],
        ctx: { ...ctx, waitingRoom: false },
      }),
    ).toThrow(/switched off/);
    expect(
      availableActions(eaMachine, 'CAPTURED', ['ea'], { ...ctx, informationStage: false }),
    ).not.toContain('toInformation');
  });
  it('a missed day goes back to Someday only when the toggle is on', () => {
    expect(transition(eaMachine, { from: 'SCHEDULED', action: 'missDay', roles: ['system'], ctx }).to).toBe(
      'SOMEDAY',
    );
    expect(() =>
      transition(eaMachine, {
        from: 'SCHEDULED',
        action: 'missDay',
        roles: ['system'],
        ctx: { ...ctx, missedDayToSomeday: false },
      }),
    ).toThrow(/switched off/);
  });
});

describe('flow designer charts', () => {
  const target = (g: ReturnType<typeof engineGraph>, action: string) => {
    const node = g.nodes.find((n) => n.key === action && n.kind !== 'start')!;
    return g.edges.find((e) => e.source === node.id)!.target;
  };

  it('"EA verifies" off sends Mark done straight to Done and greys out To verify', () => {
    const onGraph = engineGraph('delegation');
    expect(target(onGraph, 'markDone')).toBe('PENDING_VERIFY');
    const off = engineGraph('delegation', { eaVerifies: false });
    expect(target(off, 'markDone')).toBe('DONE');
    expect(off.nodes.find((n) => n.id === 'PENDING_VERIFY')!.off).toBe(true);
    expect(off.nodes.find((n) => n.key === 'verify')!.off).toBe(true);
  });

  it('starts where the settings say and leaves out status-keeping actions', () => {
    const g = engineGraph('delegation', { doerMustAccept: false });
    expect(g.edges.find((e) => e.source === 'start')!.target).toBe('OPEN');
    expect(g.nodes.find((n) => n.id === 'AWAITING_ACCEPTANCE')!.off).toBe(true);
    expect(g.nodes.some((n) => n.key === 'addFollowUp')).toBe(false);
  });

  it('marks automatic steps and the ticket escalation', () => {
    const t = engineGraph('ticket');
    expect(t.nodes.find((n) => n.key === 'escalate')).toMatchObject({ kind: 'auto', off: false });
    expect(t.nodes.find((n) => n.key === 'autoClose')).toMatchObject({ kind: 'auto', off: true });
    expect(engineGraph('ticket', { escalationLevels: 0 }).nodes.some((n) => n.key === 'escalate')).toBe(
      false,
    );
    expect(engineGraph('checklist').nodes.find((n) => n.id === 'MISSED')!.kind).toBe('deadend');
    expect(
      engineGraph('slip', { approverStep: false }).nodes.find((n) => n.id === 'WITH_APPROVER')!.off,
    ).toBe(true);
  });
});
