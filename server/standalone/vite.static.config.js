import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import { createBrowserViteConfig } from '../../build/vite.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
/** Override with GV_STATIC_OUT_DIR for a scratch build (QA); the default is what gets deployed. */
export const STATIC_OUT_DIR = process.env.GV_STATIC_OUT_DIR || 'dist-static';
/** Public-folder assets the static demo never loads (aircraft models for the movement layers). */
const UNUSED_PUBLIC_DIRS = ['models'];

/**
 * Static demo build (`npm run build:static`): no provider middleware, no keys,
 * no Cesium ion token, a relative base so the same files serve at
 * https://ground-view.pages.dev/ and under https://himanshukalra.com/groundview/.
 * The four server-backed feeds read JSON snapshots instead (src/sources/snapshots.js).
 */
export default defineConfig(() => {
  process.env.VITE_GROUND_VIEW_STATIC = '1';
  const config = createBrowserViteConfig({ command: 'build' });
  return {
    ...config,
    root,
    base: './',
    // Never read .env files: a key in one must not reach the static bundle.
    envDir: false,
    plugins: [
      ...config.plugins,
      {
        name: 'static-demo-prune',
        apply: 'build',
        closeBundle() {
          for (const dir of UNUSED_PUBLIC_DIRS)
            rmSync(path.resolve(root, STATIC_OUT_DIR, dir), {
              recursive: true,
              force: true,
            });
        },
      },
    ],
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': 'undefined',
      'import.meta.env.CESIUM_ION_TOKEN': 'undefined',
      'import.meta.env.MAPILLARY_CLIENT_TOKEN': '""',
    },
    build: {
      ...config.build,
      outDir: STATIC_OUT_DIR,
      emptyOutDir: true,
    },
  };
});
