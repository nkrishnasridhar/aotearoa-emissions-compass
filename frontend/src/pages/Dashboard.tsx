import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    Area,
    AreaChart,
    CartesianGrid,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import GenerationMixChart from "../components/GenerationMixChart";
import {
    aggregateAustraliaData,
    calculateRenewablePercentage,
    EmissionsData,
    estimateActivity,
    fetchAustraliaData,
    fetchAustraliaHistory,
    fetchNewZealandData,
    fetchNewZealandHistory,
    HistoryResponse,
    PlannerEstimate,
    PlannerInput,
} from "../services/api";
import "./Dashboard.css";

const ACTIVITIES = [
    { label: "EV charging", kWh: 18, durationHours: 3 },
    { label: "Dishwasher", kWh: 1.2, durationHours: 1.5 },
    { label: "Laundry", kWh: 2.5, durationHours: 2 },
    { label: "Heat pump", kWh: 6, durationHours: 4 },
    { label: "Generic load", kWh: 5, durationHours: 2 },
];

type TrendMetric = "carbon" | "renewable" | "demand";

interface PlannerState extends PlannerInput {
    activity: string;
}

const Dashboard: React.FC = () => {
    const [nzData, setNzData] = useState<EmissionsData | null>(null);
    const [auData, setAuData] = useState<EmissionsData | null>(null);
    const [auStates, setAuStates] = useState<EmissionsData[]>([]);
    const [nzHistory, setNzHistory] = useState<HistoryResponse | null>(null);
    const [auHistory, setAuHistory] = useState<HistoryResponse | null>(null);
    const [trendMetric, setTrendMetric] = useState<TrendMetric>("carbon");
    const [loading, setLoading] = useState(true);
    const [plannerLoading, setPlannerLoading] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [planner, setPlanner] = useState<PlannerState>({
        activity: ACTIVITIES[0].label,
        country: "Australia",
        region: "",
        kWh: ACTIVITIES[0].kWh,
        durationHours: ACTIVITIES[0].durationHours,
    });
    const [plannerEstimate, setPlannerEstimate] = useState<PlannerEstimate | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        const nextErrors: string[] = [];

        const [nzResult, auResult] = await Promise.allSettled([
            Promise.all([
                fetchNewZealandData(),
                fetchNewZealandHistory(24),
            ]),
            Promise.all([
                fetchAustraliaData(),
                fetchAustraliaHistory(24),
            ]),
        ]);

        if (nzResult.status === "fulfilled") {
            const [current, history] = nzResult.value;
            setNzData(current);
            setNzHistory(history);
        } else {
            console.error("Error fetching NZ data:", nzResult.reason);
            nextErrors.push("New Zealand data is temporarily unavailable.");
        }

        if (auResult.status === "fulfilled") {
            const [states, history] = auResult.value;
            const stateRecords = Array.isArray(states) ? states : [];
            setAuStates(stateRecords);
            setAuData(aggregateAustraliaData(stateRecords));
            setAuHistory(history);
        } else {
            console.error("Error fetching AU data:", auResult.reason);
            nextErrors.push("Australian data is temporarily unavailable.");
        }

        setErrors(nextErrors);
        setLastUpdated(new Date());
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 300000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const auRegionData = useMemo(() => Array.isArray(auStates) ? auStates : [], [auStates]);
    const insights = useMemo(() => buildInsights(nzData, auData, auRegionData, lastUpdated), [nzData, auData, auRegionData, lastUpdated]);
    const trendData = useMemo(() => buildTrendData(nzHistory, auHistory, trendMetric), [nzHistory, auHistory, trendMetric]);
    const cleanestAuRegion = useMemo(() => getCleanestRegion(auRegionData), [auRegionData]);
    const nzHasEaDispatch = Boolean(nzHistory?.dataSources?.some((source) => source.includes("Electricity Authority")));

    const handleActivityChange = (activity: string) => {
        const selected = ACTIVITIES.find((item) => item.label === activity) || ACTIVITIES[0];
        setPlanner((current) => ({
            ...current,
            activity,
            kWh: selected.kWh,
            durationHours: selected.durationHours,
        }));
        setPlannerEstimate(null);
    };

    const handlePlannerSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setPlannerLoading(true);

        try {
            const estimate = await estimateActivity({
                country: planner.country,
                region: planner.country === "Australia" && planner.region ? planner.region : undefined,
                kWh: planner.kWh,
                durationHours: planner.durationHours,
            });
            setPlannerEstimate(estimate);
        } catch (error) {
            console.error("Error estimating activity:", error);
            setErrors(["Unable to estimate activity emissions right now."]);
        } finally {
            setPlannerLoading(false);
        }
    };

    if (loading && !nzData && !auData) {
        return (
            <div className="dashboard-container">
                <div className="loading">Loading grid signals...</div>
            </div>
        );
    }

    return (
        <div className="dashboard-container">
            <header className="dashboard-header">
                <div>
                    <p className="eyebrow">Grid timing decision tool</p>
                    <h1>Is now a clean time to use electricity?</h1>
                    <p className="header-copy">
                        Compare live grid emissions, recent trends, and the impact of shifting flexible household demand.
                    </p>
                </div>
                <div className="header-controls">
                    {lastUpdated && (
                        <span className="last-updated">
                            Refreshed {formatRelativeMinutes(lastUpdated)}
                        </span>
                    )}
                    <button onClick={fetchData} disabled={loading} className="refresh-button">
                        {loading ? "Refreshing" : "Refresh"}
                    </button>
                </div>
            </header>

            {errors.length > 0 && (
                <div className="error-message">
                    {errors.map((error) => <span key={error}>{error}</span>)}
                </div>
            )}

            <section className="signal-grid">
                {nzData && <GridSignalPanel data={nzData} />}
                {auData && <GridSignalPanel data={auData} />}
            </section>

            <section className="insight-grid">
                {insights.map((insight) => (
                    <article className="insight-card" key={insight.label}>
                        <span>{insight.label}</span>
                        <strong>{insight.value}</strong>
                        <p>{insight.detail}</p>
                    </article>
                ))}
            </section>

            <section className="dashboard-section trend-section">
                <div className="section-heading">
                    <div>
                        <h2>Recent Grid Trend</h2>
                        <p>Use the recent pattern to see whether now is unusually clean or worth waiting out.</p>
                    </div>
                    <div className="segmented-control" aria-label="Trend metric">
                        <button className={trendMetric === "carbon" ? "active" : ""} onClick={() => setTrendMetric("carbon")}>Carbon</button>
                        <button className={trendMetric === "renewable" ? "active" : ""} onClick={() => setTrendMetric("renewable")}>Renewables</button>
                        <button className={trendMetric === "demand" ? "active" : ""} onClick={() => setTrendMetric("demand")}>Demand</button>
                    </div>
                </div>
                <div className="trend-chart">
                    {trendData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={320}>
                            <AreaChart data={trendData}>
                                <defs>
                                    <linearGradient id="nzTrend" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#2f855a" stopOpacity={0.28} />
                                        <stop offset="95%" stopColor="#2f855a" stopOpacity={0.03} />
                                    </linearGradient>
                                    <linearGradient id="auTrend" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#b7791f" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#b7791f" stopOpacity={0.03} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#d9e2ec" />
                                <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                                <YAxis tick={{ fontSize: 12 }} />
                                <Tooltip formatter={(value: number) => [formatTrendValue(value, trendMetric), getTrendLabel(trendMetric)]} />
                                <Legend />
                                <Area name="New Zealand" type="monotone" dataKey="nz" stroke="#2f855a" fill="url(#nzTrend)" strokeWidth={2} connectNulls />
                                <Area name="Australia" type="monotone" dataKey="au" stroke="#b7791f" fill="url(#auTrend)" strokeWidth={2} connectNulls />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="empty-panel">No history available yet.</div>
                    )}
                </div>
                <div className="coverage-row" aria-label="Data coverage">
                    <CoverageBadge country="NZ" coverage={nzHistory?.historyCoverage} note={nzHistory?.dataNotes} />
                    <CoverageBadge country="AU" coverage={auHistory?.historyCoverage || "full"} note={auHistory?.dataNotes || "Smoothed 30-minute OpenElectricity NEM history."} />
                </div>
                <p className="chart-note">
                    {nzHistory?.historyCoverage === "limited" && nzHasEaDispatch
                        ? "New Zealand carbon history is limited to recent EM6 samples; Electricity Authority dispatch is used for the latest live NZ demand snapshot."
                        : nzHistory?.historyCoverage === "limited"
                        ? "New Zealand free carbon history is limited to recent EM6 samples, while Australia is shown as a smoothed 30-minute NEM aggregate."
                        : nzHistory?.historyCoverage === "partial"
                            ? "New Zealand combines EM6 carbon samples with Electricity Authority dispatch demand; carbon history is still limited by the free EM6 feed."
                        : "Australia is shown as a 30-minute smoothed NEM aggregate to make the dense 5-minute data readable."}
                </p>
                <div className="cleanest-row">
                    <CleanestWindow label="NZ cleanest recent window" window={nzHistory?.cleanestWindow || null} />
                    <CleanestWindow label="AU cleanest recent window" window={auHistory?.cleanestWindow || null} />
                </div>
            </section>

            <section className="dashboard-section planner-section">
                <div className="section-heading">
                    <div>
                        <h2>Activity Planner</h2>
                        <p>Estimate the carbon impact of running a flexible load now versus the cleanest recent window.</p>
                    </div>
                </div>
                <form className="planner-form" onSubmit={handlePlannerSubmit}>
                    <label>
                        Activity
                        <select value={planner.activity} onChange={(event) => handleActivityChange(event.target.value)}>
                            {ACTIVITIES.map((activity) => <option key={activity.label}>{activity.label}</option>)}
                        </select>
                    </label>
                    <label>
                        Grid
                        <select value={planner.country} onChange={(event) => setPlanner((current) => ({ ...current, country: event.target.value as PlannerState["country"], region: "" }))}>
                            <option key="Australia">Australia</option>
                            <option key="New Zealand">New Zealand</option>
                        </select>
                    </label>
                    {planner.country === "Australia" && (
                        <label>
                            Region
                            <select value={planner.region || ""} onChange={(event) => setPlanner((current) => ({ ...current, region: event.target.value }))}>
                                <option key="Australia aggregate" value="">Australia aggregate</option>
                                {auRegionData.map((state) => <option key={state.state} value={state.state}>{state.state}</option>)}
                            </select>
                        </label>
                    )}
                    <label>
                        Energy
                        <input type="number" min="0.1" step="0.1" value={planner.kWh} onChange={(event) => setPlanner((current) => ({ ...current, kWh: Number(event.target.value) }))} />
                        <span>kWh</span>
                    </label>
                    <label>
                        Duration
                        <input type="number" min="0.25" step="0.25" value={planner.durationHours} onChange={(event) => setPlanner((current) => ({ ...current, durationHours: Number(event.target.value) }))} />
                        <span>hours</span>
                    </label>
                    <button type="submit" disabled={plannerLoading}>{plannerLoading ? "Estimating" : "Estimate"}</button>
                </form>
                {plannerEstimate && <PlannerResult estimate={plannerEstimate} />}
            </section>

            <section className="detail-grid">
                {nzData && (
                    <CountryDetailCard title="New Zealand" data={nzData} />
                )}
                {auData && (
                    <CountryDetailCard title="Australia" data={auData} />
                )}
            </section>

            <section className="dashboard-section region-section">
                <div className="section-heading">
                    <div>
                        <h2>Australia Regional Breakdown</h2>
                        <p>{cleanestAuRegion ? `${cleanestAuRegion.state} is currently the cleanest NEM region.` : "Regional data is loading."}</p>
                    </div>
                </div>
                <div className="region-table">
                    <div className="region-row region-head">
                        <span>Region</span>
                        <span>Signal</span>
                        <span>Carbon</span>
                        <span>Renewable</span>
                        <span>Main source</span>
                    </div>
                    {auRegionData.map((state) => (
                        <div className="region-row" key={state.state}>
                            <span>{state.state}</span>
                            <span className={`signal-pill ${getSignalClass(state.gridSignal)}`}>{state.gridSignal}</span>
                            <span>{state.carbonIntensity_gCO2kWh.toFixed(0)} gCO2/kWh</span>
                            <span>{state.renewablePercentage ?? calculateRenewablePercentage(state.generationMix)}%</span>
                            <span>{capitalize(getLeadingFuel(state.generationMix) || "unknown")}</span>
                        </div>
                    ))}
                </div>
            </section>

            <footer className="dashboard-footer">
                <p>Data sources: NZ - EM6 API + optional Electricity Authority dispatch | AU - OpenElectricity API</p>
                <p className="auto-refresh-note">Auto-refreshes every 5 minutes</p>
            </footer>
        </div>
    );
};

