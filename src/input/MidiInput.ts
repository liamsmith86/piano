import type { InputManager } from './InputManager';

interface MidiChannelState {
  sustainPedalDown: boolean;
  pressedNotes: Set<number>;
  soundingNotes: Set<number>;
  sustainedNotes: Set<number>;
}

export class MidiInput {
  private readonly inputManager: InputManager;
  private midiAccess: MIDIAccess | null = null;
  private connectedInputs: MIDIInput[] = [];
  private channelStates = new Map<string, MidiChannelState>();
  private initPromise: Promise<boolean> | null = null;
  private lifecycleGeneration = 0;
  private connectionSignature = '';
  private onConnectionChange: ((connected: boolean, name: string) => void) | null = null;

  constructor(inputManager: InputManager) {
    this.inputManager = inputManager;
  }

  async init(): Promise<boolean> {
    if (this.midiAccess) return true;
    if (this.initPromise) return this.initPromise;
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not supported in this browser');
      return false;
    }

    const generation = this.lifecycleGeneration;
    this.initPromise = navigator.requestMIDIAccess()
      .then(access => {
        if (generation !== this.lifecycleGeneration) return false;
        this.midiAccess = access;
        this.connectInputs();
        access.onstatechange = event => this.handleStateChange(event);
        return true;
      })
      .catch(err => {
        console.warn('MIDI access denied:', err);
        return false;
      })
      .finally(() => {
        this.initPromise = null;
      });

    return this.initPromise;
  }

  private handleStateChange(event: Event): void {
    const port = (event as MIDIConnectionEvent).port;
    if (port?.type === 'input' && port.state === 'disconnected') {
      this.releasePortNotes(port.id);
    }
    this.connectInputs();
  }

  private connectInputs(): void {
    if (!this.midiAccess) return;

    for (const input of this.connectedInputs) {
      input.onmidimessage = null;
    }

    this.connectedInputs = [...this.midiAccess.inputs.values()]
      .filter(input => input.state === 'connected');

    for (const input of this.connectedInputs) {
      input.onmidimessage = event => this.handleMidiMessage(input.id, event);
    }

    this.notifyConnectionChange();
  }

  private handleMidiMessage(portId: string, event: MIDIMessageEvent): void {
    if (!event.data || event.data.length < 3) return;

    const [status, data1, data2] = event.data;
    const command = status & 0xf0;
    const channelId = `${portId}:${status & 0x0f}`;
    const state = this.getChannelState(channelId);

    if (command === 0xb0) {
      this.handleControlChange(channelId, state, data1, data2);
      return;
    }

    if (command === 0x90 && data2 > 0) {
      state.pressedNotes.add(data1);
      state.soundingNotes.add(data1);
      state.sustainedNotes.delete(data1);
      this.emitNote('noteOn', data1, data2 / 127, channelId);
      return;
    }

    if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      state.pressedNotes.delete(data1);
      if (state.sustainPedalDown) {
        state.sustainedNotes.add(data1);
      } else {
        this.releaseNote(state, data1, channelId);
      }
    }
  }

  private handleControlChange(
    channelId: string,
    state: MidiChannelState,
    controller: number,
    value: number,
  ): void {
    if (controller === 64) {
      const pedalDown = value >= 64;
      if (state.sustainPedalDown && !pedalDown) {
        for (const note of [...state.sustainedNotes]) {
          if (!state.pressedNotes.has(note)) this.releaseNote(state, note, channelId);
        }
      }
      state.sustainPedalDown = pedalDown;
    } else if (controller === 120 || controller === 123) {
      this.releaseChannelNotes(channelId, state);
    }
  }

  private getChannelState(channelId: string): MidiChannelState {
    let state = this.channelStates.get(channelId);
    if (!state) {
      state = {
        sustainPedalDown: false,
        pressedNotes: new Set(),
        soundingNotes: new Set(),
        sustainedNotes: new Set(),
      };
      this.channelStates.set(channelId, state);
    }
    return state;
  }

  private releaseNote(state: MidiChannelState, note: number, channelId: string): void {
    if (!state.soundingNotes.delete(note)) return;
    state.sustainedNotes.delete(note);
    this.emitNote('noteOff', note, 0, channelId);
  }

  private releasePortNotes(portId: string): void {
    for (const [channelId, state] of this.channelStates) {
      if (!channelId.startsWith(`${portId}:`)) continue;
      this.releaseChannelNotes(channelId, state);
      this.channelStates.delete(channelId);
    }
  }

  private releaseChannelNotes(channelId: string, state: MidiChannelState): void {
    for (const note of [...state.soundingNotes]) {
      this.releaseNote(state, note, channelId);
    }
    state.pressedNotes.clear();
    state.sustainedNotes.clear();
    state.sustainPedalDown = false;
  }

  private releaseAllNotes(): void {
    for (const [channelId, state] of this.channelStates) {
      this.releaseChannelNotes(channelId, state);
    }
    this.channelStates.clear();
  }

  private emitNote(
    type: 'noteOn' | 'noteOff',
    midiNumber: number,
    velocity: number,
    inputId: string,
  ): void {
    this.inputManager.emit({ type, midiNumber, velocity, source: 'midi', inputId });
  }

  setConnectionCallback(cb: (connected: boolean, name: string) => void): void {
    this.onConnectionChange = cb;
    this.notifyConnectionChange(true);
  }

  private notifyConnectionChange(force = false): void {
    const names = this.getConnectedDevices();
    const signature = names.join('\0');
    if (!force && signature === this.connectionSignature) return;
    this.connectionSignature = signature;
    const label = names.length > 1 ? `${names[0]} +${names.length - 1}` : (names[0] ?? '');
    this.onConnectionChange?.(names.length > 0, label);
  }

  getConnectedDevices(): string[] {
    return this.connectedInputs.map(input => input.name ?? 'Unknown MIDI device');
  }

  isConnected(): boolean {
    return this.connectedInputs.length > 0;
  }

  destroy(): void {
    this.lifecycleGeneration++;
    this.releaseAllNotes();
    for (const input of this.connectedInputs) {
      input.onmidimessage = null;
    }
    this.connectedInputs = [];
    if (this.midiAccess) this.midiAccess.onstatechange = null;
    this.midiAccess = null;
    this.initPromise = null;
    this.connectionSignature = '';
  }
}
