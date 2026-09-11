require('dotenv').config({ quiet: true });

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const PORT = process.env.PORT || 5000;
const NZ_CARBON_API_URL = 'https://api.em6.co.nz/ords/em6/data_api/current_carbon_intensity';
const NZ_GENERATION_API_URL = 'https://api.em6.co.nz/ords/em6/data_api/free/price';
const DEFAULT_EA_API_BASE_URL = 'https://emi.azure-api.net';
const DEFAULT_EA_REALTIME_DISPATCH_PATH = '/real-time-dispatch/';
const EM6_CARBON_SOURCE = 'EM6 free current carbon intensity';
const EM6_GENERATION_SOURCE = 'EM6 free generation quantities';
const EA_DISPATCH_SOURCE = 'Electricity Authority real-time dispatch';
const NZ_EM6_FREE_NOTE = 'EM6 free carbon feed provides the last three trading periods; recent-sample comparisons are not forecasts.';
const NZ_EM6_EA_NOTE = 'EM6 provides NZ carbon intensity while Electricity Authority real-time dispatch provides the latest demand/generation snapshot; recent carbon samples are still limited by the free EM6 feed.';
const CACHE_TTL_MS = 4 * 60 * 1000;
const MEANINGFUL_SAVING_KG = 0.5;

const NEW_ZEALAND_PROFILE = {
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
        {
            sector: 'Industrial processes and product use',
            sharePercentage: 6,
            summary: 'Emissions from materials, chemicals, metals, and refrigerants.',
        },
        {
            sector: 'Waste',
            sharePercentage: 3,
            summary: 'Mostly methane from landfills and wastewater.',
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
        {
            gas: 'Nitrous oxide',
            sharePercentage: 9,
            summary: 'Mostly from agricultural soils and fertiliser use.',
        },
        {
            gas: 'Fluorinated gases',
            sharePercentage: 2,
            summary: 'Mainly refrigerants and industrial product use.',
        },
    ],
    electricityRenewableShare2024: 85.5,
    sources: [
        {
            name: 'Ministry for the Environment: New Zealand greenhouse gas inventory 1990-2024 snapshot',
            url: 'https://environment.govt.nz/publications/new-zealands-greenhouse-gas-inventory-19902024-snapshot/',
        },
        {
            name: 'MBIE: Energy in New Zealand 2025, electricity',
            url: 'https://www.mbie.govt.nz/building-and-energy/energy-and-natural-resources/energy-statistics-and-modelling/energy-publications-and-technical-papers/energy-in-new-zealand/energy-in-new-zealand-2025/electricity',
        },
    ],
    notes: 'Sector and gas shares are rounded public-summary values. Electricity renewable share is annual 2024 generation, not the live grid mix.',
};

let newZealandCache = null;
let nzEaRealtimeCache = null;

