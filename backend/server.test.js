const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
    createApp,
    transformOpenElectricityData,
    transformOpenElectricityHistory,
    transformNewZealandData,
    transformNewZealandHistory,
    calculateRenewablePercentage,
    classifyGridSignal,
    mapFuelGroup,
    mapOpenElectricityError,
    mapElectricityAuthorityError,
    buildQueryString,
    buildElectricityAuthorityDispatchUrl,
    transformElectricityAuthorityDispatchData,
} = require('./server');

function payload(series) {
    return {
        success: true,
        data: series,
    };
}

function series(metric, results) {
    return {
        metric,
        results,
    };
}

function result(networkRegion, name, fueltechGroup, points) {
    return {
        name,
        columns: {
            network_region: networkRegion,
            fueltech_group: fueltechGroup,
        },
        data: points,
    };
}

function regionResult(networkRegion, points) {
    return {
        name: networkRegion,
        columns: {
            network_region: networkRegion,
        },
        data: points,
    };
}

function point(timestamp, value) {
    return { timestamp, value };
}

function eaDispatchRow(timestamp, load, generation, runDateTime = '2026-09-03T09:06:00Z') {
    return {
        PointOfConnectionCode: 'BEN2201',
        FiveMinuteIntervalDatetime: timestamp,
        RunDateTime: runDateTime,
        SPDLoadMegawatt: load,
        SPDGenerationMegawatt: generation,
    };
}

test('maps OpenElectricity fuel groups to dashboard fuel keys', () => {
    assert.equal(mapFuelGroup('coal_black'), 'coal');
    assert.equal(mapFuelGroup('gas_ccgt'), 'gas');
    assert.equal(mapFuelGroup('hydro'), 'hydro');
    assert.equal(mapFuelGroup('wind'), 'wind');
    assert.equal(mapFuelGroup('solar_utility'), 'solar');
    assert.equal(mapFuelGroup('battery_discharging'), 'other');
});

test('builds repeated query params for OpenElectricity array parameters', () => {
    assert.equal(
        buildQueryString({
            metrics: ['energy', 'emissions'],
            interval: '5m',
            primary_grouping: 'network_region',
        }),
        'metrics=energy&metrics=emissions&interval=5m&primary_grouping=network_region'
    );
});

test('calculates renewable percentage and classifies grid signal', () => {
    assert.equal(calculateRenewablePercentage({ hydro: 40, wind: 30, gas: 30 }), 70);
    assert.equal(classifyGridSignal(120, 30), 'Use now');
    assert.equal(classifyGridSignal(320, 55), 'Wait');
    assert.equal(classifyGridSignal(620, 20), 'Avoid peak');
});

test('transforms latest OpenElectricity series into frontend state records', () => {
    const generationPayload = payload([
        series('power', [
            result('NSW1', 'NSW coal', 'coal', [
                point('2026-09-03T01:00:00', 100),
                point('2026-09-03T01:05:00', 120),
            ]),
            result('NSW1', 'NSW solar', 'solar', [point('2026-09-03T01:05:00', 80)]),
            {
                name: 'power_QLD1|gas',
                columns: { region: 'QLD1', fueltech_group: 'gas' },
                data: [['2026-09-03T01:05:00', 50]],
            },
        ]),
    ]);
    const demandPayload = payload([
        series('demand', [
            regionResult('NSW1', [point('2026-09-03T01:05:00', 300)]),
            regionResult('QLD1', [point('2026-09-03T01:05:00', 90)]),
        ]),
    ]);
    const emissionsPayload = payload([
        series('energy', [
            regionResult('NSW1', [point('2026-09-03T01:05:00', 10)]),
            regionResult('QLD1', [point('2026-09-03T01:05:00', 5)]),
        ]),
        series('emissions', [
            regionResult('NSW1', [point('2026-09-03T01:05:00', 4)]),
            regionResult('QLD1', [point('2026-09-03T01:05:00', 2)]),
        ]),
    ]);

    const data = transformOpenElectricityData(generationPayload, demandPayload, emissionsPayload);
    const nsw = data.find((state) => state.state === 'NSW');
    const qld = data.find((state) => state.state === 'QLD');

    assert.equal(data.length, 5);
    assert.equal(nsw.totalDemandMW, 300);
    assert.equal(nsw.carbonIntensity_gCO2kWh, 400);
    assert.deepEqual(nsw.generationMix, { coal: 120, solar: 80 });
    assert.equal(qld.carbonIntensity_gCO2kWh, 400);
    assert.deepEqual(qld.generationMix, { gas: 50 });
});

