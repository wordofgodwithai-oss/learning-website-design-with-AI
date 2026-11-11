import "server-only";

import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

/**
 * Microsoft Edge read-aloud voices.
 *
 * These are the neural voices behind Edge's "Read aloud" feature. The service
 * is free and needs no key, and it covers every language Golpo advertises. It
 * is used for narration whenever Groq's English-only Orpheus voice is not a fit
 * (non-English videos) or when `GOLPO_TTS_MODE=edge`.
 *
 * Microsoft rotates the DRM token used by the WebSocket endpoint, so the
 * transport lives in the maintained `msedge-tts` client (Sec-MS-GEC v2 +
 * clock-skew retry). This module only owns the voice catalogue, chunking and
 * prosody mapping.
 */

const MAX_CHUNK = 1800;

interface VoicePair {
  female: string;
  male: string;
}

const VOICE_BY_LANGUAGE: Record<string, VoicePair> = {
  en: { female: "en-US-AriaNeural", male: "en-US-GuyNeural" },
  es: { female: "es-ES-ElviraNeural", male: "es-ES-AlvaroNeural" },
  fr: { female: "fr-FR-DeniseNeural", male: "fr-FR-HenriNeural" },
  de: { female: "de-DE-KatjaNeural", male: "de-DE-ConradNeural" },
  pt: { female: "pt-BR-FranciscaNeural", male: "pt-BR-AntonioNeural" },
  it: { female: "it-IT-ElsaNeural", male: "it-IT-DiegoNeural" },
  nl: { female: "nl-NL-ColetteNeural", male: "nl-NL-MaartenNeural" },
  pl: { female: "pl-PL-ZofiaNeural", male: "pl-PL-MarekNeural" },
  tr: { female: "tr-TR-EmelNeural", male: "tr-TR-AhmetNeural" },
  ru: { female: "ru-RU-SvetlanaNeural", male: "ru-RU-DmitryNeural" },
  uk: { female: "uk-UA-PolinaNeural", male: "uk-UA-OstapNeural" },
  ar: { female: "ar-EG-SalmaNeural", male: "ar-EG-ShakirNeural" },
  he: { female: "he-IL-HilaNeural", male: "he-IL-AvriNeural" },
  fa: { female: "fa-IR-DilaraNeural", male: "fa-IR-FaridNeural" },
  hi: { female: "hi-IN-SwaraNeural", male: "hi-IN-MadhurNeural" },
  bn: { female: "bn-IN-TanishaaNeural", male: "bn-IN-BashkarNeural" },
  ur: { female: "ur-PK-UzmaNeural", male: "ur-PK-AsadNeural" },
  ta: { female: "ta-IN-PallaviNeural", male: "ta-IN-ValluvarNeural" },
  te: { female: "te-IN-ShrutiNeural", male: "te-IN-MohanNeural" },
  mr: { female: "mr-IN-AarohiNeural", male: "mr-IN-ManoharNeural" },
  gu: { female: "gu-IN-DhwaniNeural", male: "gu-IN-NiranjanNeural" },
  kn: { female: "kn-IN-SapnaNeural", male: "kn-IN-GaganNeural" },
  ml: { female: "ml-IN-SobhanaNeural", male: "ml-IN-MidhunNeural" },
  pa: { female: "pa-IN-VaaniNeural", male: "pa-IN-OjasNeural" },
  id: { female: "id-ID-GadisNeural", male: "id-ID-ArdiNeural" },
  ms: { female: "ms-MY-YasminNeural", male: "ms-MY-OsmanNeural" },
  th: { female: "th-TH-PremwadeeNeural", male: "th-TH-NiwatNeural" },
  vi: { female: "vi-VN-HoaiMyNeural", male: "vi-VN-NamMinhNeural" },
  ja: { female: "ja-JP-NanamiNeural", male: "ja-JP-KeitaNeural" },
  ko: { female: "ko-KR-SunHiNeural", male: "ko-KR-InJoonNeural" },
  "zh-CN": { female: "zh-CN-XiaoxiaoNeural", male: "zh-CN-YunxiNeural" },
  "zh-TW": { female: "zh-TW-HsiaoChenNeural", male: "zh-TW-YunJheNeural" },
  sv: { female: "sv-SE-SofieNeural", male: "sv-SE-MattiasNeural" },
  no: { female: "nb-NO-PernilleNeural", male: "nb-NO-FinnNeural" },
  da: { female: "da-DK-ChristelNeural", male: "da-DK-JeppeNeural" },
  fi: { female: "fi-FI-NooraNeural", male: "fi-FI-HarriNeural" },
  cs: { female: "cs-CZ-VlastaNeural", male: "cs-CZ-AntoninNeural" },
  sk: { female: "sk-SK-ViktoriaNeural", male: "sk-SK-LukasNeural" },
  hu: { female: "hu-HU-NoemiNeural", male: "hu-HU-TamasNeural" },
  ro: { female: "ro-RO-AlinaNeural", male: "ro-RO-EmilNeural" },
  bg: { female: "bg-BG-KalinaNeural", male: "bg-BG-BorislavNeural" },
  el: { female: "el-GR-AthinaNeural", male: "el-GR-NestorasNeural" },
  sr: { female: "sr-RS-SophieNeural", male: "sr-RS-NicholasNeural" },
  hr: { female: "hr-HR-GabrijelaNeural", male: "hr-HR-SreckoNeural" },
  sl: { female: "sl-SI-PetraNeural", male: "sl-SI-RokNeural" },
  lt: { female: "lt-LT-OnaNeural", male: "lt-LT-LeonasNeural" },
  lv: { female: "lv-LV-EveritaNeural", male: "lv-LV-NilsNeural" },
  et: { female: "et-EE-AnuNeural", male: "et-EE-KertNeural" },
  sw: { female: "sw-KE-ZuriNeural", male: "sw-KE-RafikiNeural" },
  fil: { female: "fil-PH-BlessicaNeural", male: "fil-PH-AngeloNeural" },
};

