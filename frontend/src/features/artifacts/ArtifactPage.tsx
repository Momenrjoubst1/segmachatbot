import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { authFetch } from "@/lib/auth";
import { useAuthContext } from "@/context/AuthContext";
import { ArtifactViewer } from "./ArtifactViewer";

interface Artifact {
  id: string;
  type: string;
  title: string;
  content: string;
  language?: string;
  created_at: string;
}

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:3004";

/**
 * Full-page artifact view for shared links (`/artifacts/:id`).
 * The chat app keeps artifact state in memory only, so this page fetches
 * the artifact by id from the backend. Guests get a sign-in prompt
 * because the API requires authentication.
 */
export function ArtifactPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, isAuthLoading } = useAuthContext();
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");

  useEffect(() => {
    if (isAuthLoading) return;
    if (!isAuthenticated || !id) {
      setStatus("error");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${backendUrl}/api/artifacts/${id}`);
        if (cancelled) return;
        if (res.ok) {
          setArtifact(await res.json());
          setStatus("ready");
        } else {
          setStatus("error");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isAuthenticated, isAuthLoading, backendUrl]);

  return (
    <div className="h-screen h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      {status === "ready" && artifact ? (
        <ArtifactViewer artifact={artifact} />
      ) : status === "loading" ? (
        <div className="flex h-full items-center justify-center">
          <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-4 text-center">
          <p className="text-sm text-muted-foreground">
            {!isAuthenticated
              ? "This artifact is private. Sign in to view it."
              : "Artifact not found or no longer available."}
          </p>
          {!isAuthenticated ? (
            <button
              type="button"
              onClick={() =>
                navigate("/login", {
                  state: { from: `${window.location.pathname}${window.location.search}` },
                })
              }
              className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              Sign in
            </button>
          ) : (
            <Link to="/" className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
              Back to chat
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
