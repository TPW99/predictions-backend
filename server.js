// --- THIS MUST BE THE VERY FIRST LINE ---
require('dotenv').config(); // This loads the .env file variables

// --- Import necessary packages ---
const express = require('express');
const cors =require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
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
    console.log('Running scoring process...');
    try {
        const fixturesToScore = await Fixture.find({ 
            kickoffTime: { $lt: new Date() }, 
            'actualScore.home': { $ne: null } // Only score fixtures that have an actual score
        });

        if (fixturesToScore.length === 0) {
            console.log('No new fixtures to score.');
            return { success: true, message: 'No new fixtures to score.' };
        }
        console.log(`Found ${fixturesToScore.length} fixtures to score.`);
        
        const fixturesMap = new Map(fixturesToScore.map(f => [f._id.toString(), f]));
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

        console.log(`Scoring complete. ${fixturesToScore.length} fixtures and ${allUsers.length} users processed.`);
        return { success: true, message: `${fixturesToScore.length} fixtures scored successfully.` };

    } catch (error) {
        console.error('Error during scoring process:', error);
        return { success: false, message: 'An error occurred during scoring.' };
    }
};


// --- API Endpoints ---

// Auth Routes...
app.post('/api/auth/register', async (req, res) => {
    // Implementation from previous steps
});
app.post('/api/auth/login', async (req, res) => {
    // Implementation from previous steps
});
app.get('/api/user/me', authenticateToken, async (req, res) => {
    // Implementation from previous steps
});

// Game Data Routes...
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
    // Implementation from previous steps
});
app.post('/api/predictions', authenticateToken, async (req, res) => {
    // Implementation from previous steps
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

// --- NEW Admin Route for Manually Updating Scores ---
app.post('/api/admin/update-score', authenticateToken, async (req, res) => {
    const { fixtureId, homeScore, awayScore } = req.body;
    // In a real app, you'd add another check here to ensure only admins can do this
    try {
        const fixture = await Fixture.findById(fixtureId);
        if (!fixture) {
            return res.status(404).json({ message: 'Fixture not found.' });
        }
        fixture.actualScore = { home: homeScore, away: awayScore };
        await fixture.save();
        res.status(200).json({ success: true, message: 'Fixture score updated successfully.' });
    } catch (error) {
        console.error('Error updating score:', error);
        res.status(500).json({ message: 'Error updating score.' });
    }
});


// --- Database Seeding with Static Data ---
const seedFixtures = async () => {
    try {
        const fixtureCount = await Fixture.countDocuments();
        if (fixtureCount > 0) {
            console.log('Database already contains fixtures. Skipping seed.');
            return;
        }

        console.log('Seeding database with static fixtures for 2025/26 Gameweek 1...');

        const initialFixtures = [
            { gameweek: 1, homeTeam: 'Liverpool', awayTeam: 'AFC Bournemouth', homeLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/0iZm6OOF1g_M51M4e_Q69A_96x96.png', awayLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/4ltl6D-3jH2x_o0l4q1e_g_96x96.png', kickoffTime: new Date('2025-08-15T19:00:00Z'), isDerby: false },
            { gameweek: 1, homeTeam: 'Aston Villa', awayTeam: 'Newcastle United', homeLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/N6-HDdY7In-fm-Y6LIADsA_96x96.png', awayLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/96_A_j_1UcH1sNA_JpQ22A_96x96.png', kickoffTime: new Date('2025-08-16T11:30:00Z'), isDerby: false },
            { gameweek: 1, homeTeam: 'Brighton & Hove Albion', awayTeam: 'Fulham', homeLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/EKIe0e-ZIphOcfYwWr-4cg_96x96.png', awayLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/8_a_fBC_UMkl_M2A_4_tKGg_96x96.png', kickoffTime: new Date('2025-08-16T14:00:00Z'), isDerby: false },
            { gameweek: 1, homeTeam: 'Sunderland', awayTeam: 'West Ham United', homeLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/SU5-2i_B2iJp12r9322y-g_96x96.png', awayLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/bXyitHBcDm+VwKGHbj9Gag_96x96.png', kickoffTime: new Date('2025-08-16T14:00:00Z'), isDerby: false },
            { gameweek: 1, homeTeam: 'Tottenham Hotspur', awayTeam: 'Burnley', homeLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/k3Q_m6eVK0h_Hj6nPoW_9g_96x96.png', awayLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/teLLOL2zEXINSAcV1Lw40g_96x96.png', kickoffTime: new Date('2025-08-16T14:00:00Z'), isDerby: false },
            { gameweek: 1, homeTeam: 'Wolverhampton Wanderers', awayTeam: 'Manchester City', homeLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/ZW73-D_KTZfFOE6C2oSw_g_96x96.png', awayLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/z44l-a0W1v5FmgP1e2SinQ_96x96.png', kickoffTime: new Date('2025-08-16T16:30:00Z'), isDerby: false },
            { gameweek: 1, homeTeam: 'Chelsea', awayTeam: 'Crystal Palace', homeLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/fhBITrIlbQxhVB60sqHmRw_96x96.png', awayLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/6Al17eKthA2qZf-49536gA_96x96.png', kickoffTime: new Date('2025-08-17T13:00:00Z'), isDerby: true },
            { gameweek: 1, homeTeam: 'Nottingham Forest', awayTeam: 'Brentford', homeLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/l3qf-XJ23wR1iMdlm20L8g_96x96.png', awayLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/QOUce0o249-fYvS6T2K_cQ_96x96.png', kickoffTime: new Date('2025-08-17T13:00:00Z'), isDerby: false },
            { gameweek: 1, homeTeam: 'Manchester United', awayTeam: 'Arsenal', homeLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/z44l-a0W1v5FmgP1e2SinQ_96x96.png', awayLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/4us2nCgl6kgZc0t3hpW75Q_96x96.png', kickoffTime: new Date('2025-08-17T15:30:00Z'), isDerby: true },
            { gameweek: 1, homeTeam: 'Leeds United', awayTeam: 'Everton', homeLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/5dqf3k2-N9n982-4aCRaYQ_96x96.png', awayLogo: 'https://ssl.gstatic.com/onebox/media/sports/logos/C3J4B9sbvGy3i42J4x_jow_96x96.png', kickoffTime: new Date('2025-08-18T19:00:00Z'), isDerby: false }
        ];

        await Fixture.insertMany(initialFixtures);
        console.log(`Successfully seeded ${initialFixtures.length} static fixtures.`);

    } catch (error) {
        console.error('Error in seedFixtures:', error);
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
