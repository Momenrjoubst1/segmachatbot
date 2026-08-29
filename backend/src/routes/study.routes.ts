import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/express-async-wrapper.js";
import { createFlashcards, getDueFlashcards, reviewFlashcard, deleteFlashcard, listFlashcards } from "../services/study/flashcards.service.js";
import { recordQuizResult, getStudyProgress, buildProgressContext } from "../services/study/progress.service.js";
import { gradeAnswer } from "../services/study/answer-grader.service.js";
import { getStudyProfile, upsertStudyProfile } from "../services/study/profile.service.js";
import { getGamificationSummary } from "../services/study/gamification.service.js";
import { answerGradingLimiter } from "../middleware/rate-limiters.js";
import { createLogger } from "../utils/logger.js";
import { supabase } from "../config/supabase.config.js";
import redis from "../config/redis/client.js";

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

const gradeAnswerSchema = z.object({
  question: z.string().min(3).max(2000),
  studentAnswer: z.string().min(1).max(4000),
  topic: z.string().min(1).max(200),
  courseId: z.string().uuid().optional(),
  textbookId: z.string().uuid().optional(),
  sectionPath: z.string().max(500).optional(),
});

const profileSchema = z.object({
  gradeLevel: z.string().max(100).optional(),
  major: z.string().max(100).optional(),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dailyGoal: z.number().int().min(1).max(200).optional(),
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

// Flashcard endpoints.

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

// Study progress endpoints.

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

// Grade a free-form quiz answer against the student's own textbook and record
// the outcome into study progress (used by the Study Map quiz panel).
router.post(
  "/grade-answer",
  answerGradingLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const parsed = gradeAnswerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const result = await gradeAnswer({ userId, ...parsed.data });
    res.json(result);
  })
);

// Progress context for the system prompt (internal use).
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

// Study profile endpoints (onboarding data: grade, major, exam date, daily goal).

router.get(
  "/profile",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const profile = await getStudyProfile(userId);
    res.json({ profile });
  })
);

router.put(
  "/profile",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }

    const profile = await upsertStudyProfile(userId, {
      gradeLevel: parsed.data.gradeLevel,
      major: parsed.data.major,
      examDate: parsed.data.examDate,
      dailyGoal: parsed.data.dailyGoal,
    });

    // The system prompt caches the profile block — keep it fresh.
    try { await redis.del(`user:profile:${userId}`); } catch { /* non-fatal */ }

    res.json({ profile });
  })
);

// Gamification summary — streak, XP, weekly stats, badges.
router.get(
  "/gamification",
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const summary = await getGamificationSummary(userId);
    res.json(summary);
  })
);

// Daily review plan endpoint.
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

    // 2b. Topics due for review (topic-level SRS — next_review_at, migration 037)
    const { data: dueTopics } = await supabase
      .from("study_progress")
      .select("topic, mastery_level, correct_count, incorrect_count")
      .eq("user_id", userId)
      .not("next_review_at", "is", null)
      .lte("next_review_at", new Date().toISOString())
      .order("mastery_level", { ascending: true })
      .limit(5);

    // 3. Suggested questions from textbook_questions (schema column is `text`).
    let suggestedQuestions: Array<{ text: string; page_number: number | null; section_path: string | null }> = [];
    if (weakTopics && weakTopics.length > 0) {
      // Strip PostgREST filter metacharacters from topic names before .or().
      const safeTopics = weakTopics
        .map((w) => w.topic.replace(/[,()"'\\%]/g, " ").trim())
        .filter((t) => t.length > 1);
      const { data: topicQuestions, error: tqErr } = await supabase
        .from("textbook_questions")
        .select("text, page_number, section_path, textbooks!inner(user_id, status)")
        .eq("textbooks.user_id", userId)
        .eq("textbooks.status", "completed")
        .or(safeTopics.map((t) => `section_path.ilike.%${t}%`).join(","))
        .limit(8);

      if (tqErr) {
        log.warn("daily-plan: topic question lookup failed", { error: tqErr.message });
      } else if (topicQuestions && topicQuestions.length > 0) {
        suggestedQuestions = topicQuestions.map((q) => ({
          text: q.text,
          page_number: q.page_number ?? null,
          section_path: q.section_path ?? null,
        }));
      }
    }

    // Fallback: if no questions matched topics, grab first general questions
    if (suggestedQuestions.length === 0) {
      const { data: generalQuestions, error: gqErr } = await supabase
        .from("textbook_questions")
        .select("text, page_number, section_path, textbooks!inner(user_id, status)")
        .eq("textbooks.user_id", userId)
        .eq("textbooks.status", "completed")
        .limit(8);

      if (gqErr) {
        log.warn("daily-plan: general question lookup failed", { error: gqErr.message });
      } else if (generalQuestions) {
        suggestedQuestions = generalQuestions.map((q) => ({
          text: q.text,
          page_number: q.page_number ?? null,
          section_path: q.section_path ?? null,
        }));
      }
    }

    res.json({
      dueCardsCount: dueCardsCount ?? 0,
      weakTopics: weakTopics || [],
      dueTopics: dueTopics || [],
      suggestedQuestions,
    });
  })
);

export const studyRoutes = router;