import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('./services/api', () => ({
  __esModule: true,
  fetchNewZealandData: jest.fn(),
  fetchNewZealandHistory: jest.fn(),
  fetchNewZealandProfile: jest.fn(),
  estimateActivity: jest.fn(),
  calculateRenewablePercentage: jest.fn(() => 23),
}));

import App from './App';
import {
  estimateActivity,
  fetchNewZealandData,
  fetchNewZealandHistory,
  fetchNewZealandProfile,
} from './services/api';

const currentNz = {
  country: 'New Zealand',
  timestamp: '2026-09-03T09:00:00Z',
  totalDemandMW: 5000,
  carbonIntensity_gCO2kWh: 42,
  generationMix: { hydro: 3000, wind: 1200, geothermal: 800 },
  renewablePercentage: 100,
  dataFreshnessMinutes: 5,
  gridSignal: 'Use now',
  signalReason: 'NZ signal: 42 gCO2/kWh and 100% renewable. Hydro leads the mix and thermal share is 3%.',
  confidence: 'High',
  dataSources: ['EM6 free current carbon intensity', 'EM6 free generation quantities'],
  historyCoverage: 'limited',
  dataNotes: 'EM6 free carbon feed provides the last three trading periods; recent-sample comparisons are not forecasts.',
  leadingRenewableFuel: 'hydro',
  leadingThermalFuel: 'gas',
  thermalSharePercentage: 3,
};

const history = {
  country: 'New Zealand',
  history: [currentNz],
  cleanestWindow: currentNz,
  historyCoverage: 'limited',
  dataSources: ['EM6 free current carbon intensity', 'EM6 free generation quantities'],
  dataNotes: 'EM6 free carbon feed provides the last three trading periods; recent-sample comparisons are not forecasts.',
};

const profile = {
  country: 'New Zealand',
  year: 2024,
  grossEmissionsMtCO2e: 75.8,
  sectorShares: [
    {
      sector: 'Agriculture',
      sharePercentage: 53,
      summary: 'Mainly methane and nitrous oxide from livestock, manure, fertiliser, and soils.',
    },
    {
      sector: 'Energy',
      sharePercentage: 38,
      summary: 'Includes road transport, electricity production, industrial fuel use, and other energy demand.',
    },
  ],
  gasShares: [
    {
      gas: 'Methane',
      sharePercentage: 48,
      summary: 'Largely connected to agricultural livestock emissions.',
    },
    {
      gas: 'Carbon dioxide',
      sharePercentage: 41,
      summary: 'Mostly from energy, transport, and industrial processes.',
    },
  ],
  electricityRenewableShare2024: 85.5,
  sources: [],
  notes: 'Sector and gas shares are rounded public-summary values.',
};

beforeEach(() => {
  jest.clearAllMocks();
  (fetchNewZealandData as jest.Mock).mockResolvedValue(currentNz);
  (fetchNewZealandHistory as jest.Mock).mockResolvedValue(history);
  (fetchNewZealandProfile as jest.Mock).mockResolvedValue(profile);
  (estimateActivity as jest.Mock).mockResolvedValue({
    country: 'New Zealand',
    region: null,
    kWh: 10,
    durationHours: 2,
    now: {
      timestamp: '2026-09-03T09:00:00Z',
      carbonIntensity_gCO2kWh: 42,
      estimatedKgCO2e: 0.42,
      gridSignal: 'Use now',
    },
    cleanerWindow: {
      timestamp: '2026-09-03T08:00:00Z',
      carbonIntensity_gCO2kWh: 40,
      estimatedKgCO2e: 0.4,
    },
    savingsKgCO2e: 0.02,
    recommendation: 'Run it now if it suits you. Timing this load is not the main emissions lever today.',
    historyCoverage: 'limited',
    dataNotes: 'EM6 free carbon feed provides the last three trading periods; recent-sample comparisons are not forecasts.',
  });
});

