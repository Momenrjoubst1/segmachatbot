/**
 * i18next configuration — production-grade i18n for the Sigma AI frontend.
 *
 * Supported UI languages: English ("en") and Arabic ("ar").
 * Namespaces: common, app, auth, chat, landing, settings,
 * profile, messages, errors, validation.
 *
 * This module initialises i18next with:
 *   - browser language detection (localStorage → navigator)
 *   - RTL direction support for Arabic
 *   - namespace-based JSON resource bundles
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// ── English namespaces ──────────────────────────────────────────────
import enCommon from "@/i18n/locales/en/common.json";
import enApp from "@/i18n/locales/en/app.json";
import enAuth from "@/i18n/locales/en/auth.json";
import enChat from "@/i18n/locales/en/chat.json";
import enLanding from "@/i18n/locales/en/landing.json";
import enSettings from "@/i18n/locales/en/settings.json";
import enProfile from "@/i18n/locales/en/profile.json";
import enMessages from "@/i18n/locales/en/messages.json";
import enErrors from "@/i18n/locales/en/errors.json";
import enValidation from "@/i18n/locales/en/validation.json";
import enKeyboardShortcuts from "@/i18n/locales/en/keyboardShortcuts.json";
import enBotStatus from "@/i18n/locales/en/botStatus.json";
import enStudy from "@/i18n/locales/en/study.json";
import enTasks from "@/i18n/locales/en/tasks.json";
import enCalendar from "@/i18n/locales/en/calendar.json";
import enMaterials from "@/i18n/locales/en/materials.json";
import enArtifacts from "@/i18n/locales/en/artifacts.json";

// ── Arabic namespaces ───────────────────────────────────────────────
import arCommon from "@/i18n/locales/ar/common.json";
import arApp from "@/i18n/locales/ar/app.json";
import arAuth from "@/i18n/locales/ar/auth.json";
import arChat from "@/i18n/locales/ar/chat.json";
import arLanding from "@/i18n/locales/ar/landing.json";
import arSettings from "@/i18n/locales/ar/settings.json";
import arProfile from "@/i18n/locales/ar/profile.json";
import arMessages from "@/i18n/locales/ar/messages.json";
import arErrors from "@/i18n/locales/ar/errors.json";
import arValidation from "@/i18n/locales/ar/validation.json";
import arKeyboardShortcuts from "@/i18n/locales/ar/keyboardShortcuts.json";
import arBotStatus from "@/i18n/locales/ar/botStatus.json";
import arStudy from "@/i18n/locales/ar/study.json";
import arTasks from "@/i18n/locales/ar/tasks.json";
import arCalendar from "@/i18n/locales/ar/calendar.json";
import arMaterials from "@/i18n/locales/ar/materials.json";
import arArtifacts from "@/i18n/locales/ar/artifacts.json";

// ── Legacy flat dictionaries (kept for backward-compat wrapper) ─────
import { en as enLegacy } from "@/i18n/locales/en";
import { ar as arLegacy } from "@/i18n/locales/ar";

export const NAMESPACES = [
  "common",
  "app",
  "auth",
  "chat",
  "landing",
  "settings",
  "profile",
  "messages",
  "errors",
  "validation",
  "keyboardShortcuts",
  "botStatus",
  "calendar",
  "study",
  "materials",
  "artifacts",
  "legacy",
] as const;

export type AppNamespace = (typeof NAMESPACES)[number];

const resources = {
  en: {
    common: enCommon,
    app: enApp,
    auth: enAuth,
    chat: enChat,
    landing: enLanding,
    settings: enSettings,
    profile: enProfile,
    messages: enMessages,
    errors: enErrors,
    validation: enValidation,
    keyboardShortcuts: enKeyboardShortcuts,
    botStatus: enBotStatus,
    calendar: enCalendar,
    study: enStudy,
    tasks: enTasks,
    materials: enMaterials,
    artifacts: enArtifacts,
    legacy: enLegacy,
  },
  ar: {
    common: arCommon,
    app: arApp,
    auth: arAuth,
    chat: arChat,
    landing: arLanding,
    settings: arSettings,
    profile: arProfile,
    messages: arMessages,
    errors: arErrors,
    validation: arValidation,
    keyboardShortcuts: arKeyboardShortcuts,
    botStatus: arBotStatus,
    calendar: arCalendar,
    study: arStudy,
    tasks: arTasks,
    materials: arMaterials,
    artifacts: arArtifacts,
    legacy: arLegacy,
  },
} as const;

const STORAGE_KEY = "sigma_language";

/** Apply html lang + dir attributes for the active language. */
function applyDocumentAttributes(lng: string) {
  document.documentElement.lang = lng;
  document.documentElement.dir = lng === "ar" ? "rtl" : "ltr";
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: ["en", "ar"],
    defaultNS: "common",
    ns: [...NAMESPACES],
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: STORAGE_KEY,
      caches: ["localStorage"],
    },
    react: {
      useSuspense: false,
    },
  });

// Set initial document attributes
applyDocumentAttributes(i18n.language);

// Keep document attributes in sync on every language change
i18n.on("languageChanged", (lng) => {
  applyDocumentAttributes(lng);
  localStorage.setItem(STORAGE_KEY, lng);
});

export default i18n;
