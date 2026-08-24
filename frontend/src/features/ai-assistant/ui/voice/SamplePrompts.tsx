/**
 * SamplePrompts — "جرّب تقول…" chips shown while the user hasn't spoken yet.
 *
 * Purely decorative (cursor: default) — they hint at what the assistant can
 * do without pretending to be clickable. Localized via the chat namespace.
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";

export const SamplePrompts: FC = () => {
  const { t } = useTranslation("chat");
  const samples = [
    t("voice.sample_1", { defaultValue: "اشرح لي نظرية فيثاغورس" }),
    t("voice.sample_2", { defaultValue: "ساعدني أكتب مقال عن البيئة" }),
    t("voice.sample_3", { defaultValue: "لخص لي هذا الدرس" }),
  ];
  return (
    <div className="vo-sample-prompts" aria-hidden="true">
      {samples.map((s) => (
        <span key={s} className="vo-sample-chip">
          {s}
        </span>
      ))}
    </div>
  );
};
