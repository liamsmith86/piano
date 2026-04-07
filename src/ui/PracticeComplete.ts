import type { PracticeState } from '../types';

export class PracticeComplete {
  private container: HTMLElement;
  private overlay: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  show(state: PracticeState): void {
    this.hide();

    const elapsed = state.startTime ? (Date.now() - state.startTime) / 1000 : 0;
    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60);
    const total = state.correctCount + state.wrongCount;
    const accuracy = total === 0 ? 100 : Math.round((state.correctCount / total) * 100);

    let grade = 'F';
    let gradeColor = '#ef4444';
    if (accuracy >= 95) { grade = 'A+'; gradeColor = '#22c55e'; }
    else if (accuracy >= 90) { grade = 'A'; gradeColor = '#22c55e'; }
    else if (accuracy >= 80) { grade = 'B'; gradeColor = '#3b82f6'; }
    else if (accuracy >= 70) { grade = 'C'; gradeColor = '#f59e0b'; }
    else if (accuracy >= 60) { grade = 'D'; gradeColor = '#f97316'; }

    // Build measure breakdown for measures with errors
    const troubleMeasures = state.measureStats
      .filter(m => m.wrong > 0)
      .sort((a, b) => b.wrong - a.wrong)
      .slice(0, 8);

    const measureBreakdown = troubleMeasures.length > 0
      ? `<div class="pc-measures">
           <h3>Trouble spots</h3>
           <div class="pc-measure-list">
             ${troubleMeasures.map(m => {
               const mTotal = m.correct + m.wrong;
               const mAcc = mTotal > 0 ? Math.round((m.correct / mTotal) * 100) : 0;
               const color = mAcc >= 80 ? '#f59e0b' : '#ef4444';
               return `<div class="pc-measure-item">
                 <span class="pc-measure-num">M${m.measure}</span>
                 <span class="pc-measure-errors" style="color:${color}">${m.wrong} error${m.wrong > 1 ? 's' : ''}</span>
               </div>`;
             }).join('')}
           </div>
         </div>`
      : '<div class="pc-measures"><p class="pc-perfect">No trouble spots — perfect practice!</p></div>';

    this.overlay = document.createElement('div');
    this.overlay.className = 'practice-complete-overlay';
    this.overlay.innerHTML = `
      <div class="pc-card">
        <h2>Practice Complete!</h2>
        <div class="pc-grade" style="color: ${gradeColor}">${grade}</div>
        <div class="pc-stats">
          <div class="pc-stat">
            <span class="pc-stat-value">${accuracy}%</span>
            <span class="pc-stat-label">Accuracy</span>
          </div>
          <div class="pc-stat">
            <span class="pc-stat-value">${state.correctCount}</span>
            <span class="pc-stat-label">Correct</span>
          </div>
          <div class="pc-stat">
            <span class="pc-stat-value">${state.wrongCount}</span>
            <span class="pc-stat-label">Wrong</span>
          </div>
          <div class="pc-stat">
            <span class="pc-stat-value">${state.bestStreak}</span>
            <span class="pc-stat-label">Best Streak</span>
          </div>
          <div class="pc-stat">
            <span class="pc-stat-value">${minutes}:${String(seconds).padStart(2, '0')}</span>
            <span class="pc-stat-label">Time</span>
          </div>
        </div>
        ${measureBreakdown}
        <div class="pc-actions">
          <button class="pc-btn pc-retry">Try Again</button>
          ${troubleMeasures.length > 0 ? '<button class="pc-btn pc-trouble">Practice Trouble Spots</button>' : ''}
          <button class="pc-btn pc-close">Close</button>
        </div>
      </div>
    `;

    this.overlay.querySelector('.pc-retry')!.addEventListener('click', () => {
      this.hide();
      this.onRetry?.();
    });

    const troubleBtn = this.overlay.querySelector('.pc-trouble');
    if (troubleBtn) {
      troubleBtn.addEventListener('click', () => {
        this.hide();
        // Set loop to the range covering all trouble measures
        const measureNumbers = troubleMeasures.map(m => m.measure);
        this.onPracticeTroubleSpots?.(
          Math.min(...measureNumbers),
          Math.max(...measureNumbers),
        );
      });
    }

    this.overlay.querySelector('.pc-close')!.addEventListener('click', () => {
      this.hide();
    });

    this.container.appendChild(this.overlay);
  }

  hide(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private onRetry: (() => void) | null = null;
  private onPracticeTroubleSpots: ((startMeasure: number, endMeasure: number) => void) | null = null;

  setOnRetry(cb: () => void): void {
    this.onRetry = cb;
  }

  setOnPracticeTroubleSpots(cb: (startMeasure: number, endMeasure: number) => void): void {
    this.onPracticeTroubleSpots = cb;
  }
}
