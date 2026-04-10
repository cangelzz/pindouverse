import { useRef, useState, useCallback, useEffect } from "react";

export type VoiceCommand =
  | "up"
  | "down"
  | "left"
  | "right"
  | "cancel"
  | "confirm"
  | "summary"
  | "unknown";

interface VoiceCommandResult {
  command: VoiceCommand;
  raw: string;
  confidence: number;
}

// ─── Command matching table ──────────────────────────────────────

// Exact matches
const EXACT_PATTERNS: { patterns: RegExp; command: VoiceCommand }[] = [
  { patterns: /^(上|向上|往上|上面|上移|上去|上方)$/i, command: "up" },
  { patterns: /^(下|向下|往下|下面|下移|下去|下方)$/i, command: "down" },
  { patterns: /^(左|向左|往左|左边|左移|左面|左方)$/i, command: "left" },
  { patterns: /^(右|向右|往右|右边|右移|右面|右方)$/i, command: "right" },
  { patterns: /^(取消|关闭|清除|取消高亮)$/i, command: "cancel" },
  { patterns: /^(确认|好了|完成|确定)$/i, command: "confirm" },
  { patterns: /^(总结|统计|汇总|报告|播报|念一下|读一下|数一下|数数|看看|说说|告诉我|报数|清点|盘点|多少|几种)$/i, command: "summary" },
  { patterns: /^(up|go up|move up)$/i, command: "up" },
  { patterns: /^(down|go down|move down)$/i, command: "down" },
  { patterns: /^(left|go left|move left)$/i, command: "left" },
  { patterns: /^(right|go right|move right)$/i, command: "right" },
  { patterns: /^(cancel|clear|stop)$/i, command: "cancel" },
  { patterns: /^(confirm|ok|done|yes)$/i, command: "confirm" },
];

// Homophone / misrecognition mapping — all characters sharing the same sound
const HOMOPHONES: { patterns: RegExp; command: VoiceCommand }[] = [
  // shàng/shǎng/shāng — 上的同音字
  { patterns: /^[尚伤赏商晌裳殇觞墒熵]$/, command: "up" },
  // xià/xiá/xiā — 下的同音字
  { patterns: /^[吓夏瞎虾侠狭峡霞辖暇遐黠匣]$/, command: "down" },
  // zuǒ/zuò/zuō — 左的同音字
  { patterns: /^[做坐作座昨琢撮佐]$/, command: "left" },
  // yòu/yǒu/yóu — 右的同音字
  { patterns: /^[又有由油友幼游优忧悠尤犹邮铀柚佑诱釉鼬莠]$/, command: "right" },
  // Longer misrecognitions with filler words (anchored to avoid conflicts)
  { patterns: /^[尚伤赏商][啊吧呢嘛哦呀]?$|上[啊吧呢嘛哦呀]/, command: "up" },
  { patterns: /^[吓夏瞎虾侠][啊吧呢嘛哦呀]?$|下[啊吧呢嘛哦呀]/, command: "down" },
  { patterns: /左[啊吧呢嘛哦呀]/, command: "left" },
  { patterns: /^[又有由][啊吧呢嘛哦呀]?$|右[啊吧呢嘛哦呀]/, command: "right" },
];

// Pinyin romanization matching (speech API sometimes returns pinyin)
const PINYIN_PATTERNS: { patterns: RegExp; command: VoiceCommand }[] = [
  { patterns: /^sh[aà]ng$/i, command: "up" },
  { patterns: /^xi[aà]$/i, command: "down" },
  { patterns: /^zu[oǒ]$/i, command: "left" },
  { patterns: /^y[oò]u$/i, command: "right" },
  { patterns: /^q[uǔ]xi[aā]o$/i, command: "cancel" },
  { patterns: /^qu[eè]r[eè]n$/i, command: "confirm" },
];

