// File router types: shared interfaces for chat file handling.

export interface ChatMsg {
  role: string;
  content?: string | Array<{ type?: string; text?: string; mimeType?: string; mediaType?: string; filename?: string; fileName?: string; data?: string; url?: string; base64?: string; file?: { type?: string; mimeType?: string; name?: string; data?: string; url?: string; base64?: string } }>;
  parts?: Array<{ type?: string; text?: string; mimeType?: string; mediaType?: string; filename?: string; fileName?: string; data?: string; url?: string; base64?: string; file?: { type?: string; mimeType?: string; name?: string; data?: string; url?: string; base64?: string } }>;
}

export interface PendingFile {
  r2Key: string;
  fileName: string;
  createdAt: number;
}

export interface ThreadFile {
  fileName: string;
  text: string;
}

export interface PdfAttachment {
  fileName: string;
  bytes: Buffer;
  r2Key?: string;
}
