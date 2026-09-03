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

/**
 * Represents a mapping of generation types to their MWh values.
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
    carbonIntensity_gCO2kWh: number;
    generationMix: GenerationMix;
}

/**
 * Fetches emissions data for Australian states from the backend server.
 * 
 * @returns {Promise<EmissionsData[]>} A list of emissions data for each state.
 */
export async function fetchAustraliaData(): Promise<EmissionsData[]> {
    try {
        const response = await fetch(`${BACKEND_URL}/api/emissions/australia`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        return data.map((state: any) => ({
            country: 'Australia',
            state: state.state,
            timestamp: state.timestamp,
            totalDemandMW: state.totalDemandMW,
            carbonIntensity_gCO2kWh: state.carbonIntensity_gCO2kWh,
            generationMix: state.generationMix,
        }));
    } catch (error) {
        console.error('Error fetching Australia data:', error);
        throw error;
    }
}

/**
 * Fetches live emissions and generation mix data for New Zealand through the backend server.
 * 
 * @returns {Promise<EmissionsData>} Current emissions data for New Zealand.
 */
export async function fetchNewZealandData(): Promise<EmissionsData> {
    try {
        const response = await fetch(`${BACKEND_URL}/api/emissions/new-zealand`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return response.json();
    } catch (error) {
        console.error('Error fetching New Zealand data:', error);
        throw error;
    }
}

/**
 * Aggregates state-level emissions data into a single national-level summary.
 *
 * @param {EmissionsData[]} states - Array of emissions data for each state.
 * @returns {EmissionsData} Aggregated national data for Australia.
 */
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

    return {
        country: 'Australia',
        timestamp: states[0]?.timestamp || new Date().toISOString(),
        totalDemandMW: totalDemand,
        carbonIntensity_gCO2kWh: weightedIntensity,
        generationMix: aggregatedMix,
    };
}
