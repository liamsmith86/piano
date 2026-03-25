import type { PianoApp } from '../api';
import type { SongInfo } from '../types';
import { getBestAccuracyForSong, getSessionsForSong } from '../progress';

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export class SongLibrary {
  private app: PianoApp;
  private container: HTMLElement;
  private onSongLoad: ((song: SongInfo) => void) | null = null;
  private grid: HTMLElement | null = null;

  constructor(app: PianoApp, container: HTMLElement) {
    this.app = app;
    this.container = container;
  }

  async render(): Promise<void> {
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'song-library';

    // Header
    const header = document.createElement('div');
    header.className = 'sl-header';
    header.innerHTML = `
      <h2>Song Library</h2>
      <div class="sl-actions">
        <label class="sl-upload-btn" title="Upload MXL/MusicXML file">
          <input type="file" accept=".mxl,.musicxml,.xml" class="sl-file-input" />
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Upload
        </label>
      </div>
    `;
    wrapper.appendChild(header);

    const fileInput = header.querySelector('.sl-file-input') as HTMLInputElement;
    fileInput.addEventListener('change', () => this.handleUpload(fileInput));

    // Search bar
    const searchBar = document.createElement('div');
    searchBar.className = 'sl-search';
    searchBar.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" class="sl-search-input" placeholder="Search songs..." />
    `;
    wrapper.appendChild(searchBar);

    const searchInput = searchBar.querySelector('.sl-search-input') as HTMLInputElement;
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      this.grid?.querySelectorAll('.sl-card').forEach(card => {
        const title = card.querySelector('.sl-card-title')?.textContent?.toLowerCase() ?? '';
        (card as HTMLElement).style.display = title.includes(query) ? '' : 'none';
      });
    });

    // Welcome banner (only for first visit)
    if (!localStorage.getItem('piano-welcomed')) {
      const welcome = document.createElement('div');
      welcome.className = 'sl-welcome';
      welcome.innerHTML = `
        <p><strong>Welcome!</strong> Pick a song below to start. Use <strong>Play</strong> mode to listen, or <strong>Practice</strong> mode to learn note by note.</p>
        <p>Connect a MIDI keyboard, or use the on-screen piano and your computer keyboard to play.</p>
        <p>Press <kbd>?</kbd> for keyboard shortcuts. Open <strong>Settings</strong> to adjust helpers for your skill level.</p>
        <button class="sl-welcome-dismiss">Got it</button>
      `;
      welcome.querySelector('.sl-welcome-dismiss')!.addEventListener('click', () => {
        welcome.remove();
        localStorage.setItem('piano-welcomed', '1');
      });
      wrapper.appendChild(welcome);
    }

    // Song grid
    this.grid = document.createElement('div');
    this.grid.className = 'sl-grid';

    // Discover all songs (preloaded + personal from manifest)
    await this.app.discoverSongs();

    // Load uploaded songs from IndexedDB
    try {
      await this.app.loadUploadedSongsFromStorage();
    } catch {
      // IndexedDB unavailable — ignore
    }

    const allSongs = this.app.getSongList();
    for (const song of allSongs) {
      this.grid.appendChild(this.createSongCard(song, song.source === 'uploaded'));
    }

    wrapper.appendChild(this.grid);

    // Drop zone
    const dropZone = document.createElement('div');
    dropZone.className = 'sl-drop-zone';
    dropZone.innerHTML = '<p>Drop MXL / MusicXML files here</p>';
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('sl-drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('sl-drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('sl-drag-over');
      const file = e.dataTransfer?.files[0];
      if (file) this.loadFile(file);
    });
    wrapper.appendChild(dropZone);

    this.container.appendChild(wrapper);
  }

  private createSongCard(song: SongInfo, isUploaded = false): HTMLElement {
    const loadedSong = this.app.getLoadedSong();
    const isActive = loadedSong?.id === song.id;
    const card = document.createElement('button');
    card.className = `sl-card${isUploaded ? ' sl-card-uploaded' : ''}${isActive ? ' sl-card-active' : ''}`;
    card.dataset.songId = song.id;

    const iconColor = isUploaded ? '#22c55e' : 'currentColor';
    const bestAccuracy = getBestAccuracyForSong(song.id);
    const sessions = getSessionsForSong(song.id);
    const sessionCount = sessions.length;

    const progressHtml = bestAccuracy !== null
      ? `<div class="sl-card-progress">
           <div class="sl-card-progress-bar" style="width: ${bestAccuracy}%; background: ${bestAccuracy >= 90 ? '#22c55e' : bestAccuracy >= 70 ? '#f59e0b' : '#ef4444'}"></div>
         </div>
         <span class="sl-card-accuracy" style="color: ${bestAccuracy >= 90 ? '#22c55e' : bestAccuracy >= 70 ? '#f59e0b' : '#ef4444'}">${bestAccuracy}% best${sessionCount > 1 ? ` (${sessionCount} sessions)` : ''}</span>`
      : '';

    card.innerHTML = `
      <div class="sl-card-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="1.5">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>
      </div>
      <span class="sl-card-title">${escapeHtml(song.title)}</span>
      ${progressHtml}
      ${isUploaded ? '<span class="sl-card-badge">Uploaded</span>' : ''}
    `;

    card.addEventListener('click', async () => {
      if (song.source === 'uploaded' && !song.url) {
        await this.loadUploadedSong(song);
      } else {
        await this.loadSong(song);
      }
    });

    return card;
  }

  private async loadSong(song: SongInfo): Promise<void> {
    try {
      this.container.classList.add('loading');
      await this.app.loadSong(song.url);
      this.onSongLoad?.(song);
      this.hide();
    } catch (err) {
      console.error('Failed to load song:', err);
      alert(`Failed to load "${song.title}". Please try another song.`);
    } finally {
      this.container.classList.remove('loading');
    }
  }

  private async loadUploadedSong(song: SongInfo): Promise<void> {
    try {
      this.container.classList.add('loading');
      await this.app.loadSongById(song.id);
      this.onSongLoad?.(song);
      this.hide();
    } catch (err) {
      console.error('Failed to load uploaded song:', err);
      alert(`Failed to load "${song.title}".`);
    } finally {
      this.container.classList.remove('loading');
    }
  }

  private async handleUpload(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (file) await this.loadFile(file);
    input.value = '';
  }

  private async loadFile(file: File): Promise<void> {
    if (!file.name.match(/\.(mxl|musicxml|xml)$/i)) {
      alert('Please upload a .mxl, .musicxml, or .xml file');
      return;
    }

    try {
      this.container.classList.add('loading');
      await this.app.loadSong(file);
      const song = this.app.getLoadedSong();
      if (song) {
        this.onSongLoad?.(song);
        // Add card to grid
        if (this.grid) {
          this.grid.appendChild(this.createSongCard(song, true));
        }
      }
      this.hide();
    } catch (err) {
      console.error('Failed to load uploaded file:', err);
      alert('Failed to load file. Ensure it is a valid MusicXML or MXL file.');
    } finally {
      this.container.classList.remove('loading');
    }
  }

  setOnSongLoad(cb: (song: SongInfo) => void): void {
    this.onSongLoad = cb;
  }

  async show(): Promise<void> {
    // Re-render to update active song indicator and progress badges
    await this.render();
    this.container.style.display = 'block';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  isVisible(): boolean {
    return this.container.style.display !== 'none';
  }
}
