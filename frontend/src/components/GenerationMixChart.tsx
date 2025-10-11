import React from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { GenerationMix } from "../services/api";

interface GenerationMixChartProps {
  data: GenerationMix;
}

// Colors for different fuel types - green for renewables, others for fossil
const FUEL_COLORS: { [key: string]: string } = {
  hydro: "#4299E1",      // Blue
  wind: "#48BB78",       // Green
  solar: "#F6AD55",      // Orange
  geothermal: "#9F7AEA", // Purple
  gas: "#ED8936",        // Dark orange
  coal: "#718096",       // Gray
  other: "#A0AEC0",      // Light gray
};

const GenerationMixChart: React.FC<GenerationMixChartProps> = ({ data }) => {
  // Filter out undefined values and format data for the chart
  const chartData = Object.entries(data)
    .filter(([_, value]) => value !== undefined && value > 0)
    .map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1), // Capitalize first letter
      value: Math.round(value || 0),
      originalName: name,
    }))
    .sort((a, b) => b.value - a.value); // Sort by value descending

  if (chartData.length === 0) {
    return <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>No generation data available</div>;
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div style={{
          backgroundColor: 'white',
          padding: '10px',
          border: '1px solid #ccc',
          borderRadius: '4px',
        }}>
          <p style={{ margin: 0, fontWeight: 'bold' }}>{payload[0].name}</p>
          <p style={{ margin: '5px 0 0 0' }}>{payload[0].value.toLocaleString()} MW</p>
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={90}
          label={(entry: any) => `${entry.name} ${(entry.percent * 100).toFixed(0)}%`}
          labelLine={true}
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
          height={36}
          formatter={(value, entry: any) => `${value}: ${entry.payload.value} MW`}
        />
      </PieChart>
    </ResponsiveContainer>
  );
};

export default GenerationMixChart;