test('sets carbon intensity to zero when energy is missing', () => {
    const data = transformOpenElectricityData(
        payload([series('power', [])]),
        payload([series('demand', [])]),
        payload([series('emissions', [regionResult('NSW1', [point('2026-09-03T01:05:00', 2)])])])
    );

    assert.equal(data.find((state) => state.state === 'NSW').carbonIntensity_gCO2kWh, 0);
});

test('treats zero emissions as a valid carbon intensity value', () => {
    const data = transformOpenElectricityData(
        payload([series('power', [])]),
        payload([series('demand', [])]),
        payload([
            series('energy', [regionResult('TAS1', [point('2026-09-03T01:05:00', 10)])]),
            series('emissions', [regionResult('TAS1', [point('2026-09-03T01:05:00', 0)])]),
        ])
    );

    assert.equal(data.find((state) => state.state === 'TAS').carbonIntensity_gCO2kWh, 0);
});

test('transforms EM6 New Zealand responses into frontend country record', () => {
    const data = transformNewZealandData(
        {
            items: [
                {
                    timestamp: '2026-09-03T09:00:00Z',
                    nz_carbon_gkwh: '95.4',
                },
            ],
        },
        {
            items: [
                {
                    generation_type: [
                        {
                            hyd_mwh: 480,
                            win_mwh: 96,
                            sol_mwh: 48,
                            gas_mwh: 24,
                            cg_mwh: 24,
                            cog_mwh: 48,
                            geo_mwh: 240,
                            bat_mwh: 12,
                            liq_mwh: 0,
                        },
                    ],
                },
            ],
        }
    );

    assert.equal(data.country, 'New Zealand');
    assert.equal(data.timestamp, '2026-09-03T09:00:00Z');
    assert.equal(data.carbonIntensity_gCO2kWh, 95.4);
    assert.equal(data.historyCoverage, 'limited');
    assert.deepEqual(data.dataSources, ['EM6 free current carbon intensity', 'EM6 free generation quantities']);
    assert.match(data.dataNotes, /last three trading periods/);
    assert.equal(data.totalDemandMW, 20.25);
    assert.deepEqual(data.generationMix, {
        hydro: 10,
        wind: 2,
        solar: 1,
        gas: 2,
        geothermal: 5,
        other: 0.25,
    });
});

test('builds Electricity Authority real-time dispatch URL for latest snapshot endpoint', () => {
    const previousBaseUrl = process.env.EA_API_BASE_URL;
    const previousPath = process.env.EA_REALTIME_DISPATCH_PATH;

    process.env.EA_API_BASE_URL = 'https://ea.example.test/';
    process.env.EA_REALTIME_DISPATCH_PATH = 'real-time-dispatch/';

    const url = buildElectricityAuthorityDispatchUrl();

    restoreEnv('EA_API_BASE_URL', previousBaseUrl);
    restoreEnv('EA_REALTIME_DISPATCH_PATH', previousPath);

    assert.equal(url, 'https://ea.example.test/real-time-dispatch/');
});

