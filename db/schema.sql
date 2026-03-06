-- ============================================
-- Test Series Platform - PostgreSQL Schema
-- ============================================

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    exam_preparing TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Exams Table
CREATE TABLE IF NOT EXISTS exams (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    code TEXT UNIQUE,
    duration INTEGER NOT NULL,
    total_marks INTEGER NOT NULL,
    negative_marking REAL DEFAULT 0
);

-- 3. Subjects Table
CREATE TABLE IF NOT EXISTS subjects (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    code TEXT,
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

-- 4. Chapters Table
CREATE TABLE IF NOT EXISTS chapters (
    id SERIAL PRIMARY KEY,
    subject_id INTEGER NOT NULL,
    chapter_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    folder_name TEXT,
    UNIQUE(subject_id, chapter_number),
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE
);

-- Legacy topics table
CREATE TABLE IF NOT EXISTS topics (
    id SERIAL PRIMARY KEY,
    subject_id INTEGER NOT NULL,
    chapter_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- 5. Questions Table
CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL,
    subject_id INTEGER NOT NULL,
    chapter_id INTEGER,
    topic_id INTEGER,
    question_type TEXT CHECK(question_type IN ('mcq', 'nat')) DEFAULT 'mcq',
    difficulty TEXT CHECK(difficulty IN ('easy', 'medium', 'hard')) DEFAULT 'medium',
    question_text TEXT,
    image_url TEXT,
    correct_answer_numeric REAL,
    answer_tolerance REAL DEFAULT 0,
    solution_image_url TEXT,
    explanation TEXT,
    marks REAL DEFAULT 4,
    negative_marks REAL DEFAULT 0,
    source_folder TEXT,
    source_file TEXT,
    tags TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
);

-- 6. Question Options Table (MCQ)
CREATE TABLE IF NOT EXISTS question_options (
    id SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL,
    option_label TEXT,
    option_text TEXT,
    option_image_url TEXT,
    is_correct INTEGER DEFAULT 0,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- 7. Tests Table
CREATE TABLE IF NOT EXISTS tests (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    duration INTEGER NOT NULL,
    total_questions INTEGER NOT NULL,
    test_type TEXT CHECK(test_type IN ('full_mock', 'subject_test', 'chapter_test', 'custom')) DEFAULT 'full_mock',
    generation_config TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

-- 8. Test Questions Mapping
CREATE TABLE IF NOT EXISTS test_questions (
    id SERIAL PRIMARY KEY,
    test_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    question_order INTEGER,
    FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- 9. Test Attempts Table
CREATE TABLE IF NOT EXISTS test_attempts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    test_id INTEGER NOT NULL,
    start_time TIMESTAMPTZ DEFAULT NOW(),
    end_time TIMESTAMPTZ,
    score REAL DEFAULT 0,
    accuracy REAL DEFAULT 0,
    rank INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
);

-- 10. User Answers Table
CREATE TABLE IF NOT EXISTS user_answers (
    id SERIAL PRIMARY KEY,
    attempt_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    selected_option INTEGER,
    nat_answer REAL,
    is_correct INTEGER DEFAULT 0,
    time_taken INTEGER DEFAULT 0,
    FOREIGN KEY (attempt_id) REFERENCES test_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- 11. Topic/Chapter Performance Table
CREATE TABLE IF NOT EXISTS topic_performance (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    topic_id INTEGER,
    chapter_id INTEGER,
    questions_attempted INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    accuracy REAL DEFAULT 0,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, topic_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- 12. Study Materials Table
CREATE TABLE IF NOT EXISTS study_materials (
    id SERIAL PRIMARY KEY,
    topic_id INTEGER,
    chapter_id INTEGER,
    title TEXT NOT NULL,
    content_type TEXT CHECK(content_type IN ('notes', 'video', 'examples', 'practice_set', 'pdf')) DEFAULT 'notes',
    content_url TEXT,
    description TEXT,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_chapters_subject ON chapters(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_chapter ON questions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic_id);
CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(question_type);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_user_answers_attempt ON user_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_test_attempts_user ON test_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_topic_perf_user ON topic_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_study_materials_topic ON study_materials(topic_id);
CREATE INDEX IF NOT EXISTS idx_study_materials_chapter ON study_materials(chapter_id);
CREATE INDEX IF NOT EXISTS idx_test_questions_test ON test_questions(test_id);
