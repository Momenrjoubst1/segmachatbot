import { Router, Request, Response, NextFunction } from "express";
import {
  ArtifactStoreError,
  createArtifact,
  deleteArtifact,
  getArtifact,
  getPublicArtifact,
  listArtifacts,
  listVersions,
  remixArtifact,
  revertToVersion,
  setVisibility,
  updateArtifact,
} from "../tools/files/create-artifact/artifact-store.js";
import { ARTIFACT_TYPES } from "../tools/files/create-artifact/artifact-store.js";

const router = Router();

const MAX_TITLE_LENGTH = 300;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUser(req: Request, res: Response): string | null {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

/** Wrap handlers so store errors map to proper HTTP status codes. */
function handler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// ---------------------------------------------------------------------------
// Public (unauthenticated) share links — mounted at /api/public/artifacts
// ---------------------------------------------------------------------------

export const publicArtifactsRouter = Router();

publicArtifactsRouter.get(
  "/:id",
  handler(async (req, res) => {
    if (!UUID_RE.test(req.params.id)) {
      res.status(400).json({ error: "Invalid artifact id" });
      return;
    }
    const artifact = await getPublicArtifact(req.params.id);
    if (!artifact) {
      res.status(404).json({ error: "Artifact not found or not shared" });
      return;
    }
    res.json(artifact);
  }),
);

// ---------------------------------------------------------------------------
// Authenticated library API — mounted at /api/artifacts
// ---------------------------------------------------------------------------

router.get(
  "/",
  handler(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { thread_id, type, search, limit, offset } = req.query as Record<string, string | undefined>;
    if (type && !(ARTIFACT_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: `Invalid type filter. Allowed: ${ARTIFACT_TYPES.join(", ")}` });
      return;
    }
    const artifacts = await listArtifacts(userId, {
      threadId: thread_id,
      type,
      search: search?.trim() || undefined,
      limit: limit ? Math.max(1, Math.min(parseInt(limit, 10) || 100, 200)) : undefined,
      offset: offset ? Math.max(0, parseInt(offset, 10) || 0) : undefined,
    });
    res.json(artifacts);
  }),
);

router.post(
  "/",
  handler(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;

    const { type, title, content, language, thread_id } = req.body ?? {};
    if (!type || !(ARTIFACT_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: `Missing or invalid 'type'. Allowed: ${ARTIFACT_TYPES.join(", ")}` });
      return;
    }
    if (typeof content !== "string" || content.length === 0) {
      res.status(400).json({ error: "'content' must be a non-empty string" });
      return;
    }
    if (title !== undefined && (typeof title !== "string" || title.length > MAX_TITLE_LENGTH)) {
      res.status(400).json({ error: `'title' must be a string of at most ${MAX_TITLE_LENGTH} characters` });
      return;
    }

    const artifact = await createArtifact({
      ownerId: userId,
      threadId: typeof thread_id === "string" ? thread_id : null,
      type,
      title: typeof title === "string" && title.trim() ? title : "Untitled",
      content,
      language: typeof language === "string" ? language : undefined,
      author: "user",
    });
    res.status(201).json(artifact);
  }),
);

function validateId(id: string, res: Response): boolean {
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid artifact id" });
    return false;
  }
  return true;
}

router.get(
  "/:id",
  handler(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    if (!validateId(req.params.id, res)) return;

    const artifact = await getArtifact(req.params.id, userId);
    if (!artifact) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }
    res.json(artifact);
  }),
);

router.patch(
  "/:id",
  handler(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    if (!validateId(req.params.id, res)) return;

    const { title, content, language, change_summary } = req.body ?? {};
    if (
      title === undefined &&
      content === undefined &&
      language === undefined
    ) {
      res.status(400).json({ error: "Nothing to update: pass title, content or language" });
      return;
    }
    if (content !== undefined && (typeof content !== "string" || content.length === 0)) {
      res.status(400).json({ error: "'content' must be a non-empty string" });
      return;
    }
    if (title !== undefined && (typeof title !== "string" || title.trim().length === 0 || title.length > MAX_TITLE_LENGTH)) {
      res.status(400).json({ error: `'title' must be a non-empty string of at most ${MAX_TITLE_LENGTH} characters` });
      return;
    }

    try {
      const artifact = await updateArtifact(req.params.id, userId, {
        ...(title !== undefined ? { title } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(language !== undefined && typeof language === "string" ? { language } : {}),
        changeSummary: typeof change_summary === "string" ? change_summary : undefined,
        author: "user",
      });
      res.json(artifact);
    } catch (err) {
      if (err instanceof ArtifactStoreError && err.status === 404) {
        res.status(404).json({ error: "Artifact not found" });
        return;
      }
      throw err;
    }
  }),
);

router.delete(
  "/:id",
  handler(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    if (!validateId(req.params.id, res)) return;

    const deleted = await deleteArtifact(req.params.id, userId);
    if (!deleted) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }
    res.json({ status: "deleted", id: req.params.id });
  }),
);

router.get(
  "/:id/versions",
  handler(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    if (!validateId(req.params.id, res)) return;

    const versions = await listVersions(req.params.id, userId);
    res.json(versions);
  }),
);

router.post(
  "/:id/revert",
  handler(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    if (!validateId(req.params.id, res)) return;

    const version = parseInt(String(req.body?.version ?? ""), 10);
    if (!Number.isInteger(version) || version < 1) {
      res.status(400).json({ error: "'version' must be a positive integer" });
      return;
    }
    const artifact = await revertToVersion(req.params.id, userId, version);
    res.json(artifact);
  }),
);

router.patch(
  "/:id/share",
  handler(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    if (!validateId(req.params.id, res)) return;

    const visibility = req.body?.visibility;
    if (visibility !== "private" && visibility !== "public") {
      res.status(400).json({ error: "'visibility' must be 'private' or 'public'" });
      return;
    }
    const artifact = await setVisibility(req.params.id, userId, visibility);
    res.json(artifact);
  }),
);

router.post(
  "/:id/remix",
  handler(async (req, res) => {
    const userId = requireUser(req, res);
    if (!userId) return;
    if (!validateId(req.params.id, res)) return;

    const artifact = await remixArtifact(req.params.id, userId);
    res.status(201).json(artifact);
  }),
);

// Revert needs the store; imported above via artifact-store re-export below.

router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ArtifactStoreError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: message });
});

export default router;