function GridSignalPanel({ data }: { data: EmissionsData }) {
    return (
        <article className={`signal-panel ${getSignalClass(data.gridSignal)}`}>
            <div>
                <span className="panel-label">{data.country}</span>
                <h2>{data.gridSignal || "Checking grid"}</h2>
                <p>{data.signalReason || "Waiting for enough data to classify the grid."}</p>
            </div>
            <div className="signal-stats">
                <Metric label="Carbon" value={`${data.carbonIntensity_gCO2kWh.toFixed(0)} gCO2/kWh`} />
                <Metric label="Renewable" value={`${data.renewablePercentage ?? calculateRenewablePercentage(data.generationMix)}%`} />
                <Metric label="Confidence" value={data.confidence || "Low"} />
            </div>
        </article>
    );
}

function CountryDetailCard({ title, data }: { title: string; data: EmissionsData }) {
    return (
        <article className="country-section">
            <div className="country-title-row">
                <h2>{title}</h2>
                <span className={`signal-pill ${getSignalClass(data.gridSignal)}`}>{data.gridSignal}</span>
            </div>
            <div className="country-metrics">
                <Metric label="Carbon intensity" value={`${data.carbonIntensity_gCO2kWh.toFixed(1)} gCO2/kWh`} />
                <Metric label="Demand" value={`${data.totalDemandMW.toFixed(0)} MW`} />
                <Metric label="Renewable" value={`${data.renewablePercentage ?? calculateRenewablePercentage(data.generationMix)}%`} />
            </div>
            <div className="chart-container">
                <GenerationMixChart data={data.generationMix} />
            </div>
            <p className="timestamp">Data interval: {formatTimestamp(data.timestamp)}</p>
        </article>
    );
}

