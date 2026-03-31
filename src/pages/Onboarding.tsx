import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, ArrowLeft, Loader2, Upload, Users } from "lucide-react";
import { useRef } from "react";
import { HEALI_VOICES, Persona, saveOnboardingState } from "@/lib/personas";
import { LANGUAGE_PERSONAS } from "@/lib/voiceConfig";
import { saveProfile, generateAvatar } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

type Step = "welcome" | "select" | "profile" | "custom";


const Onboarding = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>(() => {
    // If ?step=select is passed (e.g. from Profile "Reset Companion"), skip welcome
    const initialStep = searchParams.get("step") as Step | null;
    return initialStep && ["select", "custom"].includes(initialStep)
      ? initialStep
      : "welcome";
  });
  const [selected, setSelected] = useState<Persona | null>(() => HEALI_VOICES[0]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("English");
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customAvatar, setCustomAvatar] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [fillingWithAgent, setFillingWithAgent] = useState(false);
  const [profileForm, setProfileForm] = useState<Record<string, string>>({
    display_name: "",
    blood_type: "",
    dietary_preference: "",
    allergies: "",
    conditions: "",
    current_medications: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    primary_doctor: "",
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const { getIdToken } = useAuth();

  const getPreviewUrl = (voiceId: string) => {
    const slug = voiceId.replace("heali-", "heali_");
    return `/assets/audio/companions/${slug}.wav`;
  };

  const handleVoiceCardEnter = (voice: Persona) => {
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = getPreviewUrl(voice.id);
      audio.play().catch(() => {});
    }
  };

  const handleVoiceCardLeave = () => {
    const audio = previewAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  };

  const handleGenerateAvatar = async () => {
    setGenerating(true);
    try {
      const formData = new FormData();
      formData.append("companion_name", customName || "My Companion");
      formData.append("avatar_description", customDescription);

      const res = await generateAvatar(formData);
      setCustomAvatar(res.avatar_b64);
    } catch (e) {
      console.error("Failed to generate avatar", e);
      if (!customAvatar) {
        setCustomAvatar("/placeholder.svg");
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;

    setGenerating(true);
    try {
      const formData = new FormData();
      formData.append("companion_name", customName || "My Companion");
      formData.append("avatar_description", customDescription || "Wearing casual tech wear in navy blue");
      formData.append("photo", file);

      const res = await generateAvatar(formData);
      setCustomAvatar(res.avatar_b64);
    } catch (error) {
      console.error("Failed to generate avatar from photo", error);
      const reader = new FileReader();
      reader.onload = () => setCustomAvatar(reader.result as string);
      reader.readAsDataURL(file);
    } finally {
      setGenerating(false);
    }
  };

  /** Save companion selection to Firestore, then go to Voice Guardian for voice-led onboarding. */
  const handleFillWithAgent = async (overridePersona?: Persona) => {
    const persona = overridePersona ?? selected;
    if (!persona) return;
    setFillingWithAgent(true);
    try {
      const token = await getIdToken();
      if (token) {
        await saveProfile(
          {
            companion_name: persona.name,
            language: selectedLanguage || persona.language,
            ...(persona.voiceName && { voice_name: persona.voiceName }),
            ...(persona.id === "custom" && customAvatar && { avatar_b64: customAvatar }),
          },
          token,
        );
      }
    } catch (e) {
      console.error("Failed to save profile for Onboarding Specialist", e);
    } finally {
      setFillingWithAgent(false);
      saveOnboardingState({
        persona,
        customAvatar: persona.id === "custom" ? customAvatar || undefined : undefined,
        completed: true,
      });
      setStep("profile");
    }
  };

  const handleProfileContinue = async () => {
    setSavingProfile(true);
    try {
      const token = await getIdToken();
      if (token) {
        const payload = Object.fromEntries(
          Object.entries(profileForm).filter(([, v]) => v.trim() !== "")
        );
        if (Object.keys(payload).length > 0) {
          await saveProfile(payload, token);
        }
      }
    } catch (e) {
      console.error("Failed to save health profile during onboarding", e);
    } finally {
      setSavingProfile(false);
      navigate("/");
    }
  };

  const handleSelectPreset = (persona: Persona) => {
    setSelected(persona);
    handleFillWithAgent(persona);
  };

  const handleCustomConfirm = () => {
    const persona: Persona = {
      id: "custom",
      name: customName || "My Companion",
      title: "Health Companion",
      language: "English",
      languageCode: "en",
      avatar: customAvatar || "/placeholder.svg",
      greeting: `Hello! I'm ${customName || "your companion"}, ready to help with your health.`,
      description: customDescription,
    };
    setSelected(persona);
    handleFillWithAgent(persona);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
      <AnimatePresence mode="wait">
        {/* Step: Welcome */}
        {step === "welcome" && (
          <motion.div
            key="welcome"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-lg text-center"
          >
            <div className="mx-auto mb-6 flex flex-col items-center">
              <img
                src="/heali-logo.png"
                alt="Heali"
                className="h-20 w-auto mb-4"
              />
              <h1 className="font-display text-4xl font-bold tracking-tight lg:text-5xl">
                Welcome to Heali
              </h1>
            </div>
            <p className="mt-4 text-lg text-muted-foreground">
              Your AI health guardian that speaks your language, sees your pills, and knows your name.
            </p>
            <p className="mt-2 text-muted-foreground">
              Let's set up your personal health companion.
            </p>
            <button
              onClick={() => setStep("select")}
              className="mt-8 inline-flex items-center gap-2 rounded-md bg-primary px-8 py-3 font-mono text-sm uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Get Started <ArrowRight size={16} />
            </button>
            <p className="mt-6 text-sm text-muted-foreground">
              I'm a family member or caregiver —{" "}
              <button
                type="button"
                onClick={() => navigate("/family")}
                className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
              >
                <Users size={14} strokeWidth={1.5} />
                Go to Family Dashboard
              </button>
            </p>
          </motion.div>
        )}

        {/* Step: Select Persona */}
        {step === "select" && (
          <motion.div
            key="select"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-3xl"
          >
            <button
              onClick={() => {
                if (searchParams.get("step") === "select") {
                  navigate("/profile");
                } else {
                  setStep("welcome");
                }
              }}
              className="mb-6 inline-flex items-center gap-1 font-mono text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft size={14} /> Back
            </button>
            <h2 className="font-display text-3xl font-bold tracking-tight">
              Find your healthy soundboard
            </h2>
            <p className="mt-2 mb-6 text-muted-foreground">
              Pick a voice style for Heali that feels right for you.
            </p>

            <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Language
            </p>
            <div className="mb-8 flex flex-wrap gap-2">
              {Object.values(LANGUAGE_PERSONAS).map(({ label }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSelectedLanguage(label)}
                  className={`rounded-full px-4 py-1.5 font-mono text-xs uppercase tracking-widest transition-colors ${
                    selectedLanguage === label
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <audio ref={previewAudioRef} className="sr-only" aria-hidden />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {HEALI_VOICES.map((voice) => (
                <button
                  key={voice.id}
                  type="button"
                  onClick={() => handleSelectPreset(voice)}
                  onMouseEnter={() => handleVoiceCardEnter(voice)}
                  onMouseLeave={handleVoiceCardLeave}
                  disabled={fillingWithAgent}
                  className={`group flex items-start gap-4 rounded-lg border-2 bg-card p-5 text-left transition-all duration-150 hover:border-emerald-500/60 hover:shadow-md disabled:opacity-60 ${
                    selected?.id === voice.id ? "border-primary shadow-md" : "border-border"
                  }`}
                >
                  <div className="relative shrink-0 rounded-full">
                    <img
                      src={voice.avatar}
                      alt={voice.name}
                      className="h-16 w-16 rounded-full border-2 border-border object-cover transition-all group-hover:border-emerald-500/60"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-lg font-bold">{voice.name}</h3>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      {voice.role ?? "VOICE COMPANION"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{voice.description}</p>
                  </div>
                </button>
              ))}
            </div>

            {fillingWithAgent && (
              <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={16} className="animate-spin" />
                Saving your companion…
              </div>
            )}

          </motion.div>
        )}

        {/* Step: Health Profile */}
        {step === "profile" && (
          <motion.div
            key="profile"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-lg"
          >
            <button
              onClick={() => setStep("select")}
              className="mb-6 inline-flex items-center gap-1 font-mono text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft size={14} /> Back
            </button>
            <h2 className="font-display text-3xl font-bold tracking-tight">
              Tell us about yourself
            </h2>
            <p className="mt-2 mb-8 text-muted-foreground">
              This helps Heali give you personalised care. All fields are optional.
            </p>

            <div className="space-y-4">
              {[
                { label: "Full Name", field: "display_name", placeholder: "e.g., Priya Sharma" },
                { label: "Blood Type", field: "blood_type", placeholder: "e.g., O+" },
                { label: "Allergies", field: "allergies", placeholder: "e.g., Penicillin, Peanuts (comma separated)" },
                { label: "Conditions", field: "conditions", placeholder: "e.g., Type 2 Diabetes, Hypertension" },
                { label: "Current Medications", field: "current_medications", placeholder: "e.g., Metformin 500mg" },
                { label: "Emergency Contact Name", field: "emergency_contact_name", placeholder: "e.g., Ravi Sharma" },
                { label: "Emergency Contact Phone", field: "emergency_contact_phone", placeholder: "e.g., +91 98765 43210" },
                { label: "Primary Doctor", field: "primary_doctor", placeholder: "e.g., Dr. Anita Rao" },
              ].map(({ label, field, placeholder }) => (
                <div key={field}>
                  <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-muted-foreground">
                    {label}
                  </label>
                  <input
                    type="text"
                    value={profileForm[field]}
                    onChange={(e) => setProfileForm((f) => ({ ...f, [field]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
                  />
                </div>
              ))}

              <div>
                <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Dietary Preference
                </label>
                <select
                  value={profileForm.dietary_preference}
                  onChange={(e) => setProfileForm((f) => ({ ...f, dietary_preference: e.target.value }))}
                  className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="">None</option>
                  <option value="Vegetarian">Vegetarian</option>
                  <option value="Vegan">Vegan</option>
                  <option value="Pescatarian">Pescatarian</option>
                  <option value="Keto">Keto</option>
                  <option value="Low Sodium">Low Sodium</option>
                  <option value="Diabetic / Low Glycemic">Diabetic / Low Glycemic</option>
                </select>
              </div>

              <button
                onClick={handleProfileContinue}
                disabled={savingProfile}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-6 py-3 font-mono text-sm uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
              >
                {savingProfile ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>Continue <ArrowRight size={16} /></>
                )}
              </button>

              <button
                type="button"
                onClick={() => navigate("/")}
                className="w-full text-center font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
              >
                Skip for now
              </button>

              <p className="text-center text-sm text-muted-foreground">
                You can always edit or make changes with Heali later.
              </p>
            </div>
          </motion.div>
        )}

        {/* Step: Custom persona */}
        {step === "custom" && (
          <motion.div
            key="custom"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-lg"
          >
            <button
              onClick={() => setStep("select")}
              className="mb-6 inline-flex items-center gap-1 font-mono text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft size={14} /> Back
            </button>
            <h2 className="font-display text-3xl font-bold tracking-tight">
              Create your <em className="text-primary">Heali</em>
            </h2>
            <p className="mt-2 mb-8 text-muted-foreground">
              Describe your ideal Heali — personality, appearance, anything.
            </p>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Companion Name
                </label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g., Dr. Ananya, Abuela Rosa…"
                  className="w-full rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Description
                </label>
                <textarea
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder="e.g., A warm grandmotherly figure with grey hair and glasses who speaks Kannada with gentle humor…"
                  rows={4}
                  className="w-full resize-none rounded-md border border-border bg-background px-4 py-2.5 text-sm focus:border-primary focus:outline-none"
                />
              </div>

              {/* Avatar preview / upload */}
              <div className="flex flex-col items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                {customAvatar ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="group relative"
                    title="Click to change photo"
                  >
                    <img
                      src={customAvatar}
                      alt="Avatar"
                      className="h-32 w-32 rounded-full border-4 border-primary/20 object-cover transition-all group-hover:opacity-70"
                    />
                    <div className="absolute inset-0 flex items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100">
                      <Upload size={24} className="text-foreground" />
                    </div>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-32 w-32 flex-col items-center justify-center gap-2 rounded-full border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                  >
                    <Upload size={24} />
                    <span className="font-mono text-[9px] uppercase tracking-widest">Upload Photo</span>
                  </button>
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleGenerateAvatar}
                  disabled={generating}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-secondary disabled:opacity-40 shadow-sm"
                >
                  {generating ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Sparkles size={14} className="text-primary" />
                  )}
                  {generating ? "Generating…" : "AI Generate"}
                </button>
                <button
                  onClick={handleCustomConfirm}
                  disabled={!customName.trim() || fillingWithAgent}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 font-mono text-xs uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40 shadow-sm"
                >
                  {fillingWithAgent ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <>Continue <ArrowRight size={14} /></>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Onboarding;
