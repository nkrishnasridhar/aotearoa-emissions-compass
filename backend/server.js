require('dotenv').config({ quiet: true });

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const PORT = process.env.PORT || 5000;
const OPEN_ELECTRICITY_BASE_URL =
    process.env.OPENELECTRICITY_API_BASE_URL || 'https://api.openelectricity.org.au/v4';
const NZ_CARBON_API_URL = 'https://api.em6.co.nz/ords/em6/data_api/current_carbon_intensity';
const NZ_GENERATION_API_URL = 'https://api.em6.co.nz/ords/em6/data_api/free/price';
const NZ_EM6_FREE_NOTE = 'EM6 free carbon feed provides the last three trading periods; 24-hour NZ carbon history requires a richer registered or paid feed.';
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
    app.use(express.json());

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

    app.get('/api/emissions/australia/history', async (req, res) => {
        try {
            if (!process.env.OPENELECTRICITY_API_KEY) {
                return res.status(500).json({
                    error: 'OpenElectricity API key is not configured on the backend.',
                });
            }

            const hours = getHoursQuery(req.query.hours);
            const data = await fetchAustraliaHistory(httpClient, hours);

            return res.json(data);
        } catch (error) {
            const mappedError = mapOpenElectricityError(error);
            console.error('Error fetching OpenElectricity Australia history:', mappedError.logMessage);

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

    app.get('/api/emissions/new-zealand/history', async (req, res) => {
        try {
            const hours = getHoursQuery(req.query.hours);
            const data = await fetchNewZealandHistory(httpClient, hours);

            return res.json(data);
        } catch (error) {
            console.error('Error fetching EM6 New Zealand history:', error.message);

            return res.status(502).json({
                error: 'New Zealand emissions history is temporarily unavailable.',
            });
        }
    });

    app.post('/api/planner/estimate', async (req, res) => {
        try {
            const estimate = await estimateActivity(req.body || {}, httpClient);
            return res.json(estimate);
        } catch (error) {
            const status = error.status || 500;
            console.error('Error estimating activity emissions:', error.message);

            return res.status(status).json({
                error: error.message || 'Unable to estimate activity emissions.',
            });
        }
    });

    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            timestamp: new Date().toISOString(),
            nzProvider: getNzProviderStatus(),
            electricityAuthorityConfigured: Boolean(process.env.EA_API_KEY && process.env.EA_API_BASE_URL),
            openElectricityConfigured: Boolean(process.env.OPENELECTRICITY_API_KEY),
        });
    });

    return app;
}

function getHoursQuery(hours) {
    const parsed = Number(hours || 24);
    if (!Number.isFinite(parsed)) return 24;
    return Math.min(Math.max(Math.round(parsed), 1), 48);
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
    ).map((state) => enrichEmissionRecord(state));
}

async function fetchAustraliaHistory(httpClient = axios, hours = 24) {
    const dateStart = getDateStartForHours(hours);
    const [generationResponse, demandResponse, emissionsResponse] = await Promise.all([
        requestOpenElectricity(httpClient, '/data/network/NEM', {
            metrics: ['power'],
            interval: '5m',
            date_start: dateStart,
            primary_grouping: 'network_region',
            secondary_grouping: 'fueltech_group',
        }),
        requestOpenElectricity(httpClient, '/market/network/NEM', {
            metrics: ['demand'],
            interval: '5m',
            date_start: dateStart,
            primary_grouping: 'network_region',
        }),
        requestOpenElectricity(httpClient, '/data/network/NEM', {
            metrics: ['energy', 'emissions'],
            interval: '5m',
            date_start: dateStart,
            primary_grouping: 'network_region',
        }),
    ]);

    return transformOpenElectricityHistory(
        generationResponse.data,
        demandResponse.data,
        emissionsResponse.data
    );
}

