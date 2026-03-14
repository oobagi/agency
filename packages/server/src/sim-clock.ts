import { getDb } from './db.js';

export type TickCallback = (simTime: Date) => void;

const TICK_INTERVAL_MS = 1000; // Real-world ms between ticks
const SIM_SECONDS_PER_TICK = 1; // Base sim seconds advanced per tick at 1x speed

export class SimClock {
  private simTime: Date;
  private speed: number;
  private paused: boolean;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tickListeners: TickCallback[] = [];

  constructor() {
    const db = getDb();

    const savedTime = db.prepare("SELECT value FROM settings WHERE key = 'sim_time'").get() as
      | { value: string }
      | undefined;
    if (savedTime) {
      this.simTime = new Date(JSON.parse(savedTime.value));
    } else {
      // Initialize to sim day 1 at 07:00 (before office hours start at 08:00)
      this.simTime = new Date('2026-01-01T07:00:00.000Z');
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('sim_time', ?)").run(
        JSON.stringify(this.simTime.toISOString()),
      );
    }

    const speedRow = db.prepare("SELECT value FROM settings WHERE key = 'sim_speed'").get() as
      | { value: string }
      | undefined;
    this.speed = speedRow ? JSON.parse(speedRow.value) : 1;

    const pausedRow = db.prepare("SELECT value FROM settings WHERE key = 'sim_paused'").get() as
      | { value: string }
      | undefined;
    this.paused = pausedRow ? JSON.parse(pausedRow.value) : false;
  }

  start(): void {
    if (!this.paused) {
      this.startInterval();
    }
  }

  now(): Date {
    return new Date(this.simTime.getTime());
  }

  isPaused(): boolean {
    return this.paused;
  }

  getSpeed(): number {
    return this.speed;
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.stopInterval();
    this.persistState();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.startInterval();
    this.persistState();
  }

  setSpeed(multiplier: number): void {
    if (multiplier < 1 || multiplier > 10) {
      throw new Error('Speed multiplier must be between 1 and 10');
    }
    this.speed = multiplier;
    const db = getDb();
    db.prepare("UPDATE settings SET value = ? WHERE key = 'sim_speed'").run(
      JSON.stringify(this.speed),
    );

    // Restart the interval with the new speed if running
    if (!this.paused && this.intervalId !== null) {
      this.stopInterval();
      this.startInterval();
    }
  }

  onTick(callback: TickCallback): void {
    this.tickListeners.push(callback);
  }

  /** Jump to a specific sim time. Fires a single tick at the new time. */
  setTime(newTime: Date): void {
    this.simTime = new Date(newTime.getTime());
    this.persistTime();

    // Fire one tick so subscribers (scheduler, etc.) process the new time
    for (const listener of this.tickListeners) {
      listener(this.now());
    }
  }

  stop(): void {
    this.stopInterval();
    this.persistTime();
  }

  private startInterval(): void {
    if (this.intervalId !== null) return;
    this.intervalId = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  private stopInterval(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private tick(): void {
    const advanceMs = SIM_SECONDS_PER_TICK * this.speed * 1000;
    this.simTime = new Date(this.simTime.getTime() + advanceMs);
    this.persistTime();

    for (const listener of this.tickListeners) {
      listener(this.now());
    }
  }

  private persistTime(): void {
    const db = getDb();
    db.prepare("UPDATE settings SET value = ? WHERE key = 'sim_time'").run(
      JSON.stringify(this.simTime.toISOString()),
    );
  }

  private persistState(): void {
    const db = getDb();
    db.prepare("UPDATE settings SET value = ? WHERE key = 'sim_paused'").run(
      JSON.stringify(this.paused),
    );
  }
}
