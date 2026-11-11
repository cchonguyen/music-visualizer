// AudioEngine: one AudioContext, one analyser chain, one active source at a time.
//
//   source ──► analyser ──► (audible sources only) gain ──► speakers
//
// The analyser taps before the gain node, so the volume slider never changes
// what the visuals see.
import { FrameBuilder } from './frameBuilder';
import { scheduleTestSignal, type TestSignal } from './testSignals';
import { displaySource, fileSource, micSource, SourceError, type ActiveSource } from './sources';
import type { AudioFrame } from './types';

export type SourceKind = 'none' | 'file' | 'display' | 'mic' | `test:${TestSignal}`;
type EngineEvent = 'source-ended' | 'error' | 'source-changed';

const FAST_FFT_SIZE = 2048; // 17.1: short window used only for onset timing
const FFT_SIZE = 8192; // 2.3 measured: 4096 missed 6/20 kicks and fired 27 false beats under a 95 Hz note; 8192 caught 20/20

export class AudioEngine {
  readonly ctx: AudioContext;
  private analyser: AnalyserNode;
  private fastAnalyser: AnalyserNode;
  private fastByteSpectrum: Uint8Array<ArrayBuffer>;
  private gain: GainNode;
  private builder: FrameBuilder;
  private byteSpectrum: Uint8Array<ArrayBuffer>;
  private waveform: Float32Array<ArrayBuffer>;
  private active: ActiveSource | null = null;
  private listeners = new Map<EngineEvent, Set<(detail?: unknown) => void>>();
  private _kind: SourceKind = 'none';
  /** Scheduled kick times (AudioContext seconds) when the kick test signal runs. */
  kickTimes: number[] = [];
  /** Until this context time, analysis sees silence (see readFrame). */
  private settleUntil = 0;

  /** Must be called inside a click or key handler: browsers block audio otherwise. */
  static create(): AudioEngine {
    return new AudioEngine();
  }

  private constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    // resume() is called synchronously within the user gesture (spec).
    void this.ctx.resume();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0;
    // Pinned dB window so 0..1 levels mean the same thing for every source.
    this.analyser.minDecibels = -100;
    this.analyser.maxDecibels = -30;
    this.fastAnalyser = this.ctx.createAnalyser();
    this.fastAnalyser.fftSize = FAST_FFT_SIZE;
    this.fastAnalyser.smoothingTimeConstant = 0;
    this.fastAnalyser.minDecibels = -100;
    this.fastAnalyser.maxDecibels = -30;
    this.fastByteSpectrum = new Uint8Array(FAST_FFT_SIZE / 2);
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.builder = new FrameBuilder(this.ctx.sampleRate, FFT_SIZE, FAST_FFT_SIZE);
    this.byteSpectrum = new Uint8Array(FFT_SIZE / 2);
    this.waveform = new Float32Array(FFT_SIZE);
  }

  get kind(): SourceKind {
    return this._kind;
  }

  get media(): HTMLAudioElement | null {
    return this.active?.media ?? null;
  }

  on(event: EngineEvent, cb: (detail?: unknown) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  private emit(event: EngineEvent, detail?: unknown): void {
    for (const cb of this.listeners.get(event) ?? []) cb(detail);
  }

  setVolume(v: number): void {
    // Volume only through the GainNode (spec); smooth ramp avoids clicks.
    this.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.02);
  }

  /** Stop the current source and reset analysis so a switch never makes a fake beat. */
  stop(): void {
    this.active?.stop();
    this.active = null;
    this.kickTimes = [];
    this.builder.reset();
    this._kind = 'none';
    this.emit('source-changed', this._kind);
  }

  private attach(source: ActiveSource, kind: SourceKind): void {
    this.stop();
    source.node.connect(this.analyser);
    source.node.connect(this.fastAnalyser); // analysis only: it has no output, so it is never audible
    // Reconnect output per source: only file and test signals are audible.
    this.analyser.disconnect();
    if (source.audible) this.analyser.connect(this.gain);
    source.onEnded?.(() => {
      if (this.active === source) this.emit('source-ended', kind);
    });
    this.active = source;
    this._kind = kind;
    // The analyser still holds ~170–186 ms (fftSize / sampleRate with fftSize = 8192) of the previous
    // source. Until it drains, analysis sees silence, so a switch can't make a
    // fake beat (found in browser testing, 2026-11-04).
    this.settleUntil = this.ctx.currentTime + FFT_SIZE / this.ctx.sampleRate + 0.02;
    this.emit('source-changed', kind);
  }

  async useFile(file: File): Promise<void> {
    await this.run(async () => {
      const src = fileSource(this.ctx, file);
      this.attach(src, 'file');
      await src.media!.play();
    });
  }

  async useDisplayCapture(): Promise<void> {
    await this.run(async () => this.attach(await displaySource(this.ctx), 'display'));
  }

  async useMic(): Promise<void> {
    await this.run(async () => this.attach(await micSource(this.ctx), 'mic'));
  }

  useTestSignal(signal: TestSignal): void {
    const out = this.ctx.createGain();
    const handle = scheduleTestSignal(this.ctx, out, signal, this.ctx.currentTime + 0.1);
    this.attach(
      {
        node: out,
        audible: true,
        stop() {
          handle.stop();
          out.disconnect();
        },
      },
      `test:${signal}`,
    );
    this.kickTimes = handle.kickTimes;
  }

  /** Called once per animation frame by the renderer. */
  readFrame(): AudioFrame {
    if (this.ctx.currentTime < this.settleUntil) {
      this.byteSpectrum.fill(0);
      this.fastByteSpectrum.fill(0);
      this.waveform.fill(0);
    } else {
      this.fastAnalyser.getByteFrequencyData(this.fastByteSpectrum);
      this.analyser.getByteFrequencyData(this.byteSpectrum);
      this.analyser.getFloatTimeDomainData(this.waveform);
    }
    return this.builder.build(this.ctx.currentTime, this.byteSpectrum, this.waveform, this.fastByteSpectrum);
  }

  /** Audio-track settings for capture/mic (null for file and test signals). */
  get trackSettings(): MediaTrackSettings | null {
    return this.active?.settings?.() ?? null;
  }

  /** Output latency estimate from the browser, in seconds. */
  get outputLatencySec(): number {
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    try {
      await this.ctx.resume();
      await fn();
    } catch (err) {
      const message =
        err instanceof SourceError
          ? err.message
          : err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Permission was denied. Allow access in the browser prompt or site settings and try again.'
            : `Could not start this source: ${(err as Error).message}`;
      this.emit('error', message);
    }
  }
}
