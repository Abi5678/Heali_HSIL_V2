import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Activity, Pill, AlertTriangle, TrendingUp,
  Phone, CheckCircle2, XCircle, Link2, Loader2, Copy,
  Shield, ShieldAlert, ShieldCheck,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import CGMCard from "@/components/CGMCard";
import { useAuth } from "@/contexts/AuthContext";
import { generateFamilyCode, verifyFamilyCode, getDashboard, getAlertHistory } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

interface FamilyMember {
  name: string;
  relation: string;
  adherence: number;
  status: string;
  lastActive: string;
}

const FALLBACK_MEMBERS: FamilyMember[] = [
  { name: "Amma Patel", relation: "Mother", adherence: 94, status: "good", lastActive: "2 min ago" },
  { name: "Baba Patel", relation: "Father", adherence: 78, status: "attention", lastActive: "1 hr ago" },
];

const FALLBACK_ALERTS = [
  { member: "Baba Patel", type: "missed", message: "Missed evening Atorvastatin dose", time: "Yesterday 9:30 PM" },
  { member: "Amma Patel", type: "vitals", message: "Elevated fasting glucose: 145 mg/dL", time: "Today 7:00 AM" },
];

const adherenceData = [
  { day: "Mon", amma: 100, baba: 75 },
  { day: "Tue", amma: 100, baba: 100 },
  { day: "Wed", amma: 75, baba: 50 },
  { day: "Thu", amma: 100, baba: 75 },
  { day: "Fri", amma: 100, baba: 100 },
  { day: "Sat", amma: 100, baba: 75 },
  { day: "Sun", amma: 75, baba: 50 },
];

interface SafetyAlert {
  timestamp: string;
  alert_tier: "green" | "amber" | "red";
  trigger_source: string;
  symptoms: string;
  action_taken: string;
  human_notified: string[];
  patient_acknowledged: boolean;
  resolution: string | null;
}

const TIER_CONFIG = {
  red: { label: "RED", icon: ShieldAlert, border: "border-destructive", bg: "bg-destructive/10", text: "text-destructive", badge: "bg-destructive text-destructive-foreground" },
  amber: { label: "AMBER", icon: Shield, border: "border-accent", bg: "bg-accent/10", text: "text-accent", badge: "bg-accent text-accent-foreground" },
  green: { label: "GREEN", icon: ShieldCheck, border: "border-success", bg: "bg-success/10", text: "text-success", badge: "bg-success text-success-foreground" },
};

