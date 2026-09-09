import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('./services/api', () => {
  const currentNz = {
    country: 'New Zealand',
    timestamp: '2026-09-03T09:00:00Z',
    totalDemandMW: 5000,
    carbonIntensity_gCO2kWh: 42,
    generationMix: { hydro: 3000, wind: 1200, geothermal: 800 },
    renewablePercentage: 100,
    dataFreshnessMinutes: 5,
    gridSignal: 'Use now',
    signalReason: 'Low-carbon window.',
    confidence: 'High',
  };
  const auStates = [
    {
      country: 'Australia',
      state: 'NSW',
      timestamp: '2026-09-03T09:00:00Z',
      totalDemandMW: 9000,
      carbonIntensity_gCO2kWh: 520,
      generationMix: { coal: 5000, wind: 1000, hydro: 500 },
      renewablePercentage: 23,
      dataFreshnessMinutes: 5,
      gridSignal: 'Wait',
      signalReason: 'Mixed signal.',
      confidence: 'High',
    },
  ];
  const currentAu = {
    country: 'Australia',
    timestamp: '2026-09-03T09:00:00Z',
    totalDemandMW: 9000,
    carbonIntensity_gCO2kWh: 520,
    generationMix: { coal: 5000, wind: 1000, hydro: 500 },
    renewablePercentage: 23,
    dataFreshnessMinutes: 5,
    gridSignal: 'Wait',
    signalReason: 'Mixed signal.',
    confidence: 'High',
  };
  const history = {
    country: 'New Zealand',
    history: [currentNz],
    cleanestWindow: currentNz,
  };

  return {
    __esModule: true,
    fetchNewZealandData: jest.fn(() => Promise.resolve(currentNz)),
    fetchAustraliaData: jest.fn(() => Promise.resolve(auStates)),
    fetchNewZealandHistory: jest.fn(() => Promise.resolve(history)),
    fetchAustraliaHistory: jest.fn(() => Promise.resolve({ ...history, country: 'Australia' })),
    estimateActivity: jest.fn(() => Promise.resolve({
      country: 'Australia',
      region: null,
      kWh: 10,
      durationHours: 2,
      now: {
        timestamp: '2026-09-03T09:00:00Z',
        carbonIntensity_gCO2kWh: 520,
        estimatedKgCO2e: 5.2,
        gridSignal: 'Wait',
      },
      cleanerWindow: {
        timestamp: '2026-09-03T08:00:00Z',
        carbonIntensity_gCO2kWh: 300,
        estimatedKgCO2e: 3,
      },
      savingsKgCO2e: 2.2,
      recommendation: 'Delay if you can.',
    })),
    aggregateAustraliaData: jest.fn(() => currentAu),
    calculateRenewablePercentage: jest.fn(() => 23),
  };
});

import App from './App';

test('renders the grid timing decision dashboard', async () => {
  render(<App />);

  await waitFor(() => {
    expect(screen.getByText(/Is now a clean time to use electricity/i)).toBeInTheDocument();
  });

  expect(screen.getByText(/Grid timing decision tool/i)).toBeInTheDocument();
  expect(screen.getByText(/Activity Planner/i)).toBeInTheDocument();
  expect(screen.getByText(/Recent Grid Trend/i)).toBeInTheDocument();
  expect(screen.getByText(/Australia Regional Breakdown/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Estimate/i })).toBeInTheDocument();
});
