import React, { useCallback, useEffect, useMemo, useState } from "react";
import GenerationMixChart from "../components/GenerationMixChart";
import {
    calculateRenewablePercentage,
    EmissionsData,
    estimateActivity,
    fetchNewZealandData,
    fetchNewZealandHistory,
    fetchNewZealandProfile,
    HistoryResponse,
    HouseholdLever,
    HouseholdProfileId,
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

const HOUSEHOLD_PROFILES: Array<{ id: HouseholdProfileId; label: string }> = [
    { id: "petrol-diesel", label: "I drive petrol/diesel" },
    { id: "gas-lpg", label: "I use gas/LPG at home" },
    { id: "mostly-electric", label: "Mostly electric already" },
];

interface PlannerState extends PlannerInput {
    activity: string;
}

const Dashboard: React.FC = () => {
    const [nzData, setNzData] = useState<EmissionsData | null>(null);
    const [nzHistory, setNzHistory] = useState<HistoryResponse | null>(null);
    const [nzProfile, setNzProfile] = useState<NewZealandProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [plannerLoading, setPlannerLoading] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [householdProfile, setHouseholdProfile] = useState<HouseholdProfileId>("petrol-diesel");
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

    const todayTake = useMemo(() => buildTodayTake(nzData, nzHistory, nzProfile), [nzData, nzHistory, nzProfile]);
    const actionCards = useMemo(
        () => buildActionCards(nzData, nzHistory, nzProfile, planner),
        [nzData, nzHistory, nzProfile, planner]
    );
    const bestNextMove = useMemo(
        () => getBestNextMove(nzProfile?.householdLevers || [], householdProfile),
        [nzProfile, householdProfile]
    );

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
                        Choose the bigger lever first, then use today&apos;s grid to time flexible electric loads.
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

            <section className="today-take" aria-labelledby="today-take-title">
                <div>
                    <span className="panel-label">Today&apos;s take</span>
                    <h2 id="today-take-title">{todayTake.heading}</h2>
                </div>
                <p>{todayTake.detail}</p>
            </section>

            {nzProfile && bestNextMove && (
                <BestNextMovePanel
                    selectedProfile={householdProfile}
                    onProfileChange={setHouseholdProfile}
                    lever={bestNextMove}
                    gridSignal={nzData?.gridSignal}
                />
            )}

            <section className="insight-grid">
                {actionCards.map((insight) => (
                    <article className="insight-card" key={insight.label}>
                        <span>{insight.label}</span>
                        <strong>{insight.value}</strong>
                        <p>{insight.detail}</p>
                    </article>
                ))}
            </section>

            <section className="dashboard-section planner-section">
                <div className="section-heading">
                    <div>
                        <h2>Flexible Load Check</h2>
                        <p>Estimate the impact of running a flexible electric load now, then compare it with the best recent NZ sample. It is context, not a forecast.</p>
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
                        <span className="field-label">Energy (kWh)</span>
                        <input type="number" min="0.1" step="0.1" value={planner.kWh} onChange={(event) => setPlanner((current) => ({ ...current, kWh: Number(event.target.value) }))} />
                    </label>
                    <label>
                        <span className="field-label">Duration (hours)</span>
                        <input type="number" min="0.25" step="0.25" value={planner.durationHours} onChange={(event) => setPlanner((current) => ({ ...current, durationHours: Number(event.target.value) }))} />
                    </label>
                    <button type="submit" disabled={plannerLoading}>{plannerLoading ? "Estimating" : "Estimate"}</button>
                </form>
                {plannerEstimate && <PlannerResult estimate={plannerEstimate} />}
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
                <SourceBadges badges={getCoverageBadges(data.historyCoverage, data.dataSources)} />
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
            <SourceBadges badges={["Annual profile"]} />
            <div className="snapshot-metrics">
                <Metric label="Agriculture" value={`${getShare(profile.sectorShares, "Agriculture")}%`} />
                <Metric label="Energy" value={`${getShare(profile.sectorShares, "Energy")}%`} />
                <Metric label="Renewable electricity" value={`${profile.electricityRenewableShare2024}%`} />
            </div>
        </article>
    );
}