function matchCommand(text: string): VoiceCommand {
  const cleaned = text.trim();

  // 1. Exact match
  for (const { patterns, command } of EXACT_PATTERNS) {
    if (patterns.test(cleaned)) return command;
  }
  // 2. Homophone match
  for (const { patterns, command } of HOMOPHONES) {
    if (patterns.test(cleaned)) return command;
  }
  // 3. Pinyin romanization match
  for (const { patterns, command } of PINYIN_PATTERNS) {
    if (patterns.test(cleaned)) return command;
  }
  // 4. Fuzzy contain
  if (/上/.test(cleaned)) return "up";
  if (/下/.test(cleaned)) return "down";
  if (/左/.test(cleaned)) return "left";
  if (/右/.test(cleaned)) return "right";
  if (/取消|关闭|清除/.test(cleaned)) return "cancel";
  if (/确认|完成/.test(cleaned)) return "confirm";
  if (/总结|统计|汇总|报告|播报|念|读|数[一数]|清点|盘点|几种|多少/.test(cleaned)) return "summary";
  if (/\bup\b/i.test(cleaned)) return "up";
  if (/\bdown\b/i.test(cleaned)) return "down";
  if (/\bleft\b/i.test(cleaned)) return "left";
  if (/\bright\b/i.test(cleaned)) return "right";
  if (/\bsummary\b/i.test(cleaned)) return "summary";
  return "unknown";
}

/** Try matching across all alternatives, return first match */
function matchFromAlternatives(result: SpeechRecognitionResult): { command: VoiceCommand; raw: string; confidence: number } {
  for (let i = 0; i < result.length; i++) {
    const alt = result[i];
    const cmd = matchCommand(alt.transcript);
    if (cmd !== "unknown") {
      return { command: cmd, raw: alt.transcript.trim(), confidence: alt.confidence };
    }
  }
  return { command: "unknown", raw: result[0].transcript.trim(), confidence: result[0].confidence };
}

// ─── Hook ────────────────────────────────────────────────────────

interface UseVoiceControlOptions {
  lang?: string;
  onCommand: (result: VoiceCommandResult) => void;
}

export function useVoiceControl({ lang = "zh-CN", onCommand }: UseVoiceControlOptions) {
  const [isListening, setIsListening] = useState(false);
  const [lastResult, setLastResult] = useState<VoiceCommandResult | null>(null);
  const [isSupported] = useState(() => typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window));
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  // Auto-stop after 5 minutes of no valid command
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const IDLE_TIMEOUT = 5 * 60 * 1000;

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      // Auto-stop after idle timeout
      if (recognitionRef.current) {
        const ref = recognitionRef.current;
        recognitionRef.current = null;
        ref.abort();
        setIsListening(false);
        setLastResult(null);
      }
    }, IDLE_TIMEOUT);
  }, []);

  const start = useCallback(() => {
    if (!isSupported) return;
    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    const SpeechRecognition = window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition: typeof window.SpeechRecognition }).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const last = event.results[event.results.length - 1];
      if (!last.isFinal) return;

      const result = matchFromAlternatives(last);
      setLastResult(result);
      onCommandRef.current(result);
      // Reset idle timer on valid command
      if (result.command !== "unknown") {
        resetIdleTimer();
      }
    };

    recognition.onerror = (event) => {
      // "no-speech" is normal when user is silent — just keep listening
      if (event.error === "no-speech" || event.error === "aborted") return;
      console.warn("Voice recognition error:", event.error);
    };

    recognition.onend = () => {
      // Auto-restart if still supposed to be listening
      if (recognitionRef.current === recognition) {
        try {
          recognition.start();
        } catch {
          // Already started or stopped
        }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
    resetIdleTimer();
  }, [isSupported, lang, resetIdleTimer]);

  const stop = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (recognitionRef.current) {
      const ref = recognitionRef.current;
      recognitionRef.current = null; // prevent auto-restart
      ref.abort();
    }
    setIsListening(false);
    setLastResult(null);
  }, []);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
    };
  }, []);

  return { isListening, isSupported, lastResult, start, stop, toggle };
}