function createApp(options = {}) {
    const app = express();
    const httpClient = options.httpClient || axios;

    app.use(cors());
    app.use(express.json());

    app.get('/api/emissions/new-zealand', async (req, res) => {
        try {
            const cacheKey = getNzCacheKey();
            if (
                newZealandCache &&
                newZealandCache.cacheKey === cacheKey &&
                Date.now() - newZealandCache.cachedAt < CACHE_TTL_MS
            ) {
                return res.json(newZealandCache.data);
            }

            const data = await fetchNewZealandData(httpClient);
            newZealandCache = {
                cachedAt: Date.now(),
                cacheKey,
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

    app.get('/api/emissions/new-zealand/profile', (req, res) => {
        res.json(NEW_ZEALAND_PROFILE);
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
            electricityAuthorityConfigured: Boolean(process.env.EA_API_KEY),
        });
    });

    return app;
}

function getHoursQuery(hours) {
    const parsed = Number(hours || 24);
    if (!Number.isFinite(parsed)) return 24;
    return Math.min(Math.max(Math.round(parsed), 1), 48);
}

async function fetchNewZealandData(httpClient = axios) {
    const [carbonResponse, generationResponse, realtimeData] = await Promise.all([
        fetchNzCarbonFromEm6Free(httpClient),
        fetchNzGenerationFromEm6Free(httpClient),
        fetchNzRealtimeFromElectricityAuthority(httpClient, 2),
    ]);

    return enrichEmissionRecord(
        transformNewZealandData(carbonResponse.data, generationResponse.data, realtimeData)
    );
}

async function fetchNewZealandHistory(httpClient = axios, hours = 24) {
    const [carbonResponse, generationResponse, realtimeData] = await Promise.all([
        fetchNzCarbonFromEm6Free(httpClient),
        fetchNzGenerationFromEm6Free(httpClient),
        fetchNzRealtimeFromElectricityAuthority(httpClient, hours),
    ]);

    return transformNewZealandHistory(carbonResponse.data, generationResponse.data, hours, realtimeData);
}

async function fetchNzCarbonFromEm6Free(httpClient) {
    return httpClient.get(NZ_CARBON_API_URL, { timeout: 15000 });
}

async function fetchNzGenerationFromEm6Free(httpClient) {
    return httpClient.get(NZ_GENERATION_API_URL, { timeout: 15000 });
}

async function fetchNzRealtimeFromElectricityAuthority(httpClient, hours = 24) {
    if ((process.env.NZ_REALTIME_PROVIDER || 'em6-free') !== 'ea') {
        return null;
    }

    if (!process.env.EA_API_KEY) {
        console.warn('NZ_REALTIME_PROVIDER is set to ea, but EA_API_KEY is missing; falling back to EM6 free data.');
        return null;
    }

    const cappedHours = getEaHistoryHours(hours);
    const cacheKey = `${getElectricityAuthorityBaseUrl()}|${getElectricityAuthorityDispatchPath()}|${cappedHours}`;
    if (
        nzEaRealtimeCache &&
        nzEaRealtimeCache.cacheKey === cacheKey &&
        Date.now() - nzEaRealtimeCache.cachedAt < CACHE_TTL_MS
    ) {
        return nzEaRealtimeCache.data;
    }

    try {
        const response = await requestElectricityAuthorityDispatch(httpClient);
        const history = transformElectricityAuthorityDispatchData(response.data);

        if (history.length === 0) {
            console.warn('Electricity Authority real-time dispatch returned no usable rows; falling back to EM6 free data.');
            return null;
        }

        const data = {
            source: EA_DISPATCH_SOURCE,
            latest: history[history.length - 1],
            history,
            dispatchCoverage: 'latest-only',
            dispatchIntervalCount: history.length,
            dispatchLatestTimestamp: history[history.length - 1].timestamp,
            dataSources: [EA_DISPATCH_SOURCE],
            dataNotes: NZ_EM6_EA_NOTE,
        };

        nzEaRealtimeCache = {
            cachedAt: Date.now(),
            cacheKey,
            data,
        };

        return data;
    } catch (error) {
        const mappedError = mapElectricityAuthorityError(error);
        console.warn('Electricity Authority real-time dispatch unavailable; falling back to EM6 free data:', mappedError.logMessage);
        return null;
    }
}

async function requestElectricityAuthorityDispatch(httpClient) {
    return httpClient.get(buildElectricityAuthorityDispatchUrl(), {
        headers: {
            'Ocp-Apim-Subscription-Key': process.env.EA_API_KEY,
        },
        timeout: 15000,
    });
}

function getNzProviderStatus() {
    if ((process.env.NZ_REALTIME_PROVIDER || 'em6-free') === 'ea' && process.env.EA_API_KEY) {
        return 'ea';
    }

    return 'em6-free';
}

function getNzCacheKey() {
    return `${getNzProviderStatus()}|${Boolean(process.env.EA_API_KEY)}|${getElectricityAuthorityBaseUrl()}|${getElectricityAuthorityDispatchPath()}`;
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

    const generationMix = getNewZealandGenerationMix(latestGeneration);
    const totalGeneration = Object.values(generationMix).reduce((sum, value) => sum + value, 0);

    return {
        country: 'New Zealand',
        timestamp: latestCarbon.timestamp || new Date().toISOString(),
        totalDemandMW: realtimeData?.latest?.totalDemandMW || totalGeneration,
        totalGenerationMW: realtimeData?.latest?.totalGenerationMW,
        demandTimestamp: realtimeData?.latest?.timestamp,
        runDateTime: realtimeData?.latest?.runDateTime,
        carbonIntensity_gCO2kWh: parseFloat(latestCarbon.nz_carbon_gkwh) || 0,
        generationMix,
        renewablePercentage: getEm6RenewablePercentage(latestCarbon),
        dataSources: getNzDataSources(realtimeData),
        historyCoverage: getNzCurrentCoverage(realtimeData),
        dataNotes: getNzDataNotes(realtimeData),
    };
}

function transformNewZealandHistory(carbonData, generationData, hours = 24, realtimeData = null) {
    const latestGeneration = generationData.items?.[0];
    const generationMix = latestGeneration ? getNewZealandGenerationMix(latestGeneration) : {};
    const fallbackDemandMW = Object.values(generationMix).reduce((sum, value) => sum + value, 0);
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    const history = (carbonData.items || [])
        .map((item) => {
            const realtimePoint = getNearestEaHistoryPoint(realtimeData?.history || [], item.timestamp);
            const pointDataSources = getNzDataSources(realtimePoint ? realtimeData : null);

            return createHistoryPoint({
                country: 'New Zealand',
                timestamp: item.timestamp,
                totalDemandMW: realtimePoint?.totalDemandMW || fallbackDemandMW,
                totalGenerationMW: realtimePoint?.totalGenerationMW,
                demandTimestamp: realtimePoint?.timestamp,
                runDateTime: realtimePoint?.runDateTime,
                dispatchMatchedCarbonSample: Boolean(realtimePoint),
                carbonIntensity_gCO2kWh: parseFloat(item.nz_carbon_gkwh) || 0,
                generationMix,
                renewablePercentage: getEm6RenewablePercentage(item),
                dataSources: pointDataSources,
                historyCoverage: getNzHistoryCoverage(),
                dataNotes: getNzDataNotes(realtimeData),
            });
        })
        .filter((point) => new Date(point.timestamp).getTime() >= cutoff)
        .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));

    return {
        ...createHistoryResponse('New Zealand', history),
        historyCoverage: getNzHistoryCoverage(),
        dataSources: getNzDataSources(realtimeData),
        dataNotes: getNzDataNotes(realtimeData),
        dispatchCoverage: realtimeData?.dispatchCoverage,
        dispatchIntervalCount: realtimeData?.dispatchIntervalCount || 0,
        dispatchLatestTimestamp: realtimeData?.dispatchLatestTimestamp,
    };
}