test('aggregates Electricity Authority dispatch rows by 5-minute interval', () => {
    const history = transformElectricityAuthorityDispatchData({
        value: [
            eaDispatchRow('2026-09-03T09:00:00Z', '10.5', '20'),
            eaDispatchRow('2026-09-03T09:00:00Z', 5, 7),
            eaDispatchRow('2026-09-03T09:05:00Z', -2, 'bad'),
            eaDispatchRow('2026-09-03T09:05:00Z', 1, 3),
            eaDispatchRow('not-a-date', 50, 50),
        ],
    });

    assert.equal(history.length, 2);
    assert.equal(history[0].timestamp, '2026-09-03T09:00:00Z');
    assert.equal(history[0].totalDemandMW, 15.5);
    assert.equal(history[0].totalGenerationMW, 27);
    assert.equal(history[1].totalDemandMW, 1);
    assert.equal(history[1].totalGenerationMW, 3);
});

test('merges Electricity Authority latest demand into NZ current response', async () => {
    const previousProvider = process.env.NZ_REALTIME_PROVIDER;
    const previousEaKey = process.env.EA_API_KEY;
    const previousEaBaseUrl = process.env.EA_API_BASE_URL;
    const previousEaPath = process.env.EA_REALTIME_DISPATCH_PATH;

    process.env.NZ_REALTIME_PROVIDER = 'ea';
    process.env.EA_API_KEY = 'secret-ea-key';
    process.env.EA_API_BASE_URL = 'https://ea-current.test';
    process.env.EA_REALTIME_DISPATCH_PATH = '/real-time-dispatch/';

    const calls = [];
    const app = createApp({
        httpClient: {
            get: async (url, config = {}) => {
                calls.push({ url, config });

                if (url.includes('current_carbon_intensity')) {
                    return {
                        data: {
                            items: [
                                {
                                    timestamp: '2026-09-03T09:00:00Z',
                                    nz_carbon_gkwh: '80',
                                },
                            ],
                        },
                    };
                }

                if (url.includes('free/price')) {
                    return {
                        data: {
                            items: [
                                {
                                    generation_type: [
                                        {
                                            hyd_mwh: 480,
                                        },
                                    ],
                                },
                            ],
                        },
                    };
                }

                return {
                    data: {
                        value: [
                            eaDispatchRow('2026-09-03T08:55:00Z', 900, 920),
                            eaDispatchRow('2026-09-03T09:00:00Z', 950, 970),
                        ],
                    },
                };
            },
        },
    });

    const response = await request(app, '/api/emissions/new-zealand');

    restoreEnv('NZ_REALTIME_PROVIDER', previousProvider);
    restoreEnv('EA_API_KEY', previousEaKey);
    restoreEnv('EA_API_BASE_URL', previousEaBaseUrl);
    restoreEnv('EA_REALTIME_DISPATCH_PATH', previousEaPath);

    const eaCall = calls.find((call) => call.url.includes('ea-current.test'));
    assert.equal(response.status, 200);
    assert.equal(eaCall.config.headers['Ocp-Apim-Subscription-Key'], 'secret-ea-key');
    assert.equal(eaCall.config.headers.Accept, undefined);
    assert.equal(response.body.totalDemandMW, 950);
    assert.equal(response.body.totalGenerationMW, 970);
    assert.equal(response.body.historyCoverage, 'partial');
    assert.deepEqual(response.body.dataSources, [
        'EM6 free current carbon intensity',
        'EM6 free generation quantities',
        'Electricity Authority real-time dispatch',
    ]);
    assert.equal(JSON.stringify(response.body).includes('secret-ea-key'), false);
});

