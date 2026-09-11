# Aotearoa Emissions Compass

A New Zealand-focused emissions decision tool for understanding where emissions matter nationally, which household lever to consider first, and what today's electricity grid means for flexible energy use.

## Overview

The dashboard answers two practical questions:

- **Where do emissions matter in Aotearoa New Zealand?**
- **What practical household lever should I consider first?**
- **Is now a good time to run flexible electric loads?**

New Zealand's electricity grid is already mostly renewable, so the useful question is not whether NZ looks clean beside someone else. This project focuses on NZ's actual emissions profile: agriculture and energy dominate gross emissions, while clean electricity creates an opportunity to electrify transport, heating, and process heat.

The app shows:

- Live NZ electricity carbon intensity in `gCO2/kWh`
- Current NZ generation mix by fuel type
- Renewable share, total demand, data freshness, and confidence
- `Use now`, `Wait`, or `Avoid peak` grid timing signal
- A compact Best Next Move recommendation for petrol/diesel drivers, gas/LPG households, or mostly-electric households
- Estimated emissions for flexible loads such as EV charging, laundry, dishwashers, and heat pumps
- Best recent NZ electricity sample for context, not forecasting
- National NZ emissions profile by sector and gas
- Context explaining why electricity timing helps, but transport, fossil fuel substitution, agriculture, and waste are larger parts of the national picture

## Data Sources

### Live Electricity

New Zealand live electricity data uses a free-first provider approach:

- EM6 free current carbon intensity
- EM6 free generation quantities
- Optional Electricity Authority real-time dispatch demand and generation snapshot

The free EM6 carbon feed provides only the last three trading periods, so 24-hour NZ carbon history is marked as limited unless a richer provider is added later. The optional Electricity Authority integration improves the latest demand and generation snapshot, but it does not provide a full carbon-intensity history.

### National Emissions Profile

The static NZ profile endpoint uses rounded public-summary figures from official sources:

- Ministry for the Environment: New Zealand's Greenhouse Gas Inventory 1990-2024 snapshot
- MBIE: Energy in New Zealand 2025, electricity

Current v1 profile figures:

- 2024 gross emissions: `75.8 Mt CO2e`
- Sector split: agriculture `53%`, energy `38%`, industrial processes and product use `6%`, waste `3%`
- Gas split: methane `48%`, carbon dioxide `41%`, nitrous oxide `9%`, fluorinated gases `2%`
- 2024 electricity generation from renewable sources: `85.5%`
- Household levers: transport electrification, home gas/LPG replacement, flexible-load timing, and organic waste reduction

## Architecture

### Frontend

- **Framework**: React 19 with TypeScript
- **Charts**: Recharts
- **Styling**: Custom responsive CSS
- **Data access**: Calls the backend API for NZ live grid data, recent history, profile context, and activity estimates

### Backend

- **Framework**: Node.js with Express
- **Local port**: `5000`
- **API endpoints**:
  - `GET /api/emissions/new-zealand` - Returns current NZ live grid signal and generation mix
  - `GET /api/emissions/new-zealand/history?hours=24` - Returns recent NZ carbon samples and the best recent sample
  - `GET /api/emissions/new-zealand/profile` - Returns static official-source NZ emissions profile context and ordered household levers
  - `POST /api/planner/estimate` - Estimates emissions for a selected NZ electricity activity
  - `GET /health` - Health check and provider configuration status

## Running Locally

### Prerequisites

- Node.js v14 or higher
- npm or yarn

### 1. Install and start the backend

```bash
cd backend
npm install
npm start
```

Optional NZ real-time dispatch settings can be added if you have a registered free Electricity Authority API subscription:

```bash
NZ_REALTIME_PROVIDER=ea
EA_API_KEY=your-ea-api-key
EA_API_BASE_URL=https://emi.azure-api.net
EA_REALTIME_DISPATCH_PATH=/real-time-dispatch/
```

The backend starts on `http://localhost:5000`.

Useful local checks:

```bash
http://localhost:5000/health
http://localhost:5000/api/emissions/new-zealand
http://localhost:5000/api/emissions/new-zealand/profile
```

### 2. Install and start the frontend

```bash
cd frontend
npm install
npm start
```

The frontend starts on `http://localhost:3000`.

## Feature Details

### Grid Signal

The app classifies the current NZ grid as:

- **Use now**: carbon intensity is low or renewable share is high
- **Wait**: the signal is mixed, so flexible loads may be worth delaying
- **Avoid peak**: carbon intensity is high or renewable share is low

The signal is intended as a practical timing guide for flexible electricity use, not a forecast.

### Flexible Load Check

The planner estimates emissions for a selected electric load using:

```text
kWh * carbon intensity gCO2/kWh / 1000 = kg CO2e
```

It compares running now with the best recent NZ sample. Because free NZ carbon history is limited, the planner clearly displays data coverage notes and avoids presenting recent samples as a forecast.

### Best Next Move

The Best Next Move panel is intentionally lightweight. It asks for one broad household situation and recommends the highest-priority static lever from the NZ profile data:

- petrol/diesel driving: consider transport electrification first
- gas/LPG at home: consider efficient electric replacement at end of life
- mostly electric already: use flexible-load timing as the next optimisation

It does not estimate personal annual emissions or replace detailed household advice.

### National Context

The "What matters most in NZ?" section exists to keep the product honest. Electricity timing can reduce the impact of flexible loads, but New Zealand's larger emissions challenge is about:

- reducing agricultural methane and nitrous oxide
- shifting road transport and industrial energy away from fossil fuels
- using renewable electricity for more end uses
- reducing waste emissions

## Testing

Run backend tests:

```bash
cd backend
npm test
```

Run frontend tests:

```bash
cd frontend
npm test -- --watchAll=false
```

## Implementation Notes

The backend keeps external live-data calls server-side so credentials stay out of the browser and CORS issues are avoided.

The national profile endpoint is static in v1 by design. This avoids requiring a registered Stats NZ API key while still giving the app a clearer NZ-specific purpose. A later version could replace or supplement the static profile with scheduled official data imports.

## Author

Krishna
