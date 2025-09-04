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

// --- Permanent Team Logo Mapping ---
const teamLogos = {
    "Arsenal": "https://ssl.gstatic.com/onebox/media/sports/logos/4us2nCgl6kgZc0t3hpW75Q_96x96.png",
    "Aston Villa": "https://ssl.gstatic.com/onebox/media/sports/logos/N6-HDdY7In-fm-Y6LIADsA_96x96.png",
    "AFC Bournemouth": "https://ssl.gstatic.com/onebox/media/sports/logos/4ltl6D-3jH2x_o0l4q1e_g_96x96.png",
    "Brentford": "https://ssl.gstatic.com/onebox/media/sports/logos/QOUce0o249-fYvS6T2K_cQ_96x96.png",
    "Brighton & Hove Albion": "https://ssl.gstatic.com/onebox/media/sports/logos/EKIe0e-ZIphOcfYwWr-4cg_96x96.png",
    "Burnley": "https://ssl.gstatic.com/onebox/media/sports/logos/teLLOL2zEXINSAcV1Lw40g_96x96.png",
    "Chelsea": "https://ssl.gstatic.com/onebox/media/sports/logos/fhBITrIlbQxhVB60sqHmRw_96x96.png",
    "Crystal Palace": "https://ssl.gstatic.com/onebox/media/sports/logos/6Al17eKthA2qZf-49536gA_96x96.png",
    "Everton": "https://ssl.gstatic.com/onebox/media/sports/logos/C3J4B9sbvGy3i42J4x_jow_96x96.png",
    "Fulham": "https://ssl.gstatic.com/onebox/media/sports/logos/8_a_fBC_UMkl_M2A_4_tKGg_96x96.png",
    "Leeds United": "https://ssl.gstatic.com/onebox/media/sports/logos/5dqf3k2-N9n982-4aCRaYQ_96x96.png",
    "Liverpool": "https://ssl.gstatic.com/onebox/media/sports/logos/0iZm6OOF1g_M51M4e_Q69A_96x96.png",
    "Manchester City": "https://ssl.gstatic.com/onebox/media/sports/logos/z44l-a0W1v5FmgP1e2SinQ_96x96.png",
    "Manchester United": "https://ssl.gstatic.com/onebox/media/sports/logos/z44l-a0W1v5FmgP1e2SinQ_96x96.png",
    "Newcastle United": "https://ssl.gstatic.com/onebox/media/sports/logos/96_A_j_1UcH1sNA_JpQ22A_96x96.png",
    "Nottingham Forest": "https://ssl.gstatic.com/onebox/media/sports/logos/l3qf-XJ23wR1iMdlm20L8g_96x96.png",
    "Sunderland": "https://ssl.gstatic.com/onebox/media/sports/logos/SU5-2i_B2iJp12r9322y-g_96x96.png",
    "Tottenham Hotspur": "https://ssl.gstatic.com/onebox/media/sports/logos/k3Q_m6eVK0h_Hj6nPoW_9g_96x96.png",
    "West Ham United": "https://ssl.gstatic.com/onebox/media/sports/logos/bXyitHBcDm+VwKGHbj9Gag_96x96.png",
    "Wolverhampton Wanderers": "https://ssl.gstatic.com/onebox/media/sports/logos/ZW73-D_KTZfFOE6C2oSw_g_96x96.png"
};

// CORRECTED: More robust function to match API names (e.g., "Wolves") to our full names
const getLogoUrl = (apiTeamName) => {
    // Try for an exact match first
    if (teamLogos[apiTeamName]) {
        return teamLogos[apiTeamName];
    }
    // Try finding a key in our map that INCLUDES the API name (e.g., "Wolverhampton Wanderers" includes "Wolves")
    const key = Object.keys(teamLogos).find(k => k.includes(apiTeamName));
    if (key) {
        return teamLogos[key];
    }
    // Fallback to a placeholder if no match is found
    return `https://placehold.co/96x96/eee/ccc?text=${apiTeamName.substring(0,3).toUpperCase()}`;
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

// --- Reusable Scoring Logic (FINAL ROBUST VERSION) ---
const runScoringProcess = async () => {
    console.log('Running robust scoring process...');
    try {
        const apiKey = process.env.THESPORTSDB_API_KEY;
        if (!apiKey) return { success: false, message: 'API key not found.' };

        // 1. Find all fixtures that have started but have not yet been scored.
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
        
        // 2. Fetch the result for each fixture individually for maximum reliability.
        for (const fixture of fixturesToScore) {
            try {
                const resultsUrl = `https://www.thesportsdb.com/api/v1/json/${apiKey}/lookupevent.php?id=${fixture.theSportsDbId}`;
                const resultsResponse = await axios.get(resultsUrl);
                const result = resultsResponse.data.events && resultsResponse.data.events[0];

                // Check if the match is finished and has a score
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

        // 3. Recalculate all user scores from scratch to ensure accuracy.
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
            console.log(`API returned no fixtures for Gameweek ${gameweekToFetch}. This is normal if they haven't been announced yet.`);
            return;
        }

        console.log(`Found ${events.length} new fixtures for Gameweek ${gameweekToFetch}.`);

        const fixturesToSave = events.map(event => ({
            theSportsDbId: event.idEvent,
            gameweek: parseInt(event.intRound),
            homeTeam: event.strHomeTeam,
            awayTeam: event.strAwayTeam,
            homeLogo: getLogoUrl(event.strHomeTeam), // Use internal logo map
            awayLogo: getLogoUrl(event.strAwayTeam), // Use internal logo map
            kickoffTime: new Date(`${event.dateEvent}T${event.strTime}`),
            isDerby: (event.strHomeTeam.includes("Man") && event.strAwayTeam.includes("Man")) || (event.strHomeTeam.includes("Liverpool") && event.strAwayTeam.includes("Everton")),
        }));
        
        if (fixturesToSave.length > 0) {
            await Fixture.insertMany(fixturesToSave);
            console.log(`Successfully added Gameweek ${gameweekToFetch} fixtures to the database!`);
        }

    } catch (error) {
        console.error('Error during API seeding process:', error);
    }
};

// One-time function to repair missing logos in existing fixtures
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
