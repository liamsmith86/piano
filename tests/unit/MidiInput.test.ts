import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from '../../src/input/InputManager';
import { MidiInput } from '../../src/input/MidiInput';

type MutableMidiInput = {
  id: string;
  name: string;
  type: 'input';
  state: MIDIPortDeviceState;
  onmidimessage: ((event: MIDIMessageEvent) => void) | null;
};

function send(input: MutableMidiInput, data: number[]): void {
  input.onmidimessage?.({ data: new Uint8Array(data) } as MIDIMessageEvent);
}

describe('MidiInput', () => {
  let inputManager: InputManager;
  let midi: MidiInput;
  let input: MutableMidiInput;
  let access: MIDIAccess;
  let requestMidiAccess: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    inputManager = new InputManager();
    midi = new MidiInput(inputManager);
    input = {
      id: 'piano-1',
      name: 'Test Piano',
      type: 'input',
      state: 'connected',
      onmidimessage: null,
    };
    access = {
      inputs: new Map([[input.id, input]]) as unknown as MIDIInputMap,
      outputs: new Map() as unknown as MIDIOutputMap,
      onstatechange: null,
      sysexEnabled: false,
    } as MIDIAccess;
    requestMidiAccess = vi.fn().mockResolvedValue(access);
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: requestMidiAccess,
    });
  });

  afterEach(() => {
    midi.destroy();
    inputManager.destroy();
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: undefined,
    });
  });

  it('initializes once and binds only connected inputs', async () => {
    const first = midi.init();
    const second = midi.init();

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);

    expect(requestMidiAccess).toHaveBeenCalledOnce();
    expect(input.onmidimessage).toBeTypeOf('function');
    expect(midi.getConnectedDevices()).toEqual(['Test Piano']);
  });

  it('defers note-off until the sustain pedal is released', async () => {
    const listener = vi.fn();
    inputManager.addListener(listener);
    await midi.init();

    send(input, [0x90, 60, 100]);
    send(input, [0xb0, 64, 127]);
    send(input, [0x80, 60, 0]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(inputManager.isNoteActive(60)).toBe(true);

    send(input, [0xb0, 64, 0]);

    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'noteOff',
      midiNumber: 60,
      source: 'midi',
    }));
    expect(inputManager.isNoteActive(60)).toBe(false);
  });

  it('releases only the disconnected MIDI port notes', async () => {
    inputManager.emit({
      type: 'noteOn',
      midiNumber: 60,
      velocity: 0.7,
      source: 'virtual',
      inputId: '60',
    });
    await midi.init();
    send(input, [0x90, 60, 100]);

    input.state = 'disconnected';
    access.onstatechange?.({ port: input } as unknown as MIDIConnectionEvent);

    expect(inputManager.isNoteActive(60)).toBe(true);
    expect(midi.isConnected()).toBe(false);

    inputManager.emit({
      type: 'noteOff',
      midiNumber: 60,
      velocity: 0,
      source: 'virtual',
      inputId: '60',
    });
    expect(inputManager.isNoteActive(60)).toBe(false);
  });

  it('handles the MIDI all-notes-off controller', async () => {
    await midi.init();
    send(input, [0x90, 60, 100]);
    send(input, [0x90, 64, 100]);

    send(input, [0xb0, 123, 0]);

    expect(inputManager.getActiveNotes()).toEqual(new Set());
  });
});
