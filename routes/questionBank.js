/**
 * Question Bank & Test Generator Routes
 */

const express = require('express');
const db = require('../db/connection');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/question-bank/stats
router.get('/stats', auth, async (req, res) => {
    try {
        const total = await db.prepare('SELECT COUNT(*) as count FROM questions').get();
        const byType = await db.prepare('SELECT question_type, COUNT(*) as count FROM questions GROUP BY question_type').all();
        const byDifficulty = await db.prepare('SELECT difficulty, COUNT(*) as count FROM questions GROUP BY difficulty').all();

        const exams = await db.prepare(`
            SELECT e.id, e.name, e.code, COUNT(q.id) as question_count
            FROM exams e
            LEFT JOIN questions q ON q.exam_id = e.id
            GROUP BY e.id, e.name, e.code
            ORDER BY e.name
        `).all();

        const subjects = await db.prepare(`
            SELECT s.id, s.name, s.exam_id, e.name as exam_name,
                   COUNT(q.id) as question_count
            FROM subjects s
            JOIN exams e ON s.exam_id = e.id
            LEFT JOIN questions q ON q.subject_id = s.id
            GROUP BY s.id, s.name, s.exam_id, e.name
            ORDER BY e.name, s.name
        `).all();

        const chapters = await db.prepare(`
            SELECT c.id, c.chapter_number, c.name, c.subject_id,
                   s.name as subject_name, e.name as exam_name,
                   COUNT(q.id) as question_count,
                   SUM(CASE WHEN q.question_type = 'mcq' THEN 1 ELSE 0 END) as mcq_count,
                   SUM(CASE WHEN q.question_type = 'nat' THEN 1 ELSE 0 END) as nat_count,
                   SUM(CASE WHEN q.difficulty = 'easy' THEN 1 ELSE 0 END) as easy_count,
                   SUM(CASE WHEN q.difficulty = 'medium' THEN 1 ELSE 0 END) as medium_count,
                   SUM(CASE WHEN q.difficulty = 'hard' THEN 1 ELSE 0 END) as hard_count
            FROM chapters c
            JOIN subjects s ON c.subject_id = s.id
            JOIN exams e ON s.exam_id = e.id
            LEFT JOIN questions q ON q.chapter_id = c.id
            GROUP BY c.id, c.chapter_number, c.name, c.subject_id, s.name, e.name
            ORDER BY e.name, s.name, c.chapter_number
        `).all();

        res.json({ total: total.count, byType, byDifficulty, exams, subjects, chapters });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/question-bank/chapters
router.get('/chapters', auth, async (req, res) => {
    try {
        let query = `
            SELECT c.id, c.chapter_number, c.name, c.description, c.subject_id,
                   s.name as subject_name, COUNT(q.id) as question_count
            FROM chapters c
            JOIN subjects s ON c.subject_id = s.id
            LEFT JOIN questions q ON q.chapter_id = c.id
        `;
        const conditions = [];
        const params = [];

        if (req.query.exam_id) {
            conditions.push('s.exam_id = ?');
            params.push(req.query.exam_id);
        }
        if (req.query.subject_id) {
            conditions.push('c.subject_id = ?');
            params.push(req.query.subject_id);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' GROUP BY c.id, c.chapter_number, c.name, c.description, c.subject_id, s.name ORDER BY s.name, c.chapter_number';
        const chapters = await db.prepare(query).all(...params);
        res.json(chapters);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/question-bank/browse
router.get('/browse', auth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = (page - 1) * limit;

        let where = [];
        let params = [];

        if (req.query.exam_id) { where.push('q.exam_id = ?'); params.push(req.query.exam_id); }
        if (req.query.subject_id) { where.push('q.subject_id = ?'); params.push(req.query.subject_id); }
        if (req.query.chapter_id) { where.push('q.chapter_id = ?'); params.push(req.query.chapter_id); }
        if (req.query.difficulty) { where.push('q.difficulty = ?'); params.push(req.query.difficulty); }
        if (req.query.type) { where.push('q.question_type = ?'); params.push(req.query.type); }
        if (req.query.tags) {
            const tags = req.query.tags.split(',');
            for (const tag of tags) {
                where.push("q.tags LIKE ?");
                params.push(`%${tag.trim()}%`);
            }
        }

        const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

        const countQ = await db.prepare(`SELECT COUNT(*) as total FROM questions q ${whereClause}`).get(...params);

        const questions = await db.prepare(`
            SELECT q.*, s.name as subject_name,
                   COALESCE(c.name, t.name) as chapter_name,
                   c.chapter_number, e.name as exam_name
            FROM questions q
            JOIN subjects s ON q.subject_id = s.id
            JOIN exams e ON q.exam_id = e.id
            LEFT JOIN chapters c ON q.chapter_id = c.id
            LEFT JOIN topics t ON q.topic_id = t.id
            ${whereClause}
            ORDER BY e.name, s.name, c.chapter_number, q.id
            LIMIT ? OFFSET ?
        `).all(...params, limit, offset);

        for (const q of questions) {
            if (q.question_type === 'mcq') {
                q.options = await db.prepare('SELECT id, option_label, option_text, option_image_url, is_correct FROM question_options WHERE question_id = ?').all(q.id);
            }
        }

        res.json({
            questions,
            pagination: {
                page,
                limit,
                total: countQ.total,
                totalPages: Math.ceil(countQ.total / limit)
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/question-bank/generate-test
router.post('/generate-test', auth, async (req, res) => {
    try {
        const { title, exam_id, duration, sections, shuffle } = req.body;

        if (!title || !exam_id || !duration || !sections || sections.length === 0) {
            return res.status(400).json({ error: 'title, exam_id, duration, and sections are required' });
        }

        const selectedQuestions = [];

        for (const section of sections) {
            const { subject_id, chapter_ids, count, difficulty_mix, type } = section;

            if (!count || !subject_id) {
                return res.status(400).json({ error: 'Each section needs subject_id and count' });
            }

            if (difficulty_mix) {
                for (const [diff, diffCount] of Object.entries(difficulty_mix)) {
                    let where = ['q.subject_id = ?', 'q.difficulty = ?'];
                    let params = [subject_id, diff];

                    if (chapter_ids && chapter_ids.length > 0) {
                        where.push(`q.chapter_id IN (${chapter_ids.map(() => '?').join(',')})`);
                        params.push(...chapter_ids);
                    }
                    if (type) {
                        where.push('q.question_type = ?');
                        params.push(type);
                    }
                    if (selectedQuestions.length > 0) {
                        where.push(`q.id NOT IN (${selectedQuestions.map(() => '?').join(',')})`);
                        params.push(...selectedQuestions);
                    }

                    const qs = await db.prepare(`
                        SELECT q.id FROM questions q
                        WHERE ${where.join(' AND ')}
                        ORDER BY RANDOM() LIMIT ?
                    `).all(...params, diffCount);

                    qs.forEach(q => selectedQuestions.push(q.id));
                }
            } else {
                let where = ['q.subject_id = ?'];
                let params = [subject_id];

                if (chapter_ids && chapter_ids.length > 0) {
                    where.push(`q.chapter_id IN (${chapter_ids.map(() => '?').join(',')})`);
                    params.push(...chapter_ids);
                }
                if (type) {
                    where.push('q.question_type = ?');
                    params.push(type);
                }
                if (selectedQuestions.length > 0) {
                    where.push(`q.id NOT IN (${selectedQuestions.map(() => '?').join(',')})`);
                    params.push(...selectedQuestions);
                }

                const qs = await db.prepare(`
                    SELECT q.id FROM questions q
                    WHERE ${where.join(' AND ')}
                    ORDER BY RANDOM() LIMIT ?
                `).all(...params, count);

                qs.forEach(q => selectedQuestions.push(q.id));
            }
        }

        if (selectedQuestions.length === 0) {
            return res.status(400).json({ error: 'No questions matched the criteria. Check your filters.' });
        }

        const finalOrder = shuffle !== false
            ? selectedQuestions.sort(() => Math.random() - 0.5)
            : selectedQuestions;

        const subjectCount = new Set(sections.map(s => s.subject_id)).size;
        const hasChapterFilter = sections.some(s => s.chapter_ids && s.chapter_ids.length > 0);
        let testType = 'full_mock';
        if (hasChapterFilter) testType = 'chapter_test';
        else if (subjectCount === 1) testType = 'subject_test';

        const createTest = db.transaction(async (txDb) => {
            const testId = (await txDb.prepare(
                'INSERT INTO tests (exam_id, title, duration, total_questions, test_type, generation_config) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(exam_id, title, duration, finalOrder.length, testType, JSON.stringify(req.body))).lastInsertRowid;

            const insertTQ = txDb.prepare('INSERT INTO test_questions (test_id, question_id, question_order) VALUES (?, ?, ?)');
            for (let i = 0; i < finalOrder.length; i++) {
                await insertTQ.run(testId, finalOrder[i], i + 1);
            }

            return testId;
        });

        const testId = await createTest();

        res.json({
            test_id: testId,
            title,
            total_questions: finalOrder.length,
            duration,
            test_type: testType,
            message: `Test "${title}" created with ${finalOrder.length} questions`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
