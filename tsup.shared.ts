import type { Options } from 'tsup';

/**
 * Server bundles: our workspace packages (@mono/*, shipped as TypeScript) are bundled in;
 * every npm package and node builtin stays external and is loaded from node_modules at runtime.
 */
export const serverBundle: Options = {
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@mono\//],
  esbuildPlugins: [
    {
      name: 'external-npm-packages',
      setup(build) {
        build.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith('@mono/') ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
};
