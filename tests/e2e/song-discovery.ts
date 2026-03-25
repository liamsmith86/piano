import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DiscoveredSong {
  title: string;
  url: string;
  collection: 'public' | 'personal';
}

/**
 * Dynamically discover all .mxl and .musicxml files in public/songs/
 * including the personal/ subfolder. Tests use this so any new song
 * added to either folder is automatically covered.
 */
export function discoverAllSongs(): DiscoveredSong[] {
  const songsDir = path.resolve(__dirname, '../../public/songs');
  const songs: DiscoveredSong[] = [];

  // Scan root songs directory
  for (const file of safeReaddir(songsDir)) {
    if (isMusicXml(file)) {
      songs.push({
        title: filenameToTitle(file),
        url: `/songs/${file}`,
        collection: 'public',
      });
    }
  }

  // Scan personal/ subdirectory
  const personalDir = path.join(songsDir, 'personal');
  for (const file of safeReaddir(personalDir)) {
    if (isMusicXml(file)) {
      songs.push({
        title: filenameToTitle(file),
        url: `/songs/personal/${file}`,
        collection: 'personal',
      });
    }
  }

  return songs;
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isMusicXml(filename: string): boolean {
  return /\.(mxl|musicxml|xml)$/i.test(filename);
}

function filenameToTitle(filename: string): string {
  return filename
    .replace(/\.(mxl|musicxml|xml)$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}
