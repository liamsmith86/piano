import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStatus } from '../../src/ui/AppStatus';

describe('AppStatus', () => {
  let container: HTMLElement;
  let status: AppStatus;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    status = new AppStatus(container);
  });

  afterEach(() => {
    status.destroy();
    container.remove();
    vi.useRealTimers();
  });

  it('renders and clamps determinate task progress', () => {
    status.setTask('audio', { label: 'Preparing piano', detail: '3 of 30', progress: 2 });

    expect(container.querySelector('.app-task-copy')?.textContent).toContain('3 of 30');
    expect((container.querySelector('progress') as HTMLProgressElement).value).toBe(1);
  });

  it('shows the most recently updated task and restores the previous one', () => {
    status.setTask('audio', { label: 'Preparing piano' });
    status.setTask('song', { label: 'Opening score' });
    expect(container.querySelector('.app-task')?.textContent).toContain('Opening score');

    status.finishTask('song');
    expect(container.querySelector('.app-task')?.textContent).toContain('Preparing piano');
  });

  it('runs a recovery action and dismisses the message', () => {
    const retry = vi.fn();
    status.showMessage('Unable to load', {
      kind: 'error', actionLabel: 'Retry', onAction: retry,
    });

    (container.querySelector('.app-message-action') as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalledOnce();
    expect(container.querySelector('.app-message')).toBeNull();
  });

  it('automatically dismisses transient messages', () => {
    status.showMessage('Back online', { timeoutMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(container.querySelector('.app-message')).toBeNull();
  });
});
