import type { InputManager } from './InputManager';

export class MidiInput {
  private inputManager: InputManager;
  private midiAccess: MIDIAccess | null = null;
  private connectedInputs: MIDIInput[] = [];
  private onConnectionChange: ((connected: boolean, name: string) => void) | null = null;

  constructor(inputManager: InputManager) {
    this.inputManager = inputManager;
  }

  async init(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not supported in this browser');
      return false;
    }

    try {
      this.midiAccess = await navigator.requestMIDIAccess();
      this.connectInputs();

      this.midiAccess.onstatechange = () => {
        this.connectInputs();
      };

      return true;
    } catch (err) {
      console.warn('MIDI access denied:', err);
      return false;
    }
  }

  private connectInputs(): void {
    if (!this.midiAccess) return;

    // Disconnect old inputs
    for (const input of this.connectedInputs) {
      input.onmidimessage = null;
    }
    this.connectedInputs = [];

    // Connect all available inputs
    for (const input of this.midiAccess.inputs.values()) {
      input.onmidimessage = (event) => this.handleMidiMessage(event);
      this.connectedInputs.push(input);
      this.onConnectionChange?.(true, input.name ?? 'Unknown MIDI device');
    }

    if (this.connectedInputs.length === 0) {
      this.onConnectionChange?.(false, '');
    }
  }

  private sustainPedalDown = false;
  private sustainedNotes = new Set<number>();

  private handleMidiMessage(event: MIDIMessageEvent): void {
    if (!event.data || event.data.length < 3) return;

    const [status, data1, data2] = event.data;
    const command = status & 0xf0;

    // Handle Control Change (CC) messages
    if (command === 0xB0) {
      if (data1 === 64) {
        // Sustain pedal (CC 64): value >= 64 = on, < 64 = off
        this.sustainPedalDown = data2 >= 64;
        if (!this.sustainPedalDown) {
          // Release all sustained notes
          for (const note of this.sustainedNotes) {
            this.inputManager.emit({
              type: 'noteOff',
              midiNumber: note,
              velocity: 0,
              source: 'midi',
            });
          }
          this.sustainedNotes.clear();
        }
      }
      return;
    }

    if (command === 0x90 && data2 > 0) {
      // Note On
      this.sustainedNotes.delete(data1); // remove from sustained if re-pressed
      this.inputManager.emit({
        type: 'noteOn',
        midiNumber: data1,
        velocity: data2 / 127,
        source: 'midi',
      });
    } else if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      // Note Off — if sustain pedal is down, defer the release
      if (this.sustainPedalDown) {
        this.sustainedNotes.add(data1);
        return;
      }
      this.inputManager.emit({
        type: 'noteOff',
        midiNumber: data1,
        velocity: 0,
        source: 'midi',
      });
    }
  }

  setConnectionCallback(cb: (connected: boolean, name: string) => void): void {
    this.onConnectionChange = cb;
  }

  getConnectedDevices(): string[] {
    return this.connectedInputs.map(i => i.name ?? 'Unknown');
  }

  isConnected(): boolean {
    return this.connectedInputs.length > 0;
  }

  destroy(): void {
    this.sustainedNotes.clear();
    this.sustainPedalDown = false;
    for (const input of this.connectedInputs) {
      input.onmidimessage = null;
    }
    this.connectedInputs = [];
    this.midiAccess = null;
  }
}
