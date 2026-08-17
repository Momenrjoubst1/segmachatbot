import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/auth";
import { BACKEND_URL } from "@/lib/config";

export interface CurriculumSection {
  id: string;
  parent_id: string | null;
  level: "unit" | "lesson" | "topic";
  title: string;
  page_start: number;
  page_end: number;
  order_index: number;
  children?: CurriculumSection[];
}

export interface CurriculumData {
  textbook_id: string;
  file_name: string;
  book_language: string | null;
  sections: CurriculumSection[];
  counts: { sections: number; questions: number };
}

export interface BookQuestion {
  id: string;
  question_type: "lesson_questions" | "unit_questions";
  number: string | null;
  text: string;
  page_number: number | null;
  section_path: string | null;
}

export interface GlossaryEntry {
  id: string;
  term: string;
  definition: string | null;
  page_number: number | null;
}

export function useCurriculum(textbookId: string | null) {
  const [curriculum, setCurriculum] = useState<CurriculumData | null>(null);
  const [questions, setQuestions] = useState<BookQuestion[] | null>(null);
  const [glossary, setGlossary] = useState<GlossaryEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setCurriculum(null);
    setQuestions(null);
    setGlossary(null);
  }, [textbookId]);

  useEffect(() => {
    if (!textbookId) return;
    let cancelled = false;
    setIsLoading(true);
    authFetch(`${BACKEND_URL}/api/textbooks/${textbookId}/curriculum`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setCurriculum(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [textbookId]);

  const fetchQuestions = useCallback(async () => {
    if (!textbookId || questions) return;
    try {
      const res = await authFetch(`${BACKEND_URL}/api/textbooks/${textbookId}/questions?limit=100`);
      if (res.ok) {
        const data = await res.json();
        setQuestions(data.questions || []);
      }
    } catch {
      /* non-fatal */
    }
  }, [textbookId, questions]);

  const fetchGlossary = useCallback(async () => {
    if (!textbookId || glossary) return;
    try {
      const res = await authFetch(`${BACKEND_URL}/api/textbooks/${textbookId}/glossary`);
      if (res.ok) {
        const data = await res.json();
        setGlossary(data.glossary || []);
      }
    } catch {
      /* non-fatal */
    }
  }, [textbookId, glossary]);

  return { curriculum, questions, glossary, isLoading, fetchQuestions, fetchGlossary };
}