function PlannerResult({ estimate }: { estimate: PlannerEstimate }) {
    return (
        <>
            <div className="planner-result">
                <div>
                    <span>Run now</span>
                    <strong>{estimate.now.estimatedKgCO2e.toFixed(2)} kg CO2e</strong>
                    <p>{estimate.now.carbonIntensity_gCO2kWh.toFixed(0)} gCO2/kWh</p>
                </div>
                <div>
                    <span>Cleanest recent window</span>
                    <strong>{estimate.cleanerWindow.estimatedKgCO2e.toFixed(2)} kg CO2e</strong>
                    <p>{formatTimestamp(estimate.cleanerWindow.timestamp)}</p>
                </div>
                <div>
                    <span>Potential saving</span>
                    <strong>{estimate.savingsKgCO2e.toFixed(2)} kg CO2e</strong>
                    <p>{estimate.recommendation}</p>
                </div>
            </div>
            {(estimate.historyCoverage === "limited" || estimate.historyCoverage === "partial") && estimate.dataNotes && (
                <p className="planner-note">{estimate.dataNotes}</p>
            )}
        </>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="metric">
            <span>{label}</span>
            <strong>{value}</strong>
        </div>
    );
}

function CleanestWindow({ label, window }: { label: string; window: EmissionsData | null }) {
    return (
        <div className="cleanest-card">
            <span>{label}</span>
            {window ? (
                <>
                    <strong>{window.carbonIntensity_gCO2kWh.toFixed(0)} gCO2/kWh</strong>
                    <p>{formatTimestamp(window.timestamp)}</p>
                </>
            ) : (
                <p>No recent history available.</p>
            )}
        </div>
    );
}

