import { useEffect, useState } from "react";
import { Activity, Loader2 } from "lucide-react";
import { getCGMCurrent } from "@/lib/api";

interface CGMData {
  available: boolean;
  value?: number;
  unit?: string;
  trend?: string;
  time_in_range?: number;
  timestamp?: string;
  source?: string;
}

function getGlucoseColor(value: number): string {
  if (value < 54) return "text-red-600";
  if (value < 70) return "text-amber-600";
  if (value < 80) return "text-yellow-600";
  if (value <= 180) return "text-green-600";
  if (value <= 250) return "text-yellow-600";
  if (value <= 400) return "text-amber-600";
  return "text-red-600";
}

function getGlucoseBg(value: number): string {
  if (value < 54) return "bg-red-500/10 border-red-500/30";
  if (value < 70) return "bg-amber-500/10 border-amber-500/30";
  if (value <= 180) return "bg-green-500/10 border-green-500/30";
  if (value <= 250) return "bg-amber-500/10 border-amber-500/30";
  return "bg-red-500/10 border-red-500/30";
}

function getStatusLabel(value: number): string {
  if (value < 54) return "CRITICAL LOW";
  if (value < 70) return "LOW";
  if (value < 80) return "SLIGHTLY LOW";
  if (value <= 180) return "IN RANGE";
  if (value <= 250) return "HIGH";
  if (value <= 400) return "VERY HIGH";
  return "CRITICAL HIGH";
}

interface Props {
  token: string | null;
  compact?: boolean;
}

export default function CGMCard({ token, compact = false }: Props) {
  const [data, setData] = useState<CGMData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    loadCGM();
    // Refresh every 5 minutes
    const interval = setInterval(loadCGM, 5 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadCGM = async () => {
    if (!token) return;
    try {
      const result = await getCGMCurrent(token);
      setData(result);
    } catch (e) {
      console.error("Failed to load CGM data", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={`rounded-lg border border-border bg-card p-4 ${compact ? "" : "p-6"}`}>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="animate-spin text-muted-foreground" size={20} />
        </div>
      </div>
    );
  }

  if (!data?.available) return null;

  const glucoseVal = data.value!;
  const colorClass = getGlucoseColor(glucoseVal);
  const bgClass = getGlucoseBg(glucoseVal);
  const statusLabel = getStatusLabel(glucoseVal);

  if (compact) {
    return (
      <div className={`rounded-lg border-2 p-4 ${bgClass}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={16} className={colorClass} />
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              CGM Glucose
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {data.source}
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={`font-display text-3xl font-bold ${colorClass}`}>
            {glucoseVal}
          </span>
          <span className="text-sm text-muted-foreground">mg/dL</span>
          <span className={`text-xl ${colorClass}`}>{data.trend}</span>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <span className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${colorClass}`}>
            {statusLabel}
          </span>
          {data.time_in_range !== undefined && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              TIR: {data.time_in_range}%
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border-2 p-6 ${bgClass}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={18} className={colorClass} />
          <h3 className="font-display text-lg font-bold">Continuous Glucose</h3>
        </div>
        <span className="rounded-full bg-muted px-3 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {data.source}
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-3">
        <span className={`font-display text-5xl font-bold ${colorClass}`}>
          {glucoseVal}
        </span>
        <span className="text-lg text-muted-foreground">mg/dL</span>
        <span className={`text-3xl ${colorClass}`}>{data.trend}</span>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <span className={`rounded-full px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${colorClass} ${bgClass}`}>
          {statusLabel}
        </span>
        {data.time_in_range !== undefined && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Time in Range
            </span>
            <span className="font-display text-lg font-bold text-foreground">
              {data.time_in_range}%
            </span>
          </div>
        )}
      </div>

      {data.timestamp && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Last reading: {data.timestamp}
        </p>
      )}
    </div>
  );
}
