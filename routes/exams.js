const express = require('express');
const db = require('../db/connection');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/exams — List all exams
router.get('/', async (req, res) => {
    try {
        const exams = await db.prepare('SELECT * FROM exams ORDER BY name').all();
        res.json(exams);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/exams/:id — Get exam with subjects and topics
router.get('/:id', async (req, res) => {
    try {
        const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(req.params.id);
        if (!exam) return res.status(404).json({ error: 'Exam not found' });

        const subjects = await db.prepare('SELECT * FROM subjects WHERE exam_id = ?').all(exam.id);

        for (const subject of subjects) {
            subject.topics = await db.prepare('SELECT * FROM topics WHERE subject_id = ?').all(subject.id);
        }

        res.json({ ...exam, subjects });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/exams/:id/subjects — List subjects for an exam
router.get('/:id/subjects', async (req, res) => {
    try {
        const subjects = await db.prepare('SELECT * FROM subjects WHERE exam_id = ?').all(req.params.id);
        res.json(subjects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/exams/:id/topics — List all topics for an exam (grouped by subject)
router.get('/:id/topics', async (req, res) => {
    try {
        const topics = await db.prepare(`
            SELECT t.*, s.name as subject_name
            FROM topics t
            JOIN subjects s ON t.subject_id = s.id
            WHERE s.exam_id = ?
            ORDER BY s.name, t.name
        `).all(req.params.id);
        res.json(topics);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
