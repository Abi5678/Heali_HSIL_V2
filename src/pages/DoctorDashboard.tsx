import { useState, useEffect } from "react";
import {
  Activity, Pill, FileText, AlertTriangle, Download, Loader2,
  ShieldAlert, Shield, ShieldCheck, Stethoscope, Heart, Moon, Footprints,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import RiskGauge from "@/components/RiskGauge";
import CGMCard from "@/components/CGMCard";
import { useAuth } from "@/contexts/AuthContext";
import { getClinicalBrief, getRiskScore, getAlertHistory } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

const TIER_ICON = { red: ShieldAlert, amber: Shield, green: ShieldCheck };
const TIER_STYLE = {
  red: "border-destructive bg-destructive/10 text-destructive",
  amber: "border-accent bg-accent/10 text-accent",
  green: "border-success bg-success/10 text-success",
};

const DoctorDashboard = () => {
  const { getIdToken, user } = useAuth();
  const uid = (user as { uid?: string })?.uid || "demo_user";

  const [brief, setBrief] = useState<Record<string, unknown> | null>(null);
  const [risk, setRisk] = useState<{ risk_score: number; risk_level: "low" | "moderate" | "high"; contributing_factors: string[]; recommended_actions: string[] } | null>(null);
  const [alerts, setAlerts] = useState<Array<Record<string, unknown>>>([]);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getIdToken();
        if (!token || cancelled) return;
        setAuthToken(token);
        const [b, r, a] = await Promise.all([
          getClinicalBrief(uid, token).catch(() => null),
          getRiskScore(uid, token).catch(() => null),
          getAlertHistory(uid, token).catch(() => ({ alerts: [] })),
        ]);
        if (cancelled) return;
        setBrief(b as Record<string, unknown>);
        setRisk(r as typeof risk);
        setAlerts((a as { alerts: Array<Record<string, unknown>> }).alerts || []);
      } catch {
        toast({ variant: "destructive", title: "Error", description: "Failed to load dashboard data" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getIdToken, uid]);

  const handleDownloadFHIR = async () => {
    try {
      const token = await getIdToken();
      if (!token) return;
      const fhir = await getClinicalBrief(uid, token, "fhir");
      const blob = new Blob([JSON.stringify(fhir, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `heali-fhir-bundle-${uid}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Downloaded", description: "FHIR R4 Bundle saved" });
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to download" });
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 size={32} className="animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  const patient = (brief?.patient || {}) as Record<string, unknown>;
  const medications = (brief?.medications || {}) as Record<string, unknown>;
  const vitals = (brief?.vitals || {}) as Record<string, Record<string, unknown>>;
  const safetyAlerts = (brief?.safety_alerts || {}) as Record<string, unknown>;
  const symptoms = (brief?.recent_symptoms || []) as Array<Record<string, unknown>>;
  const docs = (brief?.scanned_documents || {}) as Record<string, unknown>;
  const wearableData = (brief?.wearable_data || null) as {
    connected_devices?: string[];
    cgm_summary?: { avg_glucose?: number; time_in_range?: number; hypo_events?: number; hyper_events?: number; gmi?: number };
    activity?: { avg_daily_steps?: number; avg_active_minutes?: number; avg_resting_hr?: number };
    sleep?: { avg_duration_hours?: number; avg_score?: number };
  } | null;

  return (
    <AppLayout>
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Stethoscope size={28} className="text-primary" />
            <h1 className="font-display text-4xl font-bold tracking-tight lg:text-5xl">
              Doctor Dashboard
            </h1>
          </div>
          <div className="rule-thick mt-4 mb-4 max-w-32" />
          <p className="text-sm text-muted-foreground">
            Clinical overview for {String(patient.name || uid)}
          </p>
        </div>
        <button
          onClick={handleDownloadFHIR}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-mono text-xs uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
        >
          <Download size={14} /> FHIR Export
        </button>
      </div>

      {/* Top Row: Patient Info + Risk Gauge */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-lg border border-border bg-card p-6">
          <h2 className="mb-4 font-display text-lg font-bold">Patient Information</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Name</p>
              <p className="font-semibold">{String(patient.name || "—")}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Age</p>
              <p className="font-semibold">{String(patient.age ?? "—")}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Blood Type</p>
              <p className="font-semibold">{String(patient.blood_type ?? "—")}</p>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Conditions</p>
              <p className="font-semibold">{(patient.conditions as string[])?.join(", ") || "—"}</p>
            </div>
          </div>
          {(patient.allergies as string[])?.length > 0 && (
            <div className="mt-3 flex gap-2">
              {(patient.allergies as string[]).map((a, i) => (
                <span key={i} className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">{a}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-center rounded-lg border border-border bg-card p-6">
          {risk ? (
            <div className="flex flex-col items-center">
              <RiskGauge score={risk.risk_score} level={risk.risk_level} />
              <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Re-hospitalization Risk
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Risk data unavailable</p>
          )}
        </div>
      </div>

      {/* Risk Factors + Recommendations */}
      {risk && (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 font-display text-lg font-bold">Contributing Factors</h2>
            <ul className="space-y-2">
              {risk.contributing_factors.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-accent" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 font-display text-lg font-bold">Recommended Actions</h2>
            <ul className="space-y-2">
              {risk.recommended_actions.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {a}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Middle Row: Medications + Vitals */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Pill size={16} className="text-primary" />
              <h2 className="font-display text-lg font-bold">Medications</h2>
            </div>
            <div className="text-right">
              <span className={`font-display text-2xl font-bold ${Number(medications.adherence_score) >= 90 ? "text-success" : Number(medications.adherence_score) >= 80 ? "text-accent" : "text-destructive"}`}>
                {String(medications.adherence_score ?? "—")}%
              </span>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">adherence</p>
            </div>
          </div>
          <div className="space-y-2">
            {((medications.current || []) as Array<Record<string, unknown>>).map((med, i) => (
              <div key={i} className="flex justify-between rounded-md bg-secondary p-3">
                <div>
                  <p className="text-sm font-semibold">{String(med.name)}</p>
                  <p className="text-xs text-muted-foreground">{String(med.dosage || "")} — {String(med.purpose || "")}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <Activity size={16} className="text-info" />
            <h2 className="font-display text-lg font-bold">Vital Signs</h2>
          </div>
          <div className="space-y-3">
            {Object.entries(vitals).map(([type, data]) => (
              <div key={type} className="rounded-md bg-secondary p-4">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs uppercase tracking-widest">{type.replace(/_/g, " ")}</p>
                  <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${String(data.trend) === "stable" ? "bg-success/10 text-success" : String(data.trend) === "improving" ? "bg-info/10 text-info" : "bg-accent/10 text-accent"}`}>
                    {String(data.trend)}
                  </span>
                </div>
                {data.latest && (
                  <p className="mt-1 font-display text-xl font-bold">
                    {String((data.latest as Record<string, unknown>).value)} <span className="text-sm text-muted-foreground">{String((data.latest as Record<string, unknown>).unit || "")}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CGM & Wearable Data */}
      {wearableData && (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* CGM Card */}
          <div className="lg:col-span-1">
            <CGMCard token={authToken} />
          </div>

          {/* CGM Summary Stats */}
          {wearableData.cgm_summary && (
            <div className="rounded-lg border border-border bg-card p-6">
              <div className="mb-4 flex items-center gap-2">
                <Activity size={16} className="text-green-500" />
                <h2 className="font-display text-lg font-bold">CGM Summary</h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md bg-secondary p-3 text-center">
                  <p className="font-display text-2xl font-bold text-green-600">
                    {wearableData.cgm_summary.time_in_range ?? "—"}%
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Time in Range</p>
                </div>
                <div className="rounded-md bg-secondary p-3 text-center">
                  <p className="font-display text-2xl font-bold">
                    {wearableData.cgm_summary.avg_glucose ?? "—"}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Avg Glucose</p>
                </div>
                <div className="rounded-md bg-secondary p-3 text-center">
                  <p className="font-display text-2xl font-bold text-info">
                    {wearableData.cgm_summary.gmi?.toFixed(1) ?? "—"}%
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">GMI (est. A1c)</p>
                </div>
                <div className="rounded-md bg-secondary p-3 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <span className="font-display text-lg font-bold text-amber-600">{wearableData.cgm_summary.hypo_events ?? 0}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="font-display text-lg font-bold text-red-500">{wearableData.cgm_summary.hyper_events ?? 0}</span>
                  </div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Hypo / Hyper</p>
                </div>
              </div>
            </div>
          )}

          {/* Activity & Sleep */}
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <Heart size={16} className="text-red-400" />
              <h2 className="font-display text-lg font-bold">Wearable Activity</h2>
            </div>
            <div className="space-y-3">
              {wearableData.activity && (
                <>
                  <div className="flex items-center justify-between rounded-md bg-secondary p-3">
                    <div className="flex items-center gap-2">
                      <Footprints size={14} className="text-primary" />
                      <span className="font-mono text-xs uppercase tracking-widest">Avg Steps</span>
                    </div>
                    <span className="font-display text-lg font-bold">{wearableData.activity.avg_daily_steps?.toLocaleString() ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-secondary p-3">
                    <div className="flex items-center gap-2">
                      <Activity size={14} className="text-green-500" />
                      <span className="font-mono text-xs uppercase tracking-widest">Active Min</span>
                    </div>
                    <span className="font-display text-lg font-bold">{wearableData.activity.avg_active_minutes ?? "—"}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-secondary p-3">
                    <div className="flex items-center gap-2">
                      <Heart size={14} className="text-red-400" />
                      <span className="font-mono text-xs uppercase tracking-widest">Resting HR</span>
                    </div>
                    <span className="font-display text-lg font-bold">{wearableData.activity.avg_resting_hr ?? "—"} <span className="text-sm text-muted-foreground">bpm</span></span>
                  </div>
                </>
              )}
              {wearableData.sleep && (
                <div className="flex items-center justify-between rounded-md bg-secondary p-3">
                  <div className="flex items-center gap-2">
                    <Moon size={14} className="text-indigo-400" />
                    <span className="font-mono text-xs uppercase tracking-widest">Avg Sleep</span>
                  </div>
                  <span className="font-display text-lg font-bold">{wearableData.sleep.avg_duration_hours?.toFixed(1) ?? "—"} <span className="text-sm text-muted-foreground">hrs</span></span>
                </div>
              )}
            </div>
            {wearableData.connected_devices && wearableData.connected_devices.length > 0 && (
              <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Sources: {wearableData.connected_devices.join(", ")}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Safety Alerts */}
      <div className="mb-6 rounded-lg border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="text-destructive" />
            <h2 className="font-display text-lg font-bold">Safety Alerts</h2>
          </div>
          <div className="flex gap-3">
            <span className="rounded-full bg-destructive/10 px-3 py-1 font-mono text-[10px] font-bold text-destructive">
              {String(safetyAlerts.red_count ?? 0)} RED
            </span>
            <span className="rounded-full bg-accent/10 px-3 py-1 font-mono text-[10px] font-bold text-accent">
              {String(safetyAlerts.amber_count ?? 0)} AMBER
            </span>
          </div>
        </div>
        {alerts.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No safety alerts recorded.</p>
        ) : (
          <div className="space-y-2">
            {alerts.slice(0, 10).map((alert, i) => {
              const tier = String(alert.alert_tier || "green") as "red" | "amber" | "green";
              const Icon = TIER_ICON[tier] || ShieldCheck;
              const style = TIER_STYLE[tier] || TIER_STYLE.green;
              return (
                <div key={i} className={`flex items-start gap-3 rounded-md border-l-4 p-3 ${style}`}>
                  <Icon size={16} className="mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{String(alert.symptoms || "—")}</p>
                    <p className="text-xs text-muted-foreground">
                      {String(alert.action_taken || "").replace(/_/g, " ")} — {new Date(String(alert.timestamp)).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Row: Symptoms + Documents */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {symptoms.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-2">
              <AlertTriangle size={16} className="text-accent" />
              <h2 className="font-display text-lg font-bold">Recent Symptoms</h2>
            </div>
            <div className="space-y-2">
              {symptoms.slice(0, 8).map((s, i) => (
                <div key={i} className="flex justify-between rounded-md bg-secondary p-3">
                  <p className="text-sm">{String(s.symptoms || s.description || JSON.stringify(s))}</p>
                  <span className="font-mono text-[10px] text-muted-foreground">{String(s.date || s.timestamp || "")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <FileText size={16} className="text-primary" />
            <h2 className="font-display text-lg font-bold">Scanned Documents</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md bg-secondary p-4 text-center">
              <p className="font-display text-3xl font-bold text-primary">{String(docs.prescriptions ?? 0)}</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Prescriptions</p>
            </div>
            <div className="rounded-md bg-secondary p-4 text-center">
              <p className="font-display text-3xl font-bold text-info">{String(docs.lab_reports ?? 0)}</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Lab Reports</p>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default DoctorDashboard;
