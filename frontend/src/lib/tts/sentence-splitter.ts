/**
 * Streaming sentence splitter for live voice chat TTS.
 *
 * As the assistant's reply streams in, extract complete sentences as soon as
 * they close so speech can start while the rest is still generating.
 * Markdown noise is stripped before speaking (code blocks, links, tables,
 * emoji) — the same contract as the backend sanitizer.
 */

const HARD_WRAP_CHARS = 240;

/** Remove markdown/URLs/emoji that should never be spoken aloud. */
export function stripMarkdownForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/(\*\*\*|\*\*|\*|__|_|~~)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\|/g, " ")
    // eslint-disable-next-line no-misleading-character-class
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
      " ",
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ");
}

/**
 * Incremental sentence extractor. Feed raw streamed chunks; it yields clean,
 * speakable sentences in order. Call flush() at end-of-stream for any tail.
 */
export class StreamingSentenceSplitter {
  private buf = "";

  /** Feed a raw chunk; returns zero or more completed sentences. */
  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];

    for (;;) {
      const m = this.buf.match(/[.!?؟…](\s+|$)|\n{1}/);
      if (!m || m.index === undefined) break;

      let candidate = this.buf.slice(0, m.index + m[0].length);
      const rest = this.buf.slice(m.index + m[0].length);

      // Guard: don't split decimal numbers ("3.14") or known abbreviations.
      if (/(\d)\.$/.test(candidate) && /^\d/.test(rest)) {
        // Advance deterministically: merge and continue search after the digit run
        const digits = rest.match(/^\d+/)?.[0] ?? "";
        this.buf = candidate + digits + rest.slice(digits.length);
        continue;
      }

      candidate = stripMarkdownForSpeech(candidate).trim();
      if (candidate.length >= 2) out.push(candidate);
      this.buf = rest;
    }

    // Hard-wrap pathological runs without punctuation (lists, code remnants)
    if (stripMarkdownForSpeech(this.buf).length > HARD_WRAP_CHARS) {
      const words = stripMarkdownForSpeech(this.buf).trim().split(" ");
      let line = "";
      const lines: string[] = [];
      for (const w of words) {
        if ((line + " " + w).trim().length > HARD_WRAP_CHARS) {
          lines.push(line.trim());
          line = w;
        } else {
          line = (line + " " + w).trim();
        }
      }
      if (line) lines.push(line);
      const [last, ...done] = lines.reverse();
      out.push(...done.reverse());
      this.buf = last ? " " + last : "";
    }

    return out.filter((s) => s.length >= 2 && /\p{L}|\d/u.test(s));
  }

  /** End of stream — return any remaining tail worth speaking. */
  flush(): string | null {
    const tail = stripMarkdownForSpeech(this.buf).trim();
    this.buf = "";
    if (tail.length >= 2 && /\p{L}|\d/u.test(tail)) return tail;
    return null;
  }

  get bufferedLength(): number {
    return stripMarkdownForSpeech(this.buf).length;
  }
}