require('dotenv').config({ quiet: true });

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const PORT = process.env.PORT || 5000;
const OPEN_ELECTRICITY_BASE_URL =
    process.env.OPENELECTRICITY_API_BASE_URL || 'https://api.openelectricity.org.au/v4';
const NZ_CARBON_API_URL = 'https://api.em6.co.nz/ords/em6/data_api/current_carbon_intensity';
const NZ_GENERATION_API_URL = 'https://api.em6.co.nz/ords/em6/data_api/free/price';
const NEM_REGIONS = {
    QLD1: 'QLD',
    NSW1: 'NSW',
    VIC1: 'VIC',
    SA1: 'SA',
    TAS1: 'TAS',
};
const CACHE_TTL_MS = 4 * 60 * 1000;

let australiaCache = null;
let newZealandCache = null;

function createApp(options = {}) {
    const app = express();
    const httpClient = options.httpClient || axios;

    app.use(cors());

    app.get('/api/emissions/australia', async (req, res) => {
        try {
            if (!process.env.OPENELECTRICITY_API_KEY) {
                return res.status(500).json({
                    error: 'OpenElectricity API key is not configured on the backend.',
                });
            }

            if (australiaCache && Date.now() - australiaCache.cachedAt < CACHE_TTL_MS) {
                return res.json(australiaCache.data);
            }

            const data = await fetchAustraliaNEMData(httpClient);
            australiaCache = {
                cachedAt: Date.now(),
                data,
            };

            return res.json(data);
        } catch (error) {
            const mappedError = mapOpenElectricityError(error);
            console.error('Error fetching OpenElectricity Australia data:', mappedError.logMessage);

            return res.status(mappedError.status).json({
                error: mappedError.message,
            });
        }
    });

    app.get('/api/emissions/new-zealand', async (req, res) => {
        try {
            if (newZealandCache && Date.now() - newZealandCache.cachedAt < CACHE_TTL_MS) {
                return res.json(newZealandCache.data);
            }

            const data = await fetchNewZealandData(httpClient);
            newZealandCache = {
                cachedAt: Date.now(),
                data,
            };

            return res.json(data);
        } catch (error) {
            console.error('Error fetching EM6 New Zealand data:', error.message);

            return res.status(502).json({
                error: 'New Zealand emissions data is temporarily unavailable.',
            });
        }
    });

    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            openElectricityConfigured: Boolean(process.env.OPENELECTRICITY_API_KEY),
        });
    });

    return app;
}

async function fetchAustraliaNEMData(httpClient = axios) {
    const [generationResponse, demandResponse, emissionsResponse] = await Promise.all([
        requestOpenElectricity(httpClient, '/data/network/NEM', {
            metrics: ['power'],
            interval: '5m',
            date_start: getNemDateStart(),
            primary_grouping: 'network_region',
            secondary_grouping: 'fueltech_group',
        }),
        requestOpenElectricity(httpClient, '/market/network/NEM', {
            metrics: ['demand'],
            interval: '5m',
            date_start: getNemDateStart(),
            primary_grouping: 'network_region',
        }),
        requestOpenElectricity(httpClient, '/data/network/NEM', {
            metrics: ['energy', 'emissions'],
            interval: '5m',
            date_start: getNemDateStart(),
            primary_grouping: 'network_region',
        }),
    ]);

    return transformOpenElectricityData(
        generationResponse.data,
        demandResponse.data,
        emissionsResponse.data
    );
}

async function fetchNewZealandData(httpClient = axios) {
    const [carbonResponse, generationResponse] = await Promise.all([
        httpClient.get(NZ_CARBON_API_URL, { timeout: 15000 }),
        httpClient.get(NZ_GENERATION_API_URL, { timeout: 15000 }),
    ]);

    return transformNewZealandData(carbonResponse.data, generationResponse.data);
}

