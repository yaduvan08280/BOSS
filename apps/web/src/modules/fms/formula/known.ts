import { useQueryClient } from '@tanstack/react-query';
import { createContext } from 'react';
import { FORMULA_DEFAULT_TZ, type FlowField, type Me } from '@mono/shared';
import { ME_KEY } from '@/modules/auth/session';

/**
 * The fields a formula may read besides its own form's: the start form and the steps before (empty for a start
 * form, a master or a record type). The process editor sets it around the step being edited.
 */
export const KnownFields = createContext<FlowField[]>([]);

/** The company time zone, without asking the server (the public form has nobody signed in). */
export function useCompanyTz(): string {
  return useQueryClient().getQueryData<Me>(ME_KEY)?.company.timezone ?? FORMULA_DEFAULT_TZ;
}