async function fetchNewZealandData(httpClient = axios) {
    const [carbonResponse, generationResponse, realtimeData] = await Promise.all([
        fetchNzCarbonFromEm6Free(httpClient),
        fetchNzGenerationFromEm6Free(httpClient),
        fetchNzRealtimeFromElectricityAuthority(httpClient),
    ]);

    return enrichEmissionRecord(
        transformNewZealandData(carbonResponse.data, generationResponse.data, realtimeData)
    );
}

async function fetchNewZealandHistory(httpClient = axios, hours = 24) {
    const [carbonResponse, generationResponse, realtimeData] = await Promise.all([
        fetchNzCarbonFromEm6Free(httpClient),
        fetchNzGenerationFromEm6Free(httpClient),
        fetchNzRealtimeFromElectricityAuthority(httpClient),
    ]);

    return transformNewZealandHistory(carbonResponse.data, generationResponse.data, hours, realtimeData);
}

async function fetchNzCarbonFromEm6Free(httpClient) {
    return httpClient.get(NZ_CARBON_API_URL, { timeout: 15000 });
}

async function fetchNzGenerationFromEm6Free(httpClient) {
    return httpClient.get(NZ_GENERATION_API_URL, { timeout: 15000 });
}

async function fetchNzRealtimeFromElectricityAuthority(httpClient) {
    if ((process.env.NZ_REALTIME_PROVIDER || 'em6-free') !== 'ea') {
        return null;
    }

    if (!process.env.EA_API_KEY || !process.env.EA_API_BASE_URL) {
        console.warn('NZ_REALTIME_PROVIDER is set to ea, but EA_API_KEY or EA_API_BASE_URL is missing; falling back to EM6 free data.');
        return null;
    }

    // Placeholder for a future documented EA real-time dispatch mapping. The provider
    // hook is intentionally non-blocking so free EM6 data remains the default.
    return null;
}

function getNzProviderStatus() {
    if ((process.env.NZ_REALTIME_PROVIDER || 'em6-free') === 'ea' && process.env.EA_API_KEY && process.env.EA_API_BASE_URL) {
        return 'ea';
    }

    return 'em6-free';
}

function transformNewZealandData(carbonData, generationData, realtimeData = null) {
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
        totalDemandMW: realtimeData?.totalDemandMW || totalGeneration,
        carbonIntensity_gCO2kWh: parseFloat(latestCarbon.nz_carbon_gkwh) || 0,
        generationMix,
        renewablePercentage: getEm6RenewablePercentage(latestCarbon),
        dataSources: ['EM6 free current carbon intensity', 'EM6 free generation quantities'],
        historyCoverage: 'limited',
        dataNotes: NZ_EM6_FREE_NOTE,
    };
}

function transformNewZealandHistory(carbonData, generationData, hours = 24, realtimeData = null) {
    const latestGeneration = generationData.items?.[0];
    const generationMix = latestGeneration ? getNewZealandGenerationMix(latestGeneration) : {};
    const totalDemandMW = realtimeData?.totalDemandMW || Object.values(generationMix).reduce((sum, value) => sum + value, 0);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    const history = (carbonData.items || [])
        .map((item) =>
            createHistoryPoint({
                country: 'New Zealand',
                timestamp: item.timestamp,
                totalDemandMW,
                carbonIntensity_gCO2kWh: parseFloat(item.nz_carbon_gkwh) || 0,
                generationMix,
                renewablePercentage: getEm6RenewablePercentage(item),
                dataSources: ['EM6 free current carbon intensity', 'EM6 free generation quantities'],
                historyCoverage: 'limited',
                dataNotes: NZ_EM6_FREE_NOTE,
            })
        )
        .filter((point) => new Date(point.timestamp).getTime() >= cutoff)
        .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));

    return {
        ...createHistoryResponse('New Zealand', history),
        historyCoverage: 'limited',
        dataSources: ['EM6 free current carbon intensity', 'EM6 free generation quantities'],
        dataNotes: NZ_EM6_FREE_NOTE,
    };
}

