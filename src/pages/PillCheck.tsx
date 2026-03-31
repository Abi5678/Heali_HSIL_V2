import { useState, useRef, useCallback, useEffect } from "react";
import { Camera, CameraOff, CheckCircle2, XCircle, Upload, Loader2 } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { scanDocument } from "@/lib/api";
import { useUIEvent } from "@/hooks/useUIEventStore";
import { toast } from "@/hooks/use-toast";

interface PillHistoryEntry {
  name: string;
  time: string;
  result: "correct" | "warning";
  confidence: string;
}

const FALLBACK_HISTORY: PillHistoryEntry[] = [
  { name: "Metformin 500mg", time: "Today 8:02 AM", result: "correct", confidence: "98%" },
  { name: "Lisinopril 10mg", time: "Today 8:02 AM", result: "correct", confidence: "95%" },
  { name: "Unknown white tablet", time: "Yesterday 9:15 PM", result: "warning", confidence: "62%" },
];

const PillCheck = () => {
  const { getIdToken } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [pillHistory, setPillHistory] = useState<PillHistoryEntry[]>(FALLBACK_HISTORY);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Set srcObject after video element mounts (scanning state flip → video renders)
  useEffect(() => {
    if (scanning && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [scanning]);

  // Listen for pill_verified events from the voice agent
  const pillEvent = useUIEvent("pill_verified");
  useEffect(() => {
    if (pillEvent) {
      const data = (pillEvent.data ?? pillEvent) as Record<string, unknown>;
      const entry: PillHistoryEntry = {
        name: String(data.medication_name || "Identified pill"),
        time: `Today ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
        result: data.verified ? "correct" : "warning",
        confidence: data.confidence ? `${data.confidence}%` : "—",
      };
      setPillHistory((prev) => [entry, ...prev]);
    }
  }, [pillEvent]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 640, height: 480 },
      });
      streamRef.current = stream;
      setScanning(true); // video element mounts → useEffect sets srcObject
    } catch {
      toast({ variant: "destructive", title: "Camera", description: "Camera access denied" });
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  const captureAndAnalyze = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    canvas.width = 640;
    canvas.height = 480;
    ctx.drawImage(videoRef.current, 0, 0, 640, 480);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    const base64 = dataUrl.split(",")[1];

    setAnalyzing(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("No auth token");
      const result = await scanDocument(base64, "pill", token) as {
        verified: boolean;
        pill_name: string;
        matched_medications: string[];
        confidence: string;
        message: string;
      };
      const entry = {
        name: result.pill_name || "Unknown pill",
        time: `Today ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
        result: result.verified ? ("correct" as const) : ("warning" as const),
        confidence: result.confidence || "—",
      };
      setPillHistory((prev) => [entry, ...prev]);
      toast({
        title: result.verified ? "Pill Verified ✓" : "⚠️ Pill Mismatch",
        description: result.message,
        variant: result.verified ? "default" : "destructive",
      });
    } catch (err) {
      toast({ variant: "destructive", title: "Scan Failed", description: String(err) });
    } finally {
      setAnalyzing(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    return () => { stopCamera(); };
  }, [stopCamera]);

  return (
    <AppLayout>
      <div className="mb-12">
        <h1 className="font-display text-5xl font-bold tracking-tight lg:text-7xl">
          Pill
          <br />
          <em className="text-primary">Verification</em>
        </h1>
        <div className="rule-thick mt-6 mb-8 max-w-32" />
        <p className="max-w-lg text-lg text-muted-foreground">
          Point your camera at pills to verify medication, dose, and timing
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Scanner */}
        <div className="flex flex-col items-center rounded-lg border border-border bg-card p-8">
          <div className="relative mb-8 flex h-64 w-full items-center justify-center overflow-hidden rounded-md border-2 border-dashed border-primary/30 bg-primary/5">
            {scanning ? (
              <>
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                {analyzing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <Loader2 size={32} className="animate-spin text-white" />
                  </div>
                )}
              </>
            ) : (
              <div className="text-center">
                <Camera size={40} strokeWidth={1} className="mx-auto mb-3 text-muted-foreground" />
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Position pills in frame
                </p>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />

          <div className="flex gap-3">
            <button
              onClick={scanning ? stopCamera : startCamera}
              className="flex items-center gap-2 rounded-md bg-primary px-8 py-3 font-mono text-sm uppercase tracking-widest text-primary-foreground shadow-md transition-all hover:shadow-lg"
            >
              {scanning ? <CameraOff size={16} strokeWidth={1.5} /> : <Camera size={16} strokeWidth={1.5} />}
              {scanning ? "Stop" : "Start"}
            </button>
            {scanning && (
              <button
                onClick={captureAndAnalyze}
                disabled={analyzing}
                className="flex items-center gap-2 rounded-md border-2 border-primary px-6 py-3 font-mono text-sm uppercase tracking-widest text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
              >
                <Upload size={16} strokeWidth={1.5} />
                {analyzing ? "Analyzing..." : "Verify"}
              </button>
            )}
          </div>
        </div>

        {/* History */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-6 font-display text-xl font-bold tracking-tight">Verification History</h2>
          <div className="space-y-3">
            {pillHistory.map((pill, i) => (
              <div
                key={`${pill.name}-${i}`}
                className={`flex items-center justify-between rounded-md border p-4 transition-colors ${
                  pill.result === "correct"
                    ? "border-success/30 bg-success/5 hover:border-success/50"
                    : "border-accent/30 bg-accent/5 hover:border-accent/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  {pill.result === "correct" ? (
                    <CheckCircle2 size={18} strokeWidth={1.5} className="text-success" />
                  ) : (
                    <XCircle size={18} strokeWidth={1.5} className="text-accent" />
                  )}
                  <div>
                    <p className="text-sm font-semibold">{pill.name}</p>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{pill.time}</p>
                  </div>
                </div>
                <span className="rounded-full bg-secondary px-2 py-1 font-mono text-xs">{pill.confidence}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default PillCheck;
