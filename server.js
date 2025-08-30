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
            let totalScore = 0; // Recalculate total score from scratch
            
            for (const prediction of user.predictions) {
                 const fixture = await Fixture.findById(prediction.fixtureId);
                 if (fixture && fixture.actualScore.home !== null) {
                    let points = calculatePoints(prediction, fixture.actualScore);
                    if (fixture.isDerby) points *= 2;
                    if (user.chips.jokerFixtureId && user.chips.jokerFixtureId.equals(fixture._id)) points *= 2;
                    totalScore += points;
                 }
            }
            user.score = totalScore;
            await user.save();
        }

        console.log(`Scoring complete. ${scoredFixturesCount} fixtures and ${allUsers.length} users processed.`);
        return { success: true, message: `${scoredFixturesCount} fixtures scored successfully.` };

    } catch (error) {
        console.error('Error during scoring process:', error);
        return { success: false, message: 'An error occurred during scoring.' };
    }
};


// --- API Endpoints ---

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) return res.status(400).json({ message: 'All fields are required.' });
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
app.get('/api/user/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found.' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user data.' });
    }
});
app.get('/api/fixtures/:gameweek', async (req, res) => {
    try {
        const gameweekToFetch = parseInt(req.params.gameweek);
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
        res.status(500).json({ message: 'Error fetching gameweeks.' });
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
app.get('/api/predictions/:userId/:gameweek', authenticateToken, async(req, res) => {
    try {
        const { userId, gameweek } = req.params;
        const user = await User.findById(userId).populate('predictions.fixtureId');
        if (!user) return res.status(404).json({ message: 'User not found.' });

        const history = user.predictions
            .filter(p => p.fixtureId && p.fixtureId.gameweek == gameweek && new Date(p.fixtureId.kickoffTime) < new Date())
            .map(p => ({ fixture: p.fixtureId, prediction: { homeScore: p.homeScore, awayScore: p.awayScore } }));
        
        res.json({ userName: user.name, history });
    } catch(error) {
        res.status(500).json({ message: 'Error fetching prediction history.' });
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

    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found.' });

        for (const fixtureId in predictions) {
            const predictionData = predictions[fixtureId];
            if (predictionData.homeScore === '' || predictionData.awayScore === '') continue;

            const existingPredictionIndex = user.predictions.findIndex(p => p.fixtureId.toString() === fixtureId);
            
            if (existingPredictionIndex > -1) {
                user.predictions[existingPredictionIndex].homeScore = predictionData.homeScore;
                user.predictions[existingPredictionIndex].awayScore = predictionData.awayScore;
            } else {
                user.predictions.push({ fixtureId, homeScore: predictionData.homeScore, awayScore: predictionData.awayScore });
            }
        }
        
        user.chips.jokerFixtureId = jokerFixtureId;
        if (jokerFixtureId) {
            user.chips.jokerUsedInSeason = true;
        }

        await user.save();
        res.status(200).json({ success: true, message: 'Predictions saved.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error saving predictions.' });
    }
});

app.post('/api/admin/score-gameweek', authenticateToken, async (req, res) => {
    const result = await runScoringProcess();
    if (result.success) {
        res.status(200).json(result);
    } else {
        res.status(500).json(result);
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
        
        const fixtureCount = await Fixture.countDocuments();
        if (fixtureCount > 0) {
            console.log('Database already contains fixtures. Skipping seed.');
            return;
        }

        console.log('Fetching live fixtures from TheSportsDB...');
        const url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsnextleague.php?id=4328`; // 4328 is the Premier League ID
        
        const response = await axios.get(url);
        const events = response.data.events;

        if (!events || events.length === 0) {
            console.log('API returned no fixtures.');
            return;
        }

        const fixturesToSave = await Promise.all(events.map(async (event) => {
            // Fetch team logos
            const homeTeamDetails = await axios.get(`https://www.thesportsdb.com/api/v1/json/${apiKey}/lookupteam.php?id=${event.idHomeTeam}`);
            const awayTeamDetails = await axios.get(`https://www.thesportsdb.com/api/v1/json/${apiKey}/lookupteam.php?id=${event.idAwayTeam}`);

            const homeLogo = homeTeamDetails.data.teams[0].strTeamBadge || '';
            const awayLogo = awayTeamDetails.data.teams[0].strTeamBadge || '';

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
            console.log(`Found ${fixturesToSave.length} fixtures. Adding to database...`);
            await Fixture.insertMany(fixturesToSave);
            console.log('Database seeded successfully from TheSportsDB API!');
        }

    } catch (error) {
        console.error('Error during API seeding process:', error.message);
    }
};

// --- Database Connection ---
mongoose.connect(process.env.DATABASE_URL)
    .then(async () => {
        console.log('Successfully connected to MongoDB Atlas!');
        
        await seedFixturesFromAPI(); // Run seeder on startup

        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });

        cron.schedule('0 4 * * *', runScoringProcess);
        console.log('Automated scoring job scheduled to run daily at 04:00 UTC.');
        
        // Schedule to check for new fixtures weekly, in case the season schedule changes
        cron.schedule('0 5 * * 2', seedFixturesFromAPI);
        console.log('Automated fixture seeding job scheduled to run weekly.');
    })
    .catch((error) => {
        console.error('Error connecting to MongoDB Atlas:', error);
        console.error(error);
    });