test('keeps NZ carbon history limited when Electricity Authority dispatch data is available', () => {
    const carbonTimestamp = new Date().toISOString();
    const dispatchTimestamp = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const history = transformNewZealandHistory(
        {
            items: [
                { timestamp: carbonTimestamp, nz_carbon_gkwh: '80' },
            ],
        },
        {
            items: [
                {
                    generation_type: [
                        {
                            hyd_mwh: 480,
                        },
                    ],
                },
            ],
        },
        24,
        {
            history: [
                {
                    timestamp: dispatchTimestamp,
                    totalDemandMW: 950,
                    totalGenerationMW: 970,
                },
            ],
        }
    );

    assert.equal(history.historyCoverage, 'limited');
    assert.equal(history.history[0].totalDemandMW, 950);
    assert.equal(history.history[0].totalGenerationMW, 970);
    assert.equal(history.history[0].dispatchMatchedCarbonSample, true);
    assert.equal(history.dispatchIntervalCount, 0);
    assert.match(history.dataNotes, /Electricity Authority real-time dispatch/);
});

test('does not stamp latest EA dispatch demand onto unmatched EM6 carbon samples', () => {
    const carbonTimestamp = new Date().toISOString();
    const dispatchTimestamp = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const history = transformNewZealandHistory(
        {
            items: [
                { timestamp: carbonTimestamp, nz_carbon_gkwh: '80' },
            ],
        },
        {
            items: [
                {
                    generation_type: [
                        {
                            hyd_mwh: 480,
                        },
                    ],
                },
            ],
        },
        24,
        {
            latest: {
                timestamp: dispatchTimestamp,
                totalDemandMW: 1800,
                totalGenerationMW: 1900,
            },
            history: [
                {
                    timestamp: dispatchTimestamp,
                    totalDemandMW: 1800,
                    totalGenerationMW: 1900,
                },
            ],
            dispatchIntervalCount: 1,
            dispatchLatestTimestamp: dispatchTimestamp,
        }
    );

    assert.equal(history.historyCoverage, 'limited');
    assert.equal(history.history[0].totalDemandMW, 10);
    assert.equal(history.history[0].totalGenerationMW, undefined);
    assert.equal(history.history[0].demandTimestamp, undefined);
    assert.equal(history.history[0].dispatchMatchedCarbonSample, false);
    assert.equal(history.dispatchIntervalCount, 1);
    assert.equal(history.dispatchLatestTimestamp, dispatchTimestamp);
});

test('transforms OpenElectricity time series into regional and aggregate history', () => {
    const history = transformOpenElectricityHistory(
        payload([
            series('power', [
                result('NSW1', 'NSW coal', 'coal', [
                    point('2026-09-03T01:00:00', 100),
                    point('2026-09-03T01:35:00', 80),
                ]),
                result('QLD1', 'QLD wind', 'wind', [
                    point('2026-09-03T01:00:00', 40),
                    point('2026-09-03T01:35:00', 60),
                ]),
            ]),
        ]),
        payload([
            series('demand', [
                regionResult('NSW1', [
                    point('2026-09-03T01:00:00', 100),
                    point('2026-09-03T01:35:00', 80),
                ]),
                regionResult('QLD1', [
                    point('2026-09-03T01:00:00', 40),
                    point('2026-09-03T01:35:00', 60),
                ]),
            ]),
        ]),
        payload([
            series('energy', [
                regionResult('NSW1', [point('2026-09-03T01:00:00', 10), point('2026-09-03T01:35:00', 10)]),
                regionResult('QLD1', [point('2026-09-03T01:00:00', 10), point('2026-09-03T01:35:00', 10)]),
            ]),
            series('emissions', [
                regionResult('NSW1', [point('2026-09-03T01:00:00', 5), point('2026-09-03T01:35:00', 4)]),
                regionResult('QLD1', [point('2026-09-03T01:00:00', 1), point('2026-09-03T01:35:00', 1)]),
            ]),
        ])
    );

    assert.equal(history.country, 'Australia');
    assert.equal(history.history.length, 2);
    assert.equal(history.regionHistory.length, 4);
    assert.equal(history.cleanestWindow.timestamp, '2026-09-02T13:30:00.000Z');
    assert.equal(Math.round(history.history[1].carbonIntensity_gCO2kWh), 271);
});

