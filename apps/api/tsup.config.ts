import { defineConfig } from 'tsup';
import { serverBundle } from '../../tsup.shared';

export default defineConfig({ ...serverBundle, entry: { main: 'src/main.ts', seed: '../../prisma/seed.ts' } });
