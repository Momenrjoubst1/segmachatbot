/**
 * Master switch for the built-in voice stack (Deepgram STT relays +
 * ElevenLabs stream-input TTS + live session hook).
 *
 * false = the ENTIRE current voice UI is detached from the app (composer
 * mic/live-voice button, dictation menu, hotkey, session panel) while every
 * file stays intact — flip back to true to restore it instantly.
 *
 * Why false now: voice is pivoting to ElevenLabs Conversational AI agents
 * (speech-to-speech), which will plug in as a separate surface.
 */
export const VOICE_STACK_ENABLED = false;
