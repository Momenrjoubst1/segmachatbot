/**
 * Typed error codes for loading failures.
 * Render sites map these to i18n keys — never show raw codes to users.
 */
export type LoadErrorCode =
  | "messages_load_failed"
  | "threads_load_failed"
  | "courses_load_failed"
  | "courses_unexpected"
  | "network_unreachable";

/**
 * Maps a LoadErrorCode to an i18n key path.
 * Usage: t(errors[errorCode]) where errors = useTranslation('errors')
 */
export const LOAD_ERROR_I18N: Record<LoadErrorCode, string> = {
  messages_load_failed: "errors:messages_load_failed",
  threads_load_failed: "errors:threads_load_failed",
  courses_load_failed: "errors:courses_load_failed",
  courses_unexpected: "errors:courses_unexpected",
  network_unreachable: "errors:network_unreachable",
};
