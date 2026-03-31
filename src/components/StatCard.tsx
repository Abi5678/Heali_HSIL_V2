import { ReactNode } from "react";

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  variant?: "default" | "primary" | "accent" | "success";
}

const variantStyles = {
  default: "border-border bg-card hover:border-primary/50",
  primary: "border-primary bg-primary text-primary-foreground",
  accent: "border-accent bg-accent text-accent-foreground",
  success: "border-success/30 bg-success/10",
};

const StatCard = ({
  icon,
  label,
  value,
  subtitle,
  trend,
  trendValue,
  variant = "default",
}: StatCardProps) => {
  const isColored = variant === "primary" || variant === "accent";

  return (
    <div
      className={`group border p-6 transition-all duration-150 ${variantStyles[variant]}`}
    >
      <div className="flex items-start justify-between">
        <div className={isColored ? "opacity-80" : "text-primary"}>
          {icon}
        </div>
        {trend && trendValue && (
          <span className={`font-mono text-xs font-medium ${
            trend === "up" ? "text-success" : trend === "down" ? "text-destructive" : "text-muted-foreground"
          }`}>
            {trend === "up" ? "↑" : trend === "down" ? "↓" : "→"} {trendValue}
          </span>
        )}
      </div>
      <div className="mt-4">
        <p className={`font-mono text-xs uppercase tracking-widest ${isColored ? "opacity-70" : "text-muted-foreground"}`}>
          {label}
        </p>
        <p className="mt-1 font-display text-3xl font-bold tracking-tight">{value}</p>
        {subtitle && (
          <p className={`mt-1 font-mono text-[10px] uppercase tracking-widest ${isColored ? "opacity-50" : "text-muted-foreground"}`}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
};

export default StatCard;
