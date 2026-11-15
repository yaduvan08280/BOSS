import { createContext, useContext } from 'react';

export type Named = { id: string; name: string };
export type Scope = {
  /** The property chosen in the picker ('' = the first one). */
  picked: string;
  /** Inside "all properties": this view is one property of several, stacked under its name. */
  fixed: Named | null;
  /** Pick a property, or '' for all of them. */
  choose: (id: string) => void;
};
export const PropertyCtx = createContext<Scope | null>(null);
export const usePropertyScope = () => useContext(PropertyCtx);
