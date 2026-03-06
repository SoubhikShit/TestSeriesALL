/**
 * Seed Script — Sets up the database, imports question bank, and creates sample tests
 * Run: node db/seed.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const initializeDB = require('./init');
const { initDB } = require('./connection');
const bcrypt = require('bcryptjs');
const { scanQuestionBank, importToDatabase } = require('../admin/scan-question-bank');

async function runSeed() {
    await initializeDB();
    const db = require('./connection');

    console.log('🌱 Seeding database...\n');

    // ═══════════════════════════════════════
    // 1. Setup base data (exams with codes)
    // ═══════════════════════════════════════
    const setupBase = db.transaction(() => {
        // Delete existing data (fresh seed)
        db.exec('DELETE FROM study_materials');
        db.exec('DELETE FROM topic_performance');
        db.exec('DELETE FROM user_answers');
        db.exec('DELETE FROM test_attempts');
        db.exec('DELETE FROM test_questions');
        db.exec('DELETE FROM tests');
        db.exec('DELETE FROM question_options');
        db.exec('DELETE FROM questions');
        db.exec('DELETE FROM topics');
        db.exec('DELETE FROM chapters');
        db.exec('DELETE FROM subjects');
        db.exec('DELETE FROM exams');
        db.exec('DELETE FROM users');

        // Create exams with codes matching folder names
        db.prepare('INSERT INTO exams (name, code, duration, total_marks, negative_marking) VALUES (?, ?, ?, ?, ?)')
            .run('JEE Advanced', 'jee', 180, 300, 1);
        db.prepare('INSERT INTO exams (name, code, duration, total_marks, negative_marking) VALUES (?, ?, ?, ?, ?)')
            .run('NEET', 'neet', 180, 720, 1);
        db.prepare('INSERT INTO exams (name, code, duration, total_marks, negative_marking) VALUES (?, ?, ?, ?, ?)')
            .run('GATE CS', 'gate-cs', 180, 100, 0.33);

        console.log('  ✅ Exams: 3 (JEE Advanced, NEET, GATE CS)');
    });
    setupBase();

    // ═══════════════════════════════════════
    // 2. Import Question Bank from folder structure
    // ═══════════════════════════════════════
    console.log('\n📂 Scanning question bank...\n');
    const bank = scanQuestionBank();

    if (bank.length > 0) {
        await importToDatabase(bank, false);
    } else {
        console.log('  ⚠️  No question bank folders found — skipping question import');
    }

    // ═══════════════════════════════════════
    // 3. Auto-generate tests from imported questions
    // ═══════════════════════════════════════
    const createTests = db.transaction(() => {
        const jeeExam = db.prepare("SELECT id FROM exams WHERE code = 'jee'").get();
        if (!jeeExam) return;
        const jeeId = jeeExam.id;

        const insertTest = db.prepare(
            'INSERT INTO tests (exam_id, title, duration, total_questions, test_type, generation_config) VALUES (?, ?, ?, ?, ?, ?)'
        );
        const insertTestQ = db.prepare(
            'INSERT INTO test_questions (test_id, question_id, question_order) VALUES (?, ?, ?)'
        );

        // Get all questions grouped by type
        const allQ = db.prepare('SELECT id FROM questions WHERE exam_id = ? ORDER BY RANDOM()').all(jeeId);
        const mcqQ = db.prepare("SELECT id FROM questions WHERE exam_id = ? AND question_type = 'mcq' ORDER BY RANDOM()").all(jeeId);
        const natQ = db.prepare("SELECT id FROM questions WHERE exam_id = ? AND question_type = 'nat' ORDER BY RANDOM()").all(jeeId);

        if (allQ.length === 0) {
            console.log('  ⚠️  No JEE questions found — skipping test creation');
            return;
        }

        let testCount = 0;

        // Test 1: Full Mock (all questions)
        const t1 = insertTest.run(jeeId, 'JEE Advanced Full Mock 1', 180, allQ.length, 'full_mock',
            JSON.stringify({ type: 'all', source: 'question-bank' })).lastInsertRowid;
        allQ.forEach((q, i) => insertTestQ.run(t1, q.id, i + 1));
        testCount++;

        // Test 2: Per-subject tests
        const subjects = db.prepare('SELECT id, name FROM subjects WHERE exam_id = ?').all(jeeId);
        for (const sub of subjects) {
            const subQ = db.prepare('SELECT id FROM questions WHERE subject_id = ? ORDER BY RANDOM()').all(sub.id);
            if (subQ.length > 0) {
                const t = insertTest.run(jeeId, `${sub.name} Subject Test`, 60, subQ.length, 'subject_test',
                    JSON.stringify({ subject_id: sub.id })).lastInsertRowid;
                subQ.forEach((q, i) => insertTestQ.run(t, q.id, i + 1));
                testCount++;
            }
        }

        // Test 3: NAT-only test (if enough NAT questions)
        if (natQ.length >= 5) {
            const t = insertTest.run(jeeId, 'JEE Numerical (NAT) Practice', 90, natQ.length, 'full_mock',
                JSON.stringify({ type: 'nat_only' })).lastInsertRowid;
            natQ.forEach((q, i) => insertTestQ.run(t, q.id, i + 1));
            testCount++;
        }

        // Test 4: Mixed MCQ + NAT (random selection)
        if (mcqQ.length >= 5 && natQ.length >= 3) {
            const mixed = [...mcqQ.slice(0, 10), ...natQ.slice(0, 8)].sort(() => Math.random() - 0.5);
            const t = insertTest.run(jeeId, 'JEE Mixed MCQ + NAT Mock', 120, mixed.length, 'full_mock',
                JSON.stringify({ type: 'mixed' })).lastInsertRowid;
            mixed.forEach((q, i) => insertTestQ.run(t, q.id, i + 1));
            testCount++;
        }

        // Test 5: Per-chapter tests for chapters with enough questions
        const chapters = db.prepare(`
            SELECT c.id, c.name, c.chapter_number, s.name as subject_name
            FROM chapters c JOIN subjects s ON c.subject_id = s.id
            WHERE s.exam_id = ?
            ORDER BY s.name, c.chapter_number
        `).all(jeeId);

        for (const ch of chapters) {
            const chQ = db.prepare('SELECT id FROM questions WHERE chapter_id = ? ORDER BY RANDOM()').all(ch.id);
            if (chQ.length >= 3) {
                const t = insertTest.run(jeeId, `${ch.subject_name}: ${ch.name} Test`, 30, chQ.length, 'chapter_test',
                    JSON.stringify({ chapter_id: ch.id })).lastInsertRowid;
                chQ.forEach((q, i) => insertTestQ.run(t, q.id, i + 1));
                testCount++;
            }
        }

        console.log(`\n  ✅ Tests created: ${testCount}`);
    });
    createTests();

    // ═══════════════════════════════════════
    // 4. Study Materials (linked to topics/chapters)
    // ═══════════════════════════════════════
    const addMaterials = db.transaction(() => {
        const topics = db.prepare(`
            SELECT t.id as topic_id, c.id as chapter_id, t.name, s.name as subject_name
            FROM topics t
            LEFT JOIN chapters c ON t.chapter_id = c.id
            JOIN subjects s ON t.subject_id = s.id
        `).all();

        const insertMat = db.prepare(
            'INSERT INTO study_materials (topic_id, chapter_id, title, content_type, content_url, description) VALUES (?, ?, ?, ?, ?, ?)'
        );

        let matCount = 0;
        for (const t of topics) {
            insertMat.run(t.topic_id, t.chapter_id, `${t.name} Complete Notes`, 'notes',
                `/materials/${t.name.toLowerCase().replace(/\s+/g, '-')}-notes.pdf`,
                `Comprehensive notes for ${t.name}`);
            insertMat.run(t.topic_id, t.chapter_id, `${t.name} Video Lecture`, 'video',
                `https://youtube.com/example-${t.name.toLowerCase().replace(/\s+/g, '-')}`,
                `Full video lecture on ${t.name}`);
            insertMat.run(t.topic_id, t.chapter_id, `${t.name} Practice Problems`, 'practice_set',
                `/materials/${t.name.toLowerCase().replace(/\s+/g, '-')}-practice.pdf`,
                `Practice problems for ${t.name}`);
            matCount += 3;
        }

        console.log(`  ✅ Study materials: ${matCount}`);
    });
    addMaterials();

    // ═══════════════════════════════════════
    // 5. Sample User
    // ═══════════════════════════════════════
    const hash = bcrypt.hashSync('password123', 10);
    db.prepare('INSERT OR IGNORE INTO users (name, email, password_hash, exam_preparing) VALUES (?, ?, ?, ?)')
        .run('Rahul', 'rahul@example.com', hash, 'JEE Advanced');
    console.log('  ✅ Sample user: rahul@example.com / password123');

    // Final summary
    const totalQ = db.prepare('SELECT COUNT(*) as cnt FROM questions').get().cnt;
    const totalMCQ = db.prepare("SELECT COUNT(*) as cnt FROM questions WHERE question_type = 'mcq'").get().cnt;
    const totalNAT = db.prepare("SELECT COUNT(*) as cnt FROM questions WHERE question_type = 'nat'").get().cnt;
    const totalTests = db.prepare('SELECT COUNT(*) as cnt FROM tests').get().cnt;
    const totalCh = db.prepare('SELECT COUNT(*) as cnt FROM chapters').get().cnt;

    console.log('\n══════════════════════════════');
    console.log(`📊 TOTAL: ${totalQ} questions (${totalMCQ} MCQ, ${totalNAT} NAT)`);
    console.log(`📖 ${totalCh} chapters across all subjects`);
    console.log(`📝 ${totalTests} tests generated`);
    console.log('══════════════════════════════\n');
    console.log('✅ Seeding complete!');
}

runSeed().catch(err => {
    console.error('Seeding failed:', err);
    process.exit(1);
});
