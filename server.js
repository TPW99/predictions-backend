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
    fplId: { type: Number, required: true, unique: true }, // FPL's unique ID for the match
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
    console.log('Running scoring process...');
    try {
        const url = 'https://fantasy.premierleague.com/api/fixtures/';
        const { data: fplFixtures } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3' }
        });
        
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
            const fplFixture = fplFixtures.find(f => f.id === fixture.fplId);
            if (fplFixture && fplFixture.finished === true) {
                fixture.actualScore = {
                    home: fplFixture.team_h_score,
                    away: fplFixture.team_a_score
                };
                await fixture.save();
                updatedFixturesForScoring.push(fixture);
                scoredFixturesCount++;
            }
        }
        
        if (scoredFixturesCount === 0) {
            console.log('No matching results found for fixtures needing scores.');
            return { success: true, message: 'No results to score yet.' };
        }
        
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
     try {
        const { prophecies } = req.body;
        await User.findByIdAndUpdate(req.user.userId, { $set: { prophecies: prophecies } });
        res.status(200).json({ success: true, message: 'Prophecies saved successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error saving prophecies.' });
    }
});

app.post('/api/predictions', authenticateToken, async (req, res) => {
    try {
        const { predictions, jokerFixtureId } = req.body;
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ message: 'User not found.' });

        for (const fixtureId in predictions) {
            const predictionData = predictions[fixtureId];
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


// --- FPL API Seeding Logic ---
const seedFixturesFromFPL = async () => {
    try {
        const fixtureCount = await Fixture.countDocuments();
        if (fixtureCount > 300) { // Check if we likely have a full season
            console.log('Database already contains fixtures. Skipping FPL seed.');
            return;
        }

        console.log('Fetching live fixtures from Fantasy Premier League API...');
        const bootstrapUrl = 'https://fantasy.premierleague.com/api/bootstrap-static/';
        const fixturesUrl = 'https://fantasy.premierleague.com/api/fixtures/';
        
        const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3' };

        const [bootstrapRes, fixturesRes] = await Promise.all([
            axios.get(bootstrapUrl, { headers }),
            axios.get(fixturesUrl, { headers })
        ]);

        const teams = bootstrapRes.data.teams;
        const fplFixtures = fixturesRes.data;

        const teamsMap = new Map(teams.map(team => [team.id, team.name]));
        
        const fixturesToSave = fplFixtures.map(fplFixture => {
            const homeTeamName = teamsMap.get(fplFixture.team_h);
            const awayTeamName = teamsMap.get(fplFixture.team_a);

            // Simple derby check
            const isDerby = (homeTeamName.includes("Man") && awayTeamName.includes("Man")) || 
                            (homeTeamName === "Arsenal" && awayTeamName === "Tottenham Hotspur") ||
                            (homeTeamName === "Tottenham Hotspur" && awayTeamName === "Arsenal");

            return {
                fplId: fplFixture.id,
                gameweek: fplFixture.event,
                homeTeam: homeTeamName,
                awayTeam: awayTeamName,
                kickoffTime: new Date(fplFixture.kickoff_time),
                homeLogo: `https://resources.premierleague.com/premierleague/badges/70/t${fplFixture.team_h}.png`,
                awayLogo: `https://resources.premierleague.com/premierleague/badges/70/t${fplFixture.team_a}.png`,
                isDerby: isDerby,
            };
        });

        if (fixturesToSave.length > 0) {
            console.log(`Found ${fixturesToSave.length} fixtures. Adding to database...`);
            await Fixture.deleteMany({}); // Clear old fixtures before seeding
            await Fixture.insertMany(fixturesToSave);
            console.log('Database seeded successfully from FPL API!');
        } else {
            console.log('Could not find any fixtures from the FPL API.');
        }

    } catch (error) {
        console.error('Error during FPL seeding process:', error.message);
    }
};


// --- Database Connection ---
mongoose.connect(process.env.DATABASE_URL)
    .then(async () => {
        console.log('Successfully connected to MongoDB Atlas!');
        
        await seedFixturesFromFPL(); // Run seeder on startup

        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });

        cron.schedule('0 4 * * *', runScoringProcess); // Run scoring daily at 4 AM UTC
        console.log('Automated scoring job scheduled to run daily at 04:00 UTC.');
        
        cron.schedule('0 5 * * 2', seedFixturesFromFPL); // Re-seed fixtures weekly on Tuesdays
        console.log('Automated fixture seeding job scheduled to run weekly.');
    })
    .catch((error) => {
        console.error('Error connecting to MongoDB Atlas:', error);
        console.error(error);
    });