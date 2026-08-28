// Sigma voice personas — Arabic + English, ElevenLabs-first with Edge Read Aloud fallback.

export interface VoicePersona {
  id: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  /** Azure neural voice (Edge Read Aloud fallback). */
  edgeVoice: string;
  /** Locale for the Edge voice. */
  locale: string;
  gender: "female" | "male";
  /** Speech rate adjustment, e.g. "+0%" / "-5%". */
  rate: string;
  // ElevenLabs voice id for the /ws/tts-stream relay; falls back to ELEVENLABS_VOICE_ID env.
  elevenLabsVoiceId?: string;
  // Language hint pinned to ElevenLabs for stability; ISO-639-1 codes "ar", "en".
  language?: "ar" | "en";
  default?: boolean;
}

// ElevenLabs voice IDs sourced from .env so the persona mapping matches deploy config.
const ENV_PRIMARY = process.env.ELEVENLABS_VOICE_ID?.trim() ?? "";
const ENV_ALT = process.env.ELEVENLABS_VOICE_ID_ALT?.trim() ?? "";

const ELEVENLABS_VOICES = {
  // Primary — Bella, soft warm female; free-plan verified for Arabic.
  primary: ENV_PRIMARY || "EXAVITQu4vr4xnSDxMaL",
  /** Alternate — Adam, deep narrative male. Free-plan verified. */
  alt: ENV_ALT || "pNInz6obpgDQGcFmaJgB",
} as const;

export const VOICE_PERSONAS: VoicePersona[] = [
  // Arabic personas (Sana is the default).
  {
    id: "sana",
    nameAr: "سيجما",
    nameEn: "Sigma (Sana)",
    descAr: "رفيقة دراسة دافئة بلهجة أردنية، مشجعة وقريبة منك",
    descEn: "Warm Jordanian study buddy — encouraging and close",
    edgeVoice: "ar-JO-SanaNeural",
    locale: "ar-JO",
    gender: "female",
    rate: "+0%",
    elevenLabsVoiceId: ELEVENLABS_VOICES.primary || undefined,
    language: "ar",
    default: true,
  },
  {
    id: "hakeem",
    nameAr: "حكيم",
    nameEn: "Hakeem",
    descAr: "أستاذ هادئ وعميق، يشرح بصبر وبأسلوب سقراطي",
    descEn: "Calm professor — patient, thorough, Socratic",
    edgeVoice: "ar-SA-HamedNeural",
    locale: "ar-SA",
    gender: "male",
    rate: "-4%",
    // Male personas take the alternate (Adam) voice so persona switches are audible.
    elevenLabsVoiceId: ELEVENLABS_VOICES.alt || undefined,
    language: "ar",
  },
  {
    id: "noor",
    nameAr: "نور",
    nameEn: "Noor",
    descAr: "مدرسة مليئة بالطاقة والحماس، تحتفل معك بكل إنجاز",
    descEn: "Bright energetic tutor — celebrates every win with you",
    edgeVoice: "ar-EG-SalmaNeural",
    locale: "ar-EG",
    gender: "female",
    rate: "+6%",
    elevenLabsVoiceId: ELEVENLABS_VOICES.primary || undefined,
    language: "ar",
  },
  {
    id: "faris",
    nameAr: "فارس",
    nameEn: "Faris",
    descAr: "محاضر واثق ورسمي، يوصل الفكرة بإيجاز وحزم",
    descEn: "Confident formal lecturer — concise and assured",
    edgeVoice: "ar-SY-LaithNeural",
    locale: "ar-SY",
    gender: "male",
    rate: "+0%",
    // See hakeem above — male personas ride the alternate voice.
    elevenLabsVoiceId: ELEVENLABS_VOICES.alt || undefined,
    language: "ar",
  },

  // English persona (uses Adam).
  {
    id: "english-alt",
    nameAr: "إنجليزي",
    nameEn: "English",
    descAr: "مساعد بالإنجليزية بصوت Adam العميق",
    descEn: "English assistant with Adam's deep voice",
    edgeVoice: "en-US-GuyNeural",
    locale: "en-US",
    gender: "male",
    rate: "+0%",
    elevenLabsVoiceId: ELEVENLABS_VOICES.alt || undefined,
    language: "en",
  },
];

export const DEFAULT_PERSONA_ID = "sana";

export function getPersona(id: string | undefined | null): VoicePersona {
  if (!id) {
    return VOICE_PERSONAS.find((p) => p.default) ?? VOICE_PERSONAS[0];
  }
  return (
    VOICE_PERSONAS.find((p) => p.id === id) ??
    VOICE_PERSONAS.find((p) => p.default) ??
    VOICE_PERSONAS[0]
  );
}

export function isValidPersonaId(id: string): boolean {
  return VOICE_PERSONAS.some((p) => p.id === id);
}

// Resolve a persona's ElevenLabs voice id: explicit field, env default, or null.
export function resolveElevenLabsVoiceId(
  id: string | undefined | null,
): string | null {
  const persona = getPersona(id);
  if (persona.elevenLabsVoiceId) return persona.elevenLabsVoiceId;
  const envDefault = process.env.ELEVENLABS_VOICE_ID?.trim();
  return envDefault || null;
}

// Resolve client-sent voiceId input (persona id or raw ElevenLabs id) to a concrete voice id.
export function resolveRelayVoiceInput(
  raw: string | undefined | null,
): string | null {
  const v = raw?.trim() ?? "";
  if (!v) return resolveElevenLabsVoiceId(null);
  if (isValidPersonaId(v)) return resolveElevenLabsVoiceId(v);
  return v;
}

/** Public shape served to clients (no internal fields). */
export function publicPersonas() {
  return VOICE_PERSONAS.map((p) => ({
    id: p.id,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    descAr: p.descAr,
    descEn: p.descEn,
    gender: p.gender,
    locale: p.locale,
    language: p.language,
    default: !!p.default,
  }));
}
