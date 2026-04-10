/**
 * Audio feedback for voice commands using Web Audio API.
 * No external files needed — generates tones programmatically.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  // Resume if suspended (browser policy requires user gesture)
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

/** Pre-warm AudioContext to reduce first-play latency. Call on user gesture. */
export function warmupAudio() {
  const ctx = getAudioContext();
  // Play a silent buffer to fully initialize the audio pipeline
  const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}

interface ToneOptions {
  frequency: number;
  duration: number;
  type?: OscillatorType;
  volume?: number;
  ramp?: boolean; // fade out
}

function playTone(opts: ToneOptions) {
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = opts.type ?? "sine";
  osc.frequency.value = opts.frequency;
  gain.gain.value = opts.volume ?? 0.15;

  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  osc.start(now);
  if (opts.ramp) {
    gain.gain.exponentialRampToValueAtTime(0.001, now + opts.duration);
  }
  osc.stop(now + opts.duration);
}

function playSequence(tones: ToneOptions[], gap = 0) {
  let delay = 0;
  for (const tone of tones) {
    setTimeout(() => playTone(tone), delay * 1000);
    delay += tone.duration + gap;
  }
}

// ─── Sound presets ───────────────────────────────────────────────

export type SoundPreset = "A" | "B" | "C" | "D" | "E" | "F";

const PRESETS: Record<SoundPreset, { label: string; tones: ToneOptions[] }> = {
  // A: 微信风格 — 短促上扬
  A: {
    label: "微信",
    tones: [
      { frequency: 880, duration: 0.08, type: "sine", volume: 0.12, ramp: true },
      { frequency: 1100, duration: 0.12, type: "sine", volume: 0.1, ramp: true },
    ],
  },
  // B: iOS 风格 — 柔和三连音
  B: {
    label: "iOS",
    tones: [
      { frequency: 784, duration: 0.06, type: "sine", volume: 0.1, ramp: true },
      { frequency: 988, duration: 0.06, type: "sine", volume: 0.08, ramp: true },
      { frequency: 1175, duration: 0.1, type: "sine", volume: 0.06, ramp: true },
    ],
  },
  // C: 水滴 — 单音圆润
  C: {
    label: "水滴",
    tones: [
      { frequency: 1047, duration: 0.15, type: "sine", volume: 0.1, ramp: true },
    ],
  },
  // D: 清脆 — triangle 波双音
  D: {
    label: "清脆",
    tones: [
      { frequency: 659, duration: 0.05, type: "triangle", volume: 0.12, ramp: true },
      { frequency: 988, duration: 0.1, type: "triangle", volume: 0.1, ramp: true },
    ],
  },
  // E: 气泡 — 快速高音
  E: {
    label: "气泡",
    tones: [
      { frequency: 1319, duration: 0.06, type: "sine", volume: 0.08, ramp: true },
      { frequency: 1568, duration: 0.08, type: "sine", volume: 0.06, ramp: true },
    ],
  },
  // F: 叮 — 经典单音
  F: {
    label: "叮",
    tones: [
      { frequency: 1397, duration: 0.2, type: "sine", volume: 0.08, ramp: true },
    ],
  },
};

let currentPreset: SoundPreset = "A";

export function setPreset(preset: SoundPreset) {
  currentPreset = preset;
}

export function getPreset(): SoundPreset {
  return currentPreset;
}

export function getPresetLabel(preset: SoundPreset): string {
  return PRESETS[preset].label;
}

export function getAllPresets(): SoundPreset[] {
  return Object.keys(PRESETS) as SoundPreset[];
}

export function playDone(preset?: SoundPreset) {
  playSequence(PRESETS[preset ?? currentPreset].tones, 0.02);
}

/** Play a low warning tone for unrecognized commands */
export function playUnknown() {
  playSequence([
    { frequency: 330, duration: 0.1, type: "sine", volume: 0.1, ramp: true },
    { frequency: 260, duration: 0.15, type: "sine", volume: 0.08, ramp: true },
  ], 0.02);
}

/** Play a start-listening chime (ascending three-note) */
export function playListenStart() {
  playSequence([
    { frequency: 523, duration: 0.06, type: "sine", volume: 0.08, ramp: true },
    { frequency: 659, duration: 0.06, type: "sine", volume: 0.08, ramp: true },
    { frequency: 784, duration: 0.1, type: "sine", volume: 0.06, ramp: true },
  ], 0.03);
}

/** Get all available voices for a language (empty = all languages) */
export function getVoices(lang = ""): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return [];
  const all = window.speechSynthesis.getVoices();
  if (!lang) return all;
  return all.filter((v) => v.lang.startsWith(lang));
}

/** Get all voices (any language) */
export function getAllVoices(): SpeechSynthesisVoice[] {
  if (!("speechSynthesis" in window)) return [];
  return window.speechSynthesis.getVoices();
}

let selectedVoice: SpeechSynthesisVoice | null = null;

/** Set preferred voice by name */
export function setVoice(voice: SpeechSynthesisVoice | null) {
  selectedVoice = voice;
}

/** Auto-pick the best Chinese voice (prefer female/natural sounding) */
function pickBestVoice(lang: string): SpeechSynthesisVoice | null {
  if (selectedVoice) return selectedVoice;
  const voices = window.speechSynthesis.getVoices();
  const langVoices = voices.filter((v) => v.lang.startsWith(lang.slice(0, 2)));
  if (langVoices.length === 0) return null;

  // Prefer: Xiaoxiao, Yunyang, HuiHui, Yaoyao, Kangkang — Microsoft's natural voices
  const preferred = ["Xiaoxiao", "Yunyang", "HuiHui", "Yaoyao", "Kangkang", "Hanhan", "Zhiwei"];
  for (const name of preferred) {
    const v = langVoices.find((v) => v.name.includes(name));
    if (v) return v;
  }
  // Prefer non-default, often better quality
  const nonDefault = langVoices.find((v) => !v.default);
  return nonDefault ?? langVoices[0];
}

/** Speak a short text using Web Speech Synthesis */
export function speak(text: string, lang = "zh-CN") {
  if (!("speechSynthesis" in window)) return;
  // Cancel any ongoing speech
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 1.4;
  utterance.volume = 0.9;
  utterance.pitch = 1.2;
  const voice = pickBestVoice(lang);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

/** Preview a specific voice */
export function previewVoice(voice: SpeechSynthesisVoice, text = "上下左右") {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = 1.4;
  utterance.volume = 0.9;
  utterance.pitch = 1.2;
  window.speechSynthesis.speak(utterance);
}

/** Preview a preset */
export function previewPreset(preset: SoundPreset) {
  playDone(preset);
}
