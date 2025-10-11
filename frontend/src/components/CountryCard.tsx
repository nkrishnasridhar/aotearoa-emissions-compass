import React from "react";
import "./CountryCard.css";

interface CountryCardProps {
  name: string;
  carbonIntensity: number;
  timestamp: string;
}

const getIntensityLevel = (intensity: number): { color: string; label: string } => {
  if (intensity < 50) return { color: "#48BB78", label: "Very Low" };
  if (intensity < 100) return { color: "#48BB78", label: "Low" };
  if (intensity < 500) return { color: "#f6d355ff", label: "Moderate" };
  if (intensity < 700) return { color: "#E53E3E", label: "High" };
  return { color: "#E53E3E", label: "Very High" };
};

const CountryCard: React.FC<CountryCardProps> = ({ name, carbonIntensity, timestamp }) => {
  const { color, label } = getIntensityLevel(carbonIntensity);
  
  // Format timestamp
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