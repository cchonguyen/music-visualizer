// Slice 1.10 — on-screen debug panel proving the audio drives the visuals.
// NOTE(spec): the panel is self-contained (mounts into document.body and handles
// its own "D" key) so main.ts only needs to feed it one update() per frame. The
// latency estimate arrives pre-computed from src/audio/latency.ts; it is null
// unless the test-signal source is active, and the panel also shows n/a when the
// estimate exists but has zero paired samples.

import type { AudioFrame, BandLevels } from "../audio/types";
import { isEditableTarget } from "./controls";
import { formatTable, reportToJson, type BenchmarkReport } from "../render/benchmark";

/** Shape of one latency estimate, matching src/audio/latency.ts. */
export interface PanelLatency {
  medianMs: number;
  samples: number;
}

/** Everything the panel draws for one frame; the caller gathers it. */
export interface DebugPanelInput {
  sourceName: string;
  frame: AudioFrame;
  /** Wall-clock time of the last frame build, in milliseconds. */
  frameMs: number;
  /** Rolling frame-time budget summary (optional; hidden when absent). */
  budget?: { samples: number; p50Ms: number; p95Ms: number; overBudgetPct: number };
  /** Null unless the test-signal source is active (only it has kick times). */
  latency: PanelLatency | null;
  /** Capture/mic audio-track settings, to confirm voice filters are off. */
  trackSettings?: MediaTrackSettings | null;
}

/** Frame budget at 60 fps, shown in the budget line. */
const FRAME_BUDGET_MS = 16.7;

/** Latency below this is a pass and renders green. */
const PASS_LIMIT_MS = 100;

const BANDS: Array<{ name: string; key: keyof BandLevels }> = [
  { name: "sub", key: "sub" },
  { name: "mid", key: "mid" },
  { name: "high", key: "high" },
];

function fmt(value: number, digits = 3): string {
  return value.toFixed(digits);
}

export class DebugPanel {
  private readonly root: HTMLDivElement;
  private readonly stats: HTMLPreElement;
  private readonly status: HTMLDivElement;
  private visible = false;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:fixed;top:8px;left:8px;z-index:9999;" +
      "font:12px/1.5 ui-monospace,Menlo,monospace;" +
      "color:#cfe8ff;background:rgba(8,12,20,.85);" +
      "border:1px solid #2a3548;border-radius:6px;padding:8px 10px;" +
      "pointer-events:none;display:none;white-space:pre;";

    this.stats = document.createElement("pre");
    this.stats.style.cssText = "margin:0;";
    this.status = document.createElement("div");
    this.root.append(this.stats, this.status);

