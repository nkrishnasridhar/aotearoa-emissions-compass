import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('./services/api', () => ({
  __esModule: true,
  fetchNewZealandData: jest.fn(),
  fetchAustraliaData: jest.fn(),
  fetchNewZealandHistory: jest.fn(),
  fetchAustraliaHistory: jest.fn(),
  estimateActivity: jest.fn(),
  aggregateAustraliaData: jest.fn(),
  calculateRenewablePercentage: jest.fn(() => 23),
}));

import App from './App';
import {
  aggregateAustraliaData,
  estimateActivity,
  fetchAustraliaData,
  fetchAustraliaHistory,
  fetchNewZealandData,
  fetchNewZealandHistory,
} from './services/api';

beforeEach(() => {
  jest.clearAllMocks();
});

test('renders the grid timing decision dashboard', async () => {
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
    dataSources: ['EM6 free current carbon intensity', 'EM6 free generation quantities'],
    historyCoverage: 'limited',
    dataNotes: 'EM6 free carbon feed provides the last three trading periods.',
    leadingRenewableFuel: 'hydro',
    leadingThermalFuel: 'gas',
    thermalSharePercentage: 3,
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
  };
  const history = {
    country: 'New Zealand',
    history: [currentNz],
    cleanestWindow: currentNz,
    historyCoverage: 'limited',
    dataSources: ['EM6 free current carbon intensity', 'EM6 free generation quantities'],
    dataNotes: 'EM6 free carbon feed provides the last three trading periods.',
  };

  (fetchNewZealandData as jest.Mock).mockResolvedValue(currentNz);
  (fetchAustraliaData as jest.Mock).mockResolvedValue(auStates);
  (fetchNewZealandHistory as jest.Mock).mockResolvedValue(history);
  (fetchAustraliaHistory as jest.Mock).mockResolvedValue({ ...history, country: 'Australia' });
  (aggregateAustraliaData as jest.Mock).mockReturnValue(currentAu);
  (estimateActivity as jest.Mock).mockResolvedValue({
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
    historyCoverage: 'limited',
    dataNotes: 'EM6 free carbon feed provides the last three trading periods.',
  });

  render(<App />);

  expect(await screen.findByText(/Is now a clean time to use electricity/i)).toBeInTheDocument();
  await waitFor(() => expect(fetchNewZealandData).toHaveBeenCalled());
  await waitFor(() => expect(fetchNewZealandHistory).toHaveBeenCalled());

  expect(screen.getByText(/Grid timing decision tool/i)).toBeInTheDocument();
  expect(screen.getByText(/Activity Planner/i)).toBeInTheDocument();
  expect(screen.getByText(/Recent Grid Trend/i)).toBeInTheDocument();
  expect(screen.getByText(/Australia Regional Breakdown/i)).toBeInTheDocument();
  expect(await screen.findByText(/NZ: Limited recent carbon samples/i)).toBeInTheDocument();
  expect(screen.getByText(/NZ driver/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Estimate/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Estimate/i }));

  await waitFor(() => {
    expect(screen.getByText(/EM6 free carbon feed provides the last three trading periods/i)).toBeInTheDocument();
  });
});

test('renders limited NZ history with Electricity Authority latest dispatch active', async () => {
  const currentNz = {
    country: 'New Zealand',
    timestamp: '2026-09-03T09:00:00Z',
    totalDemandMW: 5200,
    totalGenerationMW: 5300,
    carbonIntensity_gCO2kWh: 42,
    generationMix: { hydro: 3000, wind: 1200, geothermal: 800 },
    renewablePercentage: 100,
    dataFreshnessMinutes: 5,
    gridSignal: 'Use now',
    signalReason: 'Low-carbon window.',
    confidence: 'Medium',
    dataSources: [
      'EM6 free current carbon intensity',
      'EM6 free generation quantities',
      'Electricity Authority real-time dispatch',
    ],
    historyCoverage: 'partial',
    dataNotes: 'EM6 provides NZ carbon intensity while Electricity Authority real-time dispatch provides the latest demand/generation snapshot; carbon history is still limited by the free EM6 feed.',
    leadingRenewableFuel: 'hydro',
    thermalSharePercentage: 3,
  };
  const currentAu = {
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
  };
  const history = {
    country: 'New Zealand',
    history: [currentNz],
    cleanestWindow: currentNz,
    historyCoverage: 'limited',
    dataSources: currentNz.dataSources,
    dataNotes: currentNz.dataNotes,
    dispatchCoverage: 'latest-only',
    dispatchIntervalCount: 1,
    dispatchLatestTimestamp: '2026-09-03T09:05:00',
  };

  (fetchNewZealandData as jest.Mock).mockResolvedValue(currentNz);
  (fetchAustraliaData as jest.Mock).mockResolvedValue([currentAu]);
  (fetchNewZealandHistory as jest.Mock).mockResolvedValue(history);
  (fetchAustraliaHistory as jest.Mock).mockResolvedValue({ ...history, country: 'Australia', historyCoverage: 'full' });
  (aggregateAustraliaData as jest.Mock).mockReturnValue(currentAu);
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
    recommendation: 'Run it now.',
    historyCoverage: 'partial',
    dataNotes: currentNz.dataNotes,
  });

  render(<App />);

  expect(await screen.findByText(/NZ: Limited recent carbon samples/i)).toBeInTheDocument();
  expect(screen.getByText(/EA dispatch demand is active/i)).toBeInTheDocument();
  expect(screen.getByText(/Electricity Authority dispatch is used for the latest live NZ demand snapshot/i)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/Grid/i), { target: { value: 'New Zealand' } });
  fireEvent.click(screen.getByRole('button', { name: /Estimate/i }));

  await waitFor(() => {
    expect(screen.getByText(/carbon history is still limited/i)).toBeInTheDocument();
  });
});
