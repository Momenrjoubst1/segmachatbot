import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/express-async-wrapper.js";
import { createFlashcards, getDueFlashcards, reviewFlashcard, deleteFlashcard, listFlashcards } from "../services/study/flashcards.service.js";
import { recordQuizResult, getStudyProgress, buildProgressContext } from "../services/study/progress.service.js";
import { createLogger } from "../utils/logger.js";
import { supabase } from "../config/supabase.config.js";

const log = createLogger("routes:study");
const router = Router();

const reviewSchema = z.object({
  quality: z.enum(["again", "hard", "good", "easy"]),
});

const quizResultSchema = z.object({
  topic: z.string().min(1),
  correct: z.boolean(),
  courseId: z.string().uuid().optional(),
  textbookId: z.string().uuid().optional(),
});

const createFlashcardsSchema = z.object({
  cards: z.array(z.object({
    textbookId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    topic: z.string().min(1),
    sectionPath: z.string().optional(),
    question: z.string().min(1),
    answer: z.string().min(1),
    source: z.enum(["ai", "manual"]).optional(),
  })).min(1).max(50),
});

// ── Flashcards ───────────────────────────────────────────────────────────────

router.get(
  "/flashcards/due-count",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { count, error } = await supabase
      .from("flashcards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .lte("due_at", new Date().toISOString());

    if (error) {
      log.error("Failed to count due flashcards", { error: error.message, userId });
      res.status(500).json({ error: "Failed to count due flashcards" });
      return;
    }

    res.json({ count: count ?? 0 });
  })
);

router.get(
  "/flashcards/due",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const courseId = req.query.courseId as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;

    const cards = await getDueFlashcards(userId, { courseId, limit });
    res.json({ cards });
  })
);

router.get(
  "/flashcards",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const courseId = req.query.courseId as string | undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const cards = await listFlashcards(userId, { courseId, offset, limit });
    res.json({ cards });
  })
);

router.post(
  "/flashcards",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const parsed = createFlashcardsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const created = await createFlashcards({ userId, cards: parsed.data.cards });
    res.status(201).json({ cards: created });
  })
);

router.post(
  "/flashcards/:id/review",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const result = await reviewFlashcard(userId, req.params.id, parsed.data.quality);
    res.json(result);
  })
);

router.delete(
  "/flashcards/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    await deleteFlashcard(userId, req.params.id);
    res.status(204).send();
  })
);

// ── Study Progress ──────────────────────────────────────────────────────────

router.get(
  "/progress",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const courseId = req.query.courseId as string | undefined;
    const textbookId = req.query.textbookId as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const progress = await getStudyProgress(userId, { courseId, textbookId, limit });
    res.json({ progress });
  })
);

router.post(
  "/quiz-result",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const parsed = quizResultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const result = await recordQuizResult({ userId, ...parsed.data });
    res.json(result);
  })
);

// ── Context for system prompt (internal use) ─────────────────────────────────
router.get(
  "/progress/context",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const courseId = req.query.courseId as string | undefined;
    const textbookId = req.query.textbookId as string | undefined;

    const context = await buildProgressContext(userId, { courseId, textbookId });
    res.json({ context });
  })
);

// ── Daily review plan ──────────────────────────────────────────────────────
router.get(
  "/daily-plan",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    // 1. Due cards count
    const { count: dueCardsCount } = await supabase
      .from("flashcards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .lte("due_at", new Date().toISOString());

    // 2. Weak topics (mastery < 0.5, ascending, limit 5)
    const { data: weakTopics } = await supabase
      .from("study_progress")
      .select("topic, mastery_level, correct_count, incorrect_count")
      .eq("user_id", userId)
      .lt("mastery_level", 0.5)
      .order("mastery_level", { ascending: true })
      .limit(5);

    // 3. Suggested questions from textbook_questions
    let suggestedQuestions: Array<{ text: string; page_number: number | null; section_path: string | null }> = [];
    if (weakTopics && weakTopics.length > 0) {
      // Try to find questions matching weak topic section paths (up to 2 per topic, max 8)
      const topicNames = weakTopics.map((w) => w.topic);
      const { data: topicQuestions } = await supabase
        .from("textbook_questions")
        .select("question, page_number, section_path, textbooks!inner(user_id, status)")
        .eq("textbooks.user_id", userId)
        .eq("textbooks.status", "completed")
        .or(topicNames.map((t) => `section_path.ilike.%${t}%`).join(","))
        .limit(8);

      if (topicQuestions && topicQuestions.length > 0) {
        suggestedQuestions = topicQuestions.map((q) => ({
          text: q.question,
          page_number: q.page_number ?? null,
          section_path: q.section_path ?? null,
        }));
      }
    }

    // Fallback: if no questions matched topics, grab first general questions
    if (suggestedQuestions.length === 0) {
      const { data: generalQuestions } = await supabase
        .from("textbook_questions")
        .select("question, page_number, section_path, textbooks!inner(user_id, status)")
        .eq("textbooks.user_id", userId)
        .eq("textbooks.status", "completed")
        .limit(8);

      if (generalQuestions) {
        suggestedQuestions = generalQuestions.map((q) => ({
          text: q.question,
          page_number: q.page_number ?? null,
          section_path: q.section_path ?? null,
        }));
      }
    }

    res.json({
      dueCardsCount: dueCardsCount ?? 0,
      weakTopics: weakTopics || [],
      suggestedQuestions,
    });
  })
);

export const studyRoutes = router;