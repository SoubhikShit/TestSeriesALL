const express = require('express');
const db = require('../db/connection');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/tests?exam_id=1 — List tests, optionally filtered by exam
router.get('/', async (req, res) => {
    try {
        let query = 'SELECT t.*, e.name as exam_name FROM tests t JOIN exams e ON t.exam_id = e.id';
        const params = [];

        if (req.query.exam_id) {
            query += ' WHERE t.exam_id = ?';
            params.push(req.query.exam_id);
        }

        query += ' ORDER BY t.created_at DESC';
        const tests = await db.prepare(query).all(...params);
        res.json(tests);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/tests/:id — Get test details
router.get('/:id', async (req, res) => {
    try {
        const test = await db.prepare(`
            SELECT t.*, e.name as exam_name
            FROM tests t
            JOIN exams e ON t.exam_id = e.id
            WHERE t.id = ?
        `).get(req.params.id);

        if (!test) return res.status(404).json({ error: 'Test not found' });

        res.json(test);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/tests/:id/questions — Get test questions (for taking test)
router.get('/:id/questions', auth, async (req, res) => {
    try {
        const questions = await db.prepare(`
            SELECT q.id, q.question_type, q.question_text, q.image_url,
                   q.difficulty, q.marks, q.negative_marks,
                   tq.question_order, s.name as subject_name, tp.name as topic_name
            FROM test_questions tq
            JOIN questions q ON tq.question_id = q.id
            JOIN subjects s ON q.subject_id = s.id
            JOIN topics tp ON q.topic_id = tp.id
            WHERE tq.test_id = ?
            ORDER BY tq.question_order
        `).all(req.params.id);

        for (const q of questions) {
            if (q.question_type === 'mcq') {
                q.options = await db.prepare(
                    'SELECT id, option_text FROM question_options WHERE question_id = ?'
                ).all(q.id);
            } else {
                q.options = [];
            }
        }

        res.json(questions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
