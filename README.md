# Live Emissions & Generation Mix Dashboard

A grid timing decision tool for comparing electricity carbon intensity and generation mix between New Zealand and Australia.

## Overview

The dashboard answers a practical question: **is now a clean time to use electricity?**

It combines live grid data, recent trends, and simple activity estimates so users can decide whether to run flexible electricity loads now or wait for a cleaner window.

It shows:

- Current carbon intensity in `gCO2/kWh`
- Generation mix by fuel type
- Total demand in MW
- Renewable generation percentage
- `Use now`, `Wait`, or `Avoid peak` grid signals
- Estimated emissions for common activities such as EV charging, laundry, dishwashers, and heat pumps
- Recent cleanest windows for shifting flexible demand
- Australian NEM regional comparison
- Automatic refresh every 5 minutes
- Manual refresh for on-demand updates

New Zealand data uses a free-first provider approach: EM6 free feeds provide current carbon intensity and generation context, with optional backend configuration reserved for richer registered Electricity Authority data later. Australian data comes from OpenElectricity for the National Electricity Market regions `QLD1`, `NSW1`, `VIC1`, `SA1`, and `TAS1`, then the frontend aggregates those regions into a country-level Australia card.

## Architecture

### Frontend
- **Framework**: React 19 with TypeScript
- **Charts**: Recharts for data visualization
- **Styling**: Custom CSS with responsive design
- **Data access**: Calls the backend API for both countries

### Backend
- **Framework**: Node.js with Express
- **Local port**: 5000
- **API endpoints**:
  - `GET /api/emissions/australia` - Returns OpenElectricity NEM data for 5 Australian regions
  - `GET /api/emissions/new-zealand` - Returns EM6 data for New Zealand
  - `GET /api/emissions/australia/history?hours=24` - Returns recent Australian NEM history
  - `GET /api/emissions/new-zealand/history?hours=24` - Returns recent New Zealand history
  - `POST /api/planner/estimate` - Estimates emissions for a selected activity
  - `GET /health` - Health check endpoint
- **External sources**:
  - EM6 free current carbon intensity and generation data for New Zealand
  - Optional registered Electricity Authority provider configuration for future NZ real-time data
  - OpenElectricity generation, demand, energy, and emissions data for Australia

## Running Locally

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### 1. Clone the repository
```bash
git clone https://github.com/nkrishnasridhar/emissions-dashboard
cd emissions-dashboard
```

### 2. Start the backend
```bash
cd backend
npm install
npm start
```

Create `backend/.env` from `backend/.env.example` and set your OpenElectricity API key:

```bash
OPENELECTRICITY_API_KEY=your-api-key
```

Optional NZ real-time provider settings can be added later if you have a registered free Electricity Authority API configuration:

```bash
NZ_REALTIME_PROVIDER=ea
EA_API_KEY=your-ea-api-key
EA_API_BASE_URL=your-ea-api-base-url
```

The backend will start on `http://localhost:5000`.

To test it locally, open `http://localhost:5000/health` or `http://localhost:5000/api/emissions/australia`.

### 3. Start the frontend
```bash
cd frontend
npm install
npm start
```

The frontend will start on `http://localhost:3000` and open automatically in your browser.

## Features

- Classify each grid as `Use now`, `Wait`, or `Avoid peak`
- Estimate activity emissions now versus the cleanest recent window
- Compare recent carbon, renewable, and demand trends
- Identify the cleanest Australian NEM region
- Visualize generation mix through pie charts
- Show renewable percentage, total demand, and data freshness
- Refresh data manually and automatically every 5 minutes

## Design Details

### Carbon Intensity Color Coding
- **Green**: Very Low / Low, below `100 gCO2/kWh`
- **Yellow**: Moderate, `100-500 gCO2/kWh`
- **Red**: High / Very High, above `500 gCO2/kWh`

### Generation Mix Colors
- Hydro: blue
- Wind: green
- Solar: orange
- Geothermal: purple
- Gas: dark orange
- Coal: gray
- Other: light gray

## Data Flow

### New Zealand
1. Backend fetches from two EM6 APIs simultaneously:
   - Carbon intensity API for emissions data
   - Generation price API for fuel mix data
2. Backend marks free EM6 carbon history as limited because it only covers the most recent trading periods
3. Backend adds NZ-specific source metadata, leading renewable fuel, leading thermal fuel, and thermal share
4. Frontend fetches from backend API endpoint and displays data coverage clearly

### Australia
1. Backend fetches NEM data from OpenElectricity for QLD1, NSW1, VIC1, SA1, and TAS1
2. Backend maps generation, demand, energy, and emissions into the dashboard response format
3. Frontend fetches from backend API endpoint
4. State data is aggregated into country-level totals
5. Displayed alongside NZ data

## API Details

### Backend API Response Format
```json
[
  {
    "state": "QLD",
    "timestamp": "11/10/2025, 02:30:45 pm",
    "totalDemandMW": 7234,
    "carbonIntensity_gCO2kWh": 456,
    "generationMix": {
      "coal": 28.5,
      "gas": 18.3,
      "hydro": 12.7,
      "wind": 15.2,
      "solar": 8.9
    }
  },
  // ... 4 more states
]
```

### EM6 APIs Used
- **Carbon Intensity**: Returns real-time carbon emissions (`gCO2/kWh`) and renewable percentage
- **Generation Mix**: Returns daily generation by fuel type (MWh)

### Optional NZ Provider Hooks
- **Electricity Authority**: Optional registered/free provider configuration is supported for future richer NZ generation and demand history
- **Free-first fallback**: If optional NZ provider config is absent, the backend keeps using EM6 free feeds and marks history coverage as limited

### OpenElectricity APIs Used
- **Generation**: NEM power data grouped by region and fuel technology group
- **Demand**: NEM market demand grouped by region
- **Emissions and energy**: Used to calculate carbon intensity for each Australian region

## Implementation Notes

Australian and New Zealand data are both served through the backend. This keeps the OpenElectricity API key out of the browser and avoids browser-side connectivity or CORS issues with external data sources.

The backend caches country data briefly to reduce repeated upstream API usage during dashboard refreshes.

The planner uses recent historical data rather than forecasts. Its recommendation is intended as a practical grid-timing signal, not a guarantee about future grid conditions.

### Tech Decisions
- **React + TypeScript**: Type safety and component reusability
- **Recharts**: Lightweight, responsive charts
- **Express**: Simple, fast backend setup
- **No state management library**: App state is simple enough for React hooks
- **CSS over styled-components**: Faster development, no additional dependencies

## AI Assistance Disclosure

This project was developed with the assistance of **Claude (Anthropic)**. AI assistance was primarily used for:

- **Styling and CSS**: Component styling, responsive design, and visual polish
- **API Integration**: Parsing EM6 API responses and data transformation logic in `api.ts`
- **Documentation**: README structure, code comments, and inline documentation
- **TypeScript Types**: Interface definitions and type safety improvements
- **Boilerplate Code**: Initial project structure and configuration files

**Core logic, architecture decisions, and React component structure were designed and implemented by me.** AI was used as a development tool to accelerate implementation and ensure code quality, similar to how Stack Overflow or documentation would be referenced during development.

## Author

**Krishna**
