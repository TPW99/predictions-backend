// --- THIS MUST BE THE VERY FIRST LINE ---
require('dotenv').config(); // This loads the .env file variables

// --- Import necessary packages ---
const express = require('express');
const cors =require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cheerio = require('cheerio'); // For parsing HTML
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
    // This will be updated later to scrape results
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
    // This will be updated later to use a scraper for results
    res.status(200).json({ message: "Scoring logic to be implemented with scraper."});
});

app.post('/api/admin/run-scraper/:gameweek', authenticateToken, async (req, res) => {
    try {
        const gameweek = parseInt(req.params.gameweek);
        if (isNaN(gameweek) || gameweek < 1 || gameweek > 38) {
            return res.status(400).json({ message: 'Invalid gameweek number.' });
        }
        await scrapeAndSeedFixtures(gameweek);
        res.status(200).json({ success: true, message: `Scraper run for Gameweek ${gameweek}.` });
    } catch (error) {
        res.status(500).json({ message: 'Error running scraper.' });
    }
});


// --- Web Scraper for Fixtures ---
const scrapeAndSeedFixtures = async (gameweek) => {
    try {
        console.log(`Scraping fixtures for Gameweek ${gameweek}...`);

        // Step 1: Find the current season ID dynamically
        const mainUrl = 'https://www.premierleague.com/matches';
        const { data: mainData } = await axios.get(mainUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Origin': 'https://www.premierleague.com',
                'Referer': 'https://www.premierleague.com/'
            }
        });

        const main$ = cheerio.load(mainData);
        const seasonId = main$('.current-season').attr('data-season-id');
        
        if (!seasonId) {
            console.log('Could not dynamically find season ID. The website layout may have changed.');
            return;
        }
        console.log(`Found current season ID: ${seasonId}`);

        // Step 2: Use the dynamic season ID to build the correct URL
        const url = `https://www.premierleague.com/matches?co=1&se=${seasonId}&mw=${gameweek}`;
        
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Origin': 'https://www.premierleague.com',
                'Referer': 'https://www.premierleague.com/matches'
            }
        });
        
        const $ = cheerio.load(data);
        const fixturesFromScraper = [];
        
        $('.fixture.match-fixture').each((index, element) => {
            const homeTeam = $(element).find('.team.home .name').text().trim();
            const awayTeam = $(element).find('.team.away .name').text().trim();
            const kickoffTimestamp = $(element).attr('data-kickoff');

            if (homeTeam && awayTeam && kickoffTimestamp) {
                console.log(`Found: ${homeTeam} vs ${awayTeam}`);
                fixturesFromScraper.push({
                    gameweek,
                    homeTeam,
                    awayTeam,
                    kickoffTime: new Date(parseInt(kickoffTimestamp)),
                    homeLogo: `https://placehold.co/96x96/eee/ccc?text=${homeTeam.substring(0,3).toUpperCase()}`,
                    awayLogo: `https://placehold.co/96x96/eee/ccc?text=${awayTeam.substring(0,3).toUpperCase()}`,
                    isDerby: false // Add logic for derby matches if needed
                });
            }
        });

        if (fixturesFromScraper.length > 0) {
            console.log(`Found ${fixturesFromScraper.length} fixtures. Adding to database...`);
            
            for(const fixtureData of fixturesFromScraper) {
                await Fixture.updateOne(
                    { homeTeam: fixtureData.homeTeam, awayTeam: fixtureData.awayTeam, gameweek: fixtureData.gameweek },
                    { $set: fixtureData },
                    { upsert: true }
                );
            }
            console.log('Database seeded/updated successfully from scraper!');
        } else {
            console.log('Could not find any fixtures on the page. The website layout may have changed.');
        }

    } catch (error) {
        console.error('Error during scraping process:', error.message);
    }
};


// --- Database Connection ---
mongoose.connect(process.env.DATABASE_URL)
    .then(async () => {
        console.log('Successfully connected to MongoDB Atlas!');
        
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });

        // Schedule a job to scrape for the *next* gameweek every Tuesday.
        cron.schedule('0 5 * * 2', () => { 
            console.log('--- Triggering weekly automated fixture scraping job ---');
            const today = new Date();
            const seasonStart = new Date('2025-08-15T00:00:00Z');
            const weekInMillis = 7 * 24 * 60 * 60 * 1000;
            let gameweekToScrape = Math.floor((today - seasonStart) / weekInMillis) + 2; // +2 to get next week
            if (gameweekToScrape > 1 && gameweekToScrape <= 38) {
                scrapeAndSeedFixtures(gameweekToScrape);
            }
        });
        console.log('Automated fixture scraping job scheduled to run weekly.');

    })
    .catch((error) => {
        console.error('Error connecting to MongoDB Atlas:', error);
        console.error(error);
    });
