const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 5000;

app.use(cors());

// Function to generate random emissions data for each state
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
        timestamp: new Date().toLocaleString("en-NZ", dateLocaleOptions),
        totalDemandMW: Math.round(5000 + Math.random() * 3000),
        carbonIntensity_gCO2kWh: Math.round(200 + Math.random() * 600),
        generationMix: {
            coal: Math.round(Math.random() * 40 * 10) / 10,
            gas: Math.round(Math.random() * 30 * 10) / 10,
            hydro: Math.round(Math.random() * 20 * 10) / 10,
            wind: Math.round(Math.random() * 25 * 10) / 10,
            solar: Math.round(Math.random() * 15 * 10) / 10,
        },
    };
}

// Create an endpoint that returns emissions data for Australian states
app.get('/api/emissions/australia', (req, res) => {
  const states = ['QLD', 'NSW', 'VIC', 'SA', 'TAS'];
  const data = states.map((state) => generateStateData(state));
  res.json(data);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Test API: http://localhost:${PORT}/api/emissions/australia`);
});