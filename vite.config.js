import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILES = ['status.json', 'timetable.json', 'classes.json'];
const BASE_PATH = '/';

function dataAssetsPlugin() {
  return {
    name: 'bakalari-data-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqPath = (req.url || '').split('?')[0];
        if (req.method === 'GET') {
          for (const name of DATA_FILES) {
            if (reqPath === `/data/${name}`) {
              const filePath = path.join(ROOT_DIR, 'data', name);
              try {
                const payload = fs.readFileSync(filePath, 'utf8');
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store');
                res.end(payload);
              } catch {
                res.statusCode = 404;
                res.end(`${name} not found`);
              }
              return;
            }
          }
        }
        next();
      });
    },
    generateBundle() {
      for (const name of DATA_FILES) {
        const filePath = path.join(ROOT_DIR, 'data', name);
        if (fs.existsSync(filePath)) {
          const source = fs.readFileSync(filePath, 'utf8');
          this.emitFile({
            type: 'asset',
            fileName: `data/${name}`,
            source,
          });
        }
      }
    },
  };
}

export default defineConfig({
  base: BASE_PATH,
  plugins: [tailwindcss(), dataAssetsPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(ROOT_DIR, 'index.html'),
        timetable: path.resolve(ROOT_DIR, 'timetable/index.html'),
      },
    },
  },
});
