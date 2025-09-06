// --- THIS MUST BE THE VERY FIRST LINE ---
require('dotenv').config(); // This loads the .env file variables

// --- Import necessary packages ---
const express = require('express');
const cors =require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const axios = require('axios');

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
    theSportsDbId: { type: String, unique: true, sparse: true },
    homeTeamId: { type: String },
    awayTeamId: { type: String },
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

// --- More Robust Team Logo Mapping ---
const teamLogos = {
    "Arsenal": "https://r2.thesportsdb.com/images/media/team/badge/uyhbfe1612467038.png",
    "Aston Villa": "https://r2.thesportsdb.com/images/media/team/badge/jykrpv1717309891.png",
    "AFC Bournemouth": "https://r2.thesportsdb.com/images/media/team/badge/y08nak1534071116.png",
    "Bournemouth": "https://r2.thesportsdb.com/images/media/team/badge/y08nak1534071116.png",
    "Brentford": "https://r2.thesportsdb.com/images/media/team/badge/grv1aw1546453779.png",
    "Brighton & Hove Albion": "https://r2.thesportsdb.com/images/media/team/badge/ywypts1448810904.png",
    "Brighton": "https://r2.thesportsdb.com/images/media/team/badge/ywypts1448810904.png",
    "Burnley": "https://r2.thesportsdb.com/images/media/team/badge/ql7nl31686893820.png",
    "Chelsea": "https://r2.thesportsdb.com/images/media/team/badge/yvwvtu1448813215.png",
    "Crystal Palace": "https://r2.thesportsdb.com/images/media/team/badge/ia6i3m1656014992.png",
    "Everton": "https://r2.thesportsdb.com/images/media/team/badge/eqayrf1523184794.png",
    "Fulham": "https://r2.thesportsdb.com/images/media/team/badge/xwwvyt1448811086.png",
    "Leeds United": "https://r2.thesportsdb.com/images/media/team/badge/g0eqzw1598804097.png",
    "Liverpool": "https://r2.thesportsdb.com/images/media/team/badge/kfaher1737969724.png",
    "Manchester City": "https://r2.thesportsdb.com/images/media/team/badge/vwpvry1467462651.png",
    "Man City": "https://r2.thesportsdb.com/images/media/team/badge/vwpvry1467462651.png",
    "Manchester United": "https://r2.thesportsdb.com/images/media/team/badge/xzqdr11517660252.png",
    "Man Utd": "https://r2.thesportsdb.com/images/media/team/badge/xzqdr11517660252.png",
    "Newcastle United": "https://r2.thesportsdb.com/images/media/team/badge/lhwuiz1621593302.png",
    "Newcastle": "https://r2.thesportsdb.com/images/media/team/badge/lhwuiz1621593302.png",
    "Nottingham Forest": "https://r2.thesportsdb.com/images/media/team/badge/bk4qjs1546440351.png",
    "Sunderland": "https://r2.thesportsdb.com/images/media/team/badge/tprtus1448813498.png",
    "Tottenham Hotspur": "https://r2.thesportsdb.com/images/media/team/badge/dfyfhl1604094109.png",
    "Tottenham": "https://r2.thesportsdb.com/images/media/team/badge/dfyfhl1604094109.png",
    "West Ham United": "https://r2.thesportsdb.com/images/media/team/badge/yutyxs1467459956.png",
    "West Ham": "https://r2.thesportsdb.com/images/media/team/badge/yutyxs1467459956.png",
    "Wolverhampton Wanderers": "https://r2.thesportsdb.com/images/media/team/badge/u9qr031621593327.png",
    "Wolves": "https://r2.thesportsdb.com/images/media/team/badge/u9qr031621593327.png"
};

const getLogoUrl = (apiTeamName) => {
    return teamLogos[apiTeamName] || `https://placehold.co/96x96/eee/ccc?text=${apiTeamName.substring(0,3).toUpperCase()}`;
};

