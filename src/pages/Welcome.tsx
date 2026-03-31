import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Mic,
  LayoutDashboard,
  Pill,
  Camera,
  Dumbbell,
  FileText,
  CalendarCheck,
  Users,
  User,
  ArrowRight,
  Heart,
  Languages,
} from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { getProfile } from "@/lib/api";

const FEATURES = [
  { to: "/voice", icon: Mic, label: "Voice Guardian", description: "Talk to your AI health companion", primary: true },
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", description: "Health overview & today's summary" },
  { to: "/translator", icon: Languages, label: "Translator", description: "Real-time voice translation with your doctor or family" },
  { to: "/pills", icon: Pill, label: "Pill Check", description: "Verify medications with your camera" },
  { to: "/food", icon: Camera, label: "Food Log", description: "Log meals and track nutrition" },
  { to: "/exercise", icon: Dumbbell, label: "Exercise", description: "Guided workouts & breathing" },
  { to: "/prescriptions", icon: FileText, label: "Reports & Rx", description: "Prescriptions and lab reports" },
  { to: "/booking", icon: CalendarCheck, label: "Book Doctor", description: "Find and book appointments" },
  { to: "/family", icon: Users, label: "Family", description: "Share health with caregivers" },
  { to: "/profile", icon: User, label: "Profile", description: "Settings and preferences" },
];

const Welcome = () => {
  const navigate = useNavigate();
  const { user, getIdToken } = useAuth();
  const [profileName, setProfileName] = useState<string | null>(null);

  // Fetch Firestore profile name so it matches the Profile page
  useEffect(() => {
    getIdToken().then((token) => {
      if (!token) return;
      getProfile(token)
        .then((p) => {
          const profile = p as { name?: string; display_name?: string } | null;
          const name = profile?.name || profile?.display_name || null;
          if (name) setProfileName(name);
        })
        .catch(() => {/* silently ignore */});
    });
  }, [getIdToken]);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  };

  // Priority: Firestore profile name → Firebase Auth displayName → email prefix
  const displayName = profileName || user?.displayName || user?.email?.split("@")[0] || "there";

  return (
    <AppLayout>
      <div className="mb-12">
        <h1 className="font-display text-5xl font-bold tracking-tight text-foreground lg:text-7xl">
          {greeting()},
          <br />
          <em className="text-primary">{displayName}</em>
        </h1>
        <div className="rule-thick mt-6 mb-8 max-w-32" />
        <h2 className="font-display text-2xl font-bold tracking-tight text-foreground lg:text-3xl">
          Hello! I'm Heali, your AI Health Bestie.
        </h2>
        <p className="mt-4 max-w-lg text-lg text-muted-foreground">
          I'm here to help you stay healthy and connected. What can we do together today? Just speak to me naturally, or select a quick action below.
        </p>
      </div>

      {/* Voice Guardian — primary CTA */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        onClick={() => navigate("/voice")}
        className="group relative mb-12 overflow-hidden rounded-xl border-2 border-primary/40 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-8 transition-all duration-200 hover:border-primary hover:shadow-lg hover:shadow-primary/20 cursor-pointer"
      >
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
              <Mic size={36} strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Voice Guardian
              </h2>
              <p className="mt-1 text-muted-foreground">
                Speak naturally in your language — medication reminders, pill verification, food logging, and more.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 font-medium text-primary group-hover:gap-3 transition-all">
            <span>Start conversation</span>
            <ArrowRight size={20} strokeWidth={1.5} />
          </div>
        </div>
      </motion.div>

      {/* Feature blocks */}
      <div className="mb-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.filter((f) => !f.primary).map(({ to, icon: Icon, label, description, state: featureState }, i) => (
            <motion.button
              key={to}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.05 * i }}
              onClick={() => navigate(to, featureState ? { state: featureState } : undefined)}
              className="group flex items-start gap-4 rounded-lg border border-border bg-card p-5 text-left transition-all duration-150 hover:border-primary/50 hover:bg-primary/5 hover:shadow-md"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                <Icon size={22} strokeWidth={1.5} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">{label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
              </div>
              <ArrowRight
                size={16}
                strokeWidth={1.5}
                className="shrink-0 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all"
              />
            </motion.button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Heart size={14} strokeWidth={1.5} className="text-primary" />
        <span>Use the menu on the left to navigate anytime.</span>
      </div>
    </AppLayout>
  );
};

export default Welcome;
