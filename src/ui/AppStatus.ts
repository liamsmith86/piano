export type StatusKind = 'info' | 'success' | 'error';

export interface StatusTask {
  label: string;
  detail?: string;
  progress?: number;
}

export interface StatusMessageOptions {
  kind?: StatusKind;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  timeoutMs?: number;
}

/**
 * Non-blocking feedback for background work and recoverable errors. Tasks and
 * transient messages intentionally live in separate live regions so progress
 * updates do not repeatedly interrupt screen-reader users.
 */
export class AppStatus {
  private readonly root: HTMLElement;
  private readonly taskRegion: HTMLElement;
  private readonly messageRegion: HTMLElement;
  private readonly tasks = new Map<string, StatusTask>();
  private messageTimer: number | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'app-status-root';

    this.taskRegion = document.createElement('div');
    this.taskRegion.className = 'app-task-region';
    this.taskRegion.setAttribute('role', 'status');
    this.taskRegion.setAttribute('aria-live', 'polite');
    this.taskRegion.setAttribute('aria-atomic', 'true');

    this.messageRegion = document.createElement('div');
    this.messageRegion.className = 'app-message-region';
    this.messageRegion.setAttribute('aria-live', 'polite');

    this.root.append(this.taskRegion, this.messageRegion);
    container.appendChild(this.root);
  }

  setTask(id: string, task: StatusTask): void {
    this.tasks.set(id, {
      ...task,
      progress: task.progress === undefined
        ? undefined
        : Math.max(0, Math.min(1, task.progress)),
    });
    this.renderTasks();
  }

  finishTask(id: string): void {
    if (!this.tasks.delete(id)) return;
    this.renderTasks();
  }

  showMessage(message: string, options: StatusMessageOptions = {}): void {
    this.clearMessage();

    const kind = options.kind ?? 'info';
    const toast = document.createElement('div');
    toast.className = `app-message app-message-${kind}`;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');

    const text = document.createElement('span');
    text.className = 'app-message-text';
    text.textContent = message;
    toast.appendChild(text);

    if (options.actionLabel && options.onAction) {
      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'app-message-action';
      action.textContent = options.actionLabel;
      action.addEventListener('click', () => {
        this.clearMessage();
        void options.onAction?.();
      });
      toast.appendChild(action);
    }

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'app-message-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss message');
    dismiss.textContent = '\u00d7';
    dismiss.addEventListener('click', () => this.clearMessage());
    toast.appendChild(dismiss);

    this.messageRegion.replaceChildren(toast);
    const timeoutMs = options.timeoutMs ?? (kind === 'error' ? 0 : 4500);
    if (timeoutMs > 0) {
      this.messageTimer = window.setTimeout(() => this.clearMessage(), timeoutMs);
    }
  }

  clearMessage(): void {
    if (this.messageTimer !== null) {
      window.clearTimeout(this.messageTimer);
      this.messageTimer = null;
    }
    this.messageRegion.replaceChildren();
  }

  destroy(): void {
    this.clearMessage();
    this.tasks.clear();
    this.root.remove();
  }

  private renderTasks(): void {
    const active = Array.from(this.tasks.values()).at(-1);
    if (!active) {
      this.taskRegion.replaceChildren();
      return;
    }

    const card = document.createElement('div');
    card.className = 'app-task';

    const spinner = document.createElement('span');
    spinner.className = 'app-task-spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('span');
    copy.className = 'app-task-copy';
    const label = document.createElement('strong');
    label.textContent = active.label;
    copy.appendChild(label);
    if (active.detail) {
      const detail = document.createElement('span');
      detail.textContent = active.detail;
      copy.appendChild(detail);
    }

    card.append(spinner, copy);
    if (active.progress !== undefined) {
      const progress = document.createElement('progress');
      progress.className = 'app-task-progress';
      progress.max = 1;
      progress.value = active.progress;
      progress.setAttribute('aria-label', active.label);
      card.appendChild(progress);
    }
    this.taskRegion.replaceChildren(card);
  }
}
