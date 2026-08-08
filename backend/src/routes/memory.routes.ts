import { Router } from "express";
import { getMemory, deleteMemory, deleteMemoryById, clearAllMemory, setCustomInstructions, getCustomInstructions } from "../services/memory/memory-repository.js";
import { resetExtractionCounter } from "../services/memory/memory-context-builder.js";
import { asyncHandler } from "../utils/express-async-wrapper.js";
import { updateInstructionsSchema, deleteMemorySchema } from "../validators/memory-validation.js";

const router = Router();

router.get("/", asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const memory = await getMemory(userId);
  const instructions = await getCustomInstructions(userId);
  res.json({ memory, customInstructions: instructions });
}));

router.delete("/:key", asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await deleteMemory(userId, req.params.key);
  res.json({ success: true });
}));

router.delete("/", asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { id } = req.query;
  if (id) {
    const parsed = deleteMemorySchema.safeParse({ id });
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    await deleteMemoryById(userId, parsed.data.id);
  } else {
    await clearAllMemory(userId);
    resetExtractionCounter(userId);
  }
  res.json({ success: true });
}));

router.put("/instructions", asyncHandler(async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = updateInstructionsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  await setCustomInstructions(userId, parsed.data.instructions);
  res.json({ success: true });
}));

export default router;
