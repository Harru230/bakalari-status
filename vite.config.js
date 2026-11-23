import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const STATUS_JSON_PATH = path.join(ROOT_DIR, 'data', 'status.json');
const BASE_PATH = '/bakalari-status/';

function statusDataPlugin() {
  return {
    name: 'bakalari-status-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqPath = (req.url || '').split('?')[0];
        if (reqPath === `${BASE_PATH}data/status.json` && req.method === 'GET') {
          try {
            const payload = fs.readFileSync(STATUS_JSON_PATH, 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(payload);
          } catch {
            res.statusCode = 404;
            res.end('status.json not found');
          }
          return;
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqPath = (req.url || '').split('?')[0];
        if (reqPath === '/bakalari-status' && (req.method === 'GET' || req.method === 'HEAD')) {
          try {
            const html = fs.readFileSync(path.join(ROOT_DIR, 'dist', 'index.html'), 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(req.method === 'HEAD' ? undefined : html);
          } catch {
            next();
          }
          return;
        }
        next();
      });
    },
    generateBundle() {
      const source = fs.readFileSync(STATUS_JSON_PATH, 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'data/status.json',
        source,
      });
    },
  };
}

export default defineConfig({
  base: BASE_PATH,
  plugins: [tailwindcss(), statusDataPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