const FamilyDashboard = () => {
  const { getIdToken, user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [familyMembers] = useState<FamilyMember[]>(FALLBACK_MEMBERS);
  const [alerts] = useState(FALLBACK_ALERTS);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [safetyAlerts, setSafetyAlerts] = useState<SafetyAlert[]>([]);
  const [safetyLoading, setSafetyLoading] = useState(true);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [linking, setLinking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const didAutoVerifyFromUrlRef = useRef(false);

  // Fetch safety alert history
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getIdToken();
        if (!token || cancelled) { setSafetyLoading(false); return; }
        setAuthToken(token);
        const uid = (user as { uid?: string })?.uid || "demo_user";
        const result = await getAlertHistory(uid, token);
        if (!cancelled) setSafetyAlerts(result.alerts);
      } catch {
        // Silently fail — section will just show empty
      } finally {
        if (!cancelled) setSafetyLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getIdToken, user]);

  const codeFromUrl = searchParams.get("code")?.trim().toUpperCase().slice(0, 5);

  useEffect(() => {
    if (codeFromUrl && !didAutoVerifyFromUrlRef.current) setVerifyCode(codeFromUrl);
  }, [codeFromUrl]);

  useEffect(() => {
    if (!codeFromUrl || verifyCode !== codeFromUrl || didAutoVerifyFromUrlRef.current || linking) return;
    let cancelled = false;
    didAutoVerifyFromUrlRef.current = true;
    getIdToken()
      .then((token) => {
        if (!token || cancelled) return null;
        return verifyFamilyCode(verifyCode, token);
      })
      .then((result) => {
        if (cancelled || !result) return;
        toast({ title: "Linked!", description: `Connected to ${result.parent_name || "family member"}` });
        setVerifyCode("");
        navigate("/family", { replace: true });
      })
      .catch(() => {
        didAutoVerifyFromUrlRef.current = false;
      });
    return () => { cancelled = true; };
  }, [codeFromUrl, verifyCode, linking, getIdToken, navigate]);

  const handleGenerateCode = async () => {
    setGenerating(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Not authenticated");
      const result = await generateFamilyCode(token);
      setLinkCode(result.code);
      toast({ title: "Link Code Generated", description: `Share code: ${result.code}` });
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: String(err) });
    } finally {
      setGenerating(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!verifyCode.trim()) return;
    setLinking(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Not authenticated");
      const result = await verifyFamilyCode(verifyCode.trim(), token);
      toast({ title: "Linked!", description: `Connected to ${result.parent_name || "family member"}` });
      setVerifyCode("");
    } catch (err) {
      toast({ variant: "destructive", title: "Invalid Code", description: String(err) });
    } finally {
      setLinking(false);
    }
  };

  const copyCode = () => {
    if (linkCode) {
      navigator.clipboard.writeText(linkCode);
      toast({ title: "Copied", description: "Link code copied to clipboard" });
    }
  };

  const copyDashboardLink = () => {
    if (linkCode && typeof window !== "undefined") {
      const url = `${window.location.origin}/login?redirect=family&code=${linkCode}`;
      navigator.clipboard.writeText(url);
      toast({ title: "Dashboard link copied", description: "Share it with your family member." });
    }
  };

  return (
    <AppLayout>
      <div className="mb-12">
        <h1 className="font-display text-5xl font-bold tracking-tight lg:text-7xl">
          Family
          <br />
          <em className="text-primary">Dashboard</em>
        </h1>
        <div className="rule-thick mt-6 mb-8 max-w-32" />
        <p className="max-w-lg text-lg text-muted-foreground">
          Monitor your family members' health and medication adherence
        </p>
      </div>

      {/* Family Link Section */}
      <div className="mb-8 rounded-lg border border-primary/30 bg-primary/5 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Link2 size={18} className="text-primary" />
          <h2 className="font-display text-lg font-bold">Family Linking</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="mb-3 text-sm text-muted-foreground">
              Generate a code to share with your caregiver:
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleGenerateCode}
                disabled={generating}
                className="rounded-md bg-primary px-4 py-2 font-mono text-xs uppercase tracking-widest text-primary-foreground disabled:opacity-50"
              >
                {generating ? <Loader2 size={14} className="animate-spin" /> : "Generate Code"}
              </button>
              {linkCode && (
                <>
                  <div className="flex items-center gap-2 rounded-md border border-primary bg-card px-4 py-2">
                    <span className="font-mono text-lg font-bold tracking-[0.3em] text-primary">{linkCode}</span>
                    <button onClick={copyCode} className="text-muted-foreground hover:text-primary">
                      <Copy size={14} />
                    </button>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    Share dashboard link (family signs in and lands here):
                  </p>
                  <button
                    type="button"
                    onClick={copyDashboardLink}
                    className="mt-1 flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-secondary"
                  >
                    <Copy size={14} />
                    Copy dashboard link
                  </button>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm text-muted-foreground">
              Or enter a code to link to a family member:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.toUpperCase())}
                placeholder="ENTER CODE"
                maxLength={5}
                className="w-40 rounded-md border border-border bg-background px-3 py-2 font-mono text-center text-lg uppercase tracking-[0.3em] focus:border-primary focus:outline-none"
              />
              <button
                onClick={handleVerifyCode}
                disabled={linking || !verifyCode.trim()}
                className="rounded-md bg-primary px-4 py-2 font-mono text-xs uppercase tracking-widest text-primary-foreground disabled:opacity-50"
              >
                {linking ? <Loader2 size={14} className="animate-spin" /> : "Link"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CGM Glucose Monitor */}
      <div className="mb-8">
        <CGMCard token={authToken} compact />
      </div>

      {/* Family members */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {familyMembers.map((member, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-6">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary font-mono text-sm font-bold text-primary-foreground">
                  {member.name.split(" ").map((n) => n[0]).join("")}
                </div>
                <div>
                  <p className="font-display text-lg font-semibold">{member.name}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {member.relation} \u00B7 {member.lastActive}
                  </p>
                </div>
              </div>
              <button className="flex h-10 w-10 items-center justify-center rounded-full border border-border transition-colors hover:bg-secondary">
                <Phone size={16} strokeWidth={1.5} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md bg-secondary p-3 text-center">
                <Pill size={16} strokeWidth={1.5} className="mx-auto mb-1 text-primary" />
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Adherence</p>
                <p className={`font-display text-xl font-bold ${member.adherence >= 90 ? "text-success" : "text-accent"}`}>
                  {member.adherence}%
                </p>
              </div>
              <div className="rounded-md bg-secondary p-3 text-center">
                <Activity size={16} strokeWidth={1.5} className="mx-auto mb-1 text-info" />
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Vitals</p>
                <p className="font-display text-xl font-bold">4/4</p>
              </div>
              <div className="rounded-md bg-secondary p-3 text-center">
                {member.status === "good" ? (
                  <CheckCircle2 size={16} strokeWidth={1.5} className="mx-auto mb-1 text-success" />
                ) : (
                  <AlertTriangle size={16} strokeWidth={1.5} className="mx-auto mb-1 text-accent" />
                )}
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Status</p>
                <p className={`font-mono text-sm font-semibold uppercase ${member.status === "good" ? "text-success" : "text-accent"}`}>
                  {member.status}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Weekly adherence */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold tracking-tight">Weekly Adherence</h2>
            <TrendingUp size={18} strokeWidth={1.5} className="text-primary" />
          </div>
          <div className="flex items-end gap-3">
            {adherenceData.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex w-full gap-1">
                  <div className="flex-1 rounded-t bg-primary" style={{ height: `${d.amma * 0.8}px` }} />
                  <div className="flex-1 rounded-t bg-info" style={{ height: `${d.baba * 0.8}px` }} />
                </div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{d.day}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-6">
            <div className="flex items-center gap-2 font-mono text-xs">
              <div className="h-2 w-2 rounded-full bg-primary" />
              Amma
            </div>
            <div className="flex items-center gap-2 font-mono text-xs">
              <div className="h-2 w-2 rounded-full bg-info" />
              Baba
            </div>
          </div>
        </div>

        {/* Alerts */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-6 font-display text-2xl font-bold tracking-tight">Recent Alerts</h2>
          <div className="space-y-4">
            {alerts.map((alert, i) => (
              <div
                key={i}
                className={`rounded-md border-l-4 p-4 ${
                  alert.type === "missed"
                    ? "border-destructive bg-destructive/5"
                    : "border-accent bg-accent/5"
                }`}
              >
                <div className="flex items-start gap-3">
                  {alert.type === "missed" ? (
                    <XCircle size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-destructive" />
                  ) : (
                    <AlertTriangle size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
                  )}
                  <div>
                    <p className="text-sm font-semibold">{alert.member}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{alert.message}</p>
                    <p className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{alert.time}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Safety Alert History */}
      <div className="mt-8 rounded-lg border border-border bg-card p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} strokeWidth={1.5} className="text-primary" />
            <h2 className="font-display text-2xl font-bold tracking-tight">Safety Alert History</h2>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Audit Trail
          </span>
        </div>

        {safetyLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={24} className="animate-spin text-muted-foreground" />
          </div>
        ) : safetyAlerts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No safety alerts recorded yet. Alerts are logged automatically when Heali detects health concerns.
          </p>
        ) : (
          <div className="space-y-3">
            {safetyAlerts.map((alert, i) => {
              const config = TIER_CONFIG[alert.alert_tier] || TIER_CONFIG.green;
              const TierIcon = config.icon;
              const time = new Date(alert.timestamp).toLocaleString();
              return (
                <div
                  key={i}
                  className={`rounded-md border-l-4 ${config.border} ${config.bg} p-4`}
                >
                  <div className="flex items-start gap-3">
                    <TierIcon size={18} strokeWidth={1.5} className={`mt-0.5 shrink-0 ${config.text}`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest ${config.badge}`}>
                          {config.label}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          {alert.trigger_source?.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="text-sm font-semibold">{alert.symptoms}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        Action: {alert.action_taken?.replace(/_/g, " ")}
                      </p>
                      {alert.human_notified && alert.human_notified.length > 0 && (
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          Notified: {alert.human_notified.join(", ")}
                        </p>
                      )}
                      <p className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        {time}
                      </p>
                    </div>
                    {alert.resolution ? (
                      <CheckCircle2 size={16} className="shrink-0 text-success" />
                    ) : (
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Open
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default FamilyDashboard;