// --- Helper Function for Scoring ---
const calculatePoints = (prediction, actualScore) => {
    const predHome = Number(prediction.homeScore);
    const predAway = Number(prediction.awayScore);

    if (isNaN(predHome) || isNaN(predAway)) return 0;
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
        console.log(`Found ${fixturesToScore.length} fixtures needing scores.`);

        let scoredFixturesCount = 0;

        for (const fixture of fixturesToScore) {
            try {
                const resultsUrl = `https://www.thesportsdb.com/api/v1/json/${apiKey}/lookupevent.php?id=${fixture.theSportsDbId}`;
                const resultsResponse = await axios.get(resultsUrl);
                const result = resultsResponse.data.events && resultsResponse.data.events[0];

                if (result && result.intHomeScore != null && result.intAwayScore != null) {
                    await Fixture.updateOne(
                        { _id: fixture._id },
                        { $set: {
                            'actualScore.home': parseInt(result.intHomeScore),
                            'actualScore.away': parseInt(result.intAwayScore)
                        }}
                    );
                    scoredFixturesCount++;
                    console.log(`Score updated for ${fixture.homeTeam} vs ${fixture.awayTeam}: ${result.intHomeScore}-${result.intAwayScore}`);
                }
            } catch (e) {
                console.error(`Could not fetch result for fixture ${fixture.theSportsDbId}:`, e.message);
            }
        }

        if (scoredFixturesCount === 0) {
            console.log('No finished matches found with results on the API yet.');
            return { success: true, message: 'No results to score yet.' };
        }

        console.log(`Recalculating scores for all users...`);
        const allUsers = await User.find({}).populate('predictions.fixtureId');

        for (const user of allUsers) {
            let totalScore = 0;
            for (const prediction of user.predictions) {
                 if (prediction.fixtureId && prediction.fixtureId.actualScore && prediction.fixtureId.actualScore.home !== null) {
                    let points = calculatePoints(prediction, prediction.fixtureId.actualScore);
                    if (prediction.fixtureId.isDerby) points *= 2;
                    if (user.chips.jokerFixtureId && user.chips.jokerFixtureId.equals(prediction.fixtureId._id)) points *= 2;
                    totalScore += points;
                 }
            }
            await User.updateOne({ _id: user._id }, { $set: { score: totalScore } });
        }

        console.log(`Scoring complete. ${scoredFixturesCount} new fixtures scored. All user scores recalculated.`);
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
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user data.' });
    }
});
app.get('/api/fixtures', async (req, res) => {
    try {
        const upcomingFixture = await Fixture.findOne({ kickoffTime: { $gte: new Date() } }).sort({ kickoffTime: 1 });
        let gameweekToFetch = 1;
        if (upcomingFixture) {
            gameweekToFetch = upcomingFixture.gameweek;
        } else {
            const lastFixture = await Fixture.findOne().sort({ gameweek: -1 });
            if (lastFixture) gameweekToFetch = lastFixture.gameweek;
        }
        const fixtures = await Fixture.find({ gameweek: gameweekToFetch }).sort({ kickoffTime: 1 });
        res.json({ fixtures, gameweek: gameweekToFetch });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching fixtures' });
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
        const existingPredictionsMap = new Map(user.predictions.map(p => [p.fixtureId.toString(), p]));
        for (const fixtureId in predictions) {
            const predictionData = predictions[fixtureId];
            if (predictionData.homeScore !== '' && predictionData.awayScore !== '') {
                existingPredictionsMap.set(fixtureId, {
                    fixtureId,
                    homeScore: parseInt(predictionData.homeScore),
                    awayScore: parseInt(predictionData.awayScore)
                });
            } else {
                existingPredictionsMap.delete(fixtureId);
            }
        }
        user.predictions = Array.from(existingPredictionsMap.values());
        user.chips.jokerFixtureId = jokerFixtureId;
        if (jokerFixtureId) user.chips.jokerUsedInSeason = true;
        await user.save();
        res.status(200).json({ success: true, message: 'Predictions saved.' });
    } catch (error) {
        console.error("Error saving predictions:", error);
        res.status(500).json({ success: false, message: 'Error saving predictions.' });
    }
});
app.post('/api/admin/score-gameweek', authenticateToken, async (req, res) => {
    const result = await runScoringProcess();
    if(result.success) res.status(200).json(result);
    else res.status(500).json(result);
});

