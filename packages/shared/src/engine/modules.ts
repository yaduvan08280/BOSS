import {
  MODULE_DEFAULTS,
  type ChecklistSettings,
  type DelegationSettings,
  type EaSettings,
  type SlipSettings,
  type TicketSettings,
} from '../defaults';
import { checklistMachine } from '../machines/checklist';
import { delegationMachine, STATUS_KEEPING_ACTIONS } from '../machines/delegation';
import { eaMachine } from '../machines/ea';
import { slipEntryStatus, slipMachine } from '../machines/slip';
import { TICKET_KEEP, ticketMachine } from '../machines/ticket';
import { machineGraph, type FlowGraph } from './graph';

/** The five Business Engine modules, in the order the flow designer lists them. */
export const ENGINE_MODULES = ['checklist', 'delegation', 'slip', 'ticket', 'ea'] as const;
export type EngineModule = (typeof ENGINE_MODULES)[number];

/** People each module's notifications can go to (the roles legend). */
export const ENGINE_ROLES: Record<EngineModule, string[]> = {
  checklist: ['doer', 'verifier', 'owner'],
  delegation: ['doer', 'creator', 'verifier', 'hod'],
  slip: ['raiser', 'receiver', 'approver'],
  ticket: ['raiser', 'solver', 'coordinator', 'hod'],
  ea: ['owner', 'ea'],
};

/** Each module's flow chart under a company's settings (defaults when none are saved). */
export function engineGraph(module: EngineModule, settings?: unknown): FlowGraph {
  switch (module) {
    case 'delegation': {
      const s = { ...MODULE_DEFAULTS.delegation, ...(settings as Partial<DelegationSettings>) };
      return machineGraph(
        delegationMachine,
        { doerMustAccept: s.doerMustAccept, allowReopen: s.allowReopen, needsVerify: s.eaVerifies },
        {
          start: { key: 'assign', to: s.doerMustAccept ? 'AWAITING_ACCEPTANCE' : 'OPEN' },
          keep: STATUS_KEEPING_ACTIONS,
          finished: ['DONE'],
          deadEnds: ['CANCELLED', 'RETURNED_TO_CREATOR'],
        },
      );
    }
    case 'checklist': {
      const s = { ...MODULE_DEFAULTS.checklist, ...(settings as Partial<ChecklistSettings>) };
      return machineGraph(
        checklistMachine,
        { verifierStep: s.verifierStep, hasVerifier: true, allItemsDone: true },
        {
          start: { key: 'sweep', to: 'OPEN' },
          keep: ['tick'],
          finished: ['DONE'],
          deadEnds: ['MISSED'],
        },
      );
    }
    case 'slip': {
      const s = { ...MODULE_DEFAULTS.slip, ...(settings as Partial<SlipSettings>) };
      const ctx = { receiverScreens: s.receiverScreens, approverStep: s.approverStep };
      return machineGraph(slipMachine, ctx, {
        start: { key: 'raise', to: slipEntryStatus(ctx) },
        finished: ['CLOSED'],
        deadEnds: ['REJECTED', 'WITHDRAWN'],
      });
    }
    case 'ticket': {
      const s = { ...MODULE_DEFAULTS.ticket, ...(settings as Partial<TicketSettings>) };
      return machineGraph(
        ticketMachine,
        { autoClose: s.closeBy === 'auto24h' },
        {
          start: { key: 'raise', to: 'OPEN' },
          keep: TICKET_KEEP,
          finished: ['CLOSED'],
          deadEnds: ['CANCELLED'],
          extra: s.escalationLevels
            ? [{ key: 'escalate', from: ['OPEN', 'IN_PROGRESS'], to: 'ESCALATED', kind: 'deadend' }]
            : [],
        },
      );
    }
    case 'ea': {
      const s = { ...MODULE_DEFAULTS.ea, ...(settings as Partial<EaSettings>) };
      return machineGraph(
        eaMachine,
        {
          informationStage: s.informationStage,
          waitingStage: s.waitingStage,
          waitingRoom: true,
          missedDayToSomeday: s.missedDayToSomeday,
        },
        { start: { key: 'capture', to: 'CAPTURED' }, finished: ['DONE', 'CLOSED'] },
      );
    }
  }
}
