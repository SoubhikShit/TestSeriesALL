const express = require('express');
const db = require('../db/connection');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/analysis/:attempt_id — Full test analysis
router.get('/:attempt_id', auth, (req, res) => {
    try {
        const attempt = db.prepare(`
            SELECT ta.*, t.title as test_title, t.total_questions
            FROM test_attempts ta
            JOIN tests t ON ta.test_id = t.id
            WHERE ta.id = ? AND ta.user_id = ?
        `).get(req.params.attempt_id, req.user.id);

        if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

        // Get detailed answers with question info
        const answers = db.prepare(`
            SELECT ua.*, q.question_text, q.question_type, q.image_url, q.solution_image_url,
                   q.correct_answer_numeric, q.explanation, q.marks, q.negative_marks,
                   q.difficulty, s.name as subject_name,
                   COALESCE(c.name, tp.name) as topic_name,
                   COALESCE(tp.id, 0) as topic_id,
                   c.chapter_number
            FROM user_answers ua
            JOIN questions q ON ua.question_id = q.id
            JOIN subjects s ON q.subject_id = s.id
            LEFT JOIN topics tp ON q.topic_id = tp.id
            LEFT JOIN chapters c ON q.chapter_id = c.id
            WHERE ua.attempt_id = ?
        `).all(req.params.attempt_id);

        // Enrich each answer with options (for MCQ questions)
        for (const a of answers) {
            if (a.question_type === 'mcq') {
                a.options = db.prepare(
                    'SELECT id, option_text, is_correct FROM question_options WHERE question_id = ?'
                ).all(a.question_id);
            } else {
                a.options = [];
            }
        }

        // Subject-wise breakdown
        const subjectBreakdown = db.prepare(`
            SELECT s.name as subject,
                   COUNT(*) as total,
                   SUM(CASE WHEN ua.is_correct = 1 THEN 1 ELSE 0 END) as correct,
                   SUM(CASE WHEN (ua.selected_option IS NOT NULL OR ua.nat_answer IS NOT NULL) AND ua.is_correct = 0 THEN 1 ELSE 0 END) as wrong,
                   SUM(CASE WHEN ua.selected_option IS NULL AND ua.nat_answer IS NULL THEN 1 ELSE 0 END) as unanswered
            FROM user_answers ua
            JOIN questions q ON ua.question_id = q.id
            JOIN subjects s ON q.subject_id = s.id
            WHERE ua.attempt_id = ?
            GROUP BY s.id
        `).all(req.params.attempt_id);

        // Topic-wise breakdown
        const topicBreakdown = db.prepare(`
            SELECT COALESCE(tp.id, 0) as topic_id, COALESCE(c.name, tp.name, 'Unknown') as topic, s.name as subject,
                   COUNT(*) as total,
                   SUM(CASE WHEN ua.is_correct = 1 THEN 1 ELSE 0 END) as correct,
                   SUM(CASE WHEN ua.selected_option IS NOT NULL AND ua.is_correct = 0 THEN 1 ELSE 0 END) as wrong
            FROM user_answers ua
            JOIN questions q ON ua.question_id = q.id
            LEFT JOIN topics tp ON q.topic_id = tp.id
            LEFT JOIN chapters c ON q.chapter_id = c.id
            JOIN subjects s ON q.subject_id = s.id
            WHERE ua.attempt_id = ?
            GROUP BY COALESCE(tp.id, q.chapter_id)
            ORDER BY correct * 1.0 / total ASC
        `).all(req.params.attempt_id);

        res.json({
            attempt,
            answers,
            subjectBreakdown,
            topicBreakdown
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analysis/weak-topics/:user_id — Detect weak topics
router.get('/weak-topics/me', auth, (req, res) => {
    try {
        const weakTopics = db.prepare(`
            SELECT tp.*, t.name as topic_name, s.name as subject_name
            FROM topic_performance tp
            JOIN topics t ON tp.topic_id = t.id
            JOIN subjects s ON t.subject_id = s.id
            WHERE tp.user_id = ? AND tp.accuracy < 60
            ORDER BY tp.accuracy ASC
        `).all(req.user.id);

        res.json({
            total_weak_topics: weakTopics.length,
            weak_topics: weakTopics
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analysis/topic-performance/me — All topic performances
router.get('/topic-performance/me', auth, (req, res) => {
    try {
        const performance = db.prepare(`
            SELECT tp.*, t.name as topic_name, s.name as subject_name
            FROM topic_performance tp
            JOIN topics t ON tp.topic_id = t.id
            JOIN subjects s ON t.subject_id = s.id
            WHERE tp.user_id = ?
            ORDER BY s.name, t.name
        `).all(req.user.id);

        res.json(performance);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/analysis/history/me — Test history for logged-in user
router.get('/history/me', auth, (req, res) => {
    try {
        const history = db.prepare(`
            SELECT ta.*, t.title as test_title, e.name as exam_name
            FROM test_attempts ta
            JOIN tests t ON ta.test_id = t.id
            JOIN exams e ON t.exam_id = e.id
            WHERE ta.user_id = ?
            ORDER BY ta.start_time DESC
        `).all(req.user.id);

        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
