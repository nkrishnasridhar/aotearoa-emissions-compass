import React, { useState, useEffect, useCallback } from "react";
import CountryCard from "../components/CountryCard";
import GenerationMixChart from "../components/GenerationMixChart";
import { fetchAustraliaData, fetchNewZealandData, aggregateAustraliaData, EmissionsData } from "../services/api";
import "./Dashboard.css";

/**
 * Displays live carbon intensity and generation mix data for New Zealand and Australia.
 * Fetches data from APIs on mount and refreshes automatically every 5 minutes.
 * 
 * @component
 * @returns {JSX.Element} The rendered Dashboard view.
 */
const Dashboard: React.FC = () => {
    const [nzData, setNzData] = useState<EmissionsData | null>(null);
    const [auData, setAuData] = useState<EmissionsData | null>(null);
    const [loading, setLoading] = useState(true);                      // Indicates whether data is currently being fetched.
    const [error, setError] = useState<string | null>(null);           // Holds error message strings when data fetch fails.
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null); // Stores timestamp of last successful data update.

    /**
     * Fetches emissions data for New Zealand and Australia independently
     * to avoid one failure blocking the other.
     * 
     * @async
     * @returns {Promise<void>}
     */
    const fetchData = useCallback(async () => {
        setLoading(true);
        setError(null);

        const nzPromise = fetchNewZealandData().catch((err) => {
            console.error("Error fetching NZ data:", err);
            setError("Unable to fetch New Zealand data. API may be unavailable.");
            return null;
        });

        const auPromise = fetchAustraliaData().then(aggregateAustraliaData).catch((err) => {
            console.error("Error fetching AU data:", err);
            setError("Unable to fetch Australia data. Backend server may be offline.");
            return null;
        });

        const [nzResult, auResult] = await Promise.all([nzPromise, auPromise]);

        if (nzResult) {
            setNzData(nzResult);
        }

        if (auResult) {
            setAuData(auResult);
        }

        setLastUpdated(new Date());
        setLoading(false);
    }, []);

    /**
     * On mount:
     * - Fetches initial emissions data
     * - Sets up a recurring auto-refresh every 5 minutes (300,000 ms)
     * - Cleans up the interval on unmount
     */
    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 300000);
        return () => clearInterval(interval);
    }, [fetchData]);

    /**
     * Manually triggers a data refresh.
     */
    const handleRefresh = () => {
        fetchData();
    };

    if (loading && !nzData && !auData) {
        return (
            <div className="dashboard-container">
                <div className="loading">Loading emissions data...</div>
            </div>
        );
    }

    return (
        <div className="dashboard-container">
            <header className="dashboard-header">
                <h1>Live Emissions & Generation Mix Dashboard</h1>
                <div className="header-controls">
                    {lastUpdated && (
                        <span className="last-updated">
                            Last updated: {lastUpdated.toLocaleTimeString()}
                        </span>
                    )}
                    <button onClick={handleRefresh} disabled={loading} className="refresh-button">
                        {loading ? "Refreshing..." : "Refresh"}
                    </button>
                </div>
            </header>

            {error && (<div className="error-message">⚠️ {error}</div>)}

            <div className="countries-grid">
                {/* New Zealand */}
                <div className="country-section">
                <h2 className="country-title">New Zealand</h2>
                {nzData ? (
                    <>
                        <CountryCard
                            name="New Zealand"
                            carbonIntensity={nzData.carbonIntensity_gCO2kWh}
                            timestamp={nzData.timestamp}
                        />
                        <div className="chart-container">
                            <h3>Generation Mix</h3>
                            <GenerationMixChart data={nzData.generationMix} />
                            <div className="stats">
                                <p>Total Demand: {nzData.totalDemandMW.toFixed(0)} MW</p>
                                <p>Renewable: {calculateRenewablePercentage(nzData.generationMix)}%</p>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="no-data">No data available</div>
                )}
                </div>

                {/* Australia */}
                <div className="country-section">
                <h2 className="country-title">Australia</h2>
                {auData ? (
                    <>
                        <CountryCard
                            name="Australia"
                            carbonIntensity={auData.carbonIntensity_gCO2kWh}
                            timestamp={auData.timestamp}
                        />
                        <div className="chart-container">
                            <h3>Generation Mix</h3>
                            <GenerationMixChart data={auData.generationMix} />
                            <div className="stats">
                                <p>Total Demand: {auData.totalDemandMW.toFixed(0)} MW</p>
                                <p>Renewable: {calculateRenewablePercentage(auData.generationMix)}%</p>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="no-data">No data available</div>
                )}
                </div>
            </div>

            <footer className="dashboard-footer">
                <p>Data sources: NZ - EM6 API | AU - Backend API</p>
                <p className="auto-refresh-note">Auto-refreshes every 5 minutes</p>
            </footer>
        </div>
    );
};

/**
 * Calculates the renewable energy percentage in a generation mix.
 * 
 * @param {{ [key: string]: number | undefined }} mix - Object mapping fuel type to MW generation.
 * @returns {number} The renewable energy percentage (0–100), rounded to nearest integer.
 * 
 * @example
 * const mix = { hydro: 500, wind: 300, coal: 200 };
 * const result = calculateRenewablePercentage(mix); // 80
 */
function calculateRenewablePercentage(mix: { [key: string]: number | undefined }): number {
    const renewables = ['hydro', 'wind', 'solar', 'geothermal'];
    const renewableTotal = renewables.reduce((sum, fuel) => sum + (mix[fuel] || 0), 0);
    const total = Object.values(mix).reduce((sum: number, val) => sum + (val || 0), 0);
    
    return total > 0 ? Math.round((renewableTotal / total) * 100) : 0;
}

export default Dashboard;