import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeftIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAuthContext } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import type { Artifact } from "@/lib/artifacts-api";
import { getArtifact, getPublicArtifact } from "@/lib/artifacts-api";
import { ArtifactViewer } from "./ArtifactViewer";

/**
 * Full-page artifact view for `/artifacts/:id`.
 *
 * Resolution order:
 *   1. Authenticated + owner → full API artifact (mutation controls on).
 *   2. Publicly shared → public endpoint (read-only), no sign-in required.
 *   3. Otherwise → sign-in / not-found prompt.
 */
export function ArtifactPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation("artifacts");
  const { isAuthenticated, isAuthLoading } = useAuthContext();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [status, setStatus] = useState<"loading" | "notfound" | "unauthorized" | "ready">("loading");

  useEffect(() => {
    if (isAuthLoading) return;
    if (!id) {
      setStatus("notfound");
      return;
    }
    let cancelled = false;

    (async () => {
      // Try the owner path first when signed in.
      if (isAuthenticated) {
        try {
          const owned = await getArtifact(id);
          if (!cancelled && owned) {
            setArtifact(owned);
            try {
              const { data } = await supabase.auth.getUser();
              setIsOwner(data?.user?.id === owned.owner_id);
            } catch {
              setIsOwner(false);
            }
            setStatus("ready");
            return;
          }
        } catch {
          // fall through to the public path
        }
      }
      // Public share link — works for guests too.
      try {
        const shared = await getPublicArtifact(id);
        if (!cancelled && shared) {
          setArtifact(shared);
          setIsOwner(false);
          setStatus("ready");
          return;
        }
      } catch {
        // not public
      }
      if (!cancelled) {
        setStatus(isAuthenticated ? "notfound" : "unauthorized");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, isAuthenticated, isAuthLoading]);

  const handleChange = useMemo(
    () => (updated: Artifact) => setArtifact(updated),
    [],
  );

  return (
    <div className="h-screen h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      {status === "ready" && artifact ? (
        <div className="flex h-full flex-col p-4 pt-3 md:p-6 md:pt-4">
          <div className="mb-2 flex shrink-0 items-center justify-between">
            <Link
              to="/artifacts"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeftIcon className="size-4" />
              {t("library.backToLibrary")}
            </Link>
            {!isOwner && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400">
                {t("page.publicView")}
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <ArtifactViewer
              key={`${artifact.id}-${artifact.version}`}
              artifact={artifact}
              onChanged={handleChange}
              readOnly={!isOwner}
            />
          </div>
        </div>
      ) : status === "loading" || isAuthLoading ? (
        <div className="flex h-full items-center justify-center">
          <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
          <p className="text-sm text-muted-foreground">
            {status === "unauthorized" ? t("page.privatePrompt") : t("page.notFound")}
          </p>
          {status === "unauthorized" ? (
            <Link to="/login" className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
              {t("page.signIn")}
            </Link>
          ) : (
            <Link to="/" className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
              {t("page.backToChat")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
