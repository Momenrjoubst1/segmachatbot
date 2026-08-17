import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const MAX_FILE_BYTES = Math.max(
  1024,
  Number(process.env.MAX_FILE_BYTES || "2000000")
);
const MAX_TEXT_CHARS = Math.max(
  500,
  Number(process.env.MAX_FILE_TEXT_CHARS || "12000")
);

function decodeBase64(data: string): Buffer {
  const commaIndex = data.indexOf(",");
  const base64 = commaIndex >= 0 ? data.slice(commaIndex + 1) : data;
  return Buffer.from(base64, "base64");
}

function trimText(text: string): { text: string; truncated: boolean } {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (cleaned.length <= MAX_TEXT_CHARS) {
    return { text: cleaned, truncated: false };
  }
  return { text: cleaned.slice(0, MAX_TEXT_CHARS), truncated: true };
}

function normalizeExtension(filename?: string): string {
  if (!filename) return "";
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1]!.toLowerCase() : "";
}

function isTextType(mimeType: string, ext: string): boolean {
  if (mimeType.startsWith("text/")) return true;
  if (mimeType === "application/json") return true;
  if (mimeType === "application/xml") return true;
  if (["txt", "md", "json", "xml", "csv"].includes(ext)) return true;
  return false;
}

type FilePart = {
  data?: string;
  mimeType?: string;
  filename?: string;
};

export async function extractTextFromFilePart(file: FilePart): Promise<{ text: string; truncated: boolean }> {
  if (!file.data) {
    throw new Error("File data missing");
  }

  const buffer = decodeBase64(file.data);
  if (buffer.length > MAX_FILE_BYTES) {
    throw new Error("File exceeds size limit");
  }

  const mimeType = file.mimeType || "application/octet-stream";
  const ext = normalizeExtension(file.filename);

  if (mimeType === "application/pdf" || ext === "pdf") {
    const timeoutMs = 30_000;
    try {
      const parsed = await Promise.race([
        pdfParse(buffer),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("PDF parsing timed out")), timeoutMs)
        ),
      ]);
      return trimText(parsed.text || "");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`PDF extraction failed: ${msg}`);
    }
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    try {
      // @ts-ignore - Optional runtime dependency
      const { default: mammoth } = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return trimText(result.value || "");
    } catch (error) {
      throw new Error(
        `DOCX extraction failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    ext === "xlsx"
  ) {
    try {
      // @ts-ignore - Optional runtime dependency
      const { default: XLSX } = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheets = workbook.SheetNames.map((name: string) => {
        const sheet = workbook.Sheets[name];
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        return `Sheet: ${name}\n${csv}`;
      });
      return trimText(sheets.join("\n\n---\n\n"));
    } catch (error) {
      throw new Error(
        `XLSX extraction failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (mimeType === "text/csv" || mimeType === "application/csv" || ext === "csv") {
    const text = buffer.toString("utf-8");
    return trimText(text);
  }

  if (isTextType(mimeType, ext)) {
    const text = buffer.toString("utf-8");
    return trimText(text);
  }

  throw new Error("Unsupported file type");
}
