import type { PackInput } from '../schema';
import { hospitalityPack } from './hospitality';

/** The packs MONO ships (Master Library → Packs). Each is plain set-up; nothing here is code a trade depends on. */
export const PACK_LIBRARY: PackInput[] = [hospitalityPack];
export const libraryPack = (key: string) => PACK_LIBRARY.find((p) => p.key === key);