function getNzDataSources(realtimeData = null) {
    const sources = [EM6_CARBON_SOURCE, EM6_GENERATION_SOURCE];
    if (realtimeData?.history?.length) {
        sources.push(EA_DISPATCH_SOURCE);
    }

    return sources;
}

function getNzHistoryCoverage() {
    return 'limited';
}

function getNzCurrentCoverage(realtimeData = null) {
    return realtimeData?.history?.length ? 'partial' : 'limited';
}

function getNzDataNotes(realtimeData = null) {
    return realtimeData?.history?.length ? NZ_EM6_EA_NOTE : NZ_EM6_FREE_NOTE;
}

function getElectricityAuthorityBaseUrl() {
    return (process.env.EA_API_BASE_URL || DEFAULT_EA_API_BASE_URL).replace(/\/+$/, '');
}

function getElectricityAuthorityDispatchPath() {
    const path = process.env.EA_REALTIME_DISPATCH_PATH || DEFAULT_EA_REALTIME_DISPATCH_PATH;
    return path.startsWith('/') ? path : `/${path}`;
}

function getEaHistoryHours(hours) {
    const parsed = Number(hours || 24);
    if (!Number.isFinite(parsed)) return 24;
    return Math.min(Math.max(Math.round(parsed), 1), 24);
}

function buildElectricityAuthorityDispatchUrl() {
    return `${getElectricityAuthorityBaseUrl()}${getElectricityAuthorityDispatchPath()}`;
}

