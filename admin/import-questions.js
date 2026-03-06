

 b/**
 * Import Questions Script
 * =========================
 * Reads a test config JSON file, scans question/solution image folders,
 * and creates everything in the database.
 *
 * Usage:
 *   node admin/import-questions.js admin/sample-test.json
 *
 * Folder structure expected:
 *   public/questions/<test-name>/1.png, 2.png, 3.png ...
 *   public/solutions/<test-name>/1.png, 2.png, 3.png ...  (optional)
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const initializeDB = require('../db/init');

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

function findImage(folder, number) {
    for (const ext of IMAGE_EXTENSIONS) {
        const filePath = path.join(folder, `${number}${ext}`);
        if (fs.existsSync(filePath)) {
            // Return web-accessible path (relative to public/)
            return '/' + path.relative(path.join(__dirname, '..', 'public'), filePath).replace(/\\/g, '/');
        }
    }
    return null;
}

async function importQuestions() {
    const configPath = process.argv[2];
    if (!configPath) {
        console.error('❌ Usage: node admin/import-questions.js <config.json>');
        console.error('   Example: node admin/import-questions.js admin/sample-test.json');
        process.exit(1);
    }

    const fullConfigPath = path.resolve(configPath);
    if (!fs.existsSync(fullConfigPath)) {
        console.error(`❌ Config file not found: ${fullConfigPath}`);
        process.exit(1);
    }

    const config = JSON.parse(fs.readFileSync(fullConfigPath, 'utf8'));
    const {
        test_title, exam, subject, topic, duration,
        test_type = 'topic_test', marks_per_question = 4,
        negative_marks = 0, difficulty = 'medium',
        questions_folder, solutions_folder,
        answers, tolerance = 0.01
    } = config;

    console.log(`\n📋 Importing: ${test_title}`);
    console.log(`   Exam: ${exam}, Subject: ${subject}, Topic: ${topic}`);
    console.log(`   Questions folder: ${questions_folder}`);
    console.log(`   Answers: ${answers.length} questions\n`);

    // Initialize DB
    await initializeDB();
    const db = require('../db/connection');

    // Resolve folders
    const qFolder = path.resolve(__dirname, '..', questions_folder);
    const sFolder = solutions_folder ? path.resolve(__dirname, '..', solutions_folder) : null;

    if (!fs.existsSync(qFolder)) {
        console.error(`❌ Questions folder not found: ${qFolder}`);
        console.error(`   Create it and add image files: 1.png, 2.png, ...`);
        process.exit(1);
    }

    // Get or create exam
    let examRow = db.prepare('SELECT id FROM exams WHERE name = ?').get(exam);
    if (!examRow) {
        console.log(`   Creating exam: ${exam}`);
        const res = db.prepare('INSERT INTO exams (name, duration, total_marks, negative_marking) VALUES (?, ?, ?, ?)').run(exam, 180, 300, negative_marks);
        examRow = { id: res.lastInsertRowid };
    }

    // Get or create subject
    let subjectRow = db.prepare('SELECT id FROM subjects WHERE name = ? AND exam_id = ?').get(subject, examRow.id);
    if (!subjectRow) {
        console.log(`   Creating subject: ${subject}`);
        const res = db.prepare('INSERT INTO subjects (exam_id, name) VALUES (?, ?)').run(examRow.id, subject);
        subjectRow = { id: res.lastInsertRowid };
    }

    // Get or create topic
    let topicRow = db.prepare('SELECT id FROM topics WHERE name = ? AND subject_id = ?').get(topic, subjectRow.id);
    if (!topicRow) {
        console.log(`   Creating topic: ${topic}`);
        const res = db.prepare('INSERT INTO topics (subject_id, name, description) VALUES (?, ?, ?)').run(subjectRow.id, topic, `${topic} — ${subject}`);
        topicRow = { id: res.lastInsertRowid };
    }

    // Import questions in a transaction
    const importAll = db.transaction(() => {
        const questionIds = [];

        for (const entry of answers) {
            const num = entry.question;
            const correctAnswer = entry.answer;

            const imageUrl = findImage(qFolder, num);
            if (!imageUrl) {
                console.warn(`   ⚠️  No image found for question ${num} in ${qFolder}`);
            }

            const solutionUrl = sFolder ? findImage(sFolder, num) : null;

            const res = db.prepare(`
                INSERT INTO questions (exam_id, subject_id, topic_id, question_type, difficulty,
                    question_text, image_url, correct_answer_numeric, answer_tolerance,
                    solution_image_url, explanation, marks, negative_marks)
                VALUES (?, ?, ?, 'nat', ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                examRow.id, subjectRow.id, topicRow.id,
                difficulty,
                `Question ${num}`,              // fallback text
                imageUrl,
                correctAnswer,
                tolerance,
                solutionUrl,
                null,                           // explanation (can be added later)
                marks_per_question,
                negative_marks
            );

            questionIds.push({ num, id: res.lastInsertRowid, imageUrl, solutionUrl });
            console.log(`   ✅ Q${num}: answer=${correctAnswer} image=${imageUrl || 'MISSING'} solution=${solutionUrl || 'none'}`);
        }

        // Create the test
        const testRes = db.prepare(`
            INSERT INTO tests (exam_id, title, duration, total_questions, test_type)
            VALUES (?, ?, ?, ?, ?)
        `).run(examRow.id, test_title, duration, questionIds.length, test_type);

        const testId = testRes.lastInsertRowid;

        // Map questions to test
        for (let i = 0; i < questionIds.length; i++) {
            db.prepare('INSERT INTO test_questions (test_id, question_id, question_order) VALUES (?, ?, ?)').run(
                testId, questionIds[i].id, i + 1
            );
        }

        return { testId, count: questionIds.length };
    });

    const result = importAll();
    console.log(`\n✅ Test created successfully!`);
    console.log(`   Test ID: ${result.testId}`);
    console.log(`   Title: ${test_title}`);
    console.log(`   Questions: ${result.count}`);
    console.log(`\n🚀 Start the server with: node server.js`);
}

importQuestions().catch(err => {
    console.error('❌ Import failed:', err.message);
    process.exit(1);
});
