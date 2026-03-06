require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const initializeDB = require('./db/init');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Serve question-bank images (question & solution images)
app.use('/question-bank', express.static(path.join(__dirname, 'question-bank')));
// Serve Irodov question/answer images
app.use('/irodov_qa_separated', express.static(path.join(__dirname, 'irodov_qa_separated')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/exams', require('./routes/exams'));
app.use('/api/tests', require('./routes/tests'));
app.use('/api/test', require('./routes/testTaking'));
app.use('/api/analysis', require('./routes/analysis'));
app.use('/api/study-material', require('./routes/studyMaterial'));
app.use('/api/question-bank', require('./routes/questionBank'));

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all for SPA routes
app.get('/app/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

// Initialize DB then start server
initializeDB().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Test Series server running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