test('renders the Aotearoa Emissions Compass dashboard', async () => {
  render(<App />);

  expect(await screen.findByText(/Where do emissions matter in New Zealand/i)).toBeInTheDocument();
  await waitFor(() => expect(fetchNewZealandData).toHaveBeenCalled());
  await waitFor(() => expect(fetchNewZealandHistory).toHaveBeenCalled());
  await waitFor(() => expect(fetchNewZealandProfile).toHaveBeenCalled());

  expect(screen.getByText(/Aotearoa emissions compass/i)).toBeInTheDocument();
  expect(screen.getByText(/National emissions profile/i)).toBeInTheDocument();
  expect(screen.getByText(/75.8 Mt CO2e/i)).toBeInTheDocument();
  expect(screen.getByText(/Today's take/i)).toBeInTheDocument();
  expect(screen.getByText(/Flexible electricity use is fine now/i)).toBeInTheDocument();
  expect(screen.getByText(/Biggest NZ source/i)).toBeInTheDocument();
  expect(screen.getByText(/Biggest practical household lever/i)).toBeInTheDocument();
  expect(screen.getByText(/Grid timing now/i)).toBeInTheDocument();
  expect(screen.getByText(/Flexible-load saving/i)).toBeInTheDocument();
  expect(screen.getByText(/What matters most in NZ/i)).toBeInTheDocument();
  expect(screen.getByText(/Flexible Load Check/i)).toBeInTheDocument();
  expect(screen.getByText(/Live NZ generation mix/i)).toBeInTheDocument();
  expect(screen.queryByText(new RegExp(['Recent NZ Grid', 'Trend'].join(' '), 'i'))).not.toBeInTheDocument();
  expect(screen.queryByText(new RegExp(['Activity', 'Planner'].join(' '), 'i'))).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Estimate/i })).toBeInTheDocument();
});

test('removes legacy comparison UI from the user-facing experience', async () => {
  render(<App />);

  expect(await screen.findByText(/Where do emissions matter in New Zealand/i)).toBeInTheDocument();

  expect(screen.queryByText(new RegExp(['Aus', 'tralia Regional Breakdown'].join(''), 'i'))).not.toBeInTheDocument();
  expect(screen.queryByText(new RegExp(['Aus', 'tralia aggregate'].join(''), 'i'))).not.toBeInTheDocument();
  expect(screen.queryByText(new RegExp(`^${['Aus', 'tralia'].join('')}$`, 'i'))).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Grid/i)).not.toBeInTheDocument();
});

test('estimates flexible load emissions against the NZ grid only', async () => {
  render(<App />);

  expect(await screen.findByRole('button', { name: /Estimate/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Estimate/i }));

  await waitFor(() => {
    expect(estimateActivity).toHaveBeenCalledWith({
      country: 'New Zealand',
      kWh: 18,
      durationHours: 3,
    });
  });
  expect(await screen.findByText(/recent-sample comparisons are not forecasts/i)).toBeInTheDocument();
  expect(screen.getAllByText(/Best recent sample/i).length).toBeGreaterThan(0);
});

test('renders limited NZ history with Electricity Authority latest dispatch active', async () => {
  (fetchNewZealandData as jest.Mock).mockResolvedValue({
    ...currentNz,
    totalDemandMW: 5200,
    totalGenerationMW: 5300,
    confidence: 'Medium',
    dataSources: [
      'EM6 free current carbon intensity',
      'EM6 free generation quantities',
      'Electricity Authority real-time dispatch',
    ],
    historyCoverage: 'partial',
    dataNotes: 'EM6 provides NZ carbon intensity while Electricity Authority real-time dispatch provides the latest demand/generation snapshot; recent carbon samples are still limited by the free EM6 feed.',
  });
  (fetchNewZealandHistory as jest.Mock).mockResolvedValue({
    ...history,
    dataSources: [
      'EM6 free current carbon intensity',
      'EM6 free generation quantities',
      'Electricity Authority real-time dispatch',
    ],
    dataNotes: 'EM6 provides NZ carbon intensity while Electricity Authority real-time dispatch provides the latest demand/generation snapshot; recent carbon samples are still limited by the free EM6 feed.',
    dispatchCoverage: 'latest-only',
    dispatchIntervalCount: 1,
    dispatchLatestTimestamp: '2026-09-03T09:05:00',
  });

  render(<App />);

  expect(await screen.findByText(/Live NZ grid signal/i)).toBeInTheDocument();
  expect(screen.getByText(/Flexible-load saving/i)).toBeInTheDocument();
  expect(screen.queryByText(new RegExp(['Recent NZ Grid', 'Trend'].join(' '), 'i'))).not.toBeInTheDocument();
});
