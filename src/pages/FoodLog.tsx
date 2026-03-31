import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Camera, CameraOff, Upload, Apple, Loader2, Trash2, Mic } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { analyzeFood, getFoodLogs, logFood, deleteFoodLog } from "@/lib/api";
import { useUIEvent } from "@/hooks/useUIEventStore";
import { toast } from "@/hooks/use-toast";

interface MealEntry {
  id?: string;
  meal: string;
  time: string;
  items: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

const FoodLog = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [foodLogEntries, setFoodLogEntries] = useState<MealEntry[]>([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Set srcObject after video element mounts (cameraActive flip → video renders)
  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [cameraActive]);

  // Load persisted food logs on mount (today only)
  const todayDate = new Date().toISOString().slice(0, 10);
  useEffect(() => {
    if (!user?.uid) return;
    getFoodLogs(user.uid, todayDate)
      .then(({ logs }) => {
        if (logs?.length) {
          setFoodLogEntries(
            logs.map((m) => ({
              id: m.id,
              meal: m.meal_type || "Meal",
              time: m.timestamp
                ? new Date(m.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                : "",
              items: m.description || m.food_items?.join(", ") || "",
              calories: m.calories ?? 0,
              protein: m.protein_g ?? 0,
              carbs: m.carbs_g ?? 0,
              fat: m.fat_g ?? 0,
            }))
          );
        }
      })
      .catch(() => {});
  }, [user?.uid]);

  // Listen for meal_logged events from the voice agent
  const mealEvent = useUIEvent("meal_logged");
  useEffect(() => {
    if (mealEvent) {
      const data = (mealEvent.data ?? mealEvent) as Record<string, unknown>;
      setFoodLogEntries((prev) => [
        {
          meal: String(data.meal_type || "Meal"),
          time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          items: String(data.description || "Logged via voice"),
          calories: Number(data.calories || 0),
          protein: Number(data.protein_g || 0),
          carbs: Number(data.carbs_g || 0),
          fat: Number(data.fat_g || 0),
        },
        ...prev,
      ]);
    }
  }, [mealEvent]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 640, height: 480 },
      });
      streamRef.current = stream;
      setCameraActive(true); // video element mounts → useEffect sets srcObject
    } catch {
      toast({ variant: "destructive", title: "Camera", description: "Camera access denied" });
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
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
      const result = await analyzeFood(base64);
      const entry: MealEntry = {
        meal: "Snack",
        time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        items: result.food_items.join(", "),
        calories: result.calories,
        protein: result.protein_g,
        carbs: result.carbs_g,
        fat: result.fat_g,
      };
      setFoodLogEntries((prev) => [entry, ...prev]);

      // Also log to backend
      if (user?.uid) {
        logFood({
          uid: user.uid,
          food_items: result.food_items,
          calories: result.calories,
          protein_g: result.protein_g,
          carbs_g: result.carbs_g,
          fat_g: result.fat_g,
          meal_type: "snack",
          description: result.food_items.join(", "),
        }).catch(() => {});
      }

      toast({ title: "Food Analyzed", description: `${result.food_items.join(", ")} \u2014 ${result.calories} kcal` });
      stopCamera();
    } catch (err) {
      toast({ variant: "destructive", title: "Analysis Failed", description: String(err) });
    } finally {
      setAnalyzing(false);
    }
  }, [user]);

  useEffect(() => {
    return () => { stopCamera(); };
  }, [stopCamera]);

  const handleDelete = useCallback(async (id: string | undefined, index: number) => {
    if (id && user?.uid) {
      try {
        await deleteFoodLog(user.uid, id);
      } catch {
        toast({ variant: "destructive", title: "Delete failed", description: "Could not remove entry" });
        return;
      }
    }
    setFoodLogEntries((prev) => prev.filter((_, i) => i !== index));
    toast({ title: "Entry removed" });
  }, [user?.uid]);

  // Compute macro totals
  const totalCal = foodLogEntries.reduce((s, m) => s + m.calories, 0);
  const totalProtein = foodLogEntries.reduce((s, m) => s + m.protein, 0);
  const totalCarbs = foodLogEntries.reduce((s, m) => s + m.carbs, 0);
  const totalFat = foodLogEntries.reduce((s, m) => s + m.fat, 0);

  const handleDiscussWithVoiceAgent = () => {
    const mealSummary = foodLogEntries.length > 0
      ? foodLogEntries.map(m => `${m.meal} (${m.calories} kcal, ${m.protein}g protein, ${m.carbs}g carbs, ${m.fat}g fat): ${m.items}`).join("; ")
      : "No meals logged yet today.";

    const prompt =
      `[SYSTEM (CRITICAL): The user is viewing their Food Log for today. Do NOT use the navigate_to_page tool. ` +
      `Today's meals: ${mealSummary} ` +
      `Daily totals: ${totalCal} kcal / ${totalProtein}g protein / ${totalCarbs}g carbs / ${totalFat}g fat. ` +
      `Targets: 1600 kcal, 65g protein, 200g carbs, 55g fat. ` +
      `You must proactively greet the user, briefly summarize their food intake for today, note any nutritional gaps or achievements, and ask if they have any questions about their diet. Do NOT attempt to navigate away.]`;

    navigate("/voice", { state: { proactivePrompt: prompt } });
  };

  const macros = [
    { label: "Calories", current: totalCal, target: 1600, unit: "kcal", color: "bg-primary" },
    { label: "Protein", current: totalProtein, target: 65, unit: "g", color: "bg-success" },
    { label: "Carbs", current: totalCarbs, target: 200, unit: "g", color: "bg-accent" },
    { label: "Fat", current: totalFat, target: 55, unit: "g", color: "bg-info" },
  ];

  return (
    <AppLayout>
      <div className="mb-12">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-5xl font-bold tracking-tight lg:text-7xl">
            Food
            <br />
            <em className="text-accent">Log</em>
          </h1>
          <button
            onClick={handleDiscussWithVoiceAgent}
            className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/10"
          >
            <Mic size={14} />
            Discuss Food with Guardian
          </button>
        </div>
        <div className="rule-accent mt-6 mb-8 max-w-32" />
        <p className="max-w-lg text-lg text-muted-foreground">
          Snap a photo of your meal for instant macro analysis
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Camera */}
        <div className="flex flex-col items-center rounded-lg border border-border bg-card p-8">
          <div className="relative mb-6 flex h-48 w-full items-center justify-center overflow-hidden rounded-md border-2 border-dashed border-accent/30 bg-accent/5">
            {cameraActive ? (
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
                <Camera size={36} strokeWidth={1} className="mx-auto mb-3 text-muted-foreground" />
                <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Take a photo</p>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <div className="flex gap-3">
            <button
              onClick={cameraActive ? stopCamera : startCamera}
              className="flex items-center gap-2 rounded-md bg-accent px-6 py-3 font-mono text-xs uppercase tracking-widest text-accent-foreground shadow-md transition-all hover:shadow-lg"
            >
              {cameraActive ? <CameraOff size={14} strokeWidth={1.5} /> : <Camera size={14} strokeWidth={1.5} />}
              {cameraActive ? "Stop" : "Capture"}
            </button>
            {cameraActive && (
              <button
                onClick={captureAndAnalyze}
                disabled={analyzing}
                className="flex items-center gap-2 rounded-md border-2 border-accent px-4 py-3 font-mono text-xs uppercase tracking-widest text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
              >
                <Upload size={14} strokeWidth={1.5} />
                {analyzing ? "Analyzing..." : "Analyze"}
              </button>
            )}
          </div>
        </div>

        {/* Daily summary */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-6 font-display text-xl font-bold tracking-tight">Daily Summary</h2>
          <div className="space-y-5">
            {macros.map((macro) => (
              <div key={macro.label}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-widest">{macro.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {macro.current}/{macro.target} {macro.unit}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-secondary">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (macro.current / macro.target) * 100)}%` }}
                    transition={{ duration: 0.6 }}
                    className={`h-full rounded-full ${macro.color}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Meal log */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-6 font-display text-xl font-bold tracking-tight">Today's Meals</h2>
          <div className="space-y-4">
            {foodLogEntries.map((meal, i) => (
              <div key={`${meal.meal}-${i}`} className="rounded-md border border-border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="rounded-full bg-accent/10 p-1.5 text-accent">
                      <Apple size={12} strokeWidth={1.5} />
                    </div>
                    <span className="text-sm font-semibold">{meal.meal}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{meal.time}</span>
                    <button
                      onClick={() => handleDelete(meal.id, i)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      title="Delete entry"
                    >
                      <Trash2 size={12} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
                <p className="mb-2 text-sm text-muted-foreground">{meal.items}</p>
                {meal.calories > 0 && (
                  <div className="flex gap-3 font-mono text-[10px] uppercase tracking-widest">
                    <span className="text-primary">{meal.calories} cal</span>
                    <span className="text-success">{meal.protein}g P</span>
                    <span className="text-accent">{meal.carbs}g C</span>
                    <span className="text-info">{meal.fat}g F</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default FoodLog;
