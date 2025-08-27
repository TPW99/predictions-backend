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
    // ... (This function remains the same for now)
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
        if (!user) return res.status(404).json({ message: 'User not found.' });
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user data.' });
    }
});

// --- UPDATED: Split into two routes to fix deployment error ---
app.get('/api/fixtures', async (req, res) => {
    try {
        const upcomingFixture = await Fixture.findOne({ kickoffTime: { $gte: new Date() } }).sort({ kickoffTime: 1 });
        let gameweekToFetch;
        if (upcomingFixture) {
            gameweekToFetch = upcomingFixture.gameweek;
        } else {
            const lastFixture = await Fixture.findOne().sort({ gameweek: -1 });
            gameweekToFetch = lastFixture ? lastFixture.gameweek : 1;
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
        res.status(500).json({ message: 'Error fetching gameweeks' });
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
    // ... (logic from previous versions)
});
app.post('/api/predictions', authenticateToken, async (req, res) => {
    // ... (logic from previous versions)
});
app.post('/api/admin/score-gameweek', authenticateToken, async (req, res) => {
    const result = await runScoringProcess();
    if (result.success) {
        res.status(200).json(result);
    } else {
        res.status(500).json(result);
    }
});


// --- Web Scraper for Fixtures ---
const scrapeAndSeedFixtures = async (gameweek) => {
    try {
        console.log(`Scraping fixtures for Gameweek ${gameweek}...`);
        const url = `https://www.premierleague.com/matches?co=1&se=578&mw=${gameweek}`;

        // 1. Fetch the HTML from the Premier League website
        const { data } = await axios.get(url);
        
        // 2. Load the HTML into Cheerio so we can parse it
        const $ = cheerio.load(data);

        const fixturesFromScraper = [];

        // 3. Find the fixture list and loop through each match
        $('.fixture-list .match-fixture').each((index, element) => {
            // 4. For each match, find and extract the data
            const homeTeam = $(element).find('.team.home .name').text();
            const awayTeam = $(element).find('.team.away .name').text();
            const kickoffTime = $(element).find('.kickoff').attr('data-time');
            
            if (homeTeam && awayTeam && kickoffTime) {
                fixturesFromScraper.push({
                    gameweek,
                    homeTeam,
                    awayTeam,
                    kickoffTime: new Date(parseInt(kickoffTime)),
                    homeLogo: 'https://placehold.co/96x96/eee/ccc?text=?',
                    awayLogo: 'https://placehold.co/96x96/eee/ccc?text=?'
                });
            }
        });

        if (fixturesFromScraper.length > 0) {
            console.log(`Found ${fixturesFromScraper.length} fixtures. Seeding database...`);
            await Fixture.insertMany(fixturesFromScraper);
            console.log('Database seeded successfully from scraper!');
        } else {
            console.log('Could not find any fixtures on the page. The website layout may have changed.');
        }

    } catch (error) {
        console.error('Error during scraping process:', error.message);
    }
};


// --- Database Connection ---
mongoose.connect(process.env.DATABASE_URL, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(async () => {
        console.log('Successfully connected to MongoDB Atlas!');
        
        // We can manually trigger the scraper for a specific gameweek here for testing
        // For now, we will leave the old static seeding in place until the scraper is complete.
        // await scrapeAndSeedFixtures(3); 

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