function transformNewZealandData(carbonData, generationData) {
    const latestCarbon = carbonData.items?.[0];
    if (!latestCarbon) {
        throw new Error('No carbon intensity data available.');
    }

    const latestGeneration = generationData.items?.[0];
    if (!latestGeneration || !latestGeneration.generation_type) {
        throw new Error('No generation data available.');
    }

    const generationMix = {};
    let totalGeneration = 0;

    latestGeneration.generation_type.forEach((gen) => {
        totalGeneration += addGenerationValue(generationMix, 'hydro', gen.hyd_mwh);
        totalGeneration += addGenerationValue(generationMix, 'wind', gen.win_mwh);
        totalGeneration += addGenerationValue(generationMix, 'solar', gen.sol_mwh);
        totalGeneration += addGenerationValue(generationMix, 'gas', gen.gas_mwh);
        totalGeneration += addGenerationValue(generationMix, 'gas', gen.cg_mwh);
        totalGeneration += addGenerationValue(generationMix, 'gas', gen.cog_mwh);
        totalGeneration += addGenerationValue(generationMix, 'geothermal', gen.geo_mwh);
        totalGeneration += addGenerationValue(generationMix, 'other', gen.bat_mwh);

        if (gen.liq_mwh !== undefined && gen.liq_mwh > 0) {
            totalGeneration += addGenerationValue(generationMix, 'other', gen.liq_mwh);
        }
    });

    return {
        country: 'New Zealand',
        timestamp: latestCarbon.timestamp || new Date().toISOString(),
        totalDemandMW: totalGeneration,
        carbonIntensity_gCO2kWh: parseFloat(latestCarbon.nz_carbon_gkwh) || 0,
        generationMix,
    };
}

function addGenerationValue(generationMix, fuel, mwh) {
    if (mwh === undefined) {
        return 0;
    }

    const mw = (mwh || 0) / 48;
    generationMix[fuel] = (generationMix[fuel] || 0) + mw;
    return mw;
}

async function requestOpenElectricity(httpClient, path, params) {
    const query = buildQueryString(params);
    const url = `${OPEN_ELECTRICITY_BASE_URL}${path}?${query}`;

    return httpClient.get(url, {
        headers: {
            Authorization: `Bearer ${process.env.OPENELECTRICITY_API_KEY}`,
            Accept: 'application/json',
        },
        timeout: 15000,
    });
}

function buildQueryString(params) {
    const searchParams = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            value.forEach((entry) => searchParams.append(key, entry));
            return;
        }

        if (value !== undefined && value !== null) {
            searchParams.append(key, value);
        }
    });

    return searchParams.toString();
}

