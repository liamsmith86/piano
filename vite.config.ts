import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import * as fs from 'fs';
import * as path from 'path';
import type { SongLibrary } from './src/types';

/**
 * Which songs the app lists, from PIANO_SONG_LIBRARY:
 * - bundled: royalty-free songs only (default for builds, incl. production)
 * - all: bundled + personal (default for the dev server)
 * - personal: personal songs only (private LAN deploy)
 */
const SONG_LIBRARIES: readonly SongLibrary[] = ['bundled', 'all', 'personal'];

function resolveSongLibrary(isProductionBuild: boolean): SongLibrary {
  const value = process.env.PIANO_SONG_LIBRARY;
  if (!value) return isProductionBuild ? 'bundled' : 'all';
  if (!SONG_LIBRARIES.includes(value as SongLibrary)) {
    throw new Error(`PIANO_SONG_LIBRARY must be one of ${SONG_LIBRARIES.join(', ')}; got "${value}"`);
  }
  return value as SongLibrary;
}

/** Vite plugin that generates a song manifest from public/songs/ at dev/build time */
function songManifestPlugin(library: SongLibrary): Plugin {
  const generateManifest = () => {
    const songsDir = path.resolve(__dirname, 'public/songs');
    const songs: { file: string; folder: string }[] = [];

    // Scan root (royalty-free songs)
    if (library !== 'personal') {
      for (const file of safeReaddir(songsDir)) {
        if (/\.(mxl|musicxml|xml)$/i.test(file)) {
          songs.push({ file, folder: '' });
        }
      }
    }

    // Scan personal/ (copyrighted, never in git; excluded from builds by default)
    if (library !== 'bundled') {
      const personalDir = path.join(songsDir, 'personal');
      for (const file of safeReaddir(personalDir)) {
        if (/\.(mxl|musicxml|xml)$/i.test(file)) {
          songs.push({ file, folder: 'personal/' });
        }
      }
    }

    const manifest = JSON.stringify(songs, null, 2);
    fs.writeFileSync(path.join(songsDir, 'manifest.json'), manifest);
  };

  return {
    name: 'song-manifest',
    buildStart() {
      generateManifest();
    },
    configureServer(server) {
      generateManifest();
      server.watcher.on('all', (_event, filePath) => {
        if (filePath.includes('public/songs') && !filePath.endsWith('manifest.json')) {
          generateManifest();
        }
      });
    },
  };
}

/**
 * Vite plugin that removes the personal/ songs directory from the build output.
 * Even though the manifest won't list them in prod, Vite still copies all of
 * public/ to dist/. This plugin removes the personal folder after the bundle.
 */
function excludePersonalSongsPlugin(): Plugin {
  return {
    name: 'exclude-personal-songs',
    closeBundle() {
      const personalDist = path.resolve(__dirname, 'dist/songs/personal');
      if (fs.existsSync(personalDist)) {
        fs.rmSync(personalDist, { recursive: true });
        console.log('Removed dist/songs/personal/ (copyrighted content excluded from build)');
      }
    },
  };
}

/** Inject hashed entry assets into the service worker's offline app shell. */
function serviceWorkerAssetsPlugin(): Plugin {
  return {
    name: 'service-worker-assets',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      const indexPath = path.join(distDir, 'index.html');
      const workerPath = path.join(distDir, 'sw.js');
      if (!fs.existsSync(indexPath) || !fs.existsSync(workerPath)) return;

      const html = fs.readFileSync(indexPath, 'utf8');
      const assets = [...html.matchAll(/\b(?:src|href)="(\/assets\/[^"?]+)"/g)]
        .map(match => match[1]);
      const marker = 'const BUILD_ASSETS = [];';
      const worker = fs.readFileSync(workerPath, 'utf8');
      if (!worker.includes(marker)) {
        throw new Error('Service worker build asset marker is missing');
      }
      fs.writeFileSync(
        workerPath,
        worker.replace(marker, `const BUILD_ASSETS = ${JSON.stringify([...new Set(assets)])};`),
      );
    },
  };
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export default defineConfig(async ({ command, mode }) => {
  const isProductionBuild = command === 'build';
  const isDevelopmentServer = command === 'serve' && mode !== 'production';
  const songLibrary = resolveSongLibrary(isProductionBuild);

  // Only load self-signed SSL plugin in dev (not needed in prod)
  const plugins: Plugin[] = [tailwindcss(), songManifestPlugin(songLibrary)];

  if (isDevelopmentServer) {
    const { default: basicSsl } = await import('@vitejs/plugin-basic-ssl');
    plugins.push(basicSsl());
  }

  if (isProductionBuild) {
    if (songLibrary === 'bundled') plugins.push(excludePersonalSongsPlugin());
    plugins.push(serviceWorkerAssetsPlugin());
  }

  return {
    plugins,
    define: {
      'import.meta.env.PIANO_SONG_LIBRARY': JSON.stringify(songLibrary),
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      ...(isDevelopmentServer ? { https: true } : {}),
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('opensheetmusicdisplay')) return 'osmd';
            if (id.includes('/tone/')) return 'tone';
          },
        },
      },
    },
  };
});