function buildInsights(nz: EmissionsData | null, au: EmissionsData | null, auStates: EmissionsData[], lastUpdated: Date | null) {
    const insights = [];

    if (nz && au) {
        const cleaner = nz.carbonIntensity_gCO2kWh <= au.carbonIntensity_gCO2kWh ? nz : au;
        const dirtier = cleaner === nz ? au : nz;
        const gap = dirtier.carbonIntensity_gCO2kWh > 0
            ? Math.round((1 - cleaner.carbonIntensity_gCO2kWh / dirtier.carbonIntensity_gCO2kWh) * 100)
            : 0;

        insights.push({
            label: "Cleanest grid now",
            value: cleaner.country,
            detail: `${gap}% lower carbon intensity than ${dirtier.country}.`,
        });
    }

    if (auStates.length > 0) {
        const leadingFuel = getLeadingFuel(au?.generationMix || {});
        insights.push({
            label: "Australia driver",
            value: capitalize(leadingFuel || "Unknown"),
            detail: `${capitalize(leadingFuel || "Unknown")} is the largest visible source in the NEM mix.`,
        });
    }

    if (nz) {
        const leadingRenewable = nz.leadingRenewableFuel || getLeadingRenewableFuel(nz.generationMix);
        const thermalShare = nz.thermalSharePercentage ?? getFuelShare(nz.generationMix, ["coal", "gas"]);
        const hasEaDispatch = nz.dataSources?.some((source) => source.includes("Electricity Authority"));

        insights.push({
            label: "NZ driver",
            value: capitalize(leadingRenewable || "Unknown"),
            detail: hasEaDispatch
                ? `${capitalize(leadingRenewable || "Unknown")} leads the visible NZ mix; EA dispatch demand is active.`
                : `${capitalize(leadingRenewable || "Unknown")} leads the visible NZ mix; thermal share is ${thermalShare}%.`,
        });
    }

    if (nz && au) {
        insights.push({
            label: "Renewables now",
            value: `${nz.renewablePercentage}% NZ / ${au.renewablePercentage}% AU`,
            detail: "Renewable share is used with carbon intensity to produce the grid signal.",
        });
    }

    insights.push({
        label: "Data freshness",
        value: lastUpdated ? formatRelativeMinutes(lastUpdated) : "Loading",
        detail: "The dashboard refreshes current and recent-history data every 5 minutes.",
    });

    return insights;
}