function BestNextMovePanel({
    selectedProfile,
    onProfileChange,
    lever,
    gridSignal,
}: {
    selectedProfile: HouseholdProfileId;
    onProfileChange: (profile: HouseholdProfileId) => void;
    lever: HouseholdLever;
    gridSignal?: string;
}) {
    return (
        <section className="dashboard-section best-next-move" aria-labelledby="best-next-move-title">
            <div className="section-heading">
                <div>
                    <h2 id="best-next-move-title">Best Next Move</h2>
                    <p>Pick the situation that sounds most like you. This stays deliberately small: one practical direction, not a personal inventory.</p>
                </div>
            </div>
            <div className="profile-chooser" role="group" aria-label="Household situation">
                {HOUSEHOLD_PROFILES.map((profile) => (
                    <button
                        type="button"
                        key={profile.id}
                        className={profile.id === selectedProfile ? "active" : ""}
                        onClick={() => onProfileChange(profile.id)}
                    >
                        {profile.label}
                    </button>
                ))}
            </div>
            <div className="next-move-result">
                <div>
                    <span className="panel-label">Recommended first</span>
                    <h3>{lever.label}</h3>
                    <p>{lever.summary}</p>
                </div>
                <div className="next-move-reason">
                    <strong>Why this matters</strong>
                    <p>{lever.whyItMatters}</p>
                    <strong>Use today&apos;s grid for</strong>
                    <p>{createGridTimingHint(lever, gridSignal)}</p>
                </div>
            </div>
        </section>
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
                    <span>Run now estimate</span>
                    <strong>{estimate.now.estimatedKgCO2e.toFixed(2)} kg CO2e</strong>
                    <p>{estimate.now.carbonIntensity_gCO2kWh.toFixed(0)} gCO2/kWh</p>
                </div>
                <div>
                    <span>Best recent sample</span>
                    <strong>{estimate.cleanerWindow.estimatedKgCO2e.toFixed(2)} kg CO2e</strong>
                    <p>{formatTimestamp(estimate.cleanerWindow.timestamp)}</p>
                </div>
                <div>
                    <span>Potential saving</span>
                    <strong>{estimate.savingsKgCO2e.toFixed(2)} kg CO2e</strong>
                    <p>{estimate.recommendation}</p>
                </div>
            </div>
            <SourceBadges badges={getCoverageBadges(estimate.historyCoverage, estimate.dataSources)} />
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

function SourceBadges({ badges }: { badges: string[] }) {
    if (badges.length === 0) return null;

    return (
        <div className="source-badges">
            {badges.map((badge) => <span key={badge}>{badge}</span>)}
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

function getBestNextMove(levers: HouseholdLever[], profile: HouseholdProfileId) {
    return [...levers]
        .filter((lever) => lever.appliesTo.includes(profile))
        .sort((left, right) => left.priority - right.priority)[0] || null;
}

function createGridTimingHint(lever: HouseholdLever, gridSignal?: string) {
    if (gridSignal === "Use now") {
        return `${lever.gridTimingRelevance} The live grid signal is favourable right now.`;
    }

    if (gridSignal === "Avoid peak") {
        return `${lever.gridTimingRelevance} If the load is discretionary, delay it when that is easy.`;
    }

    if (gridSignal === "Wait") {
        return `${lever.gridTimingRelevance} The live grid signal is mixed, so only shift loads that are genuinely flexible.`;
    }

    return lever.gridTimingRelevance;
}

function getCoverageBadges(coverage?: string, dataSources: string[] = []) {
    const badges = ["Live grid"];

    if (coverage === "limited" || coverage === "partial") {
        badges.push("Limited recent samples");
    }

    if (dataSources.some((source) => source.includes("Electricity Authority"))) {
        badges.push("EA dispatch active");
    }

    return badges;
}

function buildTodayTake(nz: EmissionsData | null, history: HistoryResponse | null, profile: NewZealandProfile | null) {
    const signal = nz?.gridSignal || "Checking grid";
    const largestSector = profile ? [...profile.sectorShares].sort((left, right) => right.sharePercentage - left.sharePercentage)[0] : null;
    const largestSectorLabel = (largestSector?.sector || "Agriculture").toLowerCase();
    const currentIntensity = nz ? `${nz.carbonIntensity_gCO2kWh.toFixed(0)} gCO2/kWh` : "live NZ grid data";
    const recentBest = history?.cleanestWindow
        ? ` The best recent sample was ${history.cleanestWindow.carbonIntensity_gCO2kWh.toFixed(0)} gCO2/kWh, so use that as a timing hint rather than a forecast.`
        : "";

    if (signal === "Use now") {
        return {
            heading: "Flexible electricity use is fine now",
            detail: `The live grid is at ${currentIntensity}. Electricity timing can trim flexible loads, but ${largestSectorLabel} is NZ's largest gross source; the bigger household lever is replacing petrol, diesel, gas, and resistive heating with efficient electric options where possible.${recentBest}`,
        };
    }

    if (signal === "Avoid peak") {
        return {
            heading: "Delay flexible loads if it is easy",
            detail: `The live grid is at ${currentIntensity}, so discretionary loads may be worth moving. Still, electricity is not NZ's biggest emissions source; electrifying transport and heating is usually higher value than chasing small timing wins.${recentBest}`,
        };
    }

    return {
        heading: "Treat timing as useful, not central",
        detail: `The live grid signal is mixed at ${currentIntensity}. Use recent samples for flexible loads when convenient, while keeping the bigger NZ picture in view: transport, fossil fuel substitution, agriculture, and waste matter more than minute-by-minute electricity timing.${recentBest}`,
    };
}

function buildActionCards(
    nz: EmissionsData | null,
    history: HistoryResponse | null,
    profile: NewZealandProfile | null,
    planner: PlannerState
) {
    const actionCards = [];

    if (profile) {
        const largestSector = [...profile.sectorShares].sort((left, right) => right.sharePercentage - left.sharePercentage)[0];
        actionCards.push({
            label: "Biggest NZ source",
            value: largestSector?.sector || "Unknown",
            detail: `${largestSector?.sharePercentage || 0}% of gross emissions in ${profile.year}.`,
        });

        actionCards.push({
            label: "Biggest practical household lever",
            value: "Electrify energy use",
            detail: `Transport and energy are a large practical lever because annual electricity generation is ${profile.electricityRenewableShare2024}% renewable.`,
        });
    }

    if (nz) {
        actionCards.push({
            label: "Grid timing now",
            value: nz.gridSignal || "Checking",
            detail: nz.signalReason || "Waiting for enough live NZ data to classify flexible electricity use.",
        });
    }

    if (nz && history?.cleanestWindow) {
        const savingKg = Math.max(
            0,
            planner.kWh * (nz.carbonIntensity_gCO2kWh - history.cleanestWindow.carbonIntensity_gCO2kWh) / 1000
        );
        const meaningfulSaving = savingKg >= 0.5;

        actionCards.push({
            label: "Flexible-load saving",
            value: meaningfulSaving ? `~${savingKg.toFixed(1)} kg` : "Limited today",
            detail: meaningfulSaving
                ? `For ${planner.activity.toLowerCase()}, the best recent sample suggests a possible timing saving.`
                : "Recent samples suggest timing is not the main lever today.",
        });
    }

    return actionCards;
}

function getShare(items: ProfileShare[], label: string) {
    return items.find((item) => item.sector === label || item.gas === label)?.sharePercentage || 0;
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

function formatRelativeMinutes(date: Date) {
    const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (minutes === 0) return "just now";
    if (minutes === 1) return "1 minute ago";
    return `${minutes} minutes ago`;
}

export default Dashboard;
