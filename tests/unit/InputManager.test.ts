import { describe, it, expect, vi } from 'vitest';
import { InputManager } from '../../src/input/InputManager';

describe('InputManager', () => {
  it('emits events to listeners', () => {
    const im = new InputManager();
    const listener = vi.fn();
    im.addListener(listener);

    im.emit({
      type: 'noteOn',
      midiNumber: 60,
      velocity: 100,
      source: 'programmatic',
    });

    expect(listener).toHaveBeenCalledWith({
      type: 'noteOn',
      midiNumber: 60,
      velocity: 100,
      source: 'programmatic',
    });
  });

  it('tracks active notes on noteOn', () => {
    const im = new InputManager();
    im.emit({ type: 'noteOn', midiNumber: 60, velocity: 100, source: 'programmatic' });
    im.emit({ type: 'noteOn', midiNumber: 64, velocity: 80, source: 'programmatic' });

    expect(im.isNoteActive(60)).toBe(true);
    expect(im.isNoteActive(64)).toBe(true);
    expect(im.isNoteActive(67)).toBe(false);
  });

  it('removes active notes on noteOff', () => {
    const im = new InputManager();
    im.emit({ type: 'noteOn', midiNumber: 60, velocity: 100, source: 'programmatic' });
    expect(im.isNoteActive(60)).toBe(true);

    im.emit({ type: 'noteOff', midiNumber: 60, velocity: 0, source: 'programmatic' });
    expect(im.isNoteActive(60)).toBe(false);
  });

  it('simulateNoteOn emits noteOn event', () => {
    const im = new InputManager();
    const listener = vi.fn();
    im.addListener(listener);

    im.simulateNoteOn(72, 90);

    expect(listener).toHaveBeenCalledWith({
      type: 'noteOn',
      midiNumber: 72,
      velocity: 90,
      source: 'programmatic',
    });
    expect(im.isNoteActive(72)).toBe(true);
  });

  it('simulateNoteOff emits noteOff event', () => {
    const im = new InputManager();
    im.simulateNoteOn(72);
    const listener = vi.fn();
    im.addListener(listener);

    im.simulateNoteOff(72);

    expect(listener).toHaveBeenCalledWith({
      type: 'noteOff',
      midiNumber: 72,
      velocity: 0,
      source: 'programmatic',
    });
    expect(im.isNoteActive(72)).toBe(false);
  });

  it('getActiveNotes returns a copy of active notes', () => {
    const im = new InputManager();
    im.simulateNoteOn(60);
    im.simulateNoteOn(64);
    im.simulateNoteOn(67);

    const active = im.getActiveNotes();
    expect(active.size).toBe(3);
    expect(active.has(60)).toBe(true);
    expect(active.has(64)).toBe(true);
    expect(active.has(67)).toBe(true);

    // Verify it's a copy
    active.delete(60);
    expect(im.isNoteActive(60)).toBe(true);
  });

  it('removeListener stops receiving events', () => {
    const im = new InputManager();
    const listener = vi.fn();
    im.addListener(listener);
    im.removeListener(listener);

    im.simulateNoteOn(60);
    expect(listener).not.toHaveBeenCalled();
  });

  it('clearAll releases all active notes', () => {
    const im = new InputManager();
    im.simulateNoteOn(60);
    im.simulateNoteOn(64);
    im.simulateNoteOn(67);

    const listener = vi.fn();
    im.addListener(listener);

    im.clearAll();

    expect(im.getActiveNotes().size).toBe(0);
    // Should have emitted 3 noteOff events
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('destroy clears listeners and active notes', () => {
    const im = new InputManager();
    const listener = vi.fn();
    im.addListener(listener);
    im.simulateNoteOn(60);

    im.destroy();

    // After destroy, no more events should be delivered to old listeners
    // (clearAll was called first which releases notes, then listeners cleared)
    expect(im.getActiveNotes().size).toBe(0);
  });

  it('catches errors in listeners', () => {
    const im = new InputManager();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();

    im.addListener(() => { throw new Error('boom'); });
    im.addListener(good);

    im.simulateNoteOn(60);

    expect(errorSpy).toHaveBeenCalled();
    expect(good).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });
});
