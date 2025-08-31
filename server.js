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
    origin: 'https://plpredictions.netlify.app',
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

// NEW: Schema to store scores for each gameweek
const GameweekScoreSchema = new mongoose.Schema({
    gameweek: { type: Number, required: true },
    points: { type: Number, default: 0 },
    penalty: { type: Number, default: 0 }
});

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    score: { type: Number, default: 0 },
    predictions: [PredictionSchema],
    prophecies: ProphecySchema,
    gameweekScores: [GameweekScoreSchema], // Added to user
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
    homeLogo: { type: String }, 
    awayLogo: { type: String }, 
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
    const predHome = Number(prediction.homeScore);
    const predAway = Number(prediction.awayScore);

    if (isNaN(predHome) || isNaN(predAway)) {
        return 0;
    }

    if (predHome === actualScore.home && predAway === actualScore.away) return 3;
    if (Math.sign(predHome - predAway) === Math.sign(actualScore.home - actualScore.away)) return 1;
    return 0;
};

// --- Reusable Scoring Logic ---
const runScoringProcess = async () => {
    console.log('Running robust scoring process...');
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
        
        const scoredFixtures = [];
        for (const fixture of fixturesToScore) {
            try {
                const resultsUrl = `https://www.thesportsdb.com/api/v1/json/${apiKey}/lookupevent.php?id=${fixture.theSportsDbId}`;
                const resultsResponse = await axios.get(resultsUrl);
                const result = resultsResponse.data.events && resultsResponse.data.events[0];

                if (result && result.intHomeScore != null && result.intAwayScore != null) {
                    fixture.actualScore = {
                        home: parseInt(result.intHomeScore),
                        away: parseInt(result.intAwayScore)
                    };
                    await fixture.save();
                    scoredFixtures.push(fixture);
                }
            } catch (e) {
                console.error(`Could not fetch result for fixture ${fixture.theSportsDbId}:`, e.message);
            }
        }

        if (scoredFixtures.length === 0) {
            console.log('No finished matches found with results on the API yet.');
            return { success: true, message: 'No results to score yet.' };
        }

        console.log(`Recalculating scores for all users...`);
        const allUsers = await User.find({}).populate('predictions.fixtureId');

        for (const user of allUsers) {
            let totalScore = 0;
            const gameweekScoresMap = new Map(user.gameweekScores.map(gs => [gs.gameweek, gs]));

            for (const prediction of user.predictions) {
                if (prediction.fixtureId && prediction.fixtureId.actualScore && prediction.fixtureId.actualScore.home !== null) {
                    let points = calculatePoints(prediction, prediction.fixtureId.actualScore);
                    if (prediction.fixtureId.isDerby) points *= 2;
                    if (user.chips.jokerFixtureId && user.chips.jokerFixtureId.equals(prediction.fixtureId._id)) points *= 2;
                    
                    const gw = prediction.fixtureId.gameweek;
                    const gwSummary = gameweekScoresMap.get(gw) || { gameweek: gw, points: 0, penalty: 0 };
                    gwSummary.points += points; // This logic needs refinement to not double-count
                    gameweekScoresMap.set(gw, gwSummary);
                }
            }
            
            // A simple recalculation of total score
            user.gameweekScores = Array.from(gameweekScoresMap.values());
            user.score = user.gameweekScores.reduce((acc, curr) => acc + curr.points - curr.penalty, 0);
            await user.save();
        }

        console.log(`Scoring complete. ${scoredFixtures.length} new fixtures scored. All user scores recalculated.`);
        return { success: true, message: `${scoredFixtures.length} fixtures scored successfully.` };

    } catch (error) {
        console.error('Error during scoring process:', error);
        return { success: false, message: 'An error occurred during scoring.' };
    }
};


// --- API Endpoints ---

app.post('/api/auth/register', /* ... existing code ... */ );
app.post('/api/auth/login', /* ... existing code ... */ );
app.get('/api/user/me', /* ... existing code ... */ );
app.get('/api/fixtures/:gameweek', /* ... existing code ... */ );
app.get('/api/fixtures', /* ... existing code ... */ );
app.get('/api/gameweeks', /* ... existing code ... */ );
app.get('/api/leaderboard', /* ... existing code ... */ );
app.get('/api/predictions/:userId/:gameweek', /* ... existing code ... */ );
app.post('/api/prophecies', /* ... existing code ... */ );
app.post('/api/predictions', /* ... existing code ... */ );
app.post('/api/admin/score-gameweek', /* ... existing code ... */ );
app.post('/api/admin/update-score', /* ... existing code ... */ );

