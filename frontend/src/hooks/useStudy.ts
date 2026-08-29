import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/auth";
import { BACKEND_URL } from "@/lib/config";

export interface Flashcard {
  id: string;
  user_id: string;
  textbook_id: string | null;
  course_id: string | null;
  topic: string;
  section_path: string | null;
  question: string;
  answer: string;
  source: 'ai' | 'manual';
  interval_days: number;
  ease_factor: number;
  repetitions: number;
  lapses: number;
  due_at: string;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudyProgress {
  id: string;
  user_id: string;
  course_id: string | null;
  textbook_id: string | null;
  topic: string;
  correct_count: number;
  incorrect_count: number;
  mastery_level: number;
  last_outcome: boolean | null;
  last_quizzed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DueFlashcardsResponse {
  cards: Flashcard[];
}

export interface ProgressResponse {
  progress: StudyProgress[];
}

export function useDueFlashcards(courseId?: string, limit = 30) {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (courseId) params.set("courseId", courseId);
      params.set("limit", String(limit));
      const res = await authFetch(`${BACKEND_URL}/api/study/flashcards/due?${params}`);
      if (!res.ok) throw new Error("Failed to fetch due flashcards");
      const data: DueFlashcardsResponse = await res.json();
      setCards(data.cards || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [courseId, limit]);

  useEffect(() => { fetch(); }, [fetch]);

  return { cards, isLoading, error, refetch: fetch };
}

export function useStudyProgress(courseId?: string, textbookId?: string, limit = 50) {
  const [progress, setProgress] = useState<StudyProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (courseId) params.set("courseId", courseId);
      if (textbookId) params.set("textbookId", textbookId);
      params.set("limit", String(limit));
      const res = await authFetch(`${BACKEND_URL}/api/study/progress?${params}`);
      if (!res.ok) throw new Error("Failed to fetch progress");
      const data: ProgressResponse = await res.json();
      setProgress(data.progress || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }, [courseId, textbookId, limit]);

  useEffect(() => { fetch(); }, [fetch]);

  return { progress, isLoading, error, refetch: fetch };
}

export async function reviewFlashcardApi(cardId: string, quality: 'again' | 'hard' | 'good' | 'easy') {
  const res = await authFetch(`${BACKEND_URL}/api/study/flashcards/${cardId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quality }),
  });
  if (!res.ok) throw new Error("Review failed");
  return res.json();
}

export async function recordQuizResultApi(topic: string, correct: boolean, courseId?: string, textbookId?: string) {
  const res = await authFetch(`${BACKEND_URL}/api/study/quiz-result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, correct, courseId, textbookId }),
  });
  if (!res.ok) throw new Error("Failed to record quiz result");
  return res.json();
}

export type GraderVerdict = "correct" | "partial" | "incorrect";

export interface GradeAnswerResponse {
  verdict: GraderVerdict;
  score: number;
  feedback: string;
  modelAnswer: string;
  missedPoints: string[];
  gradedBy: "objective" | "llm" | "lexical-fallback";
  correct: boolean;
  masteryLevel: number | null;
  recorded: boolean;
}

export async function gradeAnswerApi(body: {
  question: string;
  studentAnswer: string;
  topic: string;
  courseId?: string;
  textbookId?: string;
  sectionPath?: string;
}): Promise<GradeAnswerResponse> {
  const res = await authFetch(`${BACKEND_URL}/api/study/grade-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to grade answer");
  return res.json();
}

export function useDueFlashcardsCount(pollIntervalMs = 5 * 60 * 1000) {
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCount = useCallback(async () => {
    try {
      const res = await authFetch(`${BACKEND_URL}/api/study/flashcards/due-count`);
      if (!res.ok) throw new Error("Failed to fetch due count");
      const data = await res.json();
      setCount(data.count ?? 0);
    } catch {
      // silently keep previous count
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const id = setInterval(fetchCount, pollIntervalMs);
    return () => clearInterval(id);
  }, [fetchCount, pollIntervalMs]);

  return { count, isLoading, refresh: fetchCount };
}

export async function createFlashcardsApi(cards: Array<{
  textbookId?: string;
  courseId?: string;
  topic: string;
  sectionPath?: string;
  question: string;
  answer: string;
  source?: 'ai' | 'manual';
}>) {
  const res = await authFetch(`${BACKEND_URL}/api/study/flashcards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cards }),
  });
  if (!res.ok) throw new Error("Failed to create flashcards");
  return res.json();
}

export interface DailyPlan {
  dueCardsCount: number;
  weakTopics: Array<{
    topic: string;
    mastery_level: number;
    correct_count: number;
    incorrect_count: number;
  }>;
  suggestedQuestions: Array<{
    text: string;
    page_number: number | null;
    section_path: string | null;
  }>;
}

export function useDailyPlan() {
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlan = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await authFetch(`${BACKEND_URL}/api/study/daily-plan`);
      if (!res.ok) throw new Error("Failed to fetch daily plan");
      const data = await res.json();
      setPlan(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plan");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  return { plan, isLoading, error, refetch: fetchPlan };
}