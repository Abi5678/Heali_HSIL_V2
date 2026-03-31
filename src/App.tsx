import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { getOnboardingState, saveOnboardingState } from "@/lib/personas";
import { getProfile } from "@/lib/api";
import Welcome from "./pages/Welcome";
import Dashboard from "./pages/Dashboard";
import VoiceGuardian from "./pages/VoiceGuardian";
import PillCheck from "./pages/PillCheck";
import FoodLog from "./pages/FoodLog";
import Exercise from "./pages/Exercise";
import Prescriptions from "./pages/Prescriptions";
import DoctorBooking from "./pages/DoctorBooking";
import FamilyDashboard from "./pages/FamilyDashboard";
import Profile from "./pages/Profile";
import Onboarding from "./pages/Onboarding";
import Login from "./pages/Login";
import Reminders from "./pages/Reminders";
import Translator from "./pages/Translator";
import ClinicalBrief from "./pages/ClinicalBrief";
import DoctorDashboard from "./pages/DoctorDashboard";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireOnboarding({ children }: { children: React.ReactNode }) {
  const { completed } = getOnboardingState();
  const location = useLocation();
  const { getIdToken } = useAuth();
  // Only bypass the onboarding check for /voice when the user explicitly chose
  // "Do it with the Onboarding Specialist" (Onboarding.tsx sets this state).
  const fromOnboardingAgent = (location.state as Record<string, unknown> | null)?.fromOnboardingAgentChoice === true;
  const [apiChecked, setApiChecked] = useState(false);
  const [syncedComplete, setSyncedComplete] = useState(false);
  const effectiveCompleted = completed || syncedComplete;

  // When localStorage says not completed, optionally sync from backend (handles agent-completed onboarding in a previous session)
  useEffect(() => {
    if (completed || syncedComplete || location.pathname === "/family") return;
    if (location.pathname === "/voice" && fromOnboardingAgent) return;
    if (apiChecked) return;
    let cancelled = false;
    getIdToken()
      .then((token) => {
        if (!token || cancelled) return;
        return getProfile(token);
      })
      .then((profile) => {
        if (cancelled) return;
        const p = profile as Record<string, unknown> | null;
        if (p?.onboarding_complete) {
          saveOnboardingState({ ...getOnboardingState(), completed: true });
          setSyncedComplete(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setApiChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [completed, syncedComplete, location.pathname, fromOnboardingAgent, apiChecked, getIdToken]);

  // Allow /family always (family members skip onboarding).
  // Allow /voice only when accessed via the "Do it with Onboarding Specialist" button.
  const voiceBypassAllowed = location.pathname === "/voice" && fromOnboardingAgent;
  if (!effectiveCompleted && location.pathname !== "/family" && !voiceBypassAllowed) {
    if (!apiChecked) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      );
    }
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <RequireOnboarding>{children}</RequireOnboarding>
    </RequireAuth>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
            <Route path="/" element={<ProtectedRoute><Welcome /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/voice" element={<ProtectedRoute><VoiceGuardian /></ProtectedRoute>} />
            <Route path="/pills" element={<ProtectedRoute><PillCheck /></ProtectedRoute>} />
            <Route path="/food" element={<ProtectedRoute><FoodLog /></ProtectedRoute>} />
            <Route path="/exercise" element={<ProtectedRoute><Exercise /></ProtectedRoute>} />
            <Route path="/prescriptions" element={<ProtectedRoute><Prescriptions /></ProtectedRoute>} />
            <Route path="/booking" element={<ProtectedRoute><DoctorBooking /></ProtectedRoute>} />
            <Route path="/family" element={<ProtectedRoute><FamilyDashboard /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/reminders" element={<ProtectedRoute><Reminders /></ProtectedRoute>} />
            <Route path="/translator" element={<ProtectedRoute><Translator /></ProtectedRoute>} />
            <Route path="/clinical-brief" element={<ProtectedRoute><ClinicalBrief /></ProtectedRoute>} />
            <Route path="/doctor" element={<ProtectedRoute><DoctorDashboard /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
