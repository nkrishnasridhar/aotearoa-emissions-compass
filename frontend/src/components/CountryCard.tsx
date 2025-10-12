import React from "react";
import "./CountryCard.css";

/**
 * Props for the CountryCard component.
 */
interface CountryCardProps {
    name: string;
    carbonIntensity: number;
    timestamp: string;
}

/**
 * Determines the intensity level category based on carbon intensity.
 *
 * @param intensity - The carbon intensity value (gCO₂/kWh)
 * @returns An object containing a color and label for the level
 */
const getIntensityLevel = (intensity: number): { color: string; label: string } => {
    if (intensity < 50) return { color: "#48BB78", label: "Very Low" };
    if (intensity < 100) return { color: "#48BB78", label: "Low" };
    if (intensity < 500) return { color: "#f6d355ff", label: "Moderate" };
    if (intensity < 700) return { color: "#E53E3E", label: "High" };
    return { color: "#E53E3E", label: "Very High" };
};

/**
 * Formats the timestamp into a localized string (New Zealand format).
 *
 * @param ts - ISO timestamp string
 * @returns A formatted date-time string or the raw input if formatting fails
 */
const formatTimestamp = (ts: string) => {
    try {
        const date = new Date(ts);
        return date.toLocaleString('en-NZ', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch {
        return ts;
    }
};

/**
 * Renders a styled card showing the carbon intensity for a given country.
 *
 * @param name - Country name
 * @param carbonIntensity - Current carbon intensity (gCO₂/kWh)
 * @param timestamp - Timestamp of the latest update
 * @returns JSX Element representing the country card
 */
const CountryCard: React.FC<CountryCardProps> = ({ name, carbonIntensity, timestamp }) => {
    const { color, label } = getIntensityLevel(carbonIntensity);

    return (
        <div className="country-card">
            <div className="carbon-intensity-badge" style={{ backgroundColor: color }}>
                <div className="intensity-label">{label}</div>
                <div className="intensity-value">{carbonIntensity.toFixed(1)}</div>
                <div className="intensity-unit">gCO₂/kWh</div>
            </div>
            <div className="card-footer">
                <span className="timestamp-label">Last updated:</span>
                <span className="timestamp">{formatTimestamp(timestamp)}</span>
            </div>
        </div>
    );
};

export default CountryCard;