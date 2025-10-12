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
    const dateLocaleOptions = {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    };
    
    return {
        state: stateName,
        timestamp: new Date().toLocaleString("en-NZ", dateLocaleOptions), // Timestamp formatted for New Zealand-style date/time
        totalDemandMW: Math.round(5000 + Math.random() * 3000),           // Total energy demand in megawatts (MW)
        carbonIntensity_gCO2kWh: Math.round(200 + Math.random() * 600),   // Carbon intensity in grams of CO2 per kWh
        generationMix: {                                                  // Power generation mix by fuel type (as percentages)
            coal: Math.round(Math.random() * 40 * 10) / 10,
            gas: Math.round(Math.random() * 30 * 10) / 10,
            hydro: Math.round(Math.random() * 20 * 10) / 10,
            wind: Math.round(Math.random() * 25 * 10) / 10,
            solar: Math.round(Math.random() * 15 * 10) / 10,
        },
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