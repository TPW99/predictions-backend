// --- THIS MUST BE THE VERY FIRST LINE ---
require('dotenv').config(); // This loads the .env file variables

// --- Import necessary packages ---
const express = require('express');
const cors =require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');

// --- Create the Express App ---
const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(express.json());
app.use(cors());

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
    homeTeam: { type: String, required: true },
    awayTeam: { type: String, required: true },
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

// --- API Endpoints ---

// --- Auth Routes (Public) ---
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

// --- User Data Route (Protected) ---
app.get('/api/user/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found.' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user data.' });
    }
});

// --- Game Data Routes ---
app.get('/api/fixtures', async (req, res) => {
    try {
        const fixtures = await Fixture.find().sort({ kickoffTime: 1 });
        res.json(fixtures);
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

// --- Admin Route for Scoring ---
app.post('/api/admin/score-gameweek', authenticateToken, async (req, res) => {
    try {
        const fixturesToScore = await Fixture.find({ kickoffTime: { $lt: new Date() }, 'actualScore.home': null });
        if (fixturesToScore.length === 0) return res.status(200).json({ message: 'No fixtures to score.' });

        const fixtureUpdates = fixturesToScore.map(fixture => {
            fixture.actualScore = { home: Math.floor(Math.random() * 5), away: Math.floor(Math.random() * 5) };
            return fixture.save();
        });
        const updatedFixtures = await Promise.all(fixtureUpdates);
        const fixturesMap = new Map(updatedFixtures.map(f => [f._id.toString(), f]));

        const allUsers = await User.find({});
        const userUpdates = allUsers.map(async (user) => {
            let gameweekScore = 0;
            user.predictions.forEach(p => {
                const fixture = fixturesMap.get(p.fixtureId.toString());
                if (fixture) {
                    let points = calculatePoints(p, fixture.actualScore);
                    if (fixture.isDerby) points *= 2;
                    if (user.chips.jokerFixtureId && user.chips.jokerFixtureId.equals(fixture._id)) points *= 2;
                    gameweekScore += points;
                }
            });
            user.score += gameweekScore;
            return user.save();
        });

        await Promise.all(userUpdates);
        res.status(200).json({ success: true, message: `${fixturesToScore.length} fixtures scored.` });
    } catch (error) {
        res.status(500).json({ message: 'Error during scoring.' });
    }
});

// --- Database Seeding with Live API Data ---
const seedFixtures = async () => {
    try {
        const apiKey = process.env.API_FOOTBALL_KEY ? process.env.API_FOOTBALL_KEY.trim() : null;
        if (!apiKey) {
            console.log('API_FOOTBALL_KEY not found in environment variables, skipping fixture seeding.');
            return;
        }
        
        const fixtureCount = await Fixture.countDocuments();
        if (fixtureCount > 0) {
            console.log('Database already contains fixtures. Skipping seed.');
            return;
        }

        console.log('Fetching live fixtures from API-Football...');

        const response = await axios.get('https://v3.football.api-sports.io/fixtures', {
            params: { 
                league: '39',
                season: '2024'
            },
            headers: {
                'x-rapidapi-host': 'v3.football.api-sports.io',
                'x-rapidapi-key': apiKey,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
            }
        });

        const fixturesFromApi = response.data.response;
        if (fixturesFromApi.length === 0) {
            console.log('API returned 0 fixtures. This is normal if the season has not started yet.');
            return;
        }
        
        const fixturesToSave = fixturesFromApi.map(f => ({
            homeTeam: f.teams.home.name,
            awayTeam: f.teams.away.name,
            kickoffTime: new Date(f.fixture.date),
            isDerby: (f.teams.home.name.includes("Manchester") && f.teams.away.name.includes("Manchester")) || (f.teams.home.name.includes("Liverpool") && f.teams.away.name.includes("Everton"))
        }));

        await Fixture.insertMany(fixturesToSave);
        console.log(`Successfully seeded ${fixturesToSave.length} fixtures from the API.`);

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
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        console.error('Error connecting to MongoDB Atlas:', error);
        console.error(error);
    });