test('filters incomplete OpenElectricity history intervals out of cleanest window', () => {
    const history = transformOpenElectricityHistory(
        payload([
            series('power', [
                result('NSW1', 'NSW wind', 'wind', [
                    point('2026-09-03T01:00:00', 50),
                    point('2026-09-03T01:35:00', 60),
                ]),
            ]),
        ]),
        payload([
            series('demand', [
                regionResult('NSW1', [
                    point('2026-09-03T01:00:00', 50),
                    point('2026-09-03T01:35:00', 60),
                ]),
            ]),
        ]),
        payload([
            series('energy', [
                regionResult('NSW1', [point('2026-09-03T01:35:00', 10)]),
            ]),
            series('emissions', [
                regionResult('NSW1', [point('2026-09-03T01:35:00', 2)]),
            ]),
        ])
    );

    assert.equal(history.history.length, 1);
    assert.equal(history.cleanestWindow.timestamp, '2026-09-02T13:30:00.000Z');
    assert.equal(history.cleanestWindow.carbonIntensity_gCO2kWh, 200);
});

test('transforms EM6 carbon items into New Zealand history', () => {
    const history = transformNewZealandHistory(
        {
            items: [
                { timestamp: new Date().toISOString(), nz_carbon_gkwh: '50' },
                { timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(), nz_carbon_gkwh: '40' },
            ],
        },
        {
            items: [
                {
                    generation_type: [
                        {
                            hyd_mwh: 480,
                            gas_mwh: 48,
                        },
                    ],
                },
            ],
        },
        24
    );

    assert.equal(history.country, 'New Zealand');
    assert.equal(history.history.length, 2);
    assert.equal(history.historyCoverage, 'limited');
    assert.deepEqual(history.dataSources, ['EM6 free current carbon intensity', 'EM6 free generation quantities']);
    assert.match(history.dataNotes, /last three trading periods/);
    assert.equal(history.cleanestWindow.carbonIntensity_gCO2kWh, 40);
    assert.equal(history.history[0].renewablePercentage, 91);
});

test('maps OpenElectricity auth and rate-limit errors safely', () => {
    assert.equal(mapOpenElectricityError({ response: { status: 401 } }).status, 502);
    assert.equal(mapOpenElectricityError({ response: { status: 403 } }).status, 502);
    assert.equal(mapOpenElectricityError({ response: { status: 429 } }).status, 503);
    assert.equal(mapOpenElectricityError(new Error('boom')).status, 502);
});

test('maps Electricity Authority auth and rate-limit errors safely', () => {
    assert.equal(mapElectricityAuthorityError({ response: { status: 401 } }).status, 502);
    assert.equal(mapElectricityAuthorityError({ response: { status: 403 } }).status, 502);
    assert.equal(mapElectricityAuthorityError({ response: { status: 429 } }).status, 503);
    assert.equal(mapElectricityAuthorityError(new Error('boom')).status, 502);
    assert.equal(JSON.stringify(mapElectricityAuthorityError({ response: { status: 401 } })).includes('secret'), false);
});

test('australia endpoint rejects missing OpenElectricity API key without calling upstream', async () => {
    const previousKey = process.env.OPENELECTRICITY_API_KEY;
    delete process.env.OPENELECTRICITY_API_KEY;

    const app = createApp({
        httpClient: {
            get() {
                throw new Error('should not call upstream');
            },
        },
    });

    const response = await request(app, '/api/emissions/australia');

    restoreApiKey(previousKey);

    assert.equal(response.status, 500);
    assert.match(response.body.error, /API key is not configured/);
});

