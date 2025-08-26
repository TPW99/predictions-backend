// --- THIS MUST BE THE VERY FIRST LINE ---
require('dotenv').config(); // This loads the .env file variables

// --- Import necessary packages ---
const express = require('express');
const cors =require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cron = require('node-cron');

// --- Create the Express App ---
const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));


// --- Authentication Middleware ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// --- Database Schemas ---
const ProphecySchema = new mongoose.Schema({
    winner: { type: String, default: '' },
    relegation: { type: [String], default: [] },
    goldenBoot: { type: String, default: '' },
    firstSacking: { type: String, default: '' }
});

const PredictionSchema = new mongoose.Schema({
    fixtureId: { type: mongoose.Schema.Types.ObjectId, ref: 'Fixture' },
    homeScore: { type: Number, required: true },
    awayScore: { type: Number, required: true }
});

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    score: { type: Number, default: 0 },
    predictions: [PredictionSchema],
    prophecies: ProphecySchema,
    chips: {
        jokerUsedInSeason: { type: Boolean, default: false },
        jokerFixtureId: { type: mongoose.Schema.Types.ObjectId, ref: 'Fixture', default: null }
    }
});

const FixtureSchema = new mongoose.Schema({
    theSportsDbId: { type: String, required: true, unique: true },
    gameweek: { type: Number, required: true },
    homeTeam: { type: String, required: true },
    awayTeam: { type: String, required: true },
    homeLogo: { type: String, required: true },
    awayLogo: { type: String, required: true },
    kickoffTime: { type: Date, required: true },
    isDerby: { type: Boolean, default: false },
    actualScore: {
        home: { type: Number, default: null },
        away: { type: Number, default: null }
    }
});

// --- Mongoose Models ---
const User = mongoose.model('User', UserSchema);
const Fixture = mongoose.model('Fixture', FixtureSchema);

// --- Helper Function for Scoring ---
const calculatePoints = (prediction, actualScore) => {
    if (prediction.homeScore === actualScore.home && prediction.awayScore === actualScore.away) return 3;
    if (Math.sign(prediction.homeScore - prediction.awayScore) === Math.sign(actualScore.home - actualScore.away)) return 1;
    return 0;
};

// --- Reusable Scoring Logic ---
const runScoringProcess = async () => {
    // ... (logic remains the same)
};


// --- API Endpoints ---
app.post('/api/auth/register', async (req, res) => {
    // ... (logic remains the same)
});
app.post('/api/auth/login', async (req, res) => {
    // ... (logic remains the same)
});
app.get('/api/user/me', authenticateToken, async (req, res) => {
    // ... (logic remains the same)
});
app.get('/api/fixtures/:gameweek?', async (req, res) => {
    // ... (logic remains the same)
});
app.get('/api/gameweeks', async (req, res) => {
    // ... (logic remains the same)
});
app.get('/api/leaderboard', async (req, res) => {
    // ... (logic remains the same)
});
app.post('/api/prophecies', authenticateToken, async (req, res) => {
    // ... (logic remains the same)
});
app.post('/api/predictions', authenticateToken, async (req, res) => {
    // ... (logic remains the same)
});
app.post('/api/admin/score-gameweek', authenticateToken, async (req, res) => {
    // ... (logic remains the same)
});

// --- Database Seeding with TheSportsDB API Data (Additive Logic) ---
const seedFixtures = async () => {
    try {
        const apiKey = process.env.THESPORTSDB_API_KEY;
        if (!apiKey) {
            console.log('THESPORTSDB_API_KEY not found in .env, skipping fixture seeding.');
            return;
        }

        console.log('Checking for missing fixtures from TheSportsDB...');

        const url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsseason.php?id=4328&s=2025-2026`;
        const response = await axios.get(url);

        const fixturesFromApi = response.data.events;
        if (!fixturesFromApi || fixturesFromApi.length === 0) {
            console.log('API returned 0 fixtures for the season.');
            return;
        }

        const existingFixtures = await Fixture.find({}, 'theSportsDbId');
        const existingIds = new Set(existingFixtures.map(f => f.theSportsDbId));

        const fixturesToAdd = fixturesFromApi.filter(f => !existingIds.has(f.idEvent));
        
        if (fixturesToAdd.length === 0) {
            console.log('Fixture list is already up to date.');
            return;
        }

        console.log(`Found ${fixturesToAdd.length} missing fixtures. Adding them to the database...`);
        
        const fixturesToSave = fixturesToAdd.map(f => {
            const kickoff = new Date(`${f.dateEvent}T${f.strTime}`);
            return {
                theSportsDbId: f.idEvent,
                gameweek: parseInt(f.intRound),
                homeTeam: f.strHomeTeam,
                awayTeam: f.strAwayTeam,
                homeLogo: f.strHomeTeamBadge || 'https://placehold.co/96x96/eee/ccc?text=?',
                awayLogo: f.strAwayTeamBadge || 'https://placehold.co/96x96/eee/ccc?text=?',
                kickoffTime: kickoff,
                isDerby: (f.strHomeTeam.includes("Man") && f.strAwayTeam.includes("Man")) || (f.strHomeTeam === "Liverpool" && f.strAwayTeam === "Everton")
            };
        });

        await Fixture.insertMany(fixturesToSave);
        console.log(`Successfully added ${fixturesToSave.length} new fixtures from TheSportsDB API.`);

    } catch (error) {
        console.error('Error in seedFixtures:');
        if (error.response) console.error('API Error:', error.response.data);
        else console.error('Error Message:', error.message);
    }
};

// --- Database Connection ---
mongoose.connect(process.env.DATABASE_URL, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        console.log('Successfully connected to MongoDB Atlas!');
        await seedFixtures();
        
        cron.schedule('0 3 * * *', () => {
            console.log('--- Triggering daily automated scoring job ---');
            runScoringProcess();
        }, {
            timezone: "Etc/UTC"
        });
        console.log('Automated scoring job scheduled to run daily at 03:00 UTC.');

        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        console.error('Error connecting to MongoDB Atlas:', error);
        console.error(error);
    });
