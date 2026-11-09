import { defineConfig } from 'tsup';
import { serverBundle } from '../../tsup.shared';

export default defineConfig({
  ...serverBundle,
  entry: {
    main: 'src/main.ts',
    seed: '../../prisma/seed.ts',
    'seed-demo': '../../prisma/seed-demo.ts',
    'seed-ggm': '../../prisma/seed-ggm.ts',
    'reset-password': '../../prisma/reset-password.ts',
  },
});
