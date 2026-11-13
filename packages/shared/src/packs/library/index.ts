import type { PackInput } from '../schema';
import { constructionPack } from './construction';
import { goldPack } from './gold';
import { hospitalityPack } from './hospitality';
import { logisticsPack } from './logistics';
import { manufacturingPack } from './manufacturing';
import { miningPack } from './mining';
import { pharmacyPack } from './pharmacy';
import { realEstatePack } from './realestate';
import { retailPack } from './retail';
import { wholesalePack } from './wholesale';

/** The packs MONO ships (Master Library → Packs). Each is plain set-up; nothing here is code a trade depends on. */
export const PACK_LIBRARY: PackInput[] = [
  hospitalityPack,
  pharmacyPack,
  goldPack,
  retailPack,
  wholesalePack,
  manufacturingPack,
  constructionPack,
  realEstatePack,
  logisticsPack,
  miningPack,
];
export const libraryPack = (key: string) => PACK_LIBRARY.find((p) => p.key === key);
