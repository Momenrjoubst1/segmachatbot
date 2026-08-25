/**
 * KaraokeText — word-level highlight overlay for the currently-spoken
 * assistant reply (Claude-style "read-along" text).
 *
 * Behaviour:
 *  - Inactive (no live voice turn): renders children unchanged — zero cost.
 *  - Active: splits the plain-text of the spoken turn into words and paints
 *    them directly via DOM refs. Words already spoken → full colour; the
 *    active word → bold accent; upcoming words → muted grey.
 *
 * Why DOM writes instead of state: the playhead ticks ~10x/sec and the
 * highlight advances word-by-word; re-rendering the React subtree per tick
 * would fight with the markdown renderer. We render ONE flat span-list for
 * the duration of the turn and flip classes imperatively.
 *
 * Markdown is intentionally flattened during karaoke (bold/links become
 * plain text) — readability while listening beats rich formatting, and the
 * original markdown rendering returns the moment playback ends.
 */

import { type FC, useEffect, useMemo, useRef, useState } from "react";
import { voiceKaraoke } from "@/lib/tts/voice-karaoke";

interface KaraokeTextProps {
  /** Rendered output when voice karaoke is NOT active (the markdown). */
  children: React.ReactNode;
}

/** Split text into words keeping their order; whitespace collapsed. */
function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export const KaraokeGate: FC<KaraokeTextProps> = ({ children }) => {
  // Subscribe cheaply: a single boolean flips when a turn starts/ends.
  const [active, setActive] = useState(false);

  useEffect(() => {
    return voiceKaraoke.subscribe((s) => {
      const nowActive = s.activeIndex >= 0 || voiceKaraoke.isActive;
      setActive(nowActive);
    });
  }, []);

  return active ? <KaraokeSpans /> : <>{children}</>;
};

const KaraokeSpans: FC = () => {
  const text = voiceKaraoke.getText();
  const words = useMemo(() => splitWords(text), [text]);
  const spansRef = useRef<Array<HTMLSpanElement | null>>([]);
  const activeIdxRef = useRef(-1);

  useEffect(() => {
    return voiceKaraoke.subscribe(({ activeIndex }) => {
      if (activeIndex === activeIdxRef.current) return;
      const prev = activeIdxRef.current;
      activeIdxRef.current = activeIndex;
      if (prev >= 0 && prev < spansRef.current.length) {
        spansRef.current[prev]?.classList.remove("vk-word-active");
        spansRef.current[prev]?.classList.add("vk-word-done");
      }
      for (let i = 0; i < spansRef.current.length; i++) {
        const el = spansRef.current[i];
        if (!el) continue;
        if (i < activeIndex) {
          el.classList.add("vk-word-done");
          el.classList.remove("vk-word-active", "vk-word-pending");
        } else if (i === activeIndex) {
          el.classList.add("vk-word-active");
          el.classList.remove("vk-word-done", "vk-word-pending");
        } else {
          el.classList.add("vk-word-pending");
          el.classList.remove("vk-word-done", "vk-word-active");
        }
      }
    });
  }, []);

  return (
    <p dir="auto" className="vk-paragraph wrap-break-word px-2 py-0.5 text-[15.5px] leading-8 md:text-base" data-testid="karaoke-text">
      {words.map((w, i) => (
        <span
          key={`${i}-${w}`}
          ref={(el) => {
            spansRef.current[i] = el;
          }}
          className="vk-word vk-word-pending"
        >
          {w}{" "}
        </span>
      ))}
    </p>
  );
};

/**
 * SpeakingPulse — the tiny breathing dot shown beside/below the bot's bubble
 * WHILE it talks. Replaces the old giant orb entirely.
 */
export const SpeakingPulse: FC = () => {
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    return voiceKaraoke.subscribe(() => setSpeaking(voiceKaraoke.isActive));
  }, []);
  if (!speaking) return null;
  return (
    <span
      data-testid="speaking-pulse"
      aria-hidden="true"
      className="vk-speaking-pulse"
    />
  );
};
