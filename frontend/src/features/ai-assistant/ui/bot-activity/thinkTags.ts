/**
 * `<think>` tag splitting for streamed model reasoning.
 *
 * The backend's reasoning tap (see `chat-shared.ts` in the API) folds
 * DeepSeek-style `reasoning_content` deltas into the text stream as
 * <think>…</think> blocks. This module splits them back out so the UI can
 * render a collapsible "Thinking" block separately from the answer.
 *
 * Handles:
 *  - complete blocks:      "<think>a</think>b"       → thinking "a", answer "b"
 *  - unclosed (streaming): "<think>a"                → thinking "a", answer ""
 *  - multiple blocks:      "<think>a</think>x<think>b" → thinking "a\n\nb", answer "x"
 */

export interface ThinkSplit {
  /** Concatenated reasoning text ("" when none). */
  thinking: string;
  /** Answer text with all think blocks removed. */
  answer: string;
  /** True when a <think> block is still open (model is mid-thought). */
  open: boolean;
}

const THINK_REGEX = /<think>([\s\S]*?)<\/think>/g;

/** Split accumulated text into { thinking, answer, open }. */
export function splitThinkBlocks(text: string): ThinkSplit {
  if (!text || !text.includes("<think>")) {
    return { thinking: "", answer: text ?? "", open: false };
  }

  const thoughts: string[] = [];
  const openIndex = text.lastIndexOf("<think>");
  const unclosed = !text.includes("</think>", openIndex);

  let answer = text.replace(THINK_REGEX, (_m, body: string) => {
    thoughts.push(body.trim());
    return "";
  });

  let thinking = thoughts.join("\n\n");
  if (unclosed) {
    const tail = text.slice(openIndex + "<think>".length);
    const tailTrimmed = tail.trim();
    thinking = thinking ? `${thinking}\n\n${tailTrimmed}` : tailTrimmed;
    // The unclosed tag itself must not leak into the answer.
    answer = answer.replace(/<think>[\s\S]*$/, "").trimEnd();
  }

  return { thinking, answer: answer.trimStart(), open: unclosed };
}

/**
 * Remove all <think>…</think> blocks (and any trailing unclosed block) from
 * text, returning only the visible answer. Used by the markdown preprocess
 * hook so raw tags never reach the renderer.
 */
export function stripThinkTags(text: string): string {
  if (!text || !text.includes("<think>")) return text ?? "";
  return splitThinkBlocks(text).answer;
}
