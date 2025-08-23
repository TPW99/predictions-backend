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
// ... (All API endpoints remain the same)


// --- Web Scraper for Fixtures ---
const scrapeAndSeedFixtures = async (gameweek) => {
    try {
        console.log(`Scraping fixtures for Gameweek ${gameweek}...`);
        const url = `https://www.premierleague.com/matches?co=1&se=578&mw=${gameweek}`;

        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });
        
        const $ = cheerio.load(data);

        const fixturesFromScraper = [];
        
        // --- UPDATED: Using correct selectors for the Premier League website ---
        $('.match-fixture').each((index, element) => {
            const homeTeamElement = $(element).find('.team.home .team-name');
            const awayTeamElement = $(element).find('.team.away .team-name');
            const kickoffTimeElement = $(element).find('.kickoff');

            const homeTeam = homeTeamElement.text().trim();
            const awayTeam = awayTeamElement.text().trim();
            const kickoffTimestamp = kickoffTimeElement.attr('data-kickoff');

            if (homeTeam && awayTeam && kickoffTimestamp) {
                fixturesFromScraper.push({
                    gameweek,
                    homeTeam,
                    awayTeam,
                    kickoffTime: new Date(parseInt(kickoffTimestamp)),
                    // Using placeholders as logos are harder to scrape reliably
                    homeLogo: 'https://placehold.co/96x96/eee/ccc?text=?',
                    awayLogo: 'https://placehold.co/96x96/eee/ccc?text=?',
                    isDerby: (homeTeam.includes("Man") && awayTeam.includes("Man")) || (homeTeam.includes("Liverpool") && awayTeam.includes("Everton"))
                });
            }
        });

        if (fixturesFromScraper.length > 0) {
            console.log(`Found ${fixturesFromScraper.length} fixtures. Seeding database...`);
            // Add logic to only insert new fixtures
            const existingFixtures = await Fixture.find({ gameweek: gameweek });
            if (existingFixtures.length === 0) {
                await Fixture.insertMany(fixturesFromScraper);
                console.log('Database seeded successfully from scraper!');
            } else {
                console.log(`Gameweek ${gameweek} already exists in the database. Skipping seed.`);
            }
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
        
        // Example of how we will use the scraper. For now, it's disabled.
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
