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

// --- Reusable Scoring Logic (More Robust Version) ---
const runScoringProcess = async () => {
    console.log('Running scoring process...');
    try {
        const apiKey = process.env.THESPORTSDB_API_KEY;
        if (!apiKey) return { success: false, message: 'API key not found.' };

        const fixturesToScore = await Fixture.find({ 
            kickoffTime: { $lt: new Date() }, 
            'actualScore.home': null 
        });

        if (fixturesToScore.length === 0) {
            console.log('No new fixtures to score.');
            return { success: true, message: 'No new fixtures to score.' };
        }
        console.log(`Found ${fixturesToScore.length} fixtures to score.`);

        // Determine the gameweek to fetch results for
        const gameweekToFetch = fixturesToScore[0].gameweek;
        console.log(`Fetching results for Gameweek ${gameweekToFetch}...`);

        const resultsUrl = `https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsround.php?id=4328&r=${gameweekToFetch}`;
        const resultsResponse = await axios.get(resultsUrl);
        const latestResults = resultsResponse.data.events;

        if (!latestResults) return { success: false, message: 'Could not fetch latest results.' };
        
        const resultsMap = new Map(latestResults.map(r => [r.idEvent, r]));
        let scoredFixturesCount = 0;

        for (const fixture of fixturesToScore) {
            const result = resultsMap.get(fixture.theSportsDbId);
            if (result && result.intHomeScore != null && result.intAwayScore != null) {
                fixture.actualScore = {
                    home: parseInt(result.intHomeScore),
                    away: parseInt(result.intAwayScore)
                };
                await fixture.save();
                scoredFixturesCount++;
            }
        }

        if (scoredFixturesCount === 0) {
            console.log('No matching results found for fixtures needing scores.');
            return { success: true, message: 'No results to score yet.' };
        }

        console.log(`Updated ${scoredFixturesCount} fixtures with actual scores. Now calculating user points...`);
        
        const allUsers = await User.find({});
        for (const user of allUsers) {
            let userGameweekScore = 0;
            const updatedFixtures = await Fixture.find({ theSportsDbId: { $in: fixturesToScore.map(f => f.theSportsDbId) } });
            
            for (const prediction of user.predictions) {
                const fixture = updatedFixtures.find(f => f._id.equals(prediction.fixtureId));
                if (fixture && fixture.actualScore.home !== null) {
                    let points = calculatePoints(prediction, fixture.actualScore);
                    if (fixture.isDerby) points *= 2;
                    if (user.chips.jokerFixtureId && user.chips.jokerFixtureId.equals(fixture._id)) points *= 2;
                    userGameweekScore += points;
                }
            }
            
            if (userGameweekScore > 0) {
                user.score += userGameweekScore;
                await user.save();
                console.log(`Updated score for ${user.name}. New total: ${user.score}`);
            }
        }

        console.log(`Scoring complete. ${scoredFixturesCount} fixtures and ${allUsers.length} users processed.`);
        return { success: true, message: `${scoredFixturesCount} fixtures scored successfully.` };

    } catch (error) {
        console.error('Error during scoring process:', error);
        return { success: false, message: 'An error occurred during scoring.' };
    }
};


// --- API Endpoints ---

// Auth Routes...
app.post('/api/auth/register', async (req, res) => {
    // Implementation from previous steps
});
app.post('/api/auth/login', async (req, res) => {
    // Implementation from previous steps
});
app.get('/api/user/me', authenticateToken, async (req, res) => {
    // Implementation from previous steps
});

// Game Data Routes...
app.get('/api/fixtures/:gameweek?', async (req, res) => {
    try {
        let gameweekToFetch;
        if (req.params.gameweek) {
            gameweekToFetch = parseInt(req.params.gameweek);
        } else {
            const upcomingFixture = await Fixture.findOne({ kickoffTime: { $gte: new Date() } }).sort({ kickoffTime: 1 });
            if (upcomingFixture) {
                gameweekToFetch = upcomingFixture.gameweek;
            } else {
                const lastFixture = await Fixture.findOne().sort({ gameweek: -1 });
                gameweekToFetch = lastFixture ? lastFixture.gameweek : 1;
            }
        }
        
        const fixtures = await Fixture.find({ gameweek: gameweekToFetch }).sort({ kickoffTime: 1 });
        res.json({ fixtures, gameweek: gameweekToFetch });

    } catch (error) {
        res.status(500).json({ message: 'Error fetching fixtures' });
    }
});
app.get('/api/gameweeks', async (req, res) => {
    try {
        const gameweeks = await Fixture.distinct('gameweek');
        res.json(gameweeks.sort((a, b) => a - b));
    } catch (error) {
        res.status(500).json({ message: 'Error fetching gameweeks' });
    }
});
app.get('/api/leaderboard', async (req, res) => {
    // Implementation from previous steps
});
app.post('/api/prophecies', authenticateToken, async (req, res) => {
    // Implementation from previous steps
});
app.post('/api/predictions', authenticateToken, async (req, res) => {
    // Implementation from previous steps
});

// Admin Route for Scoring (can still be used for manual testing)
app.post('/api/admin/score-gameweek', authenticateToken, async (req, res) => {
    const result = await runScoringProcess();
    if (result.success) {
        res.status(200).json(result);
    } else {
        res.status(500).json(result);
    }
});

// --- Database Seeding with TheSportsDB API Data ---
const seedFixtures = async () => {
    try {
        const apiKey = process.env.THESPORTSDB_API_KEY;
        if (!apiKey) {
            console.log('THESPORTSDB_API_KEY not found in .env, skipping fixture seeding.');
            return;
        }
        
        const fixtureCount = await Fixture.countDocuments();
        if (fixtureCount > 0) {
            console.log('Database already contains fixtures. Skipping seed.');
            return;
        }

        console.log('Fetching live fixtures from TheSportsDB...');

        const url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsseason.php?id=4328&s=2025-2026`;
        const response = await axios.get(url);

        const fixturesFromApi = response.data.events;
        if (!fixturesFromApi || fixturesFromApi.length === 0) {
            console.log('API returned 0 fixtures for the season.');
            return;
        }
        
        const fixturesToSave = fixturesFromApi.map(f => {
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
        console.log(`Successfully seeded ${fixturesToSave.length} fixtures from TheSportsDB API.`);

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
