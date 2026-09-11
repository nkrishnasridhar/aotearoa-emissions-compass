import React, { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { GenerationMix } from "../services/api";

/**
 * Props for the GenerationMixChart component.
 */
interface GenerationMixChartProps {
    data: GenerationMix; 
}

/**
 * Color mapping for different fuel types.
 * Renewable sources are assigned distinct colors for clarity.
 */
const FUEL_COLORS: { [key: string]: string } = {
    hydro: "#4299E1",      // Blue
    wind: "#48BB78",       // Green
    solar: "#F6AD55",      // Orange
    geothermal: "#9F7AEA", // Purple
    gas: "#ED8936",        // Dark orange
    coal: "#718096",       // Gray
    other: "#A0AEC0",      // Light gray
};

function isCompactViewport() {
    return Boolean(window.matchMedia?.("(max-width: 680px)")?.matches);
}

/**
 * A pie chart component for visualizing electricity generation mix by fuel type.
 *
 * @component
 * @param data - The fuel type data in MW for a specific region or country
 * @returns A responsive pie chart showing the proportion of each generation source
 */
const GenerationMixChart: React.FC<GenerationMixChartProps> = ({ data }) => {
    const [isCompact, setIsCompact] = useState(isCompactViewport);

    useEffect(() => {
        const query = window.matchMedia?.("(max-width: 680px)");
        if (!query) return;

        const handleChange = () => setIsCompact(query.matches);

        handleChange();
        query.addEventListener("change", handleChange);

        return () => query.removeEventListener("change", handleChange);
    }, []);

    const totalValue = Object.values(data).reduce((sum: number, val: number | undefined) => {
        if (typeof val === "number" && val > 0) {
            return sum + val;
        }
        return sum;
    }, 0);

    
    /**
     * Transforms the raw generation data into a format suitable for Recharts.
     * Filters out undefined or < 0.1% values, capitalizes names, and sorts by value.
     */
    const chartData = Object.entries(data)
        .filter(([_, value]) => value !== undefined && value > 0)
        .map(([name, value]) => ({
            name: name.charAt(0).toUpperCase() + name.slice(1),
            value: Math.round(value || 0),
            originalName: name,
        }))
        .filter(entry => (entry.value / totalValue) * 100 >= 0.1)
        .sort((a, b) => b.value - a.value);

    // Fallback UI when no data is available
    if (chartData.length === 0) {
        return (
            <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                No generation data available
            </div>
        );
    }

    /**
     * Custom tooltip renderer for Recharts PieChart.
     * Displays the name, value in MW, and percentage share.
     */
    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const entry = payload[0];
            const total = chartData.reduce((sum, item) => sum + item.value, 0);
            const percent = total > 0 ? (entry.value / total) * 100 : 0;
            return (
                <div style={{backgroundColor: 'white', padding: '10px', border: '1px solid #ccc', borderRadius: '4px'}}>
                    <p style={{ margin: 0, fontWeight: 'bold' }}>{entry.name}</p>
                    <p style={{ margin: '5px 0 0 0' }}>{entry.value.toLocaleString()} MW ({percent.toFixed(1)}%)</p>
                </div>
            );
        }
        return null;
    };

    return (
        <ResponsiveContainer width="100%" height={isCompact ? 250 : 300}>
        <PieChart>
            <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy={isCompact ? "45%" : "50%"}
                outerRadius={isCompact ? 70 : 90}
                label={isCompact ? false : (entry: any) => `${entry.name} ${(entry.percent * 100).toFixed(1)}%`}
                labelLine={!isCompact}
            >
                {chartData.map((entry, index) => (
                    <Cell 
                        key={`cell-${index}`} 
                        fill={FUEL_COLORS[entry.originalName] || "#A0AEC0"} 
                    />
                ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend 
                verticalAlign="bottom" 
                height={isCompact ? 64 : 36}
                formatter={(value, entry: any) => `${value}: ${entry.payload.value} MW`}
            />
        </PieChart>
        </ResponsiveContainer>
    );
};

export default GenerationMixChart;
