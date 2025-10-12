// API Service for fetching emissions data

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5000';
const NZ_CARBON_API_URL = 'https://api.em6.co.nz/ords/em6/data_api/current_carbon_intensity';
const NZ_GENERATION_API_URL = 'https://api.em6.co.nz/ords/em6/data_api/free/price';

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
 * Fetches mock emissions data for Australian states from the backend server.
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
 * Fetches live emissions and generation mix data for New Zealand using the EM6 API.
 * 
 * Falls back to hardcoded defaults if the API request fails.
 *
 * @returns {Promise<EmissionsData>} Current emissions data for New Zealand.
 */
export async function fetchNewZealandData(): Promise<EmissionsData> {
    try {
        // Fetch both carbon intensity and generation data in parallel
        const [carbonResponse, generationResponse] = await Promise.all([
            fetch(NZ_CARBON_API_URL),
            fetch(NZ_GENERATION_API_URL),
        ]);

        if (!carbonResponse.ok || !generationResponse.ok) {
            throw new Error('Failed to fetch NZ data');
        }

        const carbonData = await carbonResponse.json();
        const generationData = await generationResponse.json();

        const latestCarbon = carbonData.items?.[0];
        if (!latestCarbon) {
            throw new Error('No carbon intensity data available');
        }

        const latestGeneration = generationData.items?.[0];
        if (!latestGeneration || !latestGeneration.generation_type) {
            throw new Error('No generation data available');
        }

        // Build generation mix from available fields
        const generationMix: GenerationMix = {};
        let totalGeneration = 0;

        latestGeneration.generation_type.forEach((gen: any) => {
            if (gen.hyd_mwh !== undefined) {
                generationMix.hydro = gen.hyd_mwh;
                totalGeneration += gen.hyd_mwh;
            }
            if (gen.win_mwh !== undefined) {
                generationMix.wind = gen.win_mwh;
                totalGeneration += gen.win_mwh;
            }
            if (gen.sol_mwh !== undefined) {
                generationMix.solar = gen.sol_mwh;
                totalGeneration += gen.sol_mwh;
            }
            if (gen.gas_mwh !== undefined) {
                generationMix.gas = gen.gas_mwh;
                totalGeneration += gen.gas_mwh;
            }
            if (gen.cg_mwh !== undefined) {
                generationMix.gas = (generationMix.gas || 0) + gen.cg_mwh;
                totalGeneration += gen.cg_mwh;
            }
            if (gen.cog_mwh !== undefined) {
                generationMix.gas = (generationMix.gas || 0) + gen.cog_mwh;
                totalGeneration += gen.cog_mwh;
            }
            if (gen.geo_mwh !== undefined) {
                generationMix.geothermal = gen.geo_mwh;
                totalGeneration += gen.geo_mwh;
            }
            if (gen.bat_mwh !== undefined) {
                generationMix.other = (generationMix.other || 0) + gen.bat_mwh;
                totalGeneration += gen.bat_mwh;
            }
            if (gen.liq_mwh !== undefined && gen.liq_mwh > 0) {
                generationMix.other = (generationMix.other || 0) + gen.liq_mwh;
                totalGeneration += gen.liq_mwh;
            }
        });

        return {
            country: 'New Zealand',
            timestamp: latestCarbon.timestamp || new Date().toISOString(),
            totalDemandMW: totalGeneration,
            carbonIntensity_gCO2kWh: parseFloat(latestCarbon.nz_carbon_gkwh) || 0,
            generationMix,
        };
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
    
    const weightedIntensity = states.reduce((sum, state) => 
        sum + (state.carbonIntensity_gCO2kWh * state.totalDemandMW), 0
    ) / totalDemand;

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