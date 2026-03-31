import { useRef, useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Camera,
  Upload,
  Sparkles,
  Lightbulb,
  AlertTriangle,
  Loader2,
  FileText,
  FlaskConical,
  X,
  Mic,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { scanDocument, getScanHistory } from "@/lib/api";

type ScanType = "prescription" | "report";
type Phase = "idle" | "camera" | "scanning" | "result";

interface ScanResult {
  scan_type: string;
  summary?: string;
  insights?: string[];
  // prescription fields
  medications?: { name: string; dosage: string; frequency: string; route: string; drug_class?: string }[];
  doctor_name?: string;
  date?: string;
  drug_interactions?: { drug1: string; drug2: string; description: string; severity: string }[];
  // report fields
  tests?: { name: string; value: string; unit: string; reference_range: string; status: string }[];
  lab_name?: string;
}

const statusColor = (s: string) => {
  if (s === "normal") return "bg-success/10 text-success";
  if (s === "high") return "bg-destructive/10 text-destructive";
  if (s === "low") return "bg-amber-500/10 text-amber-600";
  return "bg-secondary text-muted-foreground";
};

const Prescriptions = () => {
  const [scanType, setScanType] = useState<ScanType>("prescription");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<ScanResult[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  const navigate = useNavigate();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { user, getIdToken } = useAuth();

  // ── helpers ──────────────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Load persisted scan history on mount
  useEffect(() => {
    if (!user?.uid) return;
    getIdToken().then((token) => {
      if (!token) return;
      getScanHistory(user.uid, token)
        .then(({ prescriptions, reports }) => {
          const all = [
            ...prescriptions.map((p) => ({ ...p, scan_type: "prescription" } as ScanResult)),
            ...reports.map((r) => ({ ...r, scan_type: "report" } as ScanResult)),
          ].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
          setHistory(all);
        })
        .catch(() => {});
    });
  }, [user?.uid, getIdToken]);

  const runScan = useCallback(
    async (base64: string) => {
      setPhase("scanning");
      setErrorMsg("");
      try {
        const token = await getIdToken();
        const data = (await scanDocument(base64, scanType, token || "demo")) as ScanResult;
        setResult(data);
        setHistory((prev) => [data, ...prev]);
        setPhase("result");
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Scan failed");
        setPhase("idle");
      }
    },
    [scanType, getIdToken],
  );

  // ── camera capture ────────────────────────────────────────────────────────

  const handleScan = useCallback(async () => {
    if (phase === "camera") {
      // Capture current frame
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
      stopCamera();
      await runScan(base64);
      return;
    }

    // Open camera
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setPhase("camera");
      setResult(null);
      setErrorMsg("");
    } catch {
      setErrorMsg("Camera access denied. Use Upload instead.");
    }
  }, [phase, stopCamera, runScan]);

  const handleCancelCamera = useCallback(() => {
    stopCamera();
    setPhase("idle");
  }, [stopCamera]);

  // ── file upload ───────────────────────────────────────────────────────────

  const handleUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const dataUrl = ev.target?.result as string;
        const base64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
        setResult(null);
        setErrorMsg("");
        await runScan(base64);
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [runScan],
  );

  const handleDiscussWithVoiceAgent = () => {
    if (!result) return;

    let prompt = `[SYSTEM (CRITICAL): The user has ALREADY scanned a medical document (${result.scan_type}) and is currently viewing the results. Do NOT use the navigate_to_page tool. `;
    prompt += `Summary: ${result.summary} `;
    if (result.insights && result.insights.length > 0) {
      prompt += `Key Insights: ${result.insights.join("; ")} `;
    }

    if (result.scan_type === "prescription" && result.medications) {
      const meds = result.medications.map(m => `${m.name} (${m.dosage}, ${m.frequency})`).join(", ");
      prompt += `Medications found: ${meds}. `;
      if (result.drug_interactions && result.drug_interactions.length > 0) {
        prompt += `WARNING: There are potential drug interactions identified in the results that you should warn the user about. `;
      }
    } else if (result.scan_type === "report" && result.tests) {
      const abnormal = result.tests.filter(t => t.status === "high" || t.status === "low");
      if (abnormal.length > 0) {
        const abList = abnormal.map(t => `${t.name} is ${t.status} (${t.value} ${t.unit})`).join(", ");
        prompt += `Abnormal tests found: ${abList}. `;
      }
    }

    prompt += `You must proactively greet the user, briefly summarize the results aloud, and ask if they have any questions about this document. Do NOT attempt to navigate away.]`;

    navigate("/voice", { state: { proactivePrompt: prompt } });
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <AppLayout>
      {/* Header */}
      <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-5xl font-bold tracking-tight lg:text-7xl">
            Reports &amp;
            <br />
            <em className="text-primary">Prescriptions</em>
          </h1>
          <div className="rule-thick mt-6 mb-4 max-w-32" />
          <p className="max-w-lg text-lg text-muted-foreground">
            Scan or upload documents — AI extracts details and gives you actionable insights.
          </p>
        </div>

        {/* Type tabs */}
        <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
          <button
            onClick={() => { setScanType("prescription"); setResult(null); setPhase("idle"); stopCamera(); }}
            className={`flex items-center gap-2 px-5 py-2.5 font-mono text-xs uppercase tracking-widest transition-colors ${scanType === "prescription"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary"
              }`}
          >
            <FileText size={13} strokeWidth={1.5} />
            Prescription
          </button>
          <button
            onClick={() => { setScanType("report"); setResult(null); setPhase("idle"); stopCamera(); }}
            className={`flex items-center gap-2 px-5 py-2.5 font-mono text-xs uppercase tracking-widest transition-colors ${scanType === "report"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary"
              }`}
          >
            <FlaskConical size={13} strokeWidth={1.5} />
            Lab Report
          </button>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* LEFT — Scanner */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
          <h2 className="font-display text-lg font-bold tracking-tight">
            {phase === "camera" ? "Position document in frame" : "Upload or Scan"}
          </h2>

          {/* Camera preview / placeholder */}
          <div className="relative overflow-hidden rounded-md bg-secondary" style={{ aspectRatio: "4/3" }}>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full object-cover ${phase === "camera" ? "block" : "hidden"}`}
            />
            <canvas ref={canvasRef} className="hidden" />

            {phase !== "camera" && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
                {phase === "scanning" ? (
                  <>
                    <Loader2 size={36} strokeWidth={1} className="animate-spin text-primary" />
                    <p className="font-mono text-xs uppercase tracking-widest">Analyzing…</p>
                  </>
                ) : (
                  <>
                    <FileText size={40} strokeWidth={1} className="opacity-30" />
                    <p className="font-mono text-xs uppercase tracking-widest opacity-50">
                      {result ? "Scan complete" : "No document loaded"}
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Cancel overlay when camera is active */}
            {phase === "camera" && (
              <button
                onClick={handleCancelCamera}
                className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Error */}
          {errorMsg && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
              {errorMsg}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleScan}
              disabled={phase === "scanning"}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 font-mono text-xs uppercase tracking-widest text-primary-foreground shadow-md transition-all hover:shadow-lg disabled:opacity-50"
            >
              <Camera size={14} strokeWidth={1.5} />
              {phase === "camera" ? "Capture" : "Scan"}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={phase === "scanning" || phase === "camera"}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border-2 border-border px-4 py-3 font-mono text-xs uppercase tracking-widest transition-colors hover:bg-secondary disabled:opacity-50"
            >
              <Upload size={14} strokeWidth={1.5} />
              Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUpload}
            />
          </div>
        </div>

        {/* RIGHT — Results */}
        <div className="flex flex-col gap-4">
          {!result && (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card text-center">
              <Sparkles size={36} strokeWidth={1} className="mb-3 text-muted-foreground/40" />
              <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground/50">
                {phase === "scanning" ? "AI is reading your document…" : "Results will appear here"}
              </p>
            </div>
          )}

          {result && (
            <>
              {/* AI Summary */}
              {result.summary && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles size={15} strokeWidth={1.5} className="text-emerald-600" />
                    <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-700">
                      AI Summary
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-foreground">{result.summary}</p>
                </div>
              )}

              {/* Key Insights */}
              {result.insights && result.insights.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <Lightbulb size={15} strokeWidth={1.5} className="text-amber-600" />
                    <span className="font-mono text-[10px] uppercase tracking-widest text-amber-700">
                      Key Insights
                    </span>
                  </div>
                  <ul className="space-y-2">
                    {result.insights.map((ins, i) => (
                      <li key={i} className="flex gap-2 text-sm leading-relaxed">
                        <span className="mt-1 shrink-0 text-amber-500">•</span>
                        <span>{ins}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Prescription: Medications table */}
              {result.scan_type === "prescription" && result.medications && result.medications.length > 0 && (
                <div className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="border-b border-border px-5 py-3">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Medications — {result.doctor_name || "Unknown doctor"} · {result.date || "No date"}
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/50">
                        <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Name</th>
                        <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Dosage</th>
                        <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Frequency</th>
                        <th className="hidden px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:table-cell">Class</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.medications.map((med, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-secondary/30">
                          <td className="px-4 py-3 font-medium">{med.name}</td>
                          <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{med.dosage}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{med.frequency}</td>
                          <td className="hidden px-4 py-3 font-mono text-xs text-muted-foreground sm:table-cell">
                            {med.drug_class || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Drug Interactions */}
              {result.drug_interactions &&
                result.drug_interactions.filter((ix) =>
                  ["moderate", "major", "high", "severe"].includes(ix.severity?.toLowerCase() ?? ""),
                ).length > 0 && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <AlertTriangle size={15} strokeWidth={1.5} className="text-destructive" />
                      <span className="font-mono text-[10px] uppercase tracking-widest text-destructive">
                        Drug Interactions
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {result.drug_interactions
                        .filter((ix) =>
                          ["moderate", "major", "high", "severe"].includes(ix.severity?.toLowerCase() ?? ""),
                        )
                        .map((ix, i) => (
                          <li key={i} className="text-sm">
                            <span className="font-medium">{ix.drug1} + {ix.drug2}:</span>{" "}
                            <span className="text-muted-foreground">{ix.description}</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

              {/* Lab Report: Tests table */}
              {result.scan_type === "report" && result.tests && result.tests.length > 0 && (
                <div className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="border-b border-border px-5 py-3">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Test Results — {result.lab_name || "Unknown lab"} · {result.date || "No date"}
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-secondary/50">
                        <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Test</th>
                        <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Value</th>
                        <th className="hidden px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:table-cell">Range</th>
                        <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.tests.map((t, i) => (
                        <tr
                          key={i}
                          className={`border-b border-border/50 last:border-0 ${t.status !== "normal" ? "bg-destructive/5" : "hover:bg-secondary/30"
                            }`}
                        >
                          <td className="px-4 py-3 font-medium">{t.name}</td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {t.value} {t.unit}
                          </td>
                          <td className="hidden px-4 py-3 font-mono text-xs text-muted-foreground sm:table-cell">
                            {t.reference_range || "—"}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${statusColor(t.status)}`}>
                              {t.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-border">
                <button
                  onClick={handleDiscussWithVoiceAgent}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-primary/10 text-primary border border-primary/20 px-4 py-4 font-mono text-sm uppercase tracking-widest transition-all hover:bg-primary/20 hover:shadow-md"
                >
                  <Mic size={18} strokeWidth={1.5} />
                  Discuss Results with Voice Guardian
                </button>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  The AI agent will read your results and answer your questions
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-4 font-display text-xl font-bold tracking-tight">Scan History</h2>
          <div className="space-y-3">
            {history.map((item, i) => {
              const isRx = item.scan_type === "prescription";
              const label = isRx
                ? `${item.medications?.length ?? 0} medication${item.medications?.length !== 1 ? "s" : ""} · ${item.doctor_name || "Unknown doctor"}`
                : `${item.tests?.length ?? 0} test${item.tests?.length !== 1 ? "s" : ""} · ${item.lab_name || "Unknown lab"}`;
              return (
                <div
                  key={i}
                  onClick={() => { setResult(item); setPhase("result"); }}
                  className="flex cursor-pointer items-center gap-4 rounded-lg border border-border bg-card px-5 py-4 transition-colors hover:border-primary/30"
                >
                  <div className="rounded-full bg-primary/10 p-2 text-primary">
                    {isRx ? <FileText size={16} strokeWidth={1.5} /> : <FlaskConical size={16} strokeWidth={1.5} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{isRx ? "Prescription" : "Lab Report"}</p>
                    <p className="truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {label}
                    </p>
                  </div>
                  {item.date && (
                    <span className="font-mono text-xs text-muted-foreground">{item.date}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AppLayout>
  );
};

export default Prescriptions;
