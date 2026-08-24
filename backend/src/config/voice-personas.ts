/**
 * Sigma voice personas — Arabic + English, ElevenLabs-first (sub-100ms TTFB).
 *
 * Each persona declares BOTH:
 *   - edgeVoice / locale / rate: the legacy Edge Read Aloud fallback (kept
 *     for environments without an ElevenLabs key). Still works through the
 *     existing /api/tts HTTP route.
 *   - elevenLabsVoiceId: the ElevenLabs voice used by the new
 *     /ws/tts-stream WebSocket relay (Live Voice mode). When missing, the
 *     relay falls back to ELEVENLABS_VOICE_ID from env.
 *
 * Set your real ElevenLabs voice IDs in .env (ELEVENLABS_VOICE_ID) or
 * per-persona below. The defaults below are illustrative placeholders
 * that work with the multilingual v2 / flash v2.5 models — replace them
 * with voices from your ElevenLabs Voice Library.
 */

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
  /**
   * ElevenLabs voice id used by the /ws/tts-stream relay. When undefined,
   * the relay falls back to ELEVENLABS_VOICE_ID from the environment.
   */
  elevenLabsVoiceId?: string;
  /**
   * Language hint sent to ElevenLabs. ElevenLabs auto-detects for flash /
   * multilingual models, but the persona can pin a language for stability.
   * Accepts ISO-639-1 codes: "ar", "en".
   */
  language?: "ar" | "en";
  default?: boolean;
}

/**
 * ElevenLabs stock voice IDs (multilingual v2 / flash v2.5 compatible).
 * Replace with voices cloned in your own Voice Library for production.
 */
const ELEVENLABS_VOICES = {
  // English
  rachel: "21m00Tcm4TlvDq8ikWAM",   // calm, clear — English female
  bella: "EXAVITQu4vr4xnSDxMaL",   // soft, warm — English female
  elli: "MF3mGyEYCl7XYWbV9V6O",     // friendly, conversational — English female
  adam: "pNInz6obpgDQGcFmaJgB",     // deep, narrative — English male
  josh: "TxGEqnHWrfWFTfGW9XjX",     // warm, deep — English male
  arnold: "VR6AewLTigWG4xSOukaG",  // crisp, confident — English male
  // Arabic — use community voices from the Voice Library for best quality.
  // The IDs below are placeholders; clone Arabic voices from your library
  // and update them here.
  arabicFemale1: "", // TODO: replace with your cloned Arabic female voice id
  arabicMale1: "",   // TODO: replace with your cloned Arabic male voice id
} as const;

export const VOICE_PERSONAS: VoicePersona[] = [
  // ─── Arabic (default) ─────────────────────────────────────────────
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
    elevenLabsVoiceId: ELEVENLABS_VOICES.arabicFemale1 || undefined,
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
    elevenLabsVoiceId: ELEVENLABS_VOICES.arabicMale1 || undefined,
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
    language: "ar",
  },

  // ─── English ──────────────────────────────────────────────────────
  {
    id: "rachel-en",
    nameAr: "راشيل (إنجليزي)",
    nameEn: "Rachel (EN)",
    descAr: "مساعدة هادئة وواضحة بالإنجليزية",
    descEn: "Calm, clear English assistant",
    edgeVoice: "en-US-AriaNeural",
    locale: "en-US",
    gender: "female",
    rate: "+0%",
    elevenLabsVoiceId: ELEVENLABS_VOICES.rachel,
    language: "en",
  },
  {
    id: "adam-en",
    nameAr: "آدم (إنجليزي)",
    nameEn: "Adam (EN)",
    descAr: "صوت عميق وسردي بالإنجليزية",
    descEn: "Deep narrative English voice",
    edgeVoice: "en-US-GuyNeural",
    locale: "en-US",
    gender: "male",
    rate: "-2%",
    elevenLabsVoiceId: ELEVENLABS_VOICES.adam,
    language: "en",
  },
  {
    id: "josh-en",
    nameAr: "جوش (إنجليزي)",
    nameEn: "Josh (EN)",
    descAr: "صوت دافئ وعميق بالإنجليزية",
    descEn: "Warm, deep English voice",
    edgeVoice: "en-US-DavisNeural",
    locale: "en-US",
    gender: "male",
    rate: "+0%",
    elevenLabsVoiceId: ELEVENLABS_VOICES.josh,
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

/**
 * Resolve the ElevenLabs voice id for a persona: explicit field if set,
 * otherwise ELEVENLABS_VOICE_ID from the environment, otherwise null
 * (caller decides whether to error or fall back to the Edge voice).
 */
export function resolveElevenLabsVoiceId(
  id: string | undefined | null,
): string | null {
  const persona = getPersona(id);
  if (persona.elevenLabsVoiceId) return persona.elevenLabsVoiceId;
  const envDefault = process.env.ELEVENLABS_VOICE_ID?.trim();
  return envDefault || null;
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
