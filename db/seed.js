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
    const setupBase = db.transaction(async (txDb) => {
        await txDb.exec('DELETE FROM study_materials');
        await txDb.exec('DELETE FROM topic_performance');
        await txDb.exec('DELETE FROM user_answers');
        await txDb.exec('DELETE FROM test_attempts');
        await txDb.exec('DELETE FROM test_questions');
        await txDb.exec('DELETE FROM tests');
        await txDb.exec('DELETE FROM question_options');
        await txDb.exec('DELETE FROM questions');
        await txDb.exec('DELETE FROM topics');
        await txDb.exec('DELETE FROM chapters');
        await txDb.exec('DELETE FROM subjects');
        await txDb.exec('DELETE FROM exams');
        await txDb.exec('DELETE FROM users');

        await txDb.prepare('INSERT INTO exams (name, code, duration, total_marks, negative_marking) VALUES (?, ?, ?, ?, ?)')
            .run('JEE Advanced', 'jee', 180, 300, 1);
        await txDb.prepare('INSERT INTO exams (name, code, duration, total_marks, negative_marking) VALUES (?, ?, ?, ?, ?)')
            .run('NEET', 'neet', 180, 720, 1);
        await txDb.prepare('INSERT INTO exams (name, code, duration, total_marks, negative_marking) VALUES (?, ?, ?, ?, ?)')
            .run('GATE CS', 'gate-cs', 180, 100, 0.33);

        console.log('  ✅ Exams: 3 (JEE Advanced, NEET, GATE CS)');
    });
    await setupBase();

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
    const createTests = db.transaction(async (txDb) => {
        const jeeExam = await txDb.prepare("SELECT id FROM exams WHERE code = 'jee'").get();
        if (!jeeExam) return;
        const jeeId = jeeExam.id;

        const insertTest = txDb.prepare(
            'INSERT INTO tests (exam_id, title, duration, total_questions, test_type, generation_config) VALUES (?, ?, ?, ?, ?, ?)'
        );
        const insertTestQ = txDb.prepare(
            'INSERT INTO test_questions (test_id, question_id, question_order) VALUES (?, ?, ?)'
        );

        const allQ = await txDb.prepare('SELECT id FROM questions WHERE exam_id = ? ORDER BY RANDOM()').all(jeeId);
        const mcqQ = await txDb.prepare("SELECT id FROM questions WHERE exam_id = ? AND question_type = 'mcq' ORDER BY RANDOM()").all(jeeId);
        const natQ = await txDb.prepare("SELECT id FROM questions WHERE exam_id = ? AND question_type = 'nat' ORDER BY RANDOM()").all(jeeId);

        if (allQ.length === 0) {
            console.log('  ⚠️  No JEE questions found — skipping test creation');
            return;
        }

        let testCount = 0;

        // Test 1: Full Mock
        const t1 = (await insertTest.run(jeeId, 'JEE Advanced Full Mock 1', 180, allQ.length, 'full_mock',
            JSON.stringify({ type: 'all', source: 'question-bank' }))).lastInsertRowid;
        for (let i = 0; i < allQ.length; i++) await insertTestQ.run(t1, allQ[i].id, i + 1);
        testCount++;

        // Test 2: Per-subject tests
        const subjects = await txDb.prepare('SELECT id, name FROM subjects WHERE exam_id = ?').all(jeeId);
        for (const sub of subjects) {
            const subQ = await txDb.prepare('SELECT id FROM questions WHERE subject_id = ? ORDER BY RANDOM()').all(sub.id);
            if (subQ.length > 0) {
                const t = (await insertTest.run(jeeId, `${sub.name} Subject Test`, 60, subQ.length, 'subject_test',
                    JSON.stringify({ subject_id: sub.id }))).lastInsertRowid;
                for (let i = 0; i < subQ.length; i++) await insertTestQ.run(t, subQ[i].id, i + 1);
                testCount++;
            }
        }

        // Test 3: NAT-only test
        if (natQ.length >= 5) {
            const t = (await insertTest.run(jeeId, 'JEE Numerical (NAT) Practice', 90, natQ.length, 'full_mock',
                JSON.stringify({ type: 'nat_only' }))).lastInsertRowid;
            for (let i = 0; i < natQ.length; i++) await insertTestQ.run(t, natQ[i].id, i + 1);
            testCount++;
        }

        // Test 4: Mixed MCQ + NAT
        if (mcqQ.length >= 5 && natQ.length >= 3) {
            const mixed = [...mcqQ.slice(0, 10), ...natQ.slice(0, 8)].sort(() => Math.random() - 0.5);
            const t = (await insertTest.run(jeeId, 'JEE Mixed MCQ + NAT Mock', 120, mixed.length, 'full_mock',
                JSON.stringify({ type: 'mixed' }))).lastInsertRowid;
            for (let i = 0; i < mixed.length; i++) await insertTestQ.run(t, mixed[i].id, i + 1);
            testCount++;
        }

        // Test 5: Per-chapter tests
        const chapters = await txDb.prepare(`
            SELECT c.id, c.name, c.chapter_number, s.name as subject_name
            FROM chapters c JOIN subjects s ON c.subject_id = s.id
            WHERE s.exam_id = ?
            ORDER BY s.name, c.chapter_number
        `).all(jeeId);

        for (const ch of chapters) {
            const chQ = await txDb.prepare('SELECT id FROM questions WHERE chapter_id = ? ORDER BY RANDOM()').all(ch.id);
            if (chQ.length >= 3) {
                const t = (await insertTest.run(jeeId, `${ch.subject_name}: ${ch.name} Test`, 30, chQ.length, 'chapter_test',
                    JSON.stringify({ chapter_id: ch.id }))).lastInsertRowid;
                for (let i = 0; i < chQ.length; i++) await insertTestQ.run(t, chQ[i].id, i + 1);
                testCount++;
            }
        }

        console.log(`\n  ✅ Tests created: ${testCount}`);
    });
    await createTests();

    // ═══════════════════════════════════════
    // 4. Study Materials
    // ═══════════════════════════════════════
    const addMaterials = db.transaction(async (txDb) => {
        const topics = await txDb.prepare(`
            SELECT t.id as topic_id, c.id as chapter_id, t.name, s.name as subject_name
            FROM topics t
            LEFT JOIN chapters c ON t.chapter_id = c.id
            JOIN subjects s ON t.subject_id = s.id
        `).all();

        const insertMat = txDb.prepare(
            'INSERT INTO study_materials (topic_id, chapter_id, title, content_type, content_url, description) VALUES (?, ?, ?, ?, ?, ?)'
        );

        let matCount = 0;
        for (const t of topics) {
            await insertMat.run(t.topic_id, t.chapter_id, `${t.name} Complete Notes`, 'notes',
                `/materials/${t.name.toLowerCase().replace(/\s+/g, '-')}-notes.pdf`,
                `Comprehensive notes for ${t.name}`);
            await insertMat.run(t.topic_id, t.chapter_id, `${t.name} Video Lecture`, 'video',
                `https://youtube.com/example-${t.name.toLowerCase().replace(/\s+/g, '-')}`,
                `Full video lecture on ${t.name}`);
            await insertMat.run(t.topic_id, t.chapter_id, `${t.name} Practice Problems`, 'practice_set',
                `/materials/${t.name.toLowerCase().replace(/\s+/g, '-')}-practice.pdf`,
                `Practice problems for ${t.name}`);
            matCount += 3;
        }

        console.log(`  ✅ Study materials: ${matCount}`);
    });
    await addMaterials();

    // ═══════════════════════════════════════
    // 5. Sample User
    // ═══════════════════════════════════════
    const hash = bcrypt.hashSync('password123', 10);
    await db.prepare('INSERT INTO users (name, email, password_hash, exam_preparing) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING')
        .run('Rahul', 'rahul@example.com', hash, 'JEE Advanced');
    console.log('  ✅ Sample user: rahul@example.com / password123');

    // Final summary
    const totalQ = (await db.prepare('SELECT COUNT(*) as cnt FROM questions').get()).cnt;
    const totalMCQ = (await db.prepare("SELECT COUNT(*) as cnt FROM questions WHERE question_type = 'mcq'").get()).cnt;
    const totalNAT = (await db.prepare("SELECT COUNT(*) as cnt FROM questions WHERE question_type = 'nat'").get()).cnt;
    const totalTests = (await db.prepare('SELECT COUNT(*) as cnt FROM tests').get()).cnt;
    const totalCh = (await db.prepare('SELECT COUNT(*) as cnt FROM chapters').get()).cnt;

    console.log('\n══════════════════════════════');
    console.log(`📊 TOTAL: ${totalQ} questions (${totalMCQ} MCQ, ${totalNAT} NAT)`);
    console.log(`📖 ${totalCh} chapters across all subjects`);
    console.log(`📝 ${totalTests} tests generated`);
    console.log('══════════════════════════════\n');
    console.log('✅ Seeding complete!');

    // Close pool
    db.pool.end();
}

runSeed().catch(err => {
    console.error('Seeding failed:', err);
    process.exit(1);
});