function transformElectricityAuthorityDispatchData(payload = {}) {
    const rows = getElectricityAuthorityRows(payload);
    const byTimestamp = new Map();

    rows.forEach((row) => {
        const timestamp = readObjectValue(row, 'FiveMinuteIntervalDatetime');
        if (!timestamp || Number.isNaN(new Date(timestamp).getTime())) return;

        const load = toPositiveNumber(readObjectValue(row, 'SPDLoadMegawatt'));
        const generation = toPositiveNumber(readObjectValue(row, 'SPDGenerationMegawatt'));
        if (load === null && generation === null) return;

        const bucket = byTimestamp.get(timestamp) || {
            timestamp,
            runDateTime: readObjectValue(row, 'RunDateTime') || null,
            totalDemandMW: 0,
            totalGenerationMW: 0,
            pointCount: 0,
        };

        if (load !== null) bucket.totalDemandMW += load;
        if (generation !== null) bucket.totalGenerationMW += generation;
        bucket.pointCount += 1;

        const runDateTime = readObjectValue(row, 'RunDateTime');
        if (runDateTime) {
            bucket.runDateTime = latestTimestamp(bucket.runDateTime, runDateTime);
        }

        byTimestamp.set(timestamp, bucket);
    });

    return Array.from(byTimestamp.values())
        .filter((point) => point.totalDemandMW > 0 || point.totalGenerationMW > 0)
        .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
}

function getElectricityAuthorityRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.value)) return payload.value;
    if (Array.isArray(payload.items)) return payload.items;
    return [];
}

function readObjectValue(row, pascalKey) {
    const camelKey = pascalKey.charAt(0).toLowerCase() + pascalKey.slice(1);
    return row[pascalKey] ?? row[camelKey];
}

function toPositiveNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function getNearestEaHistoryPoint(history, timestamp, maxDistanceMinutes = 10) {
    const target = new Date(timestamp).getTime();
    if (!Number.isFinite(target)) return null;

    const maxDistanceMs = maxDistanceMinutes * 60 * 1000;
    let nearest = null;
    let nearestDistance = Infinity;

    history.forEach((point) => {
        const pointTime = new Date(point.timestamp).getTime();
        if (!Number.isFinite(pointTime)) return;

        const distance = Math.abs(pointTime - target);
        if (distance <= maxDistanceMs && distance < nearestDistance) {
            nearest = point;
            nearestDistance = distance;
        }
    });

    return nearest;
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

function createHistoryResponse(country, history) {
    const cleanestWindow = getCleanestWindow(history);

    return {
        country,
        history,
        cleanestWindow,
    };
}

async function estimateActivity(input, httpClient = axios) {
    const country = String(input.country || 'New Zealand').toLowerCase();
    const kWh = Number(input.kWh);
    const durationHours = Number(input.durationHours || 1);

    if (country !== 'new zealand') {
        throw createHttpError(400, 'country must be New Zealand.');
    }

    if (!Number.isFinite(kWh) || kWh <= 0) {
        throw createHttpError(400, 'kWh must be greater than 0.');
    }

    if (!Number.isFinite(durationHours) || durationHours <= 0) {
        throw createHttpError(400, 'durationHours must be greater than 0.');
    }

    const [currentRecord, historyResponse] = await Promise.all([
        fetchNewZealandData(httpClient),
        fetchNewZealandHistory(httpClient, 24),
    ]);

    return createPlannerEstimate('New Zealand', kWh, durationHours, currentRecord, historyResponse.history);
}

function createPlannerEstimate(country, kWh, durationHours, currentRecord, history) {
    if (!currentRecord) {
        throw createHttpError(404, 'No current grid data found.');
    }

    const recentBestSample = getCleanestWindow(history) || createHistoryPoint(currentRecord);
    const nowKgCO2e = kWh * currentRecord.carbonIntensity_gCO2kWh / 1000;
    const recentBestKgCO2e = kWh * recentBestSample.carbonIntensity_gCO2kWh / 1000;
    const savingsKgCO2e = Math.max(0, nowKgCO2e - recentBestKgCO2e);
    const recommendation = createPlannerRecommendation(currentRecord, recentBestSample, savingsKgCO2e);

    return {
        country,
        region: null,
        kWh,
        durationHours,
        dataNotes: currentRecord.dataNotes || recentBestSample.dataNotes,
        historyCoverage: currentRecord.historyCoverage || recentBestSample.historyCoverage,
        now: {
            timestamp: currentRecord.timestamp,
            carbonIntensity_gCO2kWh: currentRecord.carbonIntensity_gCO2kWh,
            estimatedKgCO2e: nowKgCO2e,
            gridSignal: currentRecord.gridSignal,
        },
        cleanerWindow: {
            timestamp: recentBestSample.timestamp,
            carbonIntensity_gCO2kWh: recentBestSample.carbonIntensity_gCO2kWh,
            estimatedKgCO2e: recentBestKgCO2e,
        },
        savingsKgCO2e,
        recommendation,
    };
}

function createPlannerRecommendation(currentRecord, recentBestSample, savingsKgCO2e) {
    if (savingsKgCO2e >= MEANINGFUL_SAVING_KG) {
        return `Delay if it is easy. The cleanest recent sample would save about ${savingsKgCO2e.toFixed(1)} kg CO2e, but it is not a forecast.`;
    }

    if (currentRecord.gridSignal === 'Use now') {
        return 'Run it now if it suits you. Timing this load is not the main emissions lever today; electrifying transport and heating usually matters more.';
    }

    return `Timing benefit looks limited from the available recent samples. The best recent sample was ${recentBestSample.timestamp}; treat it as context, not a forecast.`;
}

function createHistoryPoint(record) {
    return enrichEmissionRecord({
        country: record.country,
        timestamp: record.timestamp,
        totalDemandMW: record.totalDemandMW,
        carbonIntensity_gCO2kWh: record.carbonIntensity_gCO2kWh,
        generationMix: record.generationMix,
        renewablePercentage: record.renewablePercentage,
        totalGenerationMW: record.totalGenerationMW,
        demandTimestamp: record.demandTimestamp,
        runDateTime: record.runDateTime,
        dispatchMatchedCarbonSample: record.dispatchMatchedCarbonSample,
        dataSources: record.dataSources,
        historyCoverage: record.historyCoverage,
        dataNotes: record.dataNotes,
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

function createSignalReason(signal, carbonIntensity, renewablePercentage, leadingFuel, leadingRenewableFuel, thermalSharePercentage) {
    const roundedIntensity = Math.round(carbonIntensity);

    if (leadingRenewableFuel) {
        const thermalText = Number.isFinite(thermalSharePercentage)
            ? `thermal share is ${thermalSharePercentage}%`
            : 'thermal share is unavailable';
        return `NZ signal: ${roundedIntensity} gCO2/kWh and ${renewablePercentage}% renewable. ${capitalize(leadingRenewableFuel)} leads the mix and ${thermalText}.`;
    }

    const fuelText = leadingFuel ? `${leadingFuel} is the largest visible source` : 'generation mix is incomplete';

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

function latestTimestamp(left, right) {
    if (!right) return left;
    if (!left) return right;

    return new Date(right) > new Date(left) ? right : left;
}

function createHttpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function mapElectricityAuthorityError(error) {
    const upstreamStatus = error.response?.status;

    if (upstreamStatus === 401 || upstreamStatus === 403) {
        return {
            status: 502,
            message: 'Electricity Authority dispatch data is unavailable because authentication failed.',
            logMessage: `Electricity Authority authentication failed with status ${upstreamStatus}.`,
        };
    }

    if (upstreamStatus === 429) {
        return {
            status: 503,
            message: 'Electricity Authority dispatch data is temporarily unavailable because rate limits were reached.',
            logMessage: 'Electricity Authority rate limit reached.',
        };
    }

    return {
        status: 502,
        message: 'Electricity Authority dispatch data is temporarily unavailable.',
        logMessage: error.message || 'Unknown Electricity Authority error.',
    };
}

const app = createApp();

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log(`NZ live API: http://localhost:${PORT}/api/emissions/new-zealand`);
        console.log(`NZ profile API: http://localhost:${PORT}/api/emissions/new-zealand/profile`);
    });
}

module.exports = app;
module.exports.createApp = createApp;
module.exports.transformNewZealandData = transformNewZealandData;
module.exports.transformNewZealandHistory = transformNewZealandHistory;
module.exports.estimateActivity = estimateActivity;
module.exports.enrichEmissionRecord = enrichEmissionRecord;
module.exports.calculateRenewablePercentage = calculateRenewablePercentage;
module.exports.classifyGridSignal = classifyGridSignal;
module.exports.mapElectricityAuthorityError = mapElectricityAuthorityError;
module.exports.buildElectricityAuthorityDispatchUrl = buildElectricityAuthorityDispatchUrl;
module.exports.transformElectricityAuthorityDispatchData = transformElectricityAuthorityDispatchData;
module.exports.NEW_ZEALAND_PROFILE = NEW_ZEALAND_PROFILE;
