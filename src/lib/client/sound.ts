"use client";

/**
 * Tiny WebAudio synth. No audio files to ship, nothing to preload, and nothing
 * plays until the player has interacted with the page — the AudioContext is
 * only created on the first explicit call, which browsers require anyway.
 */
export type SoundName =
  | "bid"
  | "outbid"
  | "sold"
  | "tick"
  | "reveal"
  | "crit"
  | "victory"
  | "defeat"
  | "click";

const STORAGE_KEY = "draftwar:sound";

let ctx: AudioContext | null = null;
let enabled = true;

export function soundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  enabled = raw === null ? true : raw === "1";
  return enabled;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  }
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

interface Tone {
  freq: number;
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
}

const RECIPES: Record<SoundName, Tone[]> = {
  click: [{ freq: 420, dur: 0.05, gain: 0.05, type: "triangle" }],
  bid: [{ freq: 540, to: 880, dur: 0.13, gain: 0.09, type: "square" }],
  outbid: [
    { freq: 320, to: 200, dur: 0.18, gain: 0.09, type: "sawtooth" },
    { freq: 180, dur: 0.12, gain: 0.06, delay: 0.1, type: "sine" },
  ],
  sold: [
    { freq: 660, dur: 0.1, gain: 0.1, type: "square" },
    { freq: 880, dur: 0.1, gain: 0.1, delay: 0.1, type: "square" },
    { freq: 1180, dur: 0.24, gain: 0.11, delay: 0.2, type: "square" },
  ],
  tick: [{ freq: 1100, dur: 0.04, gain: 0.06, type: "sine" }],
  reveal: [
    { freq: 220, to: 780, dur: 0.42, gain: 0.08, type: "sawtooth" },
  ],
  crit: [
    { freq: 900, to: 140, dur: 0.2, gain: 0.13, type: "sawtooth" },
  ],
  victory: [
    { freq: 523, dur: 0.14, gain: 0.11, type: "square" },
    { freq: 659, dur: 0.14, gain: 0.11, delay: 0.14, type: "square" },
    { freq: 784, dur: 0.14, gain: 0.11, delay: 0.28, type: "square" },
    { freq: 1046, dur: 0.44, gain: 0.12, delay: 0.42, type: "square" },
  ],
  defeat: [
    { freq: 400, to: 120, dur: 0.6, gain: 0.09, type: "triangle" },
  ],
};

export function play(name: SoundName): void {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;

  for (const tone of RECIPES[name]) {
    const start = ac.currentTime + (tone.delay ?? 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = tone.type ?? "sine";
    osc.frequency.setValueAtTime(tone.freq, start);
    if (tone.to) osc.frequency.exponentialRampToValueAtTime(tone.to, start + tone.dur);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(tone.gain ?? 0.08, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.dur);

    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + tone.dur + 0.02);
  }
}
