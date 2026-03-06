const express = require('express');
const db = require('../db/connection');
const auth = require('../middleware/auth');

const router = express.Router();

// POST /api/test/start — Start a test attempt
router.post('/start', auth, (req, res) => {
    try {
        const { test_id } = req.body;
        if (!test_id) return res.status(400).json({ error: 'test_id is required' });

        const test = db.prepare('SELECT * FROM tests WHERE id = ?').get(test_id);
        if (!test) return res.status(404).json({ error: 'Test not found' });

        const result = db.prepare(
            'INSERT INTO test_attempts (user_id, test_id) VALUES (?, ?)'
        ).run(req.user.id, test_id);

        res.status(201).json({
            attempt_id: result.lastInsertRowid,
            test_id: test.id,
            title: test.title,
            duration: test.duration,
            total_questions: test.total_questions,
            start_time: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/test/submit — Submit a test
// Body: { attempt_id, answers: [{ question_id, selected_option, nat_answer, time_taken }] }
router.post('/submit', auth, (req, res) => {
    try {
        const { attempt_id, answers } = req.body;

        if (!attempt_id || !answers || !Array.isArray(answers)) {
            return res.status(400).json({ error: 'attempt_id and answers array required' });
        }

        // Verify this attempt belongs to the user
        const attempt = db.prepare(
            'SELECT * FROM test_attempts WHERE id = ? AND user_id = ?'
        ).get(attempt_id, req.user.id);

        if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

        // Process answers in a transaction
        const processSubmission = db.transaction(() => {
            let totalScore = 0;
            let totalCorrect = 0;
            let totalAttempted = 0;

            const insertAnswerMCQ = db.prepare(
                'INSERT INTO user_answers (attempt_id, question_id, selected_option, nat_answer, is_correct, time_taken) VALUES (?, ?, ?, ?, ?, ?)'
            );

            for (const answer of answers) {
                const { question_id, selected_option, nat_answer, time_taken } = answer;

                // Get question details
                const question = db.prepare(
                    'SELECT question_type, marks, negative_marks, correct_answer_numeric, answer_tolerance FROM questions WHERE id = ?'
                ).get(question_id);

                if (!question) continue;

                if (question.question_type === 'nat') {
                    // NAT question — compare numeric answer
                    if (nat_answer === null || nat_answer === undefined || nat_answer === '') {
                        // Unanswered
                        insertAnswerMCQ.run(attempt_id, question_id, null, null, 0, time_taken || 0);
                        continue;
                    }

                    totalAttempted++;
                    const studentAnswer = parseFloat(nat_answer);
                    const correctAnswer = question.correct_answer_numeric;
                    const tol = question.answer_tolerance || 0;
                    const isCorrect = Math.abs(studentAnswer - correctAnswer) <= tol ? 1 : 0;

                    if (isCorrect) {
                        totalScore += question.marks;
                        totalCorrect++;
                    } else {
                        totalScore -= question.negative_marks;
                    }

                    insertAnswerMCQ.run(attempt_id, question_id, null, studentAnswer, isCorrect, time_taken || 0);

                } else {
                    // MCQ question
                    if (!selected_option) {
                        insertAnswerMCQ.run(attempt_id, question_id, null, null, 0, time_taken || 0);
                        continue;
                    }

                    totalAttempted++;

                    const option = db.prepare(
                        'SELECT is_correct FROM question_options WHERE id = ? AND question_id = ?'
                    ).get(selected_option, question_id);

                    const isCorrect = option && option.is_correct ? 1 : 0;

                    if (isCorrect) {
                        totalScore += question.marks;
                        totalCorrect++;
                    } else {
                        totalScore -= question.negative_marks;
                    }

                    insertAnswerMCQ.run(attempt_id, question_id, selected_option, null, isCorrect, time_taken || 0);
                }
            }

            const accuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;

            // Update test attempt
            db.prepare(
                'UPDATE test_attempts SET end_time = CURRENT_TIMESTAMP, score = ?, accuracy = ? WHERE id = ?'
            ).run(totalScore, accuracy, attempt_id);

            // Update topic performance
            updateTopicPerformance(req.user.id, attempt_id);

            return { totalScore, accuracy, totalCorrect, totalAttempted };
        });

        const result = processSubmission();

        res.json({
            message: 'Test submitted successfully',
            attempt_id,
            score: result.totalScore,
            accuracy: result.accuracy,
            correct: result.totalCorrect,
            attempted: result.totalAttempted
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper: Update topic_performance after test submission
function updateTopicPerformance(userId, attemptId) {
    // Get all answers with topic info for this attempt
    const answers = db.prepare(`
        SELECT ua.is_correct, q.topic_id
        FROM user_answers ua
        JOIN questions q ON ua.question_id = q.id
        WHERE ua.attempt_id = ? AND (ua.selected_option IS NOT NULL OR ua.nat_answer IS NOT NULL)
    `).all(attemptId);

    // Group by topic
    const topicStats = {};
    for (const a of answers) {
        if (!topicStats[a.topic_id]) {
            topicStats[a.topic_id] = { attempted: 0, correct: 0 };
        }
        topicStats[a.topic_id].attempted++;
        if (a.is_correct) topicStats[a.topic_id].correct++;
    }

    // Upsert topic performance
    const upsert = db.prepare(`
        INSERT INTO topic_performance (user_id, topic_id, questions_attempted, correct_answers, accuracy, last_updated)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, topic_id) DO UPDATE SET
            questions_attempted = questions_attempted + excluded.questions_attempted,
            correct_answers = correct_answers + excluded.correct_answers,
            accuracy = ROUND(
                (correct_answers + excluded.correct_answers) * 100.0 /
                (questions_attempted + excluded.questions_attempted)
            ),
            last_updated = CURRENT_TIMESTAMP
    `);

    for (const [topicId, stats] of Object.entries(topicStats)) {
        const accuracy = Math.round((stats.correct / stats.attempted) * 100);
        upsert.run(userId, topicId, stats.attempted, stats.correct, accuracy);
    }
}

module.exports = router;
