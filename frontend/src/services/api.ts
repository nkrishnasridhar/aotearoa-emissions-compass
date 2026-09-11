// API Service for fetching emissions data

const DEFAULT_PRODUCTION_BACKEND_URL = 'https://emissions-dashboard-phi.vercel.app';
const LOCAL_BACKEND_URL = 'http://localhost:5000';
const BACKEND_URL = getBackendUrl();

function getBackendUrl(): string {
    const configuredUrl = process.env.REACT_APP_BACKEND_URL?.trim();
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const fallbackUrl = isLocalhost ? LOCAL_BACKEND_URL : DEFAULT_PRODUCTION_BACKEND_URL;
    const rawUrl = configuredUrl || fallbackUrl;
    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

    return withProtocol.replace(/\/+$/, '');
}

export type GridSignal = 'Use now' | 'Wait' | 'Avoid peak';
export type Confidence = 'High' | 'Medium' | 'Low';

/**
 * Represents a mapping of generation types to their MW values.
 */
export interface GenerationMix {
    hydro?: number;
    wind?: number;
    solar?: number;
    gas?: number;
    coal?: number;
    geothermal?: number;
    other?: number;
    [key: string]: number | undefined;
}

/**
 * Live New Zealand electricity emissions data.
 */
export interface EmissionsData {
    country: string;
    timestamp: string;
    totalDemandMW: number;
    totalGenerationMW?: number;
    demandTimestamp?: string;
    runDateTime?: string;
    dispatchMatchedCarbonSample?: boolean;
    carbonIntensity_gCO2kWh: number;
    generationMix: GenerationMix;
    renewablePercentage?: number;
    dataFreshnessMinutes?: number | null;
    gridSignal?: GridSignal;
    signalReason?: string;
    confidence?: Confidence;
    dataSources?: string[];
    historyCoverage?: 'limited' | 'partial' | 'full';
    dataNotes?: string;
    leadingRenewableFuel?: string | null;
    leadingThermalFuel?: string | null;
    thermalSharePercentage?: number;
}

export interface HistoryResponse {
    country: string;
    history: EmissionsData[];
    cleanestWindow: EmissionsData | null;
    dataSources?: string[];
    historyCoverage?: 'limited' | 'partial' | 'full';
    dataNotes?: string;
    dispatchCoverage?: string;
    dispatchIntervalCount?: number;
    dispatchLatestTimestamp?: string;
}

export interface ProfileShare {
    sector?: string;
    gas?: string;
    sharePercentage: number;
    summary: string;
}

export interface ProfileSource {
    name: string;
    url: string;
}

export interface NewZealandProfile {
    country: string;
    year: number;
    grossEmissionsMtCO2e: number;
    sectorShares: ProfileShare[];
    gasShares: ProfileShare[];
    electricityRenewableShare2024: number;
    sources: ProfileSource[];
    notes: string;
}

export interface PlannerInput {
    country?: 'New Zealand';
    kWh: number;
    durationHours: number;
}

export interface PlannerEstimate {
    country: string;
    region: string | null;
    kWh: number;
    durationHours: number;
    now: {
        timestamp: string;
        carbonIntensity_gCO2kWh: number;
        estimatedKgCO2e: number;
        gridSignal: GridSignal;
    };
    cleanerWindow: {
        timestamp: string;
        carbonIntensity_gCO2kWh: number;
        estimatedKgCO2e: number;
    };
    savingsKgCO2e: number;
    recommendation: string;
    dataNotes?: string;
    historyCoverage?: 'limited' | 'partial' | 'full';
}

export async function fetchNewZealandData(): Promise<EmissionsData> {
    return requestJson<EmissionsData>('/api/emissions/new-zealand');
}

export async function fetchNewZealandHistory(hours = 24): Promise<HistoryResponse> {
    return requestJson<HistoryResponse>(`/api/emissions/new-zealand/history?hours=${hours}`);
}

export async function fetchNewZealandProfile(): Promise<NewZealandProfile> {
    return requestJson<NewZealandProfile>('/api/emissions/new-zealand/profile');
}

export async function estimateActivity(input: PlannerInput): Promise<PlannerEstimate> {
    return requestJson<PlannerEstimate>('/api/planner/estimate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
    });
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${BACKEND_URL}${path}`, options);

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
}

export function calculateRenewablePercentage(mix: GenerationMix): number {
    const renewables = ['hydro', 'wind', 'solar', 'geothermal'];
    const renewableTotal = renewables.reduce((sum, fuel) => sum + (mix[fuel] || 0), 0);
    const total = Object.values(mix).reduce((sum: number, val) => sum + (val || 0), 0);

    return total > 0 ? Math.round((renewableTotal / total) * 100) : 0;
}