// NEW: Endpoint for gameweek summary
app.get('/api/summary/:gameweek', authenticateToken, async (req, res) => {
    try {
        const gameweek = parseInt(req.params.gameweek);
        const user = await User.findById(req.user.userId);
        const summary = user.gameweekScores.find(gs => gs.gameweek === gameweek);
        res.json(summary || { gameweek, points: 0, penalty: 0 });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching summary.' });
    }
});


// --- TheSportsDB API Seeding Logic ---
const seedFixturesFromAPI = async () => {
    try {
        const apiKey = process.env.THESPORTSDB_API_KEY;
        if (!apiKey) {
            console.log("TheSportsDB API key not found. Skipping seeding.");
            return;
        }
        
        const lastFixture = await Fixture.findOne().sort({ gameweek: -1 });
        const lastKnownGameweek = lastFixture ? lastFixture.gameweek : 0;
        const gameweekToFetch = lastKnownGameweek + 1;

        if (gameweekToFetch > 38) {
            console.log("All 38 gameweeks seem to be in the database.");
            return;
        }

        console.log(`Checking API for fixtures for Gameweek ${gameweekToFetch}...`);
        
        const url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsround.php?id=4328&r=${gameweekToFetch}&s=2025-2026`;
        
        const response = await axios.get(url);
        const events = response.data.events;

        if (!events || events.length === 0) {
            console.log(`API returned no fixtures for Gameweek ${gameweekToFetch}.`);
            return;
        }

        console.log(`Found ${events.length} new fixtures for Gameweek ${gameweekToFetch}.`);

        const fixturesToSave = await Promise.all(events.map(async (event) => {
            const placeholderHomeLogo = `https://placehold.co/96x96/eee/ccc?text=${event.strHomeTeam.substring(0,3).toUpperCase()}`;
            const placeholderAwayLogo = `https://placehold.co/96x96/eee/ccc?text=${event.strAwayTeam.substring(0,3).toUpperCase()}`;
            let homeLogo = placeholderHomeLogo;
            let awayLogo = placeholderAwayLogo;
            
            try {
                const homeTeamDetails = await axios.get(`https://www.thesportsdb.com/api/v1/json/${apiKey}/lookupteam.php?id=${event.idHomeTeam}`);
                if (homeTeamDetails.data.teams && homeTeamDetails.data.teams[0].strTeamBadge) {
                    homeLogo = homeTeamDetails.data.teams[0].strTeamBadge;
                }
            } catch (e) { console.error(`Could not fetch home logo for ${event.strHomeTeam}`); }

            try {
                const awayTeamDetails = await axios.get(`https://www.thesportsdb.com/api/v1/json/${apiKey}/lookupteam.php?id=${event.idAwayTeam}`);
                if (awayTeamDetails.data.teams && awayTeamDetails.data.teams[0].strTeamBadge) {
                    awayLogo = awayTeamDetails.data.teams[0].strTeamBadge;
                }
            } catch (e) { console.error(`Could not fetch away logo for ${event.strAwayTeam}`); }

            return {
                theSportsDbId: event.idEvent,
                gameweek: parseInt(event.intRound),
                homeTeam: event.strHomeTeam,
                awayTeam: event.strAwayTeam,
                homeLogo: homeLogo,
                awayLogo: awayLogo,
                kickoffTime: new Date(`${event.dateEvent}T${event.strTime}`),
                isDerby: (event.strHomeTeam.includes("Man") && event.strAwayTeam.includes("Man")) || (event.strHomeTeam.includes("Liverpool") && event.strAwayTeam.includes("Everton")),
            };
        }));
        
        if (fixturesToSave.length > 0) {
            await Fixture.insertMany(fixturesToSave);
            console.log(`Successfully added Gameweek ${gameweekToFetch} fixtures to the database!`);
        }

    } catch (error) {
        console.error('Error during API seeding process:', error);
    }
};

// --- Database Connection ---
mongoose.connect(process.env.DATABASE_URL)
    .then(async () => {
        console.log('Successfully connected to MongoDB Atlas!');
        
        await seedFixturesFromAPI(); 
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });

        cron.schedule('0 4 * * *', runScoringProcess);
        console.log('Automated scoring job scheduled to run daily at 04:00 UTC.');
        
        cron.schedule('0 5 * * *', seedFixturesFromAPI);
        console.log('Automated fixture check job scheduled to run daily.');
    })
    .catch((error) => {
        console.error('Error connecting to MongoDB Atlas:', error);
    });