test('australia endpoint returns transformed OpenElectricity records', async () => {
    const previousKey = process.env.OPENELECTRICITY_API_KEY;
    process.env.OPENELECTRICITY_API_KEY = 'test-key';

    const responses = [
        { data: payload([series('power', [result('NSW1', 'NSW wind', 'wind', [point('2026-09-03T01:05:00', 75)])])]) },
        { data: payload([series('demand', [regionResult('NSW1', [point('2026-09-03T01:05:00', 150)])])]) },
        {
            data: payload([
                series('energy', [regionResult('NSW1', [point('2026-09-03T01:05:00', 5)])]),
                series('emissions', [regionResult('NSW1', [point('2026-09-03T01:05:00', 1)])]),
            ]),
        },
    ];

    const app = createApp({
        httpClient: {
            get: async () => responses.shift(),
        },
    });

    const response = await request(app, '/api/emissions/australia');

    restoreApiKey(previousKey);

    assert.equal(response.status, 200);
    const nsw = response.body.find((state) => state.state === 'NSW');
    assert.equal(nsw.totalDemandMW, 150);
    assert.equal(nsw.carbonIntensity_gCO2kWh, 200);
    assert.deepEqual(nsw.generationMix, { wind: 75 });
});

test('new zealand endpoint returns transformed EM6 records', async () => {
    const previousProvider = process.env.NZ_REALTIME_PROVIDER;
    const previousEaKey = process.env.EA_API_KEY;

    process.env.NZ_REALTIME_PROVIDER = 'em6-free';
    delete process.env.EA_API_KEY;

    const responses = [
        {
            data: {
                items: [
                    {
                        timestamp: '2026-09-03T09:00:00Z',
                        nz_carbon_gkwh: '80',
                    },
                ],
            },
        },
        {
            data: {
                items: [
                    {
                        generation_type: [
                            {
                                hyd_mwh: 480,
                            },
                        ],
                    },
                ],
            },
        },
    ];

    const app = createApp({
        httpClient: {
            get: async () => responses.shift(),
        },
    });

    const response = await request(app, '/api/emissions/new-zealand');

    restoreEnv('NZ_REALTIME_PROVIDER', previousProvider);
    restoreEnv('EA_API_KEY', previousEaKey);

    assert.equal(response.status, 200);
    assert.equal(response.body.country, 'New Zealand');
    assert.equal(response.body.carbonIntensity_gCO2kWh, 80);
    assert.equal(response.body.historyCoverage, 'limited');
    assert.equal(response.body.leadingRenewableFuel, 'hydro');
    assert.deepEqual(response.body.generationMix, { hydro: 10 });
});

test('health reports NZ provider config without exposing secrets', async () => {
    const previousProvider = process.env.NZ_REALTIME_PROVIDER;
    const previousEaKey = process.env.EA_API_KEY;
    const previousEaBaseUrl = process.env.EA_API_BASE_URL;

    process.env.NZ_REALTIME_PROVIDER = 'ea';
    process.env.EA_API_KEY = 'secret-ea-key';
    process.env.EA_API_BASE_URL = 'https://example.test';

    const app = createApp({
        httpClient: {
            get() {
                throw new Error('should not call upstream');
            },
        },
    });

    const response = await request(app, '/health');

    restoreEnv('NZ_REALTIME_PROVIDER', previousProvider);
    restoreEnv('EA_API_KEY', previousEaKey);
    restoreEnv('EA_API_BASE_URL', previousEaBaseUrl);

    assert.equal(response.status, 200);
    assert.equal(response.body.nzProvider, 'ea');
    assert.equal(response.body.electricityAuthorityConfigured, true);
    assert.equal(JSON.stringify(response.body).includes('secret-ea-key'), false);
});

