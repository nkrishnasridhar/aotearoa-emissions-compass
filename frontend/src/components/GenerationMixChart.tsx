import React, { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { GenerationMix } from "../services/api";

interface GenerationMixChartProps {
    data: GenerationMix;
}

const FUEL_COLORS: { [key: string]: string } = {
    hydro: "#4299E1",
    wind: "#48BB78",
    solar: "#F6AD55",
    geothermal: "#9F7AEA",
    gas: "#ED8936",
    coal: "#718096",
    other: "#A0AEC0",
};

function isCompactViewport() {
    return Boolean(window.matchMedia?.("(max-width: 680px)")?.matches);
}

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

    const chartData = Object.entries(data)
        .filter(([_, value]) => value !== undefined && value > 0)
        .map(([name, value]) => ({
            name: name.charAt(0).toUpperCase() + name.slice(1),
            value: Math.round(value || 0),
            originalName: name,
        }))
        .filter(entry => (entry.value / totalValue) * 100 >= 0.1)
        .sort((a, b) => b.value - a.value);

    if (chartData.length === 0) {
        return (
            <div className="chart-empty">
                No generation data available
            </div>
        );
    }

    const CustomTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const entry = payload[0];
            const total = chartData.reduce((sum, item) => sum + item.value, 0);
            const percent = total > 0 ? (entry.value / total) * 100 : 0;
            return (
                <div className="chart-tooltip">
                    <p><strong>{entry.name}</strong></p>
                    <p>{entry.value.toLocaleString()} MW ({percent.toFixed(1)}%)</p>
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
                formatter={(value, entry: any) => (
                    <span className="chart-legend-label">{value}: {entry.payload.value} MW</span>
                )}
            />
        </PieChart>
        </ResponsiveContainer>
    );
};

export default GenerationMixChart;
