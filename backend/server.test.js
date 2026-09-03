const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
    createApp,
    transformOpenElectricityData,
    transformNewZealandData,
    mapFuelGroup,
    mapOpenElectricityError,
    buildQueryString,
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

test('maps OpenElectricity auth and rate-limit errors safely', () => {
    assert.equal(mapOpenElectricityError({ response: { status: 401 } }).status, 502);
    assert.equal(mapOpenElectricityError({ response: { status: 403 } }).status, 502);
    assert.equal(mapOpenElectricityError({ response: { status: 429 } }).status, 503);
    assert.equal(mapOpenElectricityError(new Error('boom')).status, 502);
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

    assert.equal(response.status, 200);
    assert.equal(response.body.country, 'New Zealand');
    assert.equal(response.body.carbonIntensity_gCO2kWh, 80);
    assert.deepEqual(response.body.generationMix, { hydro: 10 });
});

function request(app, path) {
    return new Promise((resolve, reject) => {
        const server = http.createServer(app);

        server.listen(0, () => {
            const address = server.address();
            const options = {
                hostname: '127.0.0.1',
                port: address.port,
                path,
                method: 'GET',
            };

            const req = http.request(options, (res) => {
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
