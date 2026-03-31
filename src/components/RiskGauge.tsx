import { useEffect, useState } from "react";

interface RiskGaugeProps {
  score: number; // 0.0 - 1.0
  level: "low" | "moderate" | "high";
  size?: number;
}

const COLORS = {
  low: { stroke: "#22c55e", text: "text-success" },
  moderate: { stroke: "#f59e0b", text: "text-accent" },
  high: { stroke: "#ef4444", text: "text-destructive" },
};

export default function RiskGauge({ score, level, size = 120 }: RiskGaugeProps) {
  const [animated, setAnimated] = useState(0);
  const config = COLORS[level] || COLORS.low;
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(score), 100);
    return () => clearTimeout(timer);
  }, [score]);

  const offset = circumference - animated * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={6}
            className="text-muted/20"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={config.stroke}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-display text-2xl font-bold ${config.text}`}>
            {Math.round(score * 100)}%
          </span>
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            {level}
          </span>
        </div>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        30-Day Risk
      </p>
    </div>
  );
}
