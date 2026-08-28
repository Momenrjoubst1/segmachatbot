/**
 * Image Detection and Formatting Helpers
 * مساعدو كشف وتنسيق الصور
 *
 * Helper functions for detecting and formatting images in message parts.
 */

/**
 * Check if a string is a base64-encoded image.
 */
export const isBase64Image = (data: string): boolean => {
  if (!data) return false;
  const base64 = data.includes(",") ? data.split(",")[1]! : data;
  const clean = base64.trim().substring(0, 15);
  return (
    clean.startsWith("iVBORw") ||
    clean.startsWith("/9j/") ||
    clean.startsWith("UklGR") ||
    clean.startsWith("R0lGOD")
  );
};

/**
 * Get the appropriate reply language based on user text.
 */
export const visionReplyLanguage = (userText: string): string =>
  /[\u0600-\u06FF]/.test(userText)
    ? "Reply in Arabic."
    : "Reply in the same language as the user's question.";

/**
 * Check if a message part is an image.
 */
export const isImagePart = (p: Record<string, unknown>): boolean => {
  if (p.type === "image") return true;
  const file = p.file as Record<string, unknown> | undefined;
  const mime = (p.mimeType as string) || (file?.type as string) || "";
  if (mime.startsWith("image/")) return true;
  const filename = (p.filename as string) || (file?.name as string) || "";
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp"].includes(ext))
    return true;

  const rawData =
    (p.image as string) ||
    (p.url as string) ||
    (p.data as string) ||
    (p.base64 as string) ||
    (file?.url as string) ||
    (file?.data as string) ||
    (file?.base64 as string) ||
    "";
  return isBase64Image(rawData);
};

/**
 * Format image data as a data URL.
 */
export const formatImageAsDataUrl = (
  data: string,
  ext: string,
  mimeType?: string,
): string => {
  if (!data) return "";
  if (data.startsWith("data:image/")) return data;

  let mime = mimeType;
  if (!mime || !mime.startsWith("image/")) {
    const clean = data.includes(",")
      ? data.split(",")[1]!.trim()
      : data.trim();
    if (clean.startsWith("iVBORw")) mime = "image/png";
    else if (clean.startsWith("/9j/")) mime = "image/jpeg";
    else if (clean.startsWith("UklGR")) mime = "image/webp";
    else if (clean.startsWith("R0lGOD")) mime = "image/gif";
    else {
      mime =
        ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : ext === "gif"
              ? "image/gif"
              : ext === "svg"
                ? "image/svg+xml"
                : "image/jpeg";
    }
  }

  const base64Data = data.includes(",") ? data.split(",")[1] : data;
  return `data:${mime};base64,${base64Data}`;
};