function getEm6RenewablePercentage(carbonItem = {}) {
    const candidates = [
        carbonItem.renewable_percentage,
        carbonItem.renewable_percent,
        carbonItem.renewables_percentage,
        carbonItem.renewables_percent,
        carbonItem.renewable_generation_percentage,
        carbonItem.nz_renewable_percentage,
    ];
    const value = candidates.map(Number).find((candidate) => Number.isFinite(candidate));

    return value === undefined ? undefined : Math.round(value);
}

function getNewZealandGenerationMix(latestGeneration) {
    const generationMix = {};

    latestGeneration.generation_type.forEach((gen) => {
        addGenerationValue(generationMix, 'hydro', gen.hyd_mwh);
        addGenerationValue(generationMix, 'wind', gen.win_mwh);
        addGenerationValue(generationMix, 'solar', gen.sol_mwh);
        addGenerationValue(generationMix, 'gas', gen.gas_mwh);
        addGenerationValue(generationMix, 'gas', gen.cg_mwh);
        addGenerationValue(generationMix, 'gas', gen.cog_mwh);
        addGenerationValue(generationMix, 'geothermal', gen.geo_mwh);
        addGenerationValue(generationMix, 'other', gen.bat_mwh);

        if (gen.liq_mwh !== undefined && gen.liq_mwh > 0) {
            addGenerationValue(generationMix, 'other', gen.liq_mwh);
        }
    });

    return generationMix;
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
    return formatBrisbaneTimestamp(twoHoursAgo);
}