test('optional Electricity Authority provider falls back when key is missing', async () => {
    const previousProvider = process.env.NZ_REALTIME_PROVIDER;
    const previousEaKey = process.env.EA_API_KEY;
    const previousEaBaseUrl = process.env.EA_API_BASE_URL;

    process.env.NZ_REALTIME_PROVIDER = 'ea';
    delete process.env.EA_API_KEY;
    process.env.EA_API_BASE_URL = 'https://example.test';

    const responses = [
        {
            data: {
                items: [
                    {
                        timestamp: '2026-09-03T09:00:00Z',
                        nz_carbon_gkwh: '80',
                    },
                ],
            },
        },
        {
            data: {
                items: [
                    {
                        generation_type: [
                            {
                                hyd_mwh: 480,
                            },
                        ],
                    },
                ],
            },
        },
    ];

    const app = createApp({
        httpClient: {
            get: async () => responses.shift(),
        },
    });

    const response = await request(app, '/api/emissions/new-zealand');

    restoreEnv('NZ_REALTIME_PROVIDER', previousProvider);
    restoreEnv('EA_API_KEY', previousEaKey);
    restoreEnv('EA_API_BASE_URL', previousEaBaseUrl);

    assert.equal(response.status, 200);
    assert.equal(response.body.historyCoverage, 'limited');
    assert.equal(response.body.totalDemandMW, 10);
});

test('optional Electricity Authority provider falls back on upstream errors', async () => {
    const previousProvider = process.env.NZ_REALTIME_PROVIDER;
    const previousEaKey = process.env.EA_API_KEY;
    const previousEaBaseUrl = process.env.EA_API_BASE_URL;
    const previousEaPath = process.env.EA_REALTIME_DISPATCH_PATH;

    process.env.NZ_REALTIME_PROVIDER = 'ea';
    process.env.EA_API_KEY = 'secret-ea-key';
    process.env.EA_API_BASE_URL = 'https://ea-fallback.test';
    process.env.EA_REALTIME_DISPATCH_PATH = '/real-time-dispatch/';

    const app = createApp({
        httpClient: {
            get: async (url) => {
                if (url.includes('current_carbon_intensity')) {
                    return {
                        data: {
                            items: [
                                {
                                    timestamp: '2026-09-03T09:00:00Z',
                                    nz_carbon_gkwh: '80',
                                },
                            ],
                        },
                    };
                }

                if (url.includes('free/price')) {
                    return {
                        data: {
                            items: [
                                {
                                    generation_type: [
                                        {
                                            hyd_mwh: 480,
                                        },
                                    ],
                                },
                            ],
                        },
                    };
                }

                const error = new Error('rate limited');
                error.response = { status: 429 };
                throw error;
            },
        },
    });

    const response = await request(app, '/api/emissions/new-zealand');

    restoreEnv('NZ_REALTIME_PROVIDER', previousProvider);
    restoreEnv('EA_API_KEY', previousEaKey);
    restoreEnv('EA_API_BASE_URL', previousEaBaseUrl);
    restoreEnv('EA_REALTIME_DISPATCH_PATH', previousEaPath);

    assert.equal(response.status, 200);
    assert.equal(response.body.historyCoverage, 'limited');
    assert.equal(response.body.totalDemandMW, 10);
    assert.equal(JSON.stringify(response.body).includes('secret-ea-key'), false);
});

test('planner endpoint includes limited-history note for New Zealand free data', async () => {
    const previousProvider = process.env.NZ_REALTIME_PROVIDER;
    const previousEaKey = process.env.EA_API_KEY;

    process.env.NZ_REALTIME_PROVIDER = 'em6-free';
    delete process.env.EA_API_KEY;

    const responses = [
        {
            data: {
                items: [
                    {
                        timestamp: '2026-09-03T09:00:00Z',
                        nz_carbon_gkwh: '80',
                    },
                ],
            },
        },
        {
            data: {
                items: [
                    {
                        generation_type: [
                            {
                                hyd_mwh: 480,
                            },
                        ],
                    },
                ],
            },
        },
        {
            data: {
                items: [
                    {
                        timestamp: new Date().toISOString(),
                        nz_carbon_gkwh: '80',
                    },
                    {
                        timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
                        nz_carbon_gkwh: '40',
                    },
                ],
            },
        },
        {
            data: {
                items: [
                    {
                        generation_type: [
                            {
                                hyd_mwh: 480,
                            },
                        ],
                    },
                ],
            },
        },
    ];

    const app = createApp({
        httpClient: {
            get: async () => responses.shift(),
        },
    });

    const response = await request(app, '/api/planner/estimate', {
        method: 'POST',
        body: {
            country: 'New Zealand',
            kWh: 10,
            durationHours: 2,
        },
    });

    restoreEnv('NZ_REALTIME_PROVIDER', previousProvider);
    restoreEnv('EA_API_KEY', previousEaKey);

    assert.equal(response.status, 200);
    assert.equal(response.body.historyCoverage, 'limited');
    assert.match(response.body.dataNotes, /last three trading periods/);
    assert.equal(response.body.now.estimatedKgCO2e, 0.8);
    assert.equal(response.body.cleanerWindow.estimatedKgCO2e, 0.4);
});

