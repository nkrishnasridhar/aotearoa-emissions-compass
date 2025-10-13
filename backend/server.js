const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 5000;

app.use(cors());

/**
 * Generates mock emissions data for a given Australian state.
 *
 * @param {string} stateName - Name of the state (e.g. 'NSW', 'VIC')
 * @returns {Object} Emissions and generation mix data for the state
 */
function generateStateData(stateName) {
    return {
        state: stateName,
        timestamp: new Date().toISOString(),                              // Timestamp in default ISO format
        totalDemandMW: Math.round(5000 + Math.random() * 5000),           // Total energy demand in megawatts (MW)
        carbonIntensity_gCO2kWh: Math.round(200 + Math.random() * 600),   // Carbon intensity in grams of CO2 per kWh
        generationMix: {                                                  // Power generation mix by fuel type (as percentages)
            coal: Math.random() * 3000 + 1000,    // 1000-4000 MW
            gas: Math.random() * 2000 + 500,      // 500-2500 MW
            hydro: Math.random() * 1500 + 200,    // 200-1700 MW
            wind: Math.random() * 1200 + 300,     // 300-1500 MW
            solar: Math.random() * 800 + 100,     // 100-900 MW
        }
    };
}

/**
 * GET /api/emissions/australia
 * Returns mocked emissions data for Australian states.
 */
app.get('/api/emissions/australia', (req, res) => {
    const states = ['QLD', 'NSW', 'VIC', 'SA', 'TAS'];
    const data = states.map((state) => generateStateData(state));
    res.json(data);
});

/**
 * GET /health
 * Simple health check endpoint to verify the server is running.
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start the express server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Test API: http://localhost:${PORT}/api/emissions/australia`);
});