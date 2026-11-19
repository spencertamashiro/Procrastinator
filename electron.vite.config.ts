import { defineConfig, type Plugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * The bundler labels some modules with comments that hold absolute paths
 * (e.g. `./ics-worker?nodeWorker&importer=C:/Users/<name>/...`), which would put the
 * build machine's user name and folders into the shipped app. This replaces the
 * project root with a relative marker in every emitted chunk.
 */
function stripBuildPaths(): Plugin {
  const root = process.cwd().replace(/\\/g, '/');
  const variants = [root, root.replace(/\//g, '\\'), root.replace(/\//g, '\\\\')];
  return {
    name: 'strip-build-paths',
    apply: 'build',
    renderChunk(code) {
      let out = code;
      for (const v of variants) out = out.split(v).join('<project>');
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig({
  main: {
    plugins: [stripBuildPaths()],
  },
  preload: {
    plugins: [stripBuildPaths()],
    build: {
      // The preload runs sandboxed, so it must be a single CommonJS file with no externals.
      externalizeDeps: false,
      rolldownOptions: { output: { format: 'cjs' } },
    },
  },
  renderer: {
    plugins: [react(), stripBuildPaths()],
  },
});