// --- TheSportsDB API Seeding Logic (FINAL INTELLIGENT VERSION) ---
const seedFixturesFromAPI = async () => {
    try {
        const apiKey = process.env.THESPORTSDB_API_KEY;
        if (!apiKey) {
            console.log("TheSportsDB API key not found. Skipping seeding.");
            return;
        }

        const seasonStartDate = new Date('2025-08-15T00:00:00Z');
        const now = new Date();
        const weekInMillis = 7 * 24 * 60 * 60 * 1000;
        let realCurrentGameweek = Math.floor((now - seasonStartDate) / weekInMillis) + 1;
        if (realCurrentGameweek < 1) realCurrentGameweek = 1;
        if (realCurrentGameweek > 38) realCurrentGameweek = 38;

        const existingGameweeks = await Fixture.distinct('gameweek');

        for (let gw = 1; gw <= realCurrentGameweek; gw++) {
            if (existingGameweeks.includes(gw)) {
                console.log(`Gameweek ${gw} already in DB. Skipping.`);
                continue;
            }

            console.log(`Checking API for missing fixtures for Gameweek ${gw}...`);
            
            const url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/eventsround.php?id=4328&r=${gw}&s=2025-2026`;
            
            const response = await axios.get(url);
            const events = response.data.events;

            if (!events || events.length === 0) {
                console.log(`API returned no fixtures for Gameweek ${gw}.`);
                continue;
            }

            console.log(`Found ${events.length} new fixtures for Gameweek ${gw}.`);

            const fixturesToSave = events.map(event => ({
                theSportsDbId: event.idEvent,
                gameweek: parseInt(event.intRound),
                homeTeam: event.strHomeTeam,
                awayTeam: event.strAwayTeam,
                homeLogo: getLogoUrl(event.strHomeTeam),
                awayLogo: getLogoUrl(event.strAwayTeam),
                homeTeamId: event.idHomeTeam,
                awayTeamId: event.idAwayTeam,
                kickoffTime: new Date(`${event.dateEvent}T${event.strTime}`),
                isDerby: (event.strHomeTeam.includes("Man") && event.strAwayTeam.includes("Man")) || (event.strHomeTeam.includes("Liverpool") && event.strAwayTeam.includes("Everton")),
            }));
            
            if (fixturesToSave.length > 0) {
                await Fixture.insertMany(fixturesToSave);
                console.log(`Successfully added Gameweek ${gw} fixtures to the database!`);
            }
        }

    } catch (error) {
        console.error('Error during API seeding process:', error);
    }
};

const repairMissingLogos = async () => {
    try {
        console.log("Checking for fixtures with missing or placeholder logos...");
        const fixturesToRepair = await Fixture.find({ 
            $or: [ 
                { homeLogo: { $exists: false } },
                { awayLogo: { $exists: false } },
                { homeLogo: "" },
                { awayLogo: "" },
                { homeLogo: { $regex: /placehold\.co/ } },
                { awayLogo: { $regex: /placehold\.co/ } }
            ]
        });

        if (fixturesToRepair.length === 0) {
            console.log("No logos need repairing.");
            return;
        }

        console.log(`Found ${fixturesToRepair.length} fixtures to repair...`);
        const bulkUpdateOps = fixturesToRepair.map(fixture => ({
            updateOne: {
                filter: { _id: fixture._id },
                update: { $set: { 
                    homeLogo: getLogoUrl(fixture.homeTeam),
                    awayLogo: getLogoUrl(fixture.awayTeam)
                }}
            }
        }));

        await Fixture.bulkWrite(bulkUpdateOps);
        console.log("Successfully repaired missing logos.");

    } catch (error) {
        console.error("Error repairing missing logos:", error);
    }
};

// --- Database Connection ---
mongoose.connect(process.env.DATABASE_URL)
    .then(async () => {
        console.log('Successfully connected to MongoDB Atlas!');
        
        await repairMissingLogos();
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
        console.error(error);
    });