test('planner endpoint estimates run-now emissions against cleanest recent window', async () => {
    const previousKey = process.env.OPENELECTRICITY_API_KEY;
    process.env.OPENELECTRICITY_API_KEY = 'test-key';

    const responses = [
        { data: payload([series('power', [result('NSW1', 'NSW gas', 'gas', [point('2026-09-03T01:05:00', 100)])])]) },
        { data: payload([series('demand', [regionResult('NSW1', [point('2026-09-03T01:05:00', 100)])])]) },
        {
            data: payload([
                series('energy', [regionResult('NSW1', [point('2026-09-03T01:05:00', 10)])]),
                series('emissions', [regionResult('NSW1', [point('2026-09-03T01:05:00', 5)])]),
            ]),
        },
        { data: payload([series('power', [result('NSW1', 'NSW wind', 'wind', [point('2026-09-03T00:05:00', 100)])])]) },
        { data: payload([series('demand', [regionResult('NSW1', [point('2026-09-03T00:05:00', 100)])])]) },
        {
            data: payload([
                series('energy', [regionResult('NSW1', [point('2026-09-03T00:05:00', 10)])]),
                series('emissions', [regionResult('NSW1', [point('2026-09-03T00:05:00', 1)])]),
            ]),
        },
    ];

    const app = createApp({
        httpClient: {
            get: async () => responses.shift(),
        },
    });

    const response = await request(app, '/api/planner/estimate', {
        method: 'POST',
        body: {
            country: 'Australia',
            region: 'NSW',
            kWh: 10,
            durationHours: 2,
        },
    });

    restoreApiKey(previousKey);

    assert.equal(response.status, 200);
    assert.equal(response.body.now.estimatedKgCO2e, 5);
    assert.equal(response.body.cleanerWindow.estimatedKgCO2e, 1);
    assert.equal(response.body.savingsKgCO2e, 4);
});

function request(app, path, requestConfig = {}) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);

        server.listen(0, () => {
            const address = server.address();
            const httpOptions = {
                hostname: '127.0.0.1',
                port: address.port,
                path,
                method: requestConfig.method || 'GET',
                headers: requestConfig.body ? { 'Content-Type': 'application/json' } : undefined,
            };

            const req = http.request(httpOptions, (res) => {
                let body = '';

                res.on('data', (chunk) => {
                    body += chunk;
                });

                res.on('end', () => {
                    server.close();
                    resolve({
                        status: res.statusCode,
                        body: JSON.parse(body),
                    });
                });
            });

            req.on('error', (error) => {
                server.close();
                reject(error);
            });

            if (requestConfig.body) {
                req.write(JSON.stringify(requestConfig.body));
            }

            req.end();
        });
    });
}

function restoreApiKey(previousKey) {
    if (previousKey === undefined) {
        delete process.env.OPENELECTRICITY_API_KEY;
        return;
    }

    process.env.OPENELECTRICITY_API_KEY = previousKey;
}

function restoreEnv(name, previousValue) {
    if (previousValue === undefined) {
        delete process.env[name];
        return;
    }

    process.env[name] = previousValue;
}
