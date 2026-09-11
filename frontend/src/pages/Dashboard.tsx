import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import GenerationMixChart from "../components/GenerationMixChart";
import {
    calculateRenewablePercentage,
    EmissionsData,
    estimateActivity,
    fetchNewZealandData,
    fetchNewZealandHistory,
    fetchNewZealandProfile,
    HistoryResponse,
    NewZealandProfile,
    PlannerEstimate,
    PlannerInput,
    ProfileShare,
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
    const [nzHistory, setNzHistory] = useState<HistoryResponse | null>(null);
    const [nzProfile, setNzProfile] = useState<NewZealandProfile | null>(null);
    const [trendMetric, setTrendMetric] = useState<TrendMetric>("carbon");
    const [loading, setLoading] = useState(true);
    const [plannerLoading, setPlannerLoading] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [planner, setPlanner] = useState<PlannerState>({
        activity: ACTIVITIES[0].label,
        country: "New Zealand",
        kWh: ACTIVITIES[0].kWh,
        durationHours: ACTIVITIES[0].durationHours,
    });
    const [plannerEstimate, setPlannerEstimate] = useState<PlannerEstimate | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        const nextErrors: string[] = [];

        const [currentResult, historyResult, profileResult] = await Promise.allSettled([
            fetchNewZealandData(),
            fetchNewZealandHistory(24),
            fetchNewZealandProfile(),
        ]);

        if (currentResult.status === "fulfilled") {
            setNzData(currentResult.value);
        } else {
            console.error("Error fetching NZ data:", currentResult.reason);
            nextErrors.push("New Zealand live grid data is temporarily unavailable.");
        }

        if (historyResult.status === "fulfilled") {
            setNzHistory(historyResult.value);
        } else {
            console.error("Error fetching NZ history:", historyResult.reason);
            nextErrors.push("New Zealand recent history is temporarily unavailable.");
        }

        if (profileResult.status === "fulfilled") {
            setNzProfile(profileResult.value);
        } else {
            console.error("Error fetching NZ profile:", profileResult.reason);
            nextErrors.push("New Zealand emissions profile is temporarily unavailable.");
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

    const insights = useMemo(() => buildInsights(nzData, nzHistory, nzProfile, lastUpdated), [nzData, nzHistory, nzProfile, lastUpdated]);
    const trendData = useMemo(() => buildTrendData(nzHistory, trendMetric), [nzHistory, trendMetric]);
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
                country: "New Zealand",
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

    if (loading && !nzData && !nzProfile) {
        return (
            <div className="dashboard-container">
                <div className="loading">Loading Aotearoa emissions signals...</div>
            </div>
        );
    }

    return (
        <div className="dashboard-container">
            <header className="dashboard-header">
                <div>
                    <p className="eyebrow">Aotearoa emissions compass</p>
                    <h1>Where do emissions matter in New Zealand?</h1>
                    <p className="header-copy">
                        A practical NZ dashboard for live electricity timing, national emissions context, and household choices that can move with today&apos;s grid.
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

            <section className="signal-grid nz-focus-grid">
                {nzData && <GridSignalPanel data={nzData} />}
                {nzProfile && <NationalSnapshot profile={nzProfile} />}
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

            {nzProfile && (
                <section className="dashboard-section profile-section">
                    <div className="section-heading">
                        <div>
                            <h2>What matters most in NZ?</h2>
                            <p>Electricity timing is useful, but Aotearoa&apos;s bigger emissions story sits across agriculture, transport, industry, and waste.</p>
                        </div>
                    </div>
                    <div className="profile-layout">
                        <ShareList title="Gross emissions by sector" items={nzProfile.sectorShares} labelKey="sector" />
                        <ShareList title="Gross emissions by gas" items={nzProfile.gasShares} labelKey="gas" />
                    </div>
                    <div className="purpose-panel">
                        <strong>Purpose</strong>
                        <p>
                            Use clean-grid windows for flexible electric loads, but treat electrification as the bigger lever: shifting vehicles, heating, and process heat away from fossil fuels matters because electricity is already mostly renewable in New Zealand.
                        </p>
                    </div>
                </section>
            )}

            <section className="dashboard-section trend-section">
                <div className="section-heading">
                    <div>
                        <h2>Recent NZ Grid Trend</h2>
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
                                        <stop offset="5%" stopColor="#1f7a63" stopOpacity={0.28} />
                                        <stop offset="95%" stopColor="#1f7a63" stopOpacity={0.03} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#d9e2ec" />
                                <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                                <YAxis tick={{ fontSize: 12 }} />
                                <Tooltip formatter={(value: number) => [formatTrendValue(value, trendMetric), getTrendLabel(trendMetric)]} />
                                <Area name="New Zealand" type="monotone" dataKey="nz" stroke="#1f7a63" fill="url(#nzTrend)" strokeWidth={2} connectNulls />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="empty-panel">No NZ history available yet.</div>
                    )}
                </div>
                <div className="coverage-row" aria-label="Data coverage">
                    <CoverageBadge country="NZ" coverage={nzHistory?.historyCoverage} note={nzHistory?.dataNotes} />
                </div>
                <p className="chart-note">
                    {nzHistory?.historyCoverage === "limited" && nzHasEaDispatch
                        ? "New Zealand carbon history is limited to recent EM6 samples; Electricity Authority dispatch is used for the latest live demand snapshot."
                        : nzHistory?.historyCoverage === "limited"
                            ? "New Zealand free carbon history is limited to recent EM6 samples, so this trend is a near-term signal rather than a full-day forecast."
                            : nzHistory?.historyCoverage === "partial"
                                ? "New Zealand combines EM6 carbon samples with Electricity Authority dispatch demand; carbon history is still limited by the free EM6 feed."
                                : "New Zealand live and recent-history data are available."}
                </p>
                <div className="cleanest-row single">
                    <CleanestWindow label="NZ cleanest recent window" window={nzHistory?.cleanestWindow || null} />
                </div>
            </section>

            <section className="dashboard-section planner-section">
                <div className="section-heading">
                    <div>
                        <h2>Activity Planner</h2>
                        <p>Estimate the carbon impact of running a flexible electric load now versus the cleanest recent NZ window.</p>
                    </div>
                </div>
                <form className="planner-form nz-planner-form" onSubmit={handlePlannerSubmit}>
                    <label>
                        Activity
                        <select value={planner.activity} onChange={(event) => handleActivityChange(event.target.value)}>
                            {ACTIVITIES.map((activity) => <option key={activity.label}>{activity.label}</option>)}
                        </select>
                    </label>
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

            {nzData && (
                <section className="detail-grid single">
                    <CountryDetailCard title="Live NZ generation mix" data={nzData} />
                </section>
            )}

            <footer className="dashboard-footer">
                <p>Live grid sources: EM6 API + optional Electricity Authority dispatch</p>
                {nzProfile && <p>National profile sources: MfE greenhouse gas inventory and MBIE Energy in New Zealand 2025</p>}
                <p className="auto-refresh-note">Auto-refreshes every 5 minutes</p>
            </footer>
        </div>
    );
};

