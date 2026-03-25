import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '../../src/events';

describe('EventEmitter', () => {
  it('calls listener when event is emitted', () => {
    const emitter = new EventEmitter();
    const listener = vi.fn();

    emitter.on('loaded', listener);
    emitter.emit('loaded', { songId: 'test-song' });

    expect(listener).toHaveBeenCalledWith({ songId: 'test-song' });
  });

  it('supports multiple listeners on same event', () => {
    const emitter = new EventEmitter();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    emitter.on('loaded', listener1);
    emitter.on('loaded', listener2);
    emitter.emit('loaded', { songId: 'x' });

    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
  });

  it('removes a specific listener with off()', () => {
    const emitter = new EventEmitter();
    const listener = vi.fn();

    emitter.on('loaded', listener);
    emitter.off('loaded', listener);
    emitter.emit('loaded', { songId: 'x' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not affect other listeners when removing one', () => {
    const emitter = new EventEmitter();
    const stay = vi.fn();
    const remove = vi.fn();

    emitter.on('loaded', stay);
    emitter.on('loaded', remove);
    emitter.off('loaded', remove);
    emitter.emit('loaded', { songId: 'x' });

    expect(stay).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });

  it('removeAllListeners clears all listeners for an event', () => {
    const emitter = new EventEmitter();
    const listener = vi.fn();

    emitter.on('loaded', listener);
    emitter.removeAllListeners('loaded');
    emitter.emit('loaded', { songId: 'x' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('removeAllListeners without arg clears everything', () => {
    const emitter = new EventEmitter();
    const l1 = vi.fn();
    const l2 = vi.fn();

    emitter.on('loaded', l1);
    emitter.on('noteCorrect', l2);
    emitter.removeAllListeners();
    emitter.emit('loaded', { songId: 'x' });
    emitter.emit('noteCorrect', { midiNumber: 60, cursorIndex: 0 });

    expect(l1).not.toHaveBeenCalled();
    expect(l2).not.toHaveBeenCalled();
  });

  it('listenerCount returns correct count', () => {
    const emitter = new EventEmitter();
    expect(emitter.listenerCount('loaded')).toBe(0);

    const l1 = vi.fn();
    const l2 = vi.fn();
    emitter.on('loaded', l1);
    expect(emitter.listenerCount('loaded')).toBe(1);

    emitter.on('loaded', l2);
    expect(emitter.listenerCount('loaded')).toBe(2);

    emitter.off('loaded', l1);
    expect(emitter.listenerCount('loaded')).toBe(1);
  });

  it('catches errors in listeners without crashing', () => {
    const emitter = new EventEmitter();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const good = vi.fn();

    emitter.on('loaded', () => { throw new Error('boom'); });
    emitter.on('loaded', good);

    emitter.emit('loaded', { songId: 'x' });

    expect(errorSpy).toHaveBeenCalled();
    expect(good).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it('does not error when emitting with no listeners', () => {
    const emitter = new EventEmitter();
    expect(() => emitter.emit('loaded', { songId: 'x' })).not.toThrow();
  });
});
