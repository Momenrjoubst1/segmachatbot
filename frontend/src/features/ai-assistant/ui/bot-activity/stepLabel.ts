/**
 * i18n-aware label resolution for bot steps.
 *
 * Labels follow these rules:
 *  1. If a step arrived with an explicit `label` (from a backend event or a
 *     tool-call), use that.
 *  2. Otherwise, look up `botStatus.steps.<kind>` in the active locale, with
 *     optional interpolation from the step's `result` / `toolName`.
 *  3. If still missing, fall back to the English key.
 */

import type { TFunction } from "i18next";
import type { BotStep, StepKind, StepResult } from "./types";

/**
 * Resolve a human-readable label for a step, optionally with the final
 * "completed" rephrasing (e.g. "Searched 5 sources" instead of "Searching the web").
 * Claude.ai keeps a past-tense line for finished tools ("Searched the web"),
 * so completion has its own lookup path.
 */
export function resolveStepLabel(
  t: TFunction,
  step: BotStep,
  opts?: { completed?: boolean },
): string {
  // 1. Backend-supplied label wins.
  if (step.label && step.label !== step.kind) return step.label;

  // 2. Tool-specific post-completion rephrasing.
  if (opts?.completed && step.toolName) {
    const count = step.result?.count;
    if (count !== undefined) {
      const key = `botStatus:steps.tool.${step.toolName}.completed`;
      const candidate = t(key, { count, defaultValue: "" });
      if (candidate) return candidate;
    }
    // Count-less past tense ("Searched the web").
    const past = t(`botStatus:steps.tool.${step.toolName}.past`, { defaultValue: "" });
    if (past) return past;
  }

  // 3. Kind-level past tense ("Searched the knowledge base").
  if (opts?.completed && !step.toolName) {
    const kindPast = t(`botStatus:steps.completed.${step.kind}`, { defaultValue: "" });
    if (kindPast) return kindPast;
  }

  // 4. Per-tool "running" label.
  if (step.toolName) {
    const toolKey = `botStatus:steps.tool.${step.toolName}.label`;
    const toolLabel = t(toolKey, { defaultValue: "" });
    if (toolLabel) return toolLabel;
  }

  // 5. Generic kind label.
  const kindKey = `botStatus:steps.kind.${step.kind}`;
  return t(kindKey, { defaultValue: step.kind });
}

/** Compact text for the result count: "5 sources", "1 page". */
export function formatResultSummary(
  t: TFunction,
  result: StepResult | undefined,
): string | null {
  if (!result || result.count === undefined) return null;
  const ns = `botStatus:result.${result.type}`;
  return t(ns, { count: result.count, defaultValue: `${result.count}` });
}

/** Status pill text: "Thinking", "Searching…", etc. */
export function resolveStatusLabel(t: TFunction, status: StepKind | "idle" | "queued" | "tool_running" | "moderating" | "compacting" | "retrieving" | "streaming" | "interrupted" | "retrying" | "error"): string {
  return t(`botStatus:status.${status}`, { defaultValue: status });
}
