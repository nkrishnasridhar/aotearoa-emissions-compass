# 🌏 Live Emissions & Generation Mix Dashboard

A real-time dashboard comparing carbon emissions and electricity generation mix between New Zealand and Australia.

## 🎯 Overview

This dashboard displays:
- **Current carbon intensity** (gCO₂/kWh) for both countries
- **Live generation mix** by fuel type (hydro, wind, solar, gas, coal, geothermal)
- **Side-by-side comparison** of NZ and AU
- **Auto-refresh** every 5 minutes
- **Manual refresh** button

## 🏗️ Architecture

### Frontend
- **Framework**: React 19 with TypeScript
- **Charts**: Recharts for data visualization
- **Styling**: Custom CSS with responsive design
- **Data Sources**:
  - **New Zealand**: Direct API calls to EM6 APIs
    - Carbon intensity: `https://api.em6.co.nz/ords/em6/data_api/current_carbon_intensity`
    - Generation mix: `https://api.em6.co.nz/ords/em6/data_api/free/price`
  - **Australia**: Backend API (see below)

### Backend
- **Framework**: Node.js with Express
- **Port**: 5000
- **Endpoints**:
  - `GET /api/emissions/australia` - Returns emissions data for 5 Australian states
  - `GET /health` - Health check endpoint
- **Data**: Mock/random data (realistic values for demonstration purposes)

## 🚀 Quick Start

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Installation & Running

#### 1. Clone the repository
```bash
git clone <your-repo-url>
cd emissions-dashboard
```

#### 2. Start the Backend
```bash
cd backend
npm install
npm start
```

The backend will start on `http://localhost:5000`

Test it: Open `http://localhost:5000/api/emissions/australia` in your browser

#### 3. Start the Frontend (in a new terminal)
```bash
cd frontend
npm install
npm start
```

The frontend will start on `http://localhost:3000` and open automatically in your browser.

## ✨ Features Implemented

### Core Requirements ✅
- ✅ Display current carbon intensity for NZ and AU
- ✅ Show generation mix with interactive charts
- ✅ Enable side-by-side country comparison
- ✅ Include manual refresh button

### Optional Enhancements ✅
- ✅ Auto-refresh every 5 minutes
- ✅ Smooth animations and transitions
- ✅ Fully responsive design
- ✅ Color-coded carbon intensity levels
- ✅ Renewable percentage calculation
- ✅ Total demand display

## 🎨 Design Features

### Carbon Intensity Color Coding
- 🟢 **Green** (Very Low / Low): < 100 gCO₂/kWh
- 🟡 **Yellow** (Moderate): 100-500 gCO₂/kWh
- 🔴 **Red** (High / Very High): > 500 gCO₂/kWh

### Generation Mix Colors
- 🔵 **Hydro**: Blue
- 🟢 **Wind**: Green
- 🟠 **Solar**: Orange
- 🟣 **Geothermal**: Purple
- 🟤 **Gas**: Dark orange
- ⚫ **Coal**: Gray
- ⚪ **Other**: Light gray

## 📊 Data Flow

### New Zealand
1. Frontend fetches from two EM6 APIs simultaneously:
   - Carbon intensity API for emissions data
   - Generation price API for fuel mix data
2. Data is parsed and combined in `api.ts`
3. Displayed in real-time on the dashboard

### Australia
1. Backend generates realistic mock data for 5 states (QLD, NSW, VIC, SA, TAS)
2. Frontend fetches from backend API endpoint
3. State data is aggregated into country-level totals
4. Displayed alongside NZ data

## 🔧 API Details

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
- **Carbon Intensity**: Returns real-time carbon emissions (gCO₂/kWh) and renewable percentage
- **Generation Mix**: Returns daily generation by fuel type (MWh)

## 🧪 Testing

### Manual Testing Checklist
- [ ] Backend responds at `http://localhost:5000/api/emissions/australia`
- [ ] Frontend loads without errors
- [ ] Both countries display data
- [ ] Charts render correctly
- [ ] Manual refresh button works
- [ ] Auto-refresh triggers after 5 minutes
- [ ] Responsive on mobile devices
- [ ] Error handling displays when backend is down

## 📝 Implementation Notes

### Australia Data
As specified in the requirements, Australian data is served through a backend API. The current implementation uses **randomly generated mock data** that resembles realistic electricity grid values.

### Tech Decisions
- **React + TypeScript**: Type safety and component reusability
- **Recharts**: Lightweight, responsive charts
- **Express**: Simple, fast backend setup
- **No state management library**: App state is simple enough for React hooks
- **CSS over styled-components**: Faster development, no additional dependencies

## 🚨 Known Limitations

1. **Australia data is mocked**: Not real-time data from Australian grid
2. **NZ generation data**: Uses daily totals, not real-time generation
3. **No historical trends**: Current implementation shows only live data
4. **CORS**: Development uses permissive CORS; production would need proper configuration

## 👤 Author

**Krishna**  
Technical Assessment for Evnex