    parent.append(this.root);
    // Self-managed toggle so slices stay decoupled from main.ts wiring.
    window.addEventListener("keydown", this.onKeyDown);
  }

  /** Remove the element and listeners (clean teardown on page swap). */
  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.root.remove();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? "block" : "none";
  }

  /** Update the numbers. While hidden this is a no-op (cheap slice). */
  update(input: DebugPanelInput): void {
    if (!this.visible) return;
    const f = input.frame;

    const lines: string[] = [
      `source  ${input.sourceName}`,
      `rate    ${f.sampleRate} Hz   frameIndex ${f.frameIndex}`,
      `time    ${fmt(f.time, 3)} s   dt ${fmt(f.dtSec, 3)} s   ` +
        `build ${fmt(input.frameMs, 2)} ms`,
      ...(input.budget
        ? [`budget  ${fmt(FRAME_BUDGET_MS, 1)} ms: p95 ${fmt(input.budget.p95Ms, 1)} ms, ${fmt(input.budget.overBudgetPct, 1)}% over (${input.budget.samples} frames)`]
        : []),
      "band    raw      env      norm",
      ...BANDS.map(
        (b) =>
          `  ${b.name.padEnd(6)}` +
          `${fmt(f.raw[b.key]).padStart(8)}` +
          `${fmt(f.env[b.key]).padStart(9)}` +
          `${fmt(f.norm[b.key]).padStart(9)}`,
      ),
      `loud    ${fmt(f.loudness)}   energy ${fmt(f.energy)}`,
      `flux    ${fmt(f.flux, 4)}   ` +
        `sub ${fmt(f.fluxByBand.sub, 4)}  mid ${fmt(f.fluxByBand.mid, 4)}  ` +
        `high ${fmt(f.fluxByBand.high, 4)}`,
      `beat    ${f.beat ? "YES" : "no"}  ` +
        `(sub ${f.beatByBand.sub ? 1 : 0} mid ${f.beatByBand.mid ? 1 : 0} ` +
        `high ${f.beatByBand.high ? 1 : 0})  strength ${fmt(f.beatStrength)}`,
    ];
    const ts = input.trackSettings;
    if (ts) {
      const flag = (v: unknown) => (v === false ? "off" : v === true ? "ON!" : "?");
      lines.push(
        `filters echo ${flag(ts.echoCancellation)}  noise ${flag(ts.noiseSuppression)}  gain ${flag(ts.autoGainControl)}`,
      );
    }
    this.stats.textContent = lines.join("\n");

    // Latency line: n/a unless running the test signal; green under 100 ms.
    const l = input.latency;
    if (!l || l.samples === 0) {
      this.status.textContent = "latency n/a (measured with the Kick test signal only)";
      this.status.style.color = "#7f8ea3";
      return;
    }
    const pass = l.medianMs < PASS_LIMIT_MS;
    this.status.textContent =
      `detector latency ${l.medianMs.toFixed(1)} ms vs what you hear  (n=${l.samples})  ` +
      (pass ? "PASS" : "OVER");
    this.status.style.color = pass ? "#4ade80" : "#f87171";
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // Bare "d" only, so shortcuts with modifiers never toggle the panel.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditableTarget(e.target)) return;
    if (e.key !== "d" && e.key !== "D") return;
    this.toggle();
  };
}

/**
 * Benchmark mode overlay (Slice 16.1): shows progress while the run is going, then the results
 * table and a Copy JSON button. Mounted only when the `?benchmark` URL flag is on.
 */
export class BenchmarkPanel {
  private readonly root: HTMLDivElement;
  private readonly text: HTMLPreElement;
  private readonly copyBtn: HTMLButtonElement;
  private json = "";

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement("div");
    this.root.style.cssText =
      "position:fixed;top:8px;right:8px;z-index:10000;max-width:92vw;max-height:90vh;overflow:auto;" +
      "font:12px/1.5 ui-monospace,Menlo,monospace;color:#cfe8ff;background:rgba(8,12,20,.92);" +
      "border:1px solid #2a3548;border-radius:6px;padding:8px 10px;";
    this.text = document.createElement("pre");
    this.text.style.cssText = "margin:0;white-space:pre;";
    this.copyBtn = document.createElement("button");
    this.copyBtn.type = "button";
    this.copyBtn.textContent = "Copy results as JSON";
    this.copyBtn.hidden = true;
    this.copyBtn.style.cssText = "margin-top:8px;font:inherit;padding:4px 8px;cursor:pointer;";
    this.copyBtn.addEventListener("click", () => {
      void this.copy();
    });
    this.root.append(this.text, this.copyBtn);
    parent.append(this.root);
  }

  showProgress(current: number, total: number, name: string): void {
    this.text.textContent = `Benchmark running: preset ${current} of ${total}\n${name}\nLeave this tab in front and do not resize the window.`;
  }

  showResults(report: BenchmarkReport): void {
    this.json = reportToJson(report);
    const env = report.environment;
    this.text.textContent =
      `Benchmark done (${report.secondsPerPreset} s per preset)\n` +
      `${env.renderer}\n${env.canvasWidth}x${env.canvasHeight} px, pixel ratio ${env.devicePixelRatio}, ` +
      `GPU timer ${env.gpuTimer ? "yes" : "no"}\ntimes in ms\n\n` +
      formatTable(report);
    this.copyBtn.hidden = false;
  }

  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.json);
      this.copyBtn.textContent = "Copied";
    } catch {
      // Clipboard blocked: show the JSON so it can be selected by hand.
      this.text.textContent = this.json;
      this.copyBtn.textContent = "Select the text above and copy it";
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
