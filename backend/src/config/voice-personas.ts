/**
 * Sigma voice personas — Grok-style two-layer identity, Arabic-first.
 *
 * Layer 1 (shipped v1): the VOICE — distinct Azure neural voice via Edge
 *   Read Aloud, giving each persona an instantly recognizable sound.
 * Layer 2 (planned): behavioral primer threaded into the system prompt
 *   (see docs/plans/live-voice-chat-feature.md §8).
 */

export interface VoicePersona {
  id: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  /** Azure neural voice name (Edge Read Aloud compatible). */
  edgeVoice: string;
  locale: string;
  gender: "female" | "male";
  /** Speech rate adjustment, e.g. "+0%" / "-5%". */
  rate: string;
  default?: boolean;
}

export const VOICE_PERSONAS: VoicePersona[] = [
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
    default: !!p.default,
  }));
}