function formatBrisbaneTimestamp(date) {
    const parts = new Intl.DateTimeFormat('en-AU', {
        timeZone: 'Australia/Brisbane',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(date);

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

function transformOpenElectricityHistory(generationPayload, demandPayload, emissionsPayload) {
    const byRegionAndTimestamp = createRegionHistoryRecords();

    readTimeSeries(generationPayload).forEach((series) => {
        series.results.forEach((result) => {
            const region = result.columns.network_region || result.columns.region;
            if (!byRegionAndTimestamp[region]) return;

            const fuel = mapFuelGroup(result.columns.fueltech_group || result.name);
            result.data.forEach((point) => {
                const record = getRegionHistoryPoint(byRegionAndTimestamp, region, point.timestamp);
                record.generationMix[fuel] = (record.generationMix[fuel] || 0) + point.value;
            });
        });
    });

    readTimeSeries(demandPayload).forEach((series) => {
        series.results.forEach((result) => {
            const region = result.columns.network_region || result.columns.region;
            if (!byRegionAndTimestamp[region]) return;

            result.data.forEach((point) => {
                const record = getRegionHistoryPoint(byRegionAndTimestamp, region, point.timestamp);
                record.totalDemandMW = point.value;
            });
        });
    });

    const energyByRegionAndTimestamp = {};
    const emissionsByRegionAndTimestamp = {};

    readTimeSeries(emissionsPayload).forEach((series) => {
        series.results.forEach((result) => {
            const region = result.columns.network_region || result.columns.region;
            if (!byRegionAndTimestamp[region]) return;

            result.data.forEach((point) => {
                const key = `${region}|${point.timestamp}`;
                getRegionHistoryPoint(byRegionAndTimestamp, region, point.timestamp);

                if (series.metric === 'energy') {
                    energyByRegionAndTimestamp[key] = point.value;
                }

                if (series.metric === 'emissions') {
                    emissionsByRegionAndTimestamp[key] = point.value;
                }
            });
        });
    });

    const regionHistory = Object.entries(byRegionAndTimestamp).flatMap(([region, records]) =>
        Object.values(records)
            .map((record) => {
                const key = `${region}|${record.timestamp}`;
                const energyMWh = energyByRegionAndTimestamp[key];
                const emissionsTCO2 = emissionsByRegionAndTimestamp[key];
                const carbonIntensity = energyMWh ? (emissionsTCO2 || 0) / energyMWh * 1000 : 0;

                return createHistoryPoint({
                    ...record,
                    carbonIntensity_gCO2kWh: carbonIntensity,
                    isComplete: isCompleteHistoryRecord(record, energyMWh, emissionsTCO2),
                });
            })
            .filter((point) => point.isComplete)
            .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp))
    );

    const history = smoothHistory(aggregateRegionHistory(regionHistory), 30);

    return {
        ...createHistoryResponse('Australia', history),
        regionHistory,
    };
}

function isCompleteHistoryRecord(record, energyMWh, emissionsTCO2) {
    return (
        Number.isFinite(record.totalDemandMW) &&
        record.totalDemandMW > 0 &&
        Object.keys(record.generationMix || {}).length > 0 &&
        Number.isFinite(energyMWh) &&
        energyMWh > 0 &&
        Number.isFinite(emissionsTCO2)
    );
}

function createRegionHistoryRecords() {
    return Object.keys(NEM_REGIONS).reduce((records, region) => {
        records[region] = {};
        return records;
    }, {});
}

function getRegionHistoryPoint(byRegionAndTimestamp, region, timestamp) {
    if (!byRegionAndTimestamp[region][timestamp]) {
        byRegionAndTimestamp[region][timestamp] = {
            country: 'Australia',
            state: NEM_REGIONS[region],
            timestamp,
            totalDemandMW: 0,
            carbonIntensity_gCO2kWh: 0,
            generationMix: {},
        };
    }

    return byRegionAndTimestamp[region][timestamp];
}

function aggregateRegionHistory(regionHistory) {
    const byTimestamp = {};

    regionHistory.forEach((point) => {
        if (!byTimestamp[point.timestamp]) {
            byTimestamp[point.timestamp] = {
                country: 'Australia',
                timestamp: point.timestamp,
                totalDemandMW: 0,
                carbonIntensityNumerator: 0,
                generationMix: {},
            };
        }

        const aggregate = byTimestamp[point.timestamp];
        aggregate.totalDemandMW += point.totalDemandMW;
        aggregate.carbonIntensityNumerator += point.carbonIntensity_gCO2kWh * point.totalDemandMW;

        Object.entries(point.generationMix).forEach(([fuel, value]) => {
            aggregate.generationMix[fuel] = (aggregate.generationMix[fuel] || 0) + value;
        });
    });

    return Object.values(byTimestamp)
        .map((point) =>
            createHistoryPoint({
                country: point.country,
                timestamp: point.timestamp,
                totalDemandMW: point.totalDemandMW,
                carbonIntensity_gCO2kWh: point.totalDemandMW
                    ? point.carbonIntensityNumerator / point.totalDemandMW
                    : 0,
                generationMix: point.generationMix,
            })
        )
        .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
}

function createHistoryPoint(record) {
    return enrichEmissionRecord({
        country: record.country,
        state: record.state,
        timestamp: record.timestamp,
        totalDemandMW: record.totalDemandMW,
        carbonIntensity_gCO2kWh: record.carbonIntensity_gCO2kWh,
        generationMix: record.generationMix,
        isComplete: record.isComplete,
        renewablePercentage: record.renewablePercentage,
        dataSources: record.dataSources,
        historyCoverage: record.historyCoverage,
        dataNotes: record.dataNotes,
    });
}

function smoothHistory(history, bucketMinutes = 30) {
    const buckets = {};
    const bucketMs = bucketMinutes * 60 * 1000;

    history.forEach((point) => {
        if (!isUsableHistoryPoint(point)) return;

        const timestampMs = new Date(point.timestamp).getTime();
        if (!Number.isFinite(timestampMs)) return;

        const bucketTimestamp = new Date(Math.floor(timestampMs / bucketMs) * bucketMs).toISOString();
        if (!buckets[bucketTimestamp]) {
            buckets[bucketTimestamp] = {
                country: point.country,
                timestamp: bucketTimestamp,
                totalDemandMW: 0,
                carbonIntensityNumerator: 0,
                generationMix: {},
                samples: 0,
                isComplete: true,
            };
        }

        const bucket = buckets[bucketTimestamp];
        bucket.totalDemandMW += point.totalDemandMW;
        bucket.carbonIntensityNumerator += point.carbonIntensity_gCO2kWh * point.totalDemandMW;
        bucket.samples += 1;

        Object.entries(point.generationMix || {}).forEach(([fuel, value]) => {
            bucket.generationMix[fuel] = (bucket.generationMix[fuel] || 0) + (value || 0);
        });
    });

    return Object.values(buckets)
        .map((bucket) =>
            createHistoryPoint({
                country: bucket.country,
                timestamp: bucket.timestamp,
                totalDemandMW: bucket.samples ? bucket.totalDemandMW / bucket.samples : 0,
                carbonIntensity_gCO2kWh: bucket.totalDemandMW
                    ? bucket.carbonIntensityNumerator / bucket.totalDemandMW
                    : 0,
                generationMix: Object.fromEntries(
                    Object.entries(bucket.generationMix).map(([fuel, value]) => [
                        fuel,
                        bucket.samples ? value / bucket.samples : 0,
                    ])
                ),
                isComplete: bucket.isComplete,
            })
        )
        .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
}

function createHistoryResponse(country, history) {
    const cleanestWindow = getCleanestWindow(history);

    return {
        country,
        history,
        cleanestWindow,
    };
}

async function estimateActivity(input, httpClient = axios) {
    const country = String(input.country || '').toLowerCase();
    const region = input.region ? String(input.region).toUpperCase() : null;
    const kWh = Number(input.kWh);
    const durationHours = Number(input.durationHours || 1);

    if (!['australia', 'new zealand'].includes(country)) {
        throw createHttpError(400, 'country must be Australia or New Zealand.');
    }

    if (!Number.isFinite(kWh) || kWh <= 0) {
        throw createHttpError(400, 'kWh must be greater than 0.');
    }

    if (!Number.isFinite(durationHours) || durationHours <= 0) {
        throw createHttpError(400, 'durationHours must be greater than 0.');
    }

    if (country === 'australia') {
        const [current, historyResponse] = await Promise.all([
            fetchAustraliaNEMData(httpClient),
            fetchAustraliaHistory(httpClient, 24),
        ]);
        const currentRecord = region ? current.find((state) => state.state === region) : aggregateRecords('Australia', current);
        const history = region
            ? historyResponse.regionHistory.filter((point) => point.state === region)
            : historyResponse.history;

        return createPlannerEstimate('Australia', region, kWh, durationHours, currentRecord, history);
    }

    const [currentRecord, historyResponse] = await Promise.all([
        fetchNewZealandData(httpClient),
        fetchNewZealandHistory(httpClient, 24),
    ]);

    return createPlannerEstimate('New Zealand', null, kWh, durationHours, currentRecord, historyResponse.history);
}

function createPlannerEstimate(country, region, kWh, durationHours, currentRecord, history) {
    if (!currentRecord) {
        throw createHttpError(404, 'No current grid data found for that selection.');
    }

    const cleanestWindow = getCleanestWindow(history) || createHistoryPoint(currentRecord);
    const nowKgCO2e = kWh * currentRecord.carbonIntensity_gCO2kWh / 1000;
    const cleanerWindowKgCO2e = kWh * cleanestWindow.carbonIntensity_gCO2kWh / 1000;
    const savingsKgCO2e = Math.max(0, nowKgCO2e - cleanerWindowKgCO2e);
    const recommendation = createPlannerRecommendation(currentRecord, cleanestWindow, savingsKgCO2e);

    return {
        country,
        region,
        kWh,
        durationHours,
        dataNotes: currentRecord.dataNotes || cleanestWindow.dataNotes,
        historyCoverage: currentRecord.historyCoverage || cleanestWindow.historyCoverage,
        now: {
            timestamp: currentRecord.timestamp,
            carbonIntensity_gCO2kWh: currentRecord.carbonIntensity_gCO2kWh,
            estimatedKgCO2e: nowKgCO2e,
            gridSignal: currentRecord.gridSignal,
        },
        cleanerWindow: {
            timestamp: cleanestWindow.timestamp,
            carbonIntensity_gCO2kWh: cleanestWindow.carbonIntensity_gCO2kWh,
            estimatedKgCO2e: cleanerWindowKgCO2e,
        },
        savingsKgCO2e,
        recommendation,
    };
}

function createPlannerRecommendation(currentRecord, cleanestWindow, savingsKgCO2e) {
    if (currentRecord.gridSignal === 'Use now') {
        return 'Run it now. The grid is currently clean enough for flexible electricity use.';
    }

    if (savingsKgCO2e >= 1) {
        return `Delay if you can. The cleanest recent window would save about ${savingsKgCO2e.toFixed(1)} kg CO2e.`;
    }

    return `Waiting has limited emissions benefit based on recent data. Cleanest recent window: ${cleanestWindow.timestamp}.`;
}

function aggregateRecords(country, records) {
    const totalDemandMW = records.reduce((sum, record) => sum + record.totalDemandMW, 0);
    const generationMix = {};

    records.forEach((record) => {
        Object.entries(record.generationMix).forEach(([fuel, value]) => {
            generationMix[fuel] = (generationMix[fuel] || 0) + value;
        });
    });

    const carbonIntensity = totalDemandMW
        ? records.reduce((sum, record) => sum + record.carbonIntensity_gCO2kWh * record.totalDemandMW, 0) / totalDemandMW
        : 0;

    return enrichEmissionRecord({
        country,
        timestamp: getLatestTimestamp(records.map((record) => record.timestamp)),
        totalDemandMW,
        carbonIntensity_gCO2kWh: carbonIntensity,
        generationMix,
    });
}

function enrichEmissionRecord(record) {
    const renewablePercentage = Number.isFinite(record.renewablePercentage)
        ? record.renewablePercentage
        : calculateRenewablePercentage(record.generationMix);
    const dataFreshnessMinutes = calculateDataFreshnessMinutes(record.timestamp);
    const confidence = getConfidence(record, dataFreshnessMinutes);
    const signal = classifyGridSignal(record.carbonIntensity_gCO2kWh, renewablePercentage);
    const leadingFuel = getLeadingFuel(record.generationMix);
    const leadingRenewableFuel = getLeadingFuelByType(record.generationMix, ['hydro', 'wind', 'solar', 'geothermal']);
    const leadingThermalFuel = getLeadingFuelByType(record.generationMix, ['coal', 'gas']);
    const thermalSharePercentage = calculateFuelSharePercentage(record.generationMix, ['coal', 'gas']);

    return {
        ...record,
        renewablePercentage,
        dataFreshnessMinutes,
        gridSignal: signal,
        signalReason: createSignalReason(
            signal,
            record.carbonIntensity_gCO2kWh,
            renewablePercentage,
            leadingFuel,
            record.country,
            leadingRenewableFuel,
            thermalSharePercentage
        ),
        confidence,
        leadingRenewableFuel,
        leadingThermalFuel,
        thermalSharePercentage,
    };
}

function calculateRenewablePercentage(generationMix) {
    const renewables = ['hydro', 'wind', 'solar', 'geothermal'];
    const renewableTotal = renewables.reduce((sum, fuel) => sum + (generationMix[fuel] || 0), 0);
    const total = Object.values(generationMix).reduce((sum, value) => sum + (value || 0), 0);

    return total > 0 ? Math.round(renewableTotal / total * 100) : 0;
}

function calculateDataFreshnessMinutes(timestamp) {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    if (!Number.isFinite(ageMs)) return null;

    return Math.max(0, Math.round(ageMs / 60000));
}

function getConfidence(record, dataFreshnessMinutes) {
    if (!record.totalDemandMW || Object.keys(record.generationMix || {}).length === 0) {
        return 'Low';
    }

    if (dataFreshnessMinutes === null || dataFreshnessMinutes > 120) {
        return 'Low';
    }

    if (dataFreshnessMinutes > 45) {
        return 'Medium';
    }

    return 'High';
}

function classifyGridSignal(carbonIntensity, renewablePercentage) {
    if (carbonIntensity <= 150 || renewablePercentage >= 80) {
        return 'Use now';
    }

    if (carbonIntensity >= 550 || renewablePercentage < 35) {
        return 'Avoid peak';
    }

    return 'Wait';
}

function createSignalReason(signal, carbonIntensity, renewablePercentage, leadingFuel, country, leadingRenewableFuel, thermalSharePercentage) {
    const roundedIntensity = Math.round(carbonIntensity);
    const fuelText = leadingFuel ? `${leadingFuel} is the largest visible source` : 'generation mix is incomplete';

    if (country === 'New Zealand' && leadingRenewableFuel) {
        const thermalText = Number.isFinite(thermalSharePercentage)
            ? `thermal share is ${thermalSharePercentage}%`
            : 'thermal share is unavailable';
        return `NZ signal: ${roundedIntensity} gCO2/kWh and ${renewablePercentage}% renewable. ${leadingRenewableFuel} leads the mix and ${thermalText}.`;
    }

    if (signal === 'Use now') {
        return `Low-carbon window: ${roundedIntensity} gCO2/kWh and ${renewablePercentage}% renewable. ${fuelText}.`;
    }

    if (signal === 'Avoid peak') {
        return `High-impact period: ${roundedIntensity} gCO2/kWh and ${renewablePercentage}% renewable. ${fuelText}.`;
    }

    return `Mixed signal: ${roundedIntensity} gCO2/kWh and ${renewablePercentage}% renewable. ${fuelText}.`;
}

function getLeadingFuel(generationMix) {
    return Object.entries(generationMix || {})
        .filter(([, value]) => value > 0)
        .sort((left, right) => right[1] - left[1])[0]?.[0] || null;
}

function getLeadingFuelByType(generationMix, fuels) {
    return fuels
        .map((fuel) => [fuel, generationMix?.[fuel] || 0])
        .filter(([, value]) => value > 0)
        .sort((left, right) => right[1] - left[1])[0]?.[0] || null;
}

function calculateFuelSharePercentage(generationMix, fuels) {
    const total = Object.values(generationMix || {}).reduce((sum, value) => sum + (value || 0), 0);
    const fuelTotal = fuels.reduce((sum, fuel) => sum + (generationMix?.[fuel] || 0), 0);

    return total > 0 ? Math.round(fuelTotal / total * 100) : 0;
}

function getCleanestWindow(history) {
    return [...history]
        .filter((point) => isUsableHistoryPoint(point))
        .sort((left, right) => left.carbonIntensity_gCO2kWh - right.carbonIntensity_gCO2kWh)[0] || null;
}

function isUsableHistoryPoint(point) {
    return (
        Number.isFinite(point.carbonIntensity_gCO2kWh) &&
        point.carbonIntensity_gCO2kWh > 0 &&
        Number.isFinite(point.totalDemandMW) &&
        point.totalDemandMW > 0 &&
        Object.keys(point.generationMix || {}).length > 0
    );
}

function getLatestTimestamp(timestamps) {
    return timestamps.reduce((latest, timestamp) => latestTimestamp(latest, timestamp), null) || new Date().toISOString();
}

function getDateStartForHours(hours, now = new Date()) {
    return formatBrisbaneTimestamp(new Date(now.getTime() - hours * 60 * 60 * 1000));
}

function createHttpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
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
module.exports.transformOpenElectricityHistory = transformOpenElectricityHistory;
module.exports.transformNewZealandData = transformNewZealandData;
module.exports.transformNewZealandHistory = transformNewZealandHistory;
module.exports.estimateActivity = estimateActivity;
module.exports.enrichEmissionRecord = enrichEmissionRecord;
module.exports.calculateRenewablePercentage = calculateRenewablePercentage;
module.exports.classifyGridSignal = classifyGridSignal;
module.exports.mapFuelGroup = mapFuelGroup;
module.exports.mapOpenElectricityError = mapOpenElectricityError;
module.exports.buildQueryString = buildQueryString;
module.exports.getNemDateStart = getNemDateStart;