/**
 * Dashboard voice ids mapped onto a gender, then a locale voice.
 * The live catalogue is `conversational` plus `female-1…7` and `male-1…7`
 * (`docs/forensics/live/audit-notes.txt` §VOICE); the older named ids are kept
 * so renders created before that catalogue still resolve.
 */
function voiceGenderOf(voiceName?: string | null): "female" | "male" | "neutral" | undefined {
  const key = (voiceName ?? "").trim().toLowerCase();
  if (!key) return undefined;
  if (key === "conversational") return "neutral";
  if (/^female[-\s]?\d$/.test(key)) return "female";
  if (/^male[-\s]?\d$/.test(key)) return "male";
  if (key.startsWith("female") || key.includes("woman")) return "female";
  if (key.startsWith("male") || key.includes("man")) return "male";
  const legacy: Record<string, "female" | "male" | "neutral"> = {
    ava: "female",
    noah: "male",
    isla: "female",
    oliver: "male",
    maya: "female",
    luca: "male",
    sora: "neutral",
    amara: "female",
  };
  return legacy[key];
}

function localeFor(language: string): string {
  const normalized = language.replace("_", "-");
  if (normalized === "zh-TW" || normalized === "zh-CN") return normalized;
  const base = normalized.split("-")[0];
  if (base === "zh") return "zh-CN";
  return base;
}

export function edgeVoice(language: string, voiceName?: string | null): string {
  const locale = localeFor(language);
  const pair = VOICE_BY_LANGUAGE[locale] ?? VOICE_BY_LANGUAGE.en;
  const gender = voiceGenderOf(voiceName);
  return gender === "male" ? pair.male : pair.female;
}

/** A BCP-47 tag for the SSML `xml:lang`/voiceLocale (e.g. `es-ES`). */
function voiceLocale(voice: string): string {
  const match = /\b([a-z]{2,3}-[A-Z]{2})\b/.exec(voice);
  return match?.[1] ?? "en-US";
}

/** Splits long narration at sentence boundaries for one request. */
export function chunkForEdge(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_CHUNK) return clean ? [clean] : [];
  const sentences = clean.split(/(?<=[.!?。！？])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + " " + sentence).trim().length > MAX_CHUNK && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = `${current} ${sentence}`;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export interface SpeakOptions {
  language: string;
  voice?: string | null;
  /** Free-form voice instructions; rate/pitch keywords are honoured. */
  instructions?: string | null;
  timeoutMs?: number;
}

function prosody(instructions: string | null | undefined): { rate: string; pitch: string } {
  const text = (instructions ?? "").toLowerCase();
  let rate = "+0%";
  let pitch = "+0Hz";
  if (/\b(slow|calm|relaxed)\b/.test(text)) rate = "-12%";
  if (/\b(fast|energetic|quick)\b/.test(text)) rate = "+12%";
  if (/\b(deep|low voice)\b/.test(text)) pitch = "-8Hz";
  if (/\b(high|bright)\b/.test(text)) pitch = "+10Hz";
  return { rate, pitch };
}

async function speakOnce(text: string, options: SpeakOptions): Promise<Buffer> {
  const voice = edgeVoice(options.language, options.voice);
  const tts = new MsEdgeTTS({
    connectionTimeoutMs: Math.min(30_000, options.timeoutMs ?? 30_000),
    synthesisTimeoutMs: options.timeoutMs ?? 90_000,
  });

  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      voiceLocale: voiceLocale(voice),
      sentenceBoundaryEnabled: false,
      wordBoundaryEnabled: false,
    });

    const { rate, pitch } = prosody(options.instructions);
    const { audioStream } = tts.toStream(text, { rate, pitch });
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        audioStream.destroy(new Error("Edge TTS timed out"));
      }, options.timeoutMs ?? 90_000);
      audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      audioStream.on("end", () => {
        clearTimeout(timer);
        resolve();
      });
      audioStream.on("error", (error: Error) => {
        clearTimeout(timer);
        reject(error);
      });
    });

    if (chunks.length === 0) throw new Error("Edge TTS returned no audio");
    return Buffer.concat(chunks);
  } finally {
    tts.close();
  }
}

/** Synthesises narration to MP3 bytes, chunked at sentence boundaries. */
export async function edgeSpeech(text: string, options: SpeakOptions): Promise<Buffer> {
  const chunks = chunkForEdge(text);
  if (chunks.length === 0) throw new Error("Nothing to narrate.");
  const parts: Buffer[] = [];
  for (const chunk of chunks) parts.push(await speakOnce(chunk, options));
  return Buffer.concat(parts);
}
