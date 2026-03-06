/**
 * Question Bank Scanner & Importer
 * 
 * Scans the question-bank/ folder tree and imports questions into the database.
 * 
 * Expected folder structure:
 *   question-bank/
 *     {exam-code}/                     (e.g. jee, neet, gate-cs)
 *       {subject}/                     (e.g. Physics, Chemistry, Mathematics)
 *         {nn-chapter-name}/           (e.g. 01-Mechanics, 02-Electrostatics)
 *           questions/                 (question images: q001.png, q002.jpg, ...)
 *           solutions/                 (solution images: q001.png, q002.jpg, ...)
 *           metadata.json              (describes each question)
 * 
 * metadata.json format:
 * {
 *   "chapter_description": "Newton's laws, friction, energy",
 *   "default_marks": 4,
 *   "default_negative_marks": 1,
 *   "questions": [
 *     {
 *       "file": "q001.png",           // image filename in questions/ folder
 *       "type": "mcq",                // "mcq" or "nat"
 *       "difficulty": "medium",        // "easy", "medium", "hard"
 *       "text": "Optional text version of the question",
 *       "explanation": "Explanation for the solution",
 *       "marks": 4,                   // override default
 *       "negative_marks": 1,          // override default
 *       "tags": "newton,force,acceleration",
 *       "options": [                  // MCQ only
 *         { "label": "A", "text": "4 m/s²", "correct": true },
 *         { "label": "B", "text": "2 m/s²" },
 *         { "label": "C", "text": "8 m/s²" },
 *         { "label": "D", "text": "1 m/s²" }
 *       ],
 *       "answer": 30,                // NAT only — correct numeric answer
 *       "tolerance": 0.01            // NAT only — allowed error
 *     }
 *   ]
 * }
 * 
 * Usage:
 *   node admin/scan-question-bank.js                  # scan & import all
 *   node admin/scan-question-bank.js --exam jee       # import only JEE
 *   node admin/scan-question-bank.js --dry-run        # preview without importing
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BANK_DIR = path.join(__dirname, '..', 'question-bank');
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

// ═══════════════════════════════════════
// SCANNER — reads folder tree
// ═══════════════════════════════════════
function scanQuestionBank(examFilter = null) {
    if (!fs.existsSync(BANK_DIR)) {
        console.error(`❌ question-bank/ folder not found at: ${BANK_DIR}`);
        console.log('   Create the folder and add your questions. See README for structure.');
        process.exit(1);
    }

    const bank = [];
    const examDirs = fs.readdirSync(BANK_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .filter(d => !examFilter || d.name.toLowerCase() === examFilter.toLowerCase());

    for (const examDir of examDirs) {
        const examCode = examDir.name;
        const examPath = path.join(BANK_DIR, examCode);

        const subjectDirs = fs.readdirSync(examPath, { withFileTypes: true })
            .filter(d => d.isDirectory());

        for (const subjectDir of subjectDirs) {
            const subjectName = subjectDir.name;
            const subjectPath = path.join(examPath, subjectName);

            const chapterDirs = fs.readdirSync(subjectPath, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

            for (const chapterDir of chapterDirs) {
                const chapterFolder = chapterDir.name;
                const chapterPath = path.join(subjectPath, chapterFolder);

                // Parse chapter number and name from folder (e.g. "01-Mechanics" → 1, "Mechanics")
                const match = chapterFolder.match(/^(\d+)-(.+)$/);
                const chapterNum = match ? parseInt(match[1]) : 0;
                const chapterName = match ? match[2].replace(/-/g, ' ') : chapterFolder;

                // Read metadata.json
                const metaPath = path.join(chapterPath, 'metadata.json');
                let metadata = { questions: [] };
                if (fs.existsSync(metaPath)) {
                    try {
                        metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                    } catch (e) {
                        console.warn(`⚠️  Invalid metadata.json in ${chapterFolder}: ${e.message}`);
                    }
                }

                // Scan question images
                const questionsDir = path.join(chapterPath, 'questions');
                const solutionsDir = path.join(chapterPath, 'solutions');

                let questionFiles = [];
                if (fs.existsSync(questionsDir)) {
                    questionFiles = fs.readdirSync(questionsDir)
                        .filter(f => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
                        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
                }

                // Map metadata questions by filename
                const metaMap = {};
                if (metadata.questions) {
                    for (const q of metadata.questions) {
                        metaMap[q.file] = q;
                    }
                }

                // Build questions list
                const questions = [];
                for (const qFile of questionFiles) {
                    const baseName = path.parse(qFile).name;
                    const meta = metaMap[qFile] || {};

                    // Check for solution image
                    let solutionFile = null;
                    if (fs.existsSync(solutionsDir)) {
                        const solMatch = fs.readdirSync(solutionsDir)
                            .find(f => path.parse(f).name === baseName);
                        if (solMatch) solutionFile = solMatch;
                    }

                    questions.push({
                        file: qFile,
                        imagePath: `/question-bank/${examCode}/${subjectName}/${chapterFolder}/questions/${qFile}`,
                        solutionPath: solutionFile
                            ? `/question-bank/${examCode}/${subjectName}/${chapterFolder}/solutions/${solutionFile}`
                            : null,
                        type: meta.type || 'mcq',
                        difficulty: meta.difficulty || 'medium',
                        text: meta.text || null,
                        explanation: meta.explanation || null,
                        marks: meta.marks || metadata.default_marks || 4,
                        negative_marks: meta.negative_marks || metadata.default_negative_marks || 1,
                        tags: meta.tags || null,
                        options: meta.options || null,
                        answer: meta.answer !== undefined ? meta.answer : null,
                        tolerance: meta.tolerance || 0,
                        sourceFolder: `${examCode}/${subjectName}/${chapterFolder}`,
                    });
                }

                // Also add text-only questions from metadata that don't have images
                if (metadata.questions) {
                    for (const mq of metadata.questions) {
                        if (mq.file && questionFiles.includes(mq.file)) continue; // already added
                        if (!mq.file && mq.text) {
                            // Text-only question
                            questions.push({
                                file: null,
                                imagePath: null,
                                solutionPath: null,
                                type: mq.type || 'mcq',
                                difficulty: mq.difficulty || 'medium',
                                text: mq.text,
                                explanation: mq.explanation || null,
                                marks: mq.marks || metadata.default_marks || 4,
                                negative_marks: mq.negative_marks || metadata.default_negative_marks || 1,
                                tags: mq.tags || null,
                                options: mq.options || null,
                                answer: mq.answer !== undefined ? mq.answer : null,
                                tolerance: mq.tolerance || 0,
                                sourceFolder: `${examCode}/${subjectName}/${chapterFolder}`,
                            });
                        }
                    }
                }

                bank.push({
                    examCode,
                    subjectName,
                    chapterNum,
                    chapterName,
                    chapterFolder,
                    chapterDescription: metadata.chapter_description || '',
                    questions,
                });
            }
        }
    }

    return bank;
}

// ═══════════════════════════════════════
// IMPORTER — writes to database
// ═══════════════════════════════════════
async function importToDatabase(bank, dryRun = false) {
    const initializeDB = require('../db/init');
    await initializeDB();
    const db = require('../db/connection');

    let stats = { exams: 0, subjects: 0, chapters: 0, questions: 0, options: 0, skipped: 0 };

    const importAll = db.transaction(() => {
        // Exam code → id cache
        const examCache = {};
        const subjectCache = {};
        const chapterCache = {};

        for (const entry of bank) {
            // Ensure exam exists
            const examKey = entry.examCode;
            if (!examCache[examKey]) {
                let exam = db.prepare('SELECT id FROM exams WHERE code = ?').get(examKey);
                if (!exam) {
                    // Create exam with sensible defaults
                    const examName = examKey.toUpperCase().replace(/-/g, ' ');
                    const id = db.prepare('INSERT INTO exams (name, code, duration, total_marks, negative_marking) VALUES (?, ?, ?, ?, ?)')
                        .run(examName, examKey, 180, 300, 1).lastInsertRowid;
                    examCache[examKey] = id;
                    stats.exams++;
                    console.log(`  📝 Created exam: ${examName} (code: ${examKey})`);
                } else {
                    examCache[examKey] = exam.id;
                }
            }
            const examId = examCache[examKey];

            // Ensure subject exists
            const subKey = `${examKey}:${entry.subjectName}`;
            if (!subjectCache[subKey]) {
                const subCode = entry.subjectName.toLowerCase().replace(/\s+/g, '-');
                let sub = db.prepare('SELECT id FROM subjects WHERE exam_id = ? AND name = ?').get(examId, entry.subjectName);
                if (!sub) {
                    const id = db.prepare('INSERT INTO subjects (exam_id, name, code) VALUES (?, ?, ?)')
                        .run(examId, entry.subjectName, subCode).lastInsertRowid;
                    subjectCache[subKey] = id;
                    stats.subjects++;
                    console.log(`  📚 Created subject: ${entry.subjectName}`);
                } else {
                    subjectCache[subKey] = sub.id;
                }
            }
            const subjectId = subjectCache[subKey];

            // Ensure chapter exists
            const chapKey = `${subKey}:${entry.chapterNum}`;
            if (!chapterCache[chapKey]) {
                let chap = db.prepare('SELECT id FROM chapters WHERE subject_id = ? AND chapter_number = ?').get(subjectId, entry.chapterNum);
                if (!chap) {
                    const id = db.prepare('INSERT INTO chapters (subject_id, chapter_number, name, description, folder_name) VALUES (?, ?, ?, ?, ?)')
                        .run(subjectId, entry.chapterNum, entry.chapterName, entry.chapterDescription, entry.chapterFolder).lastInsertRowid;
                    chapterCache[chapKey] = id;
                    stats.chapters++;

                    // Also create legacy topic entry
                    db.prepare('INSERT INTO topics (subject_id, chapter_id, name, description) VALUES (?, ?, ?, ?)')
                        .run(subjectId, id, entry.chapterName, entry.chapterDescription);
                } else {
                    chapterCache[chapKey] = chap.id;
                }
            }
            const chapterId = chapterCache[chapKey];

            // Get linked topic_id
            const topic = db.prepare('SELECT id FROM topics WHERE chapter_id = ?').get(chapterId);
            const topicId = topic ? topic.id : null;

            // Import questions
            for (const q of entry.questions) {
                // Check if already imported (by source_folder + source_file)
                if (q.file) {
                    const existing = db.prepare('SELECT id FROM questions WHERE source_folder = ? AND source_file = ?')
                        .get(q.sourceFolder, q.file);
                    if (existing) {
                        stats.skipped++;
                        continue;
                    }
                }

                const qId = db.prepare(`
                    INSERT INTO questions (exam_id, subject_id, chapter_id, topic_id,
                        question_type, difficulty, question_text, image_url,
                        correct_answer_numeric, answer_tolerance, solution_image_url,
                        explanation, marks, negative_marks, source_folder, source_file, tags)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    examId, subjectId, chapterId, topicId,
                    q.type, q.difficulty, q.text, q.imagePath,
                    q.answer, q.tolerance, q.solutionPath,
                    q.explanation, q.marks, q.negative_marks,
                    q.sourceFolder, q.file, q.tags
                ).lastInsertRowid;

                stats.questions++;

                // Insert MCQ options
                if (q.type === 'mcq' && q.options) {
                    const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
                    for (let i = 0; i < q.options.length; i++) {
                        const opt = q.options[i];
                        db.prepare('INSERT INTO question_options (question_id, option_label, option_text, option_image_url, is_correct) VALUES (?, ?, ?, ?, ?)')
                            .run(qId, opt.label || labels[i], opt.text || null, opt.image || null, opt.correct ? 1 : 0);
                        stats.options++;
                    }
                }
            }
        }
    });

    if (dryRun) {
        // Just show what would happen
        console.log('\n🔍 DRY RUN — no changes made:\n');
        for (const entry of bank) {
            console.log(`  ${entry.examCode} / ${entry.subjectName} / Ch${entry.chapterNum}: ${entry.chapterName}`);
            console.log(`    → ${entry.questions.length} questions`);
        }
        const total = bank.reduce((s, e) => s + e.questions.length, 0);
        console.log(`\n  Total: ${bank.length} chapters, ${total} questions`);
    } else {
        importAll();
        console.log('\n✅ Import complete:');
        console.log(`  📝 Exams created: ${stats.exams}`);
        console.log(`  📚 Subjects created: ${stats.subjects}`);
        console.log(`  📖 Chapters created: ${stats.chapters}`);
        console.log(`  ❓ Questions imported: ${stats.questions}`);
        console.log(`  🔘 Options created: ${stats.options}`);
        if (stats.skipped > 0) {
            console.log(`  ⏭️  Skipped (already imported): ${stats.skipped}`);
        }
    }

    return stats;
}

// ═══════════════════════════════════════
// CLI
// ═══════════════════════════════════════
if (require.main === module) {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const examIdx = args.indexOf('--exam');
    const examFilter = examIdx >= 0 ? args[examIdx + 1] : null;

    console.log('🔍 Scanning question bank...\n');
    const bank = scanQuestionBank(examFilter);

    if (bank.length === 0) {
        console.log('No chapters found. Make sure question-bank/ folder has the right structure.');
        console.log('\nExpected: question-bank/{exam}/{subject}/{nn-chapter-name}/questions/');
        process.exit(0);
    }

    // Show summary
    for (const entry of bank) {
        const imgCount = entry.questions.filter(q => q.imagePath).length;
        const txtCount = entry.questions.filter(q => !q.imagePath).length;
        console.log(`  📖 ${entry.examCode} → ${entry.subjectName} → Ch${entry.chapterNum}: ${entry.chapterName} (${entry.questions.length} Q: ${imgCount} images, ${txtCount} text)`);
    }

    importToDatabase(bank, dryRun).catch(err => {
        console.error('❌ Import failed:', err);
        process.exit(1);
    });
}

module.exports = { scanQuestionBank, importToDatabase };
