import { useState, useEffect } from "react";
import { FileText, Download, Loader2, Activity, Pill, AlertTriangle, ShieldAlert } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { getClinicalBrief } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

interface ClinicalBriefData {
  generated_at: string;
  period_days: number;
  patient: { name: string; age?: number; conditions?: string[]; blood_type?: string; allergies?: string[] };
  medications: {
    current: Array<{ name: string; dosage?: string; frequency?: unknown; purpose?: string }>;
    adherence_score: number;
    adherence_rating: string;
    missed_doses: Array<{ medication?: string; date?: string }>;
  };
  vitals: Record<string, { latest?: Record<string, unknown>; trend: string; readings_count: number; min?: number; max?: number }>;
  recent_symptoms: Array<Record<string, unknown>>;
  scanned_documents: { prescriptions: number; lab_reports: number };
  safety_alerts: { total: number; red_count: number; amber_count: number; recent: unknown[] };
  emergency_incidents: { total: number };
}

const ClinicalBrief = () => {
  const { getIdToken, user } = useAuth();
  const [brief, setBrief] = useState<ClinicalBriefData | null>(null);
  const [loading, setLoading] = useState(true);

  const uid = (user as { uid?: string })?.uid || "demo_user";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getIdToken();
        if (!token || cancelled) return;
        const data = await getClinicalBrief(uid, token);
        if (!cancelled) setBrief(data as ClinicalBriefData);
      } catch {
        toast({ variant: "destructive", title: "Error", description: "Failed to load clinical brief" });
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
      toast({ variant: "destructive", title: "Error", description: "Failed to download FHIR bundle" });
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

  if (!brief) {
    return (
      <AppLayout>
        <p className="py-12 text-center text-muted-foreground">Could not load clinical brief.</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="font-display text-5xl font-bold tracking-tight lg:text-7xl">
            Clinical
            <br />
            <em className="text-primary">Brief</em>
          </h1>
          <div className="rule-thick mt-6 mb-6 max-w-32" />
          <p className="text-sm text-muted-foreground">
            Generated {new Date(brief.generated_at).toLocaleString()} — Last {brief.period_days} days
          </p>
        </div>
        <button
          onClick={handleDownloadFHIR}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 font-mono text-xs uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
        >
          <Download size={14} /> FHIR R4 Export
        </button>
      </div>

      {/* Patient Info */}
      <div className="mb-6 rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 font-display text-xl font-bold">Patient Summary</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Name</p>
            <p className="font-semibold">{brief.patient.name}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Age</p>
            <p className="font-semibold">{brief.patient.age ?? "—"}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Blood Type</p>
            <p className="font-semibold">{brief.patient.blood_type ?? "—"}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Conditions</p>
            <p className="font-semibold">{brief.patient.conditions?.join(", ") || "—"}</p>
          </div>
        </div>
        {brief.patient.allergies && brief.patient.allergies.length > 0 && (
          <div className="mt-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Allergies</p>
            <div className="mt-1 flex gap-2">
              {brief.patient.allergies.map((a, i) => (
                <span key={i} className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive">
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Medications */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <Pill size={16} className="text-primary" />
            <h2 className="font-display text-xl font-bold">Medications</h2>
          </div>
          <div className="mb-4 flex items-center gap-4">
            <div className="text-center">
              <p className={`font-display text-3xl font-bold ${brief.medications.adherence_score >= 90 ? "text-success" : brief.medications.adherence_score >= 80 ? "text-accent" : "text-destructive"}`}>
                {brief.medications.adherence_score}%
              </p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Adherence</p>
            </div>
            <span className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-widest ${brief.medications.adherence_rating === "excellent" ? "bg-success/10 text-success" : brief.medications.adherence_rating === "good" ? "bg-accent/10 text-accent" : "bg-destructive/10 text-destructive"}`}>
              {brief.medications.adherence_rating}
            </span>
          </div>
          <div className="space-y-2">
            {brief.medications.current.map((med, i) => (
              <div key={i} className="flex items-center justify-between rounded-md bg-secondary p-3">
                <div>
                  <p className="text-sm font-semibold">{med.name}</p>
                  <p className="text-xs text-muted-foreground">{med.dosage} — {med.purpose}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Vitals */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <Activity size={16} className="text-info" />
            <h2 className="font-display text-xl font-bold">Vitals</h2>
          </div>
          <div className="space-y-4">
            {Object.entries(brief.vitals).map(([type, data]) => (
              <div key={type} className="rounded-md bg-secondary p-4">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs uppercase tracking-widest">{type.replace(/_/g, " ")}</p>
                  <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${data.trend === "stable" ? "bg-success/10 text-success" : data.trend === "improving" ? "bg-info/10 text-info" : "bg-accent/10 text-accent"}`}>
                    {data.trend}
                  </span>
                </div>
                {data.latest && (
                  <p className="mt-1 font-display text-2xl font-bold">
                    {String((data.latest as Record<string, unknown>).value)} <span className="text-sm text-muted-foreground">{String((data.latest as Record<string, unknown>).unit || "")}</span>
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.readings_count} readings · Range: {data.min ?? "—"} – {data.max ?? "—"}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Safety Alerts Summary */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <ShieldAlert size={16} className="text-destructive" />
            <h2 className="font-display text-xl font-bold">Safety Alerts</h2>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md bg-destructive/10 p-3 text-center">
              <p className="font-display text-2xl font-bold text-destructive">{brief.safety_alerts.red_count}</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Red</p>
            </div>
            <div className="rounded-md bg-accent/10 p-3 text-center">
              <p className="font-display text-2xl font-bold text-accent">{brief.safety_alerts.amber_count}</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Amber</p>
            </div>
            <div className="rounded-md bg-secondary p-3 text-center">
              <p className="font-display text-2xl font-bold">{brief.safety_alerts.total - brief.safety_alerts.red_count - brief.safety_alerts.amber_count}</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Green</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {brief.emergency_incidents.total} emergency incident(s) in the last {brief.period_days} days
          </p>
        </div>

        {/* Scanned Documents */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <FileText size={16} className="text-primary" />
            <h2 className="font-display text-xl font-bold">Scanned Documents</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md bg-secondary p-4 text-center">
              <p className="font-display text-3xl font-bold text-primary">{brief.scanned_documents.prescriptions}</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Prescriptions</p>
            </div>
            <div className="rounded-md bg-secondary p-4 text-center">
              <p className="font-display text-3xl font-bold text-info">{brief.scanned_documents.lab_reports}</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Lab Reports</p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Symptoms */}
      {brief.recent_symptoms.length > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-accent" />
            <h2 className="font-display text-xl font-bold">Recent Symptoms</h2>
          </div>
          <div className="space-y-2">
            {brief.recent_symptoms.map((s, i) => (
              <div key={i} className="flex items-center justify-between rounded-md bg-secondary p-3">
                <p className="text-sm">{String(s.symptoms || s.description || JSON.stringify(s))}</p>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {String(s.date || s.timestamp || "")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </AppLayout>
  );
};

export default ClinicalBrief;
