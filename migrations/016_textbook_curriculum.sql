-- ==========================================
-- Migration 016: Curriculum Layer (Phase 2)
-- ==========================================
-- The book's pedagogical structure: units → lessons → topics, discrete
-- lesson/unit questions (quiz-ready), and the end-of-book glossary.
-- ==========================================

CREATE TABLE IF NOT EXISTS textbook_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES textbook_sections(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('unit', 'lesson', 'topic')),
  title TEXT NOT NULL,
  page_start INT NOT NULL,
  page_end INT NOT NULL,
  order_index INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_textbook_sections_book
  ON textbook_sections(textbook_id, order_index);

CREATE TABLE IF NOT EXISTS textbook_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL DEFAULT 'lesson_questions'
    CHECK (question_type IN ('lesson_questions', 'unit_questions')),
  number TEXT,
  text TEXT NOT NULL,
  page_number INT,
  section_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_textbook_questions_book
  ON textbook_questions(textbook_id);

CREATE TABLE IF NOT EXISTS textbook_glossary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  textbook_id UUID NOT NULL REFERENCES textbooks(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  definition TEXT,
  page_number INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_textbook_glossary_book
  ON textbook_glossary(textbook_id);

-- RLS (mirror the chunks pattern: reachable only via the owning textbook)
CREATE POLICY "Users can view sections in own textbooks" ON textbook_sections
  FOR SELECT USING (EXISTS (SELECT 1 FROM textbooks
    WHERE textbooks.id = textbook_sections.textbook_id AND textbooks.user_id = auth.uid()));
CREATE POLICY "Users can insert sections in own textbooks" ON textbook_sections
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM textbooks
    WHERE textbooks.id = textbook_sections.textbook_id AND textbooks.user_id = auth.uid()));
CREATE POLICY "Users can delete sections in own textbooks" ON textbook_sections
  FOR DELETE USING (EXISTS (SELECT 1 FROM textbooks
    WHERE textbooks.id = textbook_sections.textbook_id AND textbooks.user_id = auth.uid()));

CREATE POLICY "Users can view questions in own textbooks" ON textbook_questions
  FOR SELECT USING (EXISTS (SELECT 1 FROM textbooks
    WHERE textbooks.id = textbook_questions.textbook_id AND textbooks.user_id = auth.uid()));
CREATE POLICY "Users can insert questions in own textbooks" ON textbook_questions
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM textbooks
    WHERE textbooks.id = textbook_questions.textbook_id AND textbooks.user_id = auth.uid()));
CREATE POLICY "Users can delete questions in own textbooks" ON textbook_questions
  FOR DELETE USING (EXISTS (SELECT 1 FROM textbooks
    WHERE textbooks.id = textbook_questions.textbook_id AND textbooks.user_id = auth.uid()));

CREATE POLICY "Users can view glossary in own textbooks" ON textbook_glossary
  FOR SELECT USING (EXISTS (SELECT 1 FROM textbooks
    WHERE textbooks.id = textbook_glossary.textbook_id AND textbooks.user_id = auth.uid()));
CREATE POLICY "Users can insert glossary in own textbooks" ON textbook_glossary
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM textbooks
    WHERE textbooks.id = textbook_glossary.textbook_id AND textbooks.user_id = auth.uid()));
CREATE POLICY "Users can delete glossary in own textbooks" ON textbook_glossary
  FOR DELETE USING (EXISTS (SELECT 1 FROM textbooks
    WHERE textbooks.id = textbook_glossary.textbook_id AND textbooks.user_id = auth.uid()));
