import { User, Globe, Bell, Shield, Edit2, Heart, RotateCcw, X, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import AppLayout from "@/components/AppLayout";
import ConnectedDevices from "@/components/ConnectedDevices";
import { HEALI_VOICES, Persona, saveOnboardingState } from "@/lib/personas";
import { LANGUAGE_PERSONAS } from "@/lib/voiceConfig";
import { getProfile, saveProfile } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const Profile = () => {
  const { getIdToken } = useAuth();

  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  // Form state
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [customAvatar, setCustomAvatar] = useState<string | null>(null);
  const [customAvatarRawFile, setCustomAvatarRawFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState(false);

  // Companion picker
  const [showCompanionPicker, setShowCompanionPicker] = useState(false);
  const [pickerLanguage, setPickerLanguage] = useState("English");
  const [savingCompanionId, setSavingCompanionId] = useState<string | null>(null);
  const savingCompanion = savingCompanionId !== null;

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadProfile = async () => {
    try {
      const token = await getIdToken();
      if (!token) return;
      const data = await getProfile(token) as Record<string, any>;
      setProfile(data);
      setEditForm(data || {});
      if (data?.user_avatar_b64) {
        setCustomAvatar(data.user_avatar_b64);
      }
    } catch (e) {
      console.error("Failed to load profile", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const token = await getIdToken();
      if (!token) {
        toast({
          variant: "destructive",
          title: "Not signed in",
          description: "Please sign in to save your profile.",
        });
        return;
      }
      const payload = { ...editForm };
      if (customAvatar) {
        payload.user_avatar_b64 = customAvatar;
      }
      await saveProfile(payload, token);
      setProfile(payload);
      setIsEditing(false);
      toast({ title: "Profile saved", description: "Your changes have been saved." });
    } catch (e) {
      console.error("Failed to save profile", e);
      toast({
        variant: "destructive",
        title: "Save failed",
        description: e instanceof Error ? e.message : "Could not save profile. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleChangeCompanion = async (persona: Persona) => {
    setSavingCompanionId(persona.id);
    try {
      const token = await getIdToken();
      if (!token) {
        toast({ variant: "destructive", title: "Not signed in", description: "Please sign in to change your companion." });
        return;
      }
      await saveProfile(
        {
          companion_name: persona.name,
          language: pickerLanguage,
          ...(persona.voiceName && { voice_name: persona.voiceName }),
        },
        token,
      );
      saveOnboardingState({ persona, completed: true });
      setProfile((p) => p ? { ...p, companion_name: persona.name, language: pickerLanguage, voice_name: persona.voiceName ?? p.voice_name } : p);
      setShowCompanionPicker(false);
      toast({ title: "Companion updated", description: `Switched to ${persona.name}.` });
    } catch (e) {
      console.error("Failed to change companion", e);
      toast({ variant: "destructive", title: "Update failed", description: "Could not change companion. Please try again." });
    } finally {
      setSavingCompanionId(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;

    setGenerating(true);
    try {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_DIM = 400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_DIM) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        setCustomAvatar(dataUrl);
        setGenerating(false);
      };
      img.onerror = () => {
        console.error("Failed to read user photo inside Profile");
        setGenerating(false);
      };
      img.src = URL.createObjectURL(file);
    } catch (error) {
      console.error("Failed to process user photo inside Profile", error);
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mb-12">
        <h1 className="font-display text-5xl font-bold tracking-tight lg:text-7xl">
          <em className="text-primary">Profile</em>
        </h1>
        <div className="rule-thick mt-6 mb-8 max-w-32" />
        <p className="max-w-lg text-lg text-muted-foreground">
          Manage your health profile and preferences
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Profile card */}
        <div className="rounded-lg bg-primary p-8 text-center text-primary-foreground relative">
          <div className="relative mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-primary-foreground/20 text-3xl font-bold uppercase overflow-hidden">
            {profile?.user_avatar_b64 ? (
              <img src={profile.user_avatar_b64.startsWith("data:") ? profile.user_avatar_b64 : `data:image/jpeg;base64,${profile.user_avatar_b64}`} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              <span className="font-display">
                {profile?.display_name ? profile.display_name.slice(0, 2) : "ME"}
              </span>
            )}
            <button
              onClick={() => setIsEditing(true)}
              className="absolute -right-1 -bottom-1 flex h-8 w-8 items-center justify-center rounded-full bg-primary-foreground text-primary shadow-md z-10 hover:bg-white transition-colors"
            >
              <Edit2 size={12} strokeWidth={1.5} />
            </button>
          </div>
          <h2 className="font-display text-2xl font-bold">{profile?.display_name || "New Patient"}</h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-widest opacity-70">
            {profile?.dietary_preference || "No Diet Selected"}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <span className="rounded-full bg-primary-foreground/20 px-3 py-1 font-mono text-xs uppercase tracking-widest">
              {profile?.language || "English"}
            </span>
          </div>
        </div>

        {/* Details */}
        <div className="rounded-lg border border-border bg-card p-8 lg:col-span-2">
          <h2 className="mb-6 font-display text-2xl font-bold tracking-tight">Health Information</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { icon: Heart, label: "Conditions", value: profile?.conditions || "None recorded" },
              { icon: Heart, label: "Allergies", value: profile?.allergies || "None" },
              { icon: Globe, label: "Primary Language", value: profile?.language || "English" },
              { icon: User, label: "Emergency Contact", value: profile?.emergency_contact_name ? `${profile.emergency_contact_name} (${profile.emergency_contact_phone})` : "Not set" },
              { icon: Shield, label: "Blood Type", value: profile?.blood_type || "Unknown" },
              { icon: Bell, label: "Reminder Preference", value: profile?.reminder_meds_enabled ? "Enabled" : "Disabled" },
              { icon: User, label: "Primary Doctor", value: profile?.primary_doctor || "Not set" },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-4 rounded-md border border-border p-4"
              >
                <div className="rounded-full bg-primary/10 p-2 text-primary">
                  <item.icon size={16} strokeWidth={1.5} />
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-sm font-semibold">{item.value}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <button
              onClick={() => setIsEditing(true)}
              className="rounded-md bg-primary px-8 py-3 font-mono text-sm uppercase tracking-widest text-primary-foreground shadow-md transition-all hover:shadow-lg"
            >
              Edit Profile →
            </button>
            <button
              onClick={() => {
                setPickerLanguage(profile?.language || "English");
                setShowCompanionPicker(true);
              }}
              className="inline-flex items-center gap-2 rounded-md border-2 border-border px-6 py-3 font-mono text-sm uppercase tracking-widest text-foreground transition-colors hover:bg-secondary"
            >
              <RotateCcw size={14} /> Change Companion
            </button>
          </div>

        </div>
      </div>

      {/* Connected Devices & Trackers */}
      <ConnectedDevices getIdToken={getIdToken} />

      {/* Companion Picker Sheet */}
      <Sheet open={showCompanionPicker} onOpenChange={setShowCompanionPicker}>
        <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
          <SheetHeader className="mb-6">
            <SheetTitle className="font-display text-2xl">Change Your Companion</SheetTitle>
          </SheetHeader>

          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Language</p>
          <div className="mb-6 flex flex-wrap gap-2">
            {Object.values(LANGUAGE_PERSONAS).map(({ label }) => (
              <button
                key={label}
                type="button"
                onClick={() => setPickerLanguage(label)}
                className={`rounded-full px-4 py-1.5 font-mono text-xs uppercase tracking-widest transition-colors ${
                  pickerLanguage === label
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            {HEALI_VOICES.map((voice) => (
              <button
                key={voice.id}
                type="button"
                onClick={() => handleChangeCompanion(voice)}
                disabled={savingCompanion}
                className={`flex items-start gap-4 rounded-lg border-2 bg-card p-4 text-left transition-all hover:border-emerald-500/60 hover:shadow-md disabled:opacity-60 ${
                  profile?.companion_name === voice.name
                    ? "border-primary shadow-md"
                    : "border-border"
                }`}
              >
                <img src={voice.avatar} alt={voice.name} className="h-14 w-14 shrink-0 rounded-full border-2 border-border object-cover" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-base font-bold">{voice.name}</h3>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{voice.role ?? "VOICE COMPANION"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{voice.description}</p>
                </div>
                {savingCompanionId === voice.id && (
                  <Loader2 size={16} className="mt-1 shrink-0 animate-spin text-primary" />
                )}
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl relative">
            <button
              onClick={() => setIsEditing(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-secondary text-muted-foreground"
            >
              <X size={20} />
            </button>
            <h2 className="font-display text-2xl font-bold mb-6">Edit Profile</h2>

            <div className="mb-6 flex flex-col items-center justify-center space-y-4 rounded-lg border-2 border-dashed border-border p-6 text-center">
              <div className="relative mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 overflow-hidden">
                {customAvatar ? (
                  <img src={customAvatar.startsWith('data:') ? customAvatar : `data:image/jpeg;base64,${customAvatar}`} alt="New Profile Photo" className="h-full w-full object-cover" />
                ) : profile?.user_avatar_b64 ? (
                  <img src={profile.user_avatar_b64.startsWith('data:') ? profile.user_avatar_b64 : `data:image/jpeg;base64,${profile.user_avatar_b64}`} alt="Current Profile Photo" className="h-full w-full object-cover" />
                ) : (
                  <User size={32} className="text-primary/50" />
                )}
                {generating && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                    <Loader2 className="animate-spin text-primary" size={24} />
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm font-semibold">Change your Profile Photo</p>
                <p className="mt-1 text-xs text-muted-foreground">Upload a photo to display on your profile.</p>
              </div>
              <label className="relative cursor-pointer rounded-md bg-secondary px-4 py-2 text-sm font-semibold transition-colors hover:bg-secondary/80">
                <span>{generating ? "Uploading Photo..." : "Upload Photo"}</span>
                <input
                  type="file"
                  className="sr-only"
                  accept="image/*"
                  onChange={handleFileUpload}
                  disabled={generating}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Full Name</label>
                <input
                  className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  value={editForm.display_name || ""}
                  onChange={e => setEditForm({ ...editForm, display_name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Blood Type</label>
                <input
                  className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  value={editForm.blood_type || ""}
                  onChange={e => setEditForm({ ...editForm, blood_type: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Primary Language</label>
                <select
                  className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  value={editForm.language || "English"}
                  onChange={e => setEditForm({ ...editForm, language: e.target.value })}
                >
                  <option value="English">English</option>
                  <option value="Hindi">Hindi</option>
                  <option value="Kannada">Kannada</option>
                  <option value="Spanish">Spanish</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Dietary Preference</label>
                <select
                  value={editForm.dietary_preference || "None"}
                  onChange={e => setEditForm({ ...editForm, dietary_preference: e.target.value })}
                  className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="None">None</option>
                  <option value="Vegetarian">Vegetarian</option>
                  <option value="Vegan">Vegan</option>
                  <option value="Pescatarian">Pescatarian</option>
                  <option value="Keto">Keto</option>
                  <option value="Low Sodium">Low Sodium</option>
                  <option value="Diabetic / Low Glycemic">Diabetic / Low Glycemic</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Allergies (comma separated)</label>
                <input
                  className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  value={editForm.allergies || ""}
                  onChange={e => setEditForm({ ...editForm, allergies: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Conditions</label>
                <input
                  className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  value={editForm.conditions || ""}
                  onChange={e => setEditForm({ ...editForm, conditions: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Current Medications</label>
                <input
                  className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  value={editForm.current_medications || ""}
                  onChange={e => setEditForm({ ...editForm, current_medications: e.target.value })}
                />
              </div>

              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Emergency Contact Name</label>
                <input
                  className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  value={editForm.emergency_contact_name || ""}
                  onChange={e => setEditForm({ ...editForm, emergency_contact_name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Emergency Contact Phone</label>
                <input
                  className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  value={editForm.emergency_contact_phone || ""}
                  onChange={e => setEditForm({ ...editForm, emergency_contact_phone: e.target.value })}
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs font-mono uppercase text-muted-foreground">Primary Doctor</label>
                <input
                  className="w-full mt-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  value={editForm.primary_doctor || ""}
                  onChange={e => setEditForm({ ...editForm, primary_doctor: e.target.value })}
                />
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button
                onClick={() => setIsEditing(false)}
                className="px-6 py-2 rounded-md border border-border text-sm font-mono uppercase tracking-widest hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 rounded-md bg-primary text-primary-foreground text-sm font-mono uppercase tracking-widest hover:bg-primary/90 flex items-center gap-2"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                Save Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
};

export default Profile;
