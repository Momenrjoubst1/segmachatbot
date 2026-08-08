import { Router, Request, Response } from "express";
import { getArtifactAsync, listArtifacts } from "../tools/files/create-artifact/in-memory-artifact-store.js";

const router = Router();

router.get("/", (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json(listArtifacts(userId));
});

router.get("/:id", async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const artifact = await getArtifactAsync(req.params.id, userId);
  if (!artifact) return res.status(404).json({ error: "Artifact not found" });
  res.json(artifact);
});

export default router;
