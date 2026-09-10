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
 * Unified emissions data structure for a country or state.
 */
export interface EmissionsData {
    country: string;
    state?: string;
    timestamp: string;
    totalDemandMW: number;
    totalGenerationMW?: number;
    demandTimestamp?: string;
    runDateTime?: string;
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
    regionHistory?: EmissionsData[];
    dataSources?: string[];
    historyCoverage?: 'limited' | 'partial' | 'full';
    dataNotes?: string;
}

export interface PlannerInput {
    country: 'Australia' | 'New Zealand';
    region?: string;
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

export async function fetchAustraliaData(): Promise<EmissionsData[]> {
    const data = await requestJson<EmissionsData[]>('/api/emissions/australia');

    return data.map((state) => ({
        ...state,
        country: state.country || 'Australia',
    }));
}

export async function fetchNewZealandData(): Promise<EmissionsData> {
    return requestJson<EmissionsData>('/api/emissions/new-zealand');
}

export async function fetchAustraliaHistory(hours = 24): Promise<HistoryResponse> {
    return requestJson<HistoryResponse>(`/api/emissions/australia/history?hours=${hours}`);
}

export async function fetchNewZealandHistory(hours = 24): Promise<HistoryResponse> {
    return requestJson<HistoryResponse>(`/api/emissions/new-zealand/history?hours=${hours}`);
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

export function aggregateAustraliaData(states: EmissionsData[]): EmissionsData {
    const totalDemand = states.reduce((sum, state) => sum + state.totalDemandMW, 0);
    const weightedIntensity = totalDemand > 0 ? states.reduce((sum, state) =>
        sum + (state.carbonIntensity_gCO2kWh * state.totalDemandMW), 0
    ) / totalDemand : 0;

    const aggregatedMix: GenerationMix = {};
    states.forEach(state => {
        Object.entries(state.generationMix).forEach(([fuel, value]) => {
            if (value !== undefined) {
                aggregatedMix[fuel] = (aggregatedMix[fuel] || 0) + value;
            }
        });
    });

    const renewablePercentage = calculateRenewablePercentage(aggregatedMix);
    const leadingFuel = getLeadingFuel(aggregatedMix);
    const gridSignal = classifyGridSignal(weightedIntensity, renewablePercentage);

    return {
        country: 'Australia',
        timestamp: getLatestTimestamp(states.map((state) => state.timestamp)),
        totalDemandMW: totalDemand,
        carbonIntensity_gCO2kWh: weightedIntensity,
        generationMix: aggregatedMix,
        renewablePercentage,
        dataFreshnessMinutes: states.reduce((freshest, state) => {
            if (state.dataFreshnessMinutes === undefined || state.dataFreshnessMinutes === null) return freshest;
            return freshest === null ? state.dataFreshnessMinutes : Math.min(freshest, state.dataFreshnessMinutes);
        }, null as number | null),
        gridSignal,
        signalReason: createSignalReason(gridSignal, weightedIntensity, renewablePercentage, leadingFuel),
        confidence: states.some((state) => state.confidence === 'Low') ? 'Medium' : 'High',
    };
}

export function calculateRenewablePercentage(mix: GenerationMix): number {
    const renewables = ['hydro', 'wind', 'solar', 'geothermal'];
    const renewableTotal = renewables.reduce((sum, fuel) => sum + (mix[fuel] || 0), 0);
    const total = Object.values(mix).reduce((sum: number, val) => sum + (val || 0), 0);

    return total > 0 ? Math.round((renewableTotal / total) * 100) : 0;
}

function classifyGridSignal(carbonIntensity: number, renewablePercentage: number): GridSignal {
    if (carbonIntensity <= 150 || renewablePercentage >= 80) return 'Use now';
    if (carbonIntensity >= 550 || renewablePercentage < 35) return 'Avoid peak';
    return 'Wait';
}

function createSignalReason(signal: GridSignal, carbonIntensity: number, renewablePercentage: number, leadingFuel: string | null): string {
    const fuelText = leadingFuel ? `${leadingFuel} is the largest visible source` : 'generation mix is incomplete';

    if (signal === 'Use now') {
        return `Low-carbon window: ${Math.round(carbonIntensity)} gCO2/kWh and ${renewablePercentage}% renewable. ${fuelText}.`;
    }

    if (signal === 'Avoid peak') {
        return `High-impact period: ${Math.round(carbonIntensity)} gCO2/kWh and ${renewablePercentage}% renewable. ${fuelText}.`;
    }

    return `Mixed signal: ${Math.round(carbonIntensity)} gCO2/kWh and ${renewablePercentage}% renewable. ${fuelText}.`;
}

function getLeadingFuel(mix: GenerationMix): string | null {
    return Object.entries(mix)
        .filter(([, value]) => (value || 0) > 0)
        .sort((left, right) => (right[1] || 0) - (left[1] || 0))[0]?.[0] || null;
}

function getLatestTimestamp(timestamps: string[]): string {
    return timestamps.reduce((latest, timestamp) =>
        new Date(timestamp) > new Date(latest) ? timestamp : latest,
        timestamps[0] || new Date().toISOString()
    );
}