function getNemDateStart(now = new Date()) {
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-AU', {
        timeZone: 'Australia/Brisbane',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(twoHoursAgo);

    const getPart = (type) => parts.find((part) => part.type === type)?.value;
    return `${getPart('year')}-${getPart('month')}-${getPart('day')}T${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;
}

function transformOpenElectricityData(generationPayload, demandPayload, emissionsPayload) {
    const states = createEmptyStateRecords();

    readTimeSeries(generationPayload).forEach((series) => {
        series.results.forEach((result) => {
            const region = result.columns.network_region || result.columns.region;
            const state = states[region];
            if (!state) return;

            const fuel = mapFuelGroup(result.columns.fueltech_group || result.name);
            const latestPoint = getLatestPoint(result.data);
            if (!latestPoint) return;

            state.generationMix[fuel] = (state.generationMix[fuel] || 0) + latestPoint.value;
            state.timestamp = latestTimestamp(state.timestamp, latestPoint.timestamp);
        });
    });

    readTimeSeries(demandPayload).forEach((series) => {
        series.results.forEach((result) => {
            const region = result.columns.network_region || result.columns.region;
            const state = states[region];
            const latestPoint = getLatestPoint(result.data);
            if (!state || !latestPoint) return;

            state.totalDemandMW = latestPoint.value;
            state.timestamp = latestTimestamp(state.timestamp, latestPoint.timestamp);
        });
    });

    const energyByRegion = {};
    const emissionsByRegion = {};

    readTimeSeries(emissionsPayload).forEach((series) => {
        series.results.forEach((result) => {
            const region = result.columns.network_region || result.columns.region;
            const latestPoint = getLatestPoint(result.data);
            if (!states[region] || !latestPoint) return;

            if (series.metric === 'energy') {
                energyByRegion[region] = latestPoint.value;
            }

            if (series.metric === 'emissions') {
                emissionsByRegion[region] = latestPoint.value;
            }

            states[region].timestamp = latestTimestamp(states[region].timestamp, latestPoint.timestamp);
        });
    });

    Object.entries(states).forEach(([region, state]) => {
        const energyMWh = energyByRegion[region];
        const emissionsTCO2 = emissionsByRegion[region];

        if (!energyMWh || emissionsTCO2 === undefined) {
            console.warn(`Missing energy/emissions data for ${region}; carbon intensity set to 0.`);
            state.carbonIntensity_gCO2kWh = 0;
            return;
        }

        state.carbonIntensity_gCO2kWh = (emissionsTCO2 / energyMWh) * 1000;
    });

    Object.values(states).forEach((state) => {
        state.timestamp = state.timestamp || new Date().toISOString();
    });

    return Object.values(states);
}

function createEmptyStateRecords() {
    return Object.entries(NEM_REGIONS).reduce((states, [region, state]) => {
        states[region] = {
            state,
            timestamp: null,
            totalDemandMW: 0,
            carbonIntensity_gCO2kWh: 0,
            generationMix: {},
        };
        return states;
    }, {});
}

function readTimeSeries(payload) {
    if (!payload?.success) {
        throw new Error(payload?.error || 'OpenElectricity request was not successful.');
    }

    return (payload.data || []).map((series) => ({
        metric: series.metric,
        results: (series.results || []).map((result) => ({
            name: result.name,
            columns: result.columns || {},
            data: normalizePoints(result.data || [], series.metric),
        })),
    }));
}

function normalizePoints(points, metric) {
    return points
        .map((point) => {
            if (Array.isArray(point)) {
                return {
                    timestamp: point[0],
                    value: Number(point[1]),
                };
            }

            return {
                timestamp: point.timestamp || point.time || point.interval || point.end,
                value: Number(point.value ?? point[metric]),
            };
        })
        .filter((point) => point.timestamp && Number.isFinite(point.value));
}

function getLatestPoint(points) {
    return points.reduce((latest, point) => {
        if (!latest || new Date(point.timestamp) > new Date(latest.timestamp)) {
            return point;
        }

        return latest;
    }, null);
}

function latestTimestamp(left, right) {
    if (!right) return left;
    if (!left) return right;

    return new Date(right) > new Date(left) ? right : left;
}

function mapFuelGroup(fuelGroup = '') {
    const normalized = String(fuelGroup).toLowerCase();

    if (normalized.includes('coal')) return 'coal';
    if (normalized.includes('gas')) return 'gas';
    if (normalized.includes('hydro')) return 'hydro';
    if (normalized.includes('wind')) return 'wind';
    if (normalized.includes('solar')) return 'solar';

    return 'other';
}

function mapOpenElectricityError(error) {
    const upstreamStatus = error.response?.status;

    if (upstreamStatus === 401 || upstreamStatus === 403) {
        return {
            status: 502,
            message: 'Australian emissions data is unavailable because OpenElectricity authentication failed.',
            logMessage: `OpenElectricity authentication failed with status ${upstreamStatus}.`,
        };
    }

    if (upstreamStatus === 429) {
        return {
            status: 503,
            message: 'Australian emissions data is temporarily unavailable because OpenElectricity rate limits were reached. Please retry shortly.',
            logMessage: 'OpenElectricity rate limit reached.',
        };
    }

    return {
        status: 502,
        message: 'Australian emissions data is temporarily unavailable.',
        logMessage: error.message || 'Unknown OpenElectricity error.',
    };
}

const app = createApp();

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log(`Test API: http://localhost:${PORT}/api/emissions/australia`);
        console.log(
            `OpenElectricity configured: ${Boolean(process.env.OPENELECTRICITY_API_KEY)}`
        );
    });
}

module.exports = app;
module.exports.createApp = createApp;
module.exports.transformOpenElectricityData = transformOpenElectricityData;
module.exports.transformNewZealandData = transformNewZealandData;
module.exports.mapFuelGroup = mapFuelGroup;
module.exports.mapOpenElectricityError = mapOpenElectricityError;
module.exports.buildQueryString = buildQueryString;
module.exports.getNemDateStart = getNemDateStart;
