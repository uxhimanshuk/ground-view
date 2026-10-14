#!/usr/bin/env node
/**
 * serve-static.mjs: serves a built folder for local checks of the static demo.
 *
 *   node scripts/serve-static.mjs dist-static --port 4630 --prefix /groundview \
 *     [--snapshots <dir>]
 *
 * With `--prefix`, requests must carry the prefix and it is stripped before the
 * file lookup, mimicking the himanshukalra.com Pages Function proxy. With
 * `--snapshots`, files under /__snapshots__/ come from that folder (CORS *), so
 * a build made with VITE_SNAPSHOT_BASE=http://localhost:PORT/__snapshots__/ can
 * be tested against real snapshots without the network.
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.geojsonl': 'application/geo+json-seq',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
  '.woff2': 'font/woff2',
};

/** Create (not start) the server. */
export function createStaticServer({ root, prefix = '', snapshots = null }) {
  const base = path.resolve(root);
  return createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    let dir = base;
    if (snapshots && pathname.startsWith('/__snapshots__/')) {
      dir = path.resolve(snapshots);
      pathname = pathname.slice('/__snapshots__'.length);
    } else if (prefix) {
      if (pathname === prefix) {
        res.writeHead(301, { Location: `${prefix}/` }).end();
        return;
      }
      if (!pathname.startsWith(`${prefix}/`)) {
        res.writeHead(404).end('not found');
        return;
      }
      pathname = pathname.slice(prefix.length);
    }
    let file = path.join(dir, pathname);
    if (file !== dir && !file.startsWith(dir + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (statSync(file).isDirectory()) file = path.join(file, 'index.html');
      statSync(file);
    } catch {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    createReadStream(file).pipe(res);
  });
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const root = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
  if (!root) {
    console.error('usage: serve-static.mjs <dir> [--port N] [--prefix /x] [--snapshots dir]');
    process.exit(2);
  }
  const port = Number(flag('--port', 4630));
  createStaticServer({
    root,
    prefix: flag('--prefix', ''),
    snapshots: flag('--snapshots', null),
  }).listen(port, '127.0.0.1', () =>
    console.log(`serving ${root} on http://127.0.0.1:${port}${flag('--prefix', '')}/`),
  );
}
