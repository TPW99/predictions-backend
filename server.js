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

        let scoredFixturesCount = 0;
        const updatedFixturesForScoring = [];

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
                    updatedFixturesForScoring.push(fixture);
                    scoredFixturesCount++;
                }
            } catch (e) {
                console.error(`Could not fetch result for fixture ${fixture.theSportsDbId}:`, e.message);
            }
        }

        if (scoredFixturesCount === 0) {
            console.log('No matching results found for fixtures needing scores.');
            return { success: true, message: 'No results to score yet.' };
        }

        console.log(`Updated ${scoredFixturesCount} fixtures with actual scores. Now calculating user points...`);
        
        const fixturesMap = new Map(updatedFixturesForScoring.map(f => [f._id.toString(), f]));
        const allUsers = await User.find({});

        for (const user of allUsers) {
            let userGameweekScore = 0;
            
            for (const prediction of user.predictions) {
                const fixture = fixturesMap.get(prediction.fixtureId.toString());
                if (fixture) {
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
    try {
        const { name, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: 'User with this email already exists.' });
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = new User({ name, email, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ message: 'User registered successfully!' });
    } catch (error) {
        res.status(500).json({ message: 'Server error during registration.' });
    }
});
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ message: 'Invalid credentials.' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid credentials.' });
        const payload = { userId: user._id, name: user.name };
        const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '3h' });
        res.status(200).json({ token, message: 'Logged in successfully!' });
    } catch (error) {
        res.status(500).json({ message: 'Server error during login.' });
    }
});

// User and Game Data Routes...
app.get('/api/user/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found.' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user data.' });
    }
});
app.get('/api/fixtures', async (req, res) => {
    try {
        const fixtures = await Fixture.find().sort({ kickoffTime: 1 });
        res.json({ fixtures });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching fixtures' });
    }
});
app.get('/api/leaderboard', async (req, res) => {
    try {
        const leaderboard = await User.find({}).sort({ score: -1 }).select('name score');
        res.json(leaderboard);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching leaderboard data.' });
    }
});
app.post('/api/prophecies', authenticateToken, async (req, res) => {
    const { prophecies } = req.body;
    const userId = req.user.userId;
    try {
        await User.findByIdAndUpdate(userId, { $set: { prophecies: prophecies } });
        res.status(200).json({ success: true, message: 'Prophecies saved successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error saving prophecies.' });
    }
});
app.post('/api/predictions', authenticateToken, async (req, res) => {
    const { predictions, jokerFixtureId } = req.body;
    const userId = req.user.userId;
    const predictionsArray = Object.keys(predictions).map(fixtureId => ({
        fixtureId: fixtureId, homeScore: predictions[fixtureId].homeScore, awayScore: predictions[fixtureId].awayScore
    }));
    try {
        const updateData = { 'predictions': predictionsArray, 'chips.jokerFixtureId': jokerFixtureId };
        if (jokerFixtureId) {
            updateData['chips.jokerUsedInSeason'] = true;
        }
        await User.findByIdAndUpdate(userId, { $set: updateData });
        res.status(200).json({ success: true, message: 'Predictions saved.', submittedAt: new Date() });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error saving predictions.' });
    }
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
