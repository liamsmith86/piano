import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import * as fs from 'fs';
import * as path from 'path';

/** Vite plugin that generates a song manifest from public/songs/ at dev/build time */
function songManifestPlugin(): Plugin {
  const generateManifest = () => {
    const songsDir = path.resolve(__dirname, 'public/songs');
    const songs: { file: string; folder: string }[] = [];

    // Scan root
    for (const file of safeReaddir(songsDir)) {
      if (/\.(mxl|musicxml|xml)$/i.test(file)) {
        songs.push({ file, folder: '' });
      }
    }

    // Scan personal/
    const personalDir = path.join(songsDir, 'personal');
    for (const file of safeReaddir(personalDir)) {
      if (/\.(mxl|musicxml|xml)$/i.test(file)) {
        songs.push({ file, folder: 'personal/' });
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
      // Regenerate when songs folder changes
      server.watcher.on('all', (_event, filePath) => {
        if (filePath.includes('public/songs') && !filePath.endsWith('manifest.json')) {
          generateManifest();
        }
      });
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

export default defineConfig({
  plugins: [
    tailwindcss(),
    songManifestPlugin(),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 1600,
  },
});
