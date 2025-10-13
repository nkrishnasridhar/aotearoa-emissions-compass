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
        // API returns daily totals in MWh, so divide by 48 (half-hour periods) to get average MW
        const generationMix: GenerationMix = {};
        let totalGeneration = 0;

        latestGeneration.generation_type.forEach((gen: any) => {
            if (gen.hyd_mwh !== undefined) {
                const hyd_mw = (gen.hyd_mwh || 0) / 48;
                generationMix.hydro = hyd_mw;
                totalGeneration += hyd_mw;
            }
            if (gen.win_mwh !== undefined) {
                const win_mw = (gen.win_mwh || 0) / 48;
                generationMix.wind = win_mw;
                totalGeneration += win_mw;
            }
            if (gen.sol_mwh !== undefined) {
                const sol_mw = (gen.sol_mwh || 0) / 48;
                generationMix.solar = sol_mw;
                totalGeneration += sol_mw;
            }
            if (gen.gas_mwh !== undefined) {
                const gas_mw = (gen.gas_mwh || 0) / 48;
                generationMix.gas = gas_mw;
                totalGeneration += gas_mw;
            }
            if (gen.cg_mwh !== undefined) {
                const cg_mw = (gen.cg_mwh || 0) / 48;
                generationMix.gas = (generationMix.gas || 0) + cg_mw;
                totalGeneration += cg_mw;
            }
            if (gen.cog_mwh !== undefined) {
                const cog_mw = (gen.cog_mwh || 0) / 48;
                generationMix.gas = (generationMix.gas || 0) + cog_mw;
                totalGeneration += cog_mw;
            }
            if (gen.geo_mwh !== undefined) {
                const geo_mw = (gen.geo_mwh || 0) / 48;
                generationMix.geothermal = geo_mw;
                totalGeneration += geo_mw;
            }
            if (gen.bat_mwh !== undefined) {
                const bat_mw = (gen.bat_mwh || 0) / 48;
                generationMix.other = (generationMix.other || 0) + bat_mw;
                totalGeneration += bat_mw;
            }
            if (gen.liq_mwh !== undefined && gen.liq_mwh > 0) {
                const liq_mw = (gen.liq_mwh || 0) / 48;
                generationMix.other = (generationMix.other || 0) + liq_mw;
                totalGeneration += liq_mw;
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