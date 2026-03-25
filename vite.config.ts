import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import * as fs from 'fs';
import * as path from 'path';

const isProd = process.env.NODE_ENV === 'production';

/** Vite plugin that generates a song manifest from public/songs/ at dev/build time */
function songManifestPlugin(): Plugin {
  const generateManifest = () => {
    const songsDir = path.resolve(__dirname, 'public/songs');
    const songs: { file: string; folder: string }[] = [];

    // Scan root (royalty-free songs)
    for (const file of safeReaddir(songsDir)) {
      if (/\.(mxl|musicxml|xml)$/i.test(file)) {
        songs.push({ file, folder: '' });
      }
    }

    // Scan personal/ — dev only (copyrighted, not in git or prod builds)
    if (!isProd) {
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

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export default defineConfig(async () => {
  // Only load self-signed SSL plugin in dev (not needed in prod)
  const plugins: Plugin[] = [tailwindcss(), songManifestPlugin()];

  if (!isProd) {
    const { default: basicSsl } = await import('@vitejs/plugin-basic-ssl');
    plugins.push(basicSsl());
  }

  if (isProd) {
    plugins.push(excludePersonalSongsPlugin());
  }

  return {
    plugins,
    server: {
      host: '0.0.0.0',
      port: 5173,
      https: true,
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
