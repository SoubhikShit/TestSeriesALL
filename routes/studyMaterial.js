const express = require('express');
const db = require('../db/connection');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/study-material/recommendations/me — Get study materials for weak topics
router.get('/recommendations/me', auth, async (req, res) => {
    try {
        const weakTopics = await db.prepare(`
            SELECT tp.topic_id, tp.accuracy, t.name as topic_name, s.name as subject_name
            FROM topic_performance tp
            JOIN topics t ON tp.topic_id = t.id
            JOIN subjects s ON t.subject_id = s.id
            WHERE tp.user_id = ? AND tp.accuracy < 60
            ORDER BY tp.accuracy ASC
        `).all(req.user.id);

        const recommendations = [];
        for (const wt of weakTopics) {
            const materials = await db.prepare(
                'SELECT * FROM study_materials WHERE topic_id = ?'
            ).all(wt.topic_id);

            recommendations.push({
                topic_id: wt.topic_id,
                topic_name: wt.topic_name,
                subject_name: wt.subject_name,
                accuracy: wt.accuracy,
                materials
            });
        }

        res.json({
            total_weak_topics: recommendations.length,
            recommendations
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/study-material/:topic_id — Get study materials for a topic
router.get('/:topic_id', async (req, res) => {
    try {
        const topic = await db.prepare(`
            SELECT t.*, s.name as subject_name
            FROM topics t
            JOIN subjects s ON t.subject_id = s.id
            WHERE t.id = ?
        `).get(req.params.topic_id);

        if (!topic) return res.status(404).json({ error: 'Topic not found' });

        const materials = await db.prepare(
            'SELECT * FROM study_materials WHERE topic_id = ? ORDER BY content_type'
        ).all(req.params.topic_id);

        res.json({
            topic,
            materials
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