function CoverageBadge({ country, coverage, note }: { country: string; coverage?: string; note?: string }) {
    const label = coverage === "limited"
        ? "Limited recent carbon samples"
        : coverage === "partial"
            ? "Partial recent history"
            : "Full recent history";

    return (
        <span className={`coverage-badge ${coverage || "full"}`} title={note || label}>
            {country}: {label}
        </span>
    );
}

interface TrendPoint {
    timestamp: string;
    time: string;
    nz?: number;
    au?: number;
}

function buildTrendData(nzHistory: HistoryResponse | null, auHistory: HistoryResponse | null, metric: TrendMetric) {
    const points = new Map<string, TrendPoint>();

    addTrendSeries(points, "nz", nzHistory?.history || [], metric);
    addTrendSeries(points, "au", auHistory?.history || [], metric);

    return Array.from(points.values()).sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function addTrendSeries(points: Map<string, TrendPoint>, key: "nz" | "au", history: EmissionsData[], metric: TrendMetric) {
    history.forEach((point) => {
        const existing = points.get(point.timestamp) || {
            timestamp: point.timestamp,
            time: formatShortTime(point.timestamp),
        };
        existing[key] = getTrendMetricValue(point, metric);
        points.set(point.timestamp, existing);
    });
}

function getTrendMetricValue(point: EmissionsData, metric: TrendMetric) {
    if (metric === "renewable") return point.renewablePercentage ?? calculateRenewablePercentage(point.generationMix);
    if (metric === "demand") return Math.round(point.totalDemandMW);
    return Math.round(point.carbonIntensity_gCO2kWh);
}

function getTrendLabel(metric: TrendMetric) {
    if (metric === "renewable") return "Renewable %";
    if (metric === "demand") return "Demand MW";
    return "Carbon gCO2/kWh";
}

function formatTrendValue(value: number, metric: TrendMetric) {
    if (metric === "renewable") return `${value}%`;
    if (metric === "demand") return `${Number(value).toLocaleString()} MW`;
    return `${value} gCO2/kWh`;
}

function getCleanestRegion(states: EmissionsData[]) {
    return [...states].sort((left, right) => left.carbonIntensity_gCO2kWh - right.carbonIntensity_gCO2kWh)[0] || null;
}

function getLeadingFuel(mix: { [key: string]: number | undefined }) {
    return Object.entries(mix)
        .filter(([, value]) => (value || 0) > 0)
        .sort((left, right) => (right[1] || 0) - (left[1] || 0))[0]?.[0] || null;
}

function getLeadingRenewableFuel(mix: { [key: string]: number | undefined }) {
    return ["hydro", "wind", "solar", "geothermal"]
        .map((fuel) => [fuel, mix[fuel] || 0] as const)
        .filter(([, value]) => value > 0)
        .sort((left, right) => right[1] - left[1])[0]?.[0] || null;
}

function getFuelShare(mix: { [key: string]: number | undefined }, fuels: string[]) {
    const total = Object.values(mix).reduce((sum: number, value) => sum + (value || 0), 0);
    const fuelTotal = fuels.reduce((sum, fuel) => sum + (mix[fuel] || 0), 0);

    return total > 0 ? Math.round(fuelTotal / total * 100) : 0;
}

function getSignalClass(signal?: string) {
    if (signal === "Use now") return "use-now";
    if (signal === "Avoid peak") return "avoid-peak";
    return "wait";
}

function formatTimestamp(timestamp: string) {
    return new Date(timestamp).toLocaleString("en-NZ", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatShortTime(timestamp: string) {
    return new Date(timestamp).toLocaleTimeString("en-NZ", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatRelativeMinutes(date: Date) {
    const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (minutes === 0) return "just now";
    if (minutes === 1) return "1 minute ago";
    return `${minutes} minutes ago`;
}

function capitalize(value: string) {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

export default Dashboard;
