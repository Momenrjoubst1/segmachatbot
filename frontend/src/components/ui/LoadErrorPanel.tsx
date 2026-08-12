import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import type { LoadErrorCode } from "@/lib/load-errors";
import { LOAD_ERROR_I18N } from "@/lib/load-errors";

interface LoadErrorPanelProps {
  errorCode: LoadErrorCode;
  onRetry?: () => void;
  className?: string;
}

export function LoadErrorPanel({ errorCode, onRetry, className }: LoadErrorPanelProps) {
  const { t } = useTranslation("errors");

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-center",
        className
      )}
    >
      <p className="text-xs text-destructive">{t(LOAD_ERROR_I18N[errorCode])}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs font-medium text-destructive underline underline-offset-2 hover:text-destructive/80"
        >
          {t("common:retry", { ns: "common" })}
        </button>
      )}
    </div>
  );
}