function GridSignalPanel({ data }: { data: EmissionsData }) {
    return (
        <article className={`signal-panel ${getSignalClass(data.gridSignal)}`}>
            <div>
                <span className="panel-label">Live NZ grid signal</span>
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

function NationalSnapshot({ profile }: { profile: NewZealandProfile }) {
    return (
        <article className="national-snapshot">
            <span className="panel-label">National emissions profile</span>
            <h2>{profile.grossEmissionsMtCO2e.toFixed(1)} Mt CO2e</h2>
            <p>Gross emissions in {profile.year}. Agriculture and energy dominate, while electricity is already mostly renewable.</p>
            <div className="snapshot-metrics">
                <Metric label="Agriculture" value={`${getShare(profile.sectorShares, "Agriculture")}%`} />
                <Metric label="Energy" value={`${getShare(profile.sectorShares, "Energy")}%`} />
                <Metric label="Renewable electricity" value={`${profile.electricityRenewableShare2024}%`} />
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

function ShareList({ title, items, labelKey }: { title: string; items: ProfileShare[]; labelKey: "sector" | "gas" }) {
    return (
        <div className="share-list">
            <h3>{title}</h3>
            {items.map((item) => {
                const label = item[labelKey] || "Other";
                return (
                    <div className="share-row" key={label}>
                        <div className="share-row-header">
                            <strong>{label}</strong>
                            <span>{item.sharePercentage}%</span>
                        </div>
                        <div className="share-bar" aria-hidden="true">
                            <span style={{ width: `${item.sharePercentage}%` }} />
                        </div>
                        <p>{item.summary}</p>
                    </div>
                );
            })}
        </div>
    );
}

function buildInsights(nz: EmissionsData | null, history: HistoryResponse | null, profile: NewZealandProfile | null, lastUpdated: Date | null) {
    const insights = [];

    if (profile) {
        const largestSector = [...profile.sectorShares].sort((left, right) => right.sharePercentage - left.sharePercentage)[0];
        insights.push({
            label: "Largest national source",
            value: largestSector?.sector || "Unknown",
            detail: `${largestSector?.sharePercentage || 0}% of gross emissions in ${profile.year}.`,
        });

        insights.push({
            label: "Electricity context",
            value: `${profile.electricityRenewableShare2024}% renewable`,
            detail: "Annual electricity generation is mostly renewable, so electrification can matter more than small timing changes.",
        });
    }

    if (nz) {
        const leadingRenewable = nz.leadingRenewableFuel || getLeadingRenewableFuel(nz.generationMix);
        const thermalShare = nz.thermalSharePercentage ?? getFuelShare(nz.generationMix, ["coal", "gas"]);

        insights.push({
            label: "Live grid driver",
            value: capitalize(leadingRenewable || "Unknown"),
            detail: `${capitalize(leadingRenewable || "Unknown")} leads the visible mix; thermal share is ${thermalShare}%.`,
        });
    }

    if (history?.cleanestWindow) {
        insights.push({
            label: "Best flexible-load window",
            value: `${history.cleanestWindow.carbonIntensity_gCO2kWh.toFixed(0)} gCO2/kWh`,
            detail: `${formatTimestamp(history.cleanestWindow.timestamp)} was the cleanest recent NZ sample.`,
        });
    }

    insights.push({
        label: "Data freshness",
        value: lastUpdated ? formatRelativeMinutes(lastUpdated) : "Loading",
        detail: "The dashboard refreshes live and recent-history NZ data every 5 minutes.",
    });

    return insights;
}

function buildTrendData(nzHistory: HistoryResponse | null, metric: TrendMetric) {
    return (nzHistory?.history || [])
        .map((point) => ({
            timestamp: point.timestamp,
            time: formatShortTime(point.timestamp),
            nz: getTrendMetricValue(point, metric),
        }))
        .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
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

function getShare(items: ProfileShare[], label: string) {
    return items.find((item) => item.sector === label || item.gas === label)?.sharePercentage || 0;
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
