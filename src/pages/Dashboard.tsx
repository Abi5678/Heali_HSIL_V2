import { useEffect, useState } from "react";
import {
  Pill, Heart, Activity, AlertTriangle,
  CheckCircle2, Clock, TrendingUp, Utensils, Loader2,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import StatCard from "@/components/StatCard";
import RiskGauge from "@/components/RiskGauge";
import CGMCard from "@/components/CGMCard";
import { useAuth } from "@/contexts/AuthContext";
import { getDashboard, getMedications, getProfile, getRiskScore, logMedicationTaken, logVital } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

// Fallback data when backend is unavailable
const FALLBACK_MEDICATIONS = [
  { name: "Metformin 500mg", time: "8:00 AM", status: "taken", type: "Diabetes" },
  { name: "Lisinopril 10mg", time: "8:00 AM", status: "taken", type: "Blood Pressure" },
  { name: "Atorvastatin 20mg", time: "9:00 PM", status: "upcoming", type: "Cholesterol" },
  { name: "Aspirin 81mg", time: "9:00 PM", status: "upcoming", type: "Heart" },
];

const FALLBACK_VITALS = [
  { label: "Blood Pressure", value: "128/82", unit: "mmHg", status: "normal" },
  { label: "Heart Rate", value: "72", unit: "bpm", status: "normal" },
  { label: "Blood Sugar", value: "145", unit: "mg/dL", status: "elevated" },
  { label: "SpO\u2082", value: "97", unit: "%", status: "normal" },
];

const FALLBACK_MEALS = [
  { meal: "Breakfast", calories: 320, protein: 18, time: "7:30 AM" },
  { meal: "Lunch", calories: 480, protein: 24, time: "12:15 PM" },
];

interface DashboardData {
  adherence: { score: number; rating: string };
  digest: {
    medications: Array<{ name: string; dosage?: string; times?: string[]; status?: string; purpose?: string }>;
    vitals: Array<{ type: string; value: string | number; unit?: string; status?: string }>;
    meals: Array<{ description?: string; time?: string; meal_type?: string; calories?: number; protein_g?: number; timestamp?: string }>;
  };
}

const Dashboard = () => {
  const { user, getIdToken } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [medications, setMedications] = useState<typeof FALLBACK_MEDICATIONS>(FALLBACK_MEDICATIONS);
  const [loading, setLoading] = useState(true);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [riskData, setRiskData] = useState<{ risk_score: number; risk_level: "low" | "moderate" | "high"; contributing_factors: string[] } | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const token = await getIdToken();
        if (!token || !user?.uid) return;
        setAuthToken(token);

        const [dashRes, medsRes] = await Promise.allSettled([
          getDashboard(user.uid, token),
          getMedications(token),
        ]);

        if (dashRes.status === "fulfilled") {
          setData(dashRes.value as DashboardData);
        }

        if (medsRes.status === "fulfilled") {
          const rawMeds = (medsRes.value as { medications: Array<Record<string, unknown>> }).medications;
          if (rawMeds?.length) {
            setMedications(
              rawMeds.map((m) => ({
                name: `${m.name || "Unknown"} ${m.dosage || ""}`.trim(),
                time: Array.isArray(m.times) ? (m.times[0] as string) || "" : "",
                status: (m.status as string) || "upcoming",
                type: (m.purpose as string) || "",
              })),
            );
          }
        }

        // Fetch Firestore profile name and risk score
        try {
          const profileData = await getProfile(token) as { name?: string; display_name?: string } | null;
          const name = profileData?.name || profileData?.display_name || null;
          if (name) setProfileName(name);
        } catch { /* ignore */ }
        try {
          const riskRes = await getRiskScore(user.uid, token);
          setRiskData(riskRes);
        } catch { /* ignore */ }
      } catch (err) {
        console.warn("Dashboard fetch failed, using fallback data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [user, getIdToken]);

  const handleMarkAsTaken = async (medName: string) => {
    try {
      const token = await getIdToken();
      if (!token) return;
      await logMedicationTaken(medName, token);
      setMedications(prev => prev.map(m => 
        m.name.includes(medName) ? { ...m, status: "taken" } : m
      ));
      toast({
        title: "Medication Logged",
        description: `${medName} has been marked as taken.`,
      });
    } catch (err) {
      console.error("Failed to log medication:", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to log medication. Please try again.",
      });
    }
  };

  const handleLogVital = async (type: string, unit: string) => {
    const value = prompt(`Enter ${type.replace("_", " ")} reading (${unit}):`);
    if (!value) return;

    try {
      const token = await getIdToken();
      if (!token) return;
      await logVital(type, value, unit, token);
      toast({
        title: "Vital Logged",
        description: `New ${type.replace("_", " ")} reading logged: ${value} ${unit}`,
      });
      // Optionally refresh data but mock mode won't show it immediately anyway
    } catch (err) {
      console.error("Failed to log vital:", err);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to log vital. Please try again.",
      });
    }
  };

  const adherenceScore = data?.adherence?.score ?? 94;
  const adherenceRating = data?.adherence?.rating ?? "Good";

  const vitals =
    data?.digest?.vitals?.length
      ? data.digest.vitals.map((v) => ({
          label: String(v.type).replace(/_/g, " "),
          value: String(v.value),
          unit: v.unit || "",
          status: v.status || "normal",
        }))
      : FALLBACK_VITALS;

  const meals =
    data?.digest?.meals?.length
      ? data.digest.meals.map((m) => ({
          meal: m.meal_type || "Meal",
          calories: m.calories ?? 0,
          protein: m.protein_g ?? 0,
          time: m.time || m.timestamp?.split("T")[1]?.substring(0, 5) || "",
        }))
      : FALLBACK_MEALS;

  const takenCount = medications.filter((m) => m.status === "taken").length;
  const totalCount = medications.length;
  const totalCalories = meals.reduce((s, m) => s + m.calories, 0);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  return (
    <AppLayout>
      {/* Hero heading */}
      <div className="mb-12">
        <h1 className="font-display text-5xl font-bold tracking-tight text-foreground lg:text-7xl">
          {greeting()},
          <br />
          <em className="text-primary">{profileName || user?.displayName || "there"}</em>
        </h1>
        <div className="rule-thick mt-6 mb-8 max-w-32" />
        <p className="max-w-lg text-lg text-muted-foreground">
          Here's your health overview for today
          {loading && <Loader2 size={14} className="ml-2 inline animate-spin" />}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Pill size={20} strokeWidth={1.5} />}
          label="Medications"
          value={`${takenCount} / ${totalCount}`}
          subtitle={`${totalCount - takenCount} remaining`}
          variant="primary"
        />
        <StatCard
          icon={<Heart size={20} strokeWidth={1.5} />}
          label="Adherence"
          value={`${adherenceScore}%`}
          subtitle={adherenceRating}
          variant="success"
        />
        <StatCard
          icon={<Activity size={20} strokeWidth={1.5} />}
          label="Vitals"
          value={`${vitals.length} / ${vitals.length}`}
          subtitle="All recorded"
        />
        <StatCard
          icon={<Utensils size={20} strokeWidth={1.5} />}
          label="Calories"
          value={String(totalCalories || 800)}
          subtitle="Target: 1,600 kcal"
          variant="accent"
        />
      </div>

      {/* Risk Gauge */}
      {riskData && (
        <div className="mt-8 rounded-lg border border-border bg-card p-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-8">
            <RiskGauge score={riskData.risk_score} level={riskData.risk_level} />
            <div className="flex-1">
              <h2 className="font-display text-xl font-bold tracking-tight">Re-hospitalization Risk</h2>
              <p className="mt-1 text-sm text-muted-foreground">30-day predicted risk based on your health data</p>
              {riskData.contributing_factors.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {riskData.contributing_factors.slice(0, 4).map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-accent" />
                      {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CGM Glucose Monitor */}
      <div className="mt-8">
        <CGMCard token={authToken} />
      </div>

      <div className="rule-thick mt-12 mb-12 opacity-20" />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Medications */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold tracking-tight">Today's Medications</h2>
            <span className="rounded-full bg-accent/10 px-3 py-1 font-mono text-xs text-accent">
              {totalCount - takenCount} left
            </span>
          </div>
          <div className="space-y-3">
            {medications.map((med) => (
              <div
                key={med.name}
                className="group flex items-center justify-between rounded-md border border-border p-4 transition-all duration-150 hover:border-primary/50 hover:bg-primary/5"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`rounded-full p-2 ${
                      med.status === "taken" ? "bg-success/10 text-success" : "bg-accent/10 text-accent"
                    }`}
                  >
                    {med.status === "taken" ? (
                      <CheckCircle2 size={16} strokeWidth={1.5} />
                    ) : (
                      <Clock size={16} strokeWidth={1.5} />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{med.name}</p>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {med.type}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm">{med.time}</p>
                  <p
                    className={`font-mono text-[10px] uppercase tracking-widest ${
                      med.status === "taken" ? "text-success" : "text-accent"
                    }`}
                  >
                    {med.status}
                  </p>
                </div>
                {med.status !== "taken" && (
                  <button
                    onClick={() => handleMarkAsTaken(med.name)}
                    className="ml-4 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/20"
                  >
                    Mark as Taken
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Vitals */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold tracking-tight">Current Vitals</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleLogVital("blood_pressure", "mmHg")}
                className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/20"
              >
                Add Reading
              </button>
              <TrendingUp size={18} strokeWidth={1.5} className="text-primary" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {vitals.map((v) => (
              <div key={v.label} className="rounded-md border border-border p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {v.label}
                </p>
                <div className="mt-2 flex items-baseline gap-1.5">
                  <span className="font-display text-2xl font-bold tracking-tight">{v.value}</span>
                  <span className="font-mono text-xs text-muted-foreground">{v.unit}</span>
                </div>
                <p
                  className={`mt-2 font-mono text-[10px] uppercase tracking-widest ${
                    v.status === "normal" ? "text-success" : "text-accent"
                  }`}
                >
                  {v.status === "normal" ? "\u25CF Normal" : "\u25B2 Elevated"}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Meals */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-6 font-display text-2xl font-bold tracking-tight">Recent Meals</h2>
          <div className="space-y-3">
            {meals.map((meal, i) => (
              <div
                key={`${meal.meal}-${i}`}
                className="flex items-center justify-between rounded-md border border-border p-4 transition-colors hover:border-accent/50"
              >
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-accent/10 p-2 text-accent">
                    <Utensils size={14} strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{meal.meal}</p>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {meal.time}
                    </p>
                  </div>
                </div>
                {meal.calories > 0 && (
                  <div className="text-right font-mono text-sm">
                    <p>{meal.calories} kcal</p>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {meal.protein}g protein
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Alerts */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-6 font-display text-2xl font-bold tracking-tight">Alerts</h2>
          <div className="space-y-4">
            <div className="rounded-md border-l-4 border-accent bg-accent/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
                <div>
                  <p className="text-sm font-semibold">Elevated Blood Sugar</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your fasting glucose was 145 mg/dL. Consider reducing carbs at dinner.
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-md border-l-4 border-info bg-info/5 p-4">
              <div className="flex items-start gap-3">
                <Clock size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-info" />
                <div>
                  <p className="text-sm font-semibold">Upcoming: Dr. Sharma</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Cardiology follow-up on March 12 at 10:00 AM
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
