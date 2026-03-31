import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Bell, 
  Phone, 
  Clock, 
  Pill, 
  Utensils, 
  Droplets,
  ChevronLeft,
  Save,
  CheckCircle2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';

const Reminders = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, getIdToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [prefs, setPrefs] = useState({
    reminder_meds_enabled: true,
    reminder_lunch_enabled: true,
    reminder_dinner_enabled: true,
    reminder_glucose_enabled: false,
    voice_reminders_enabled: false,
    lunch_reminder_time: "12:00",
    dinner_reminder_time: "19:00",
    glucose_reminder_time: "08:00",
    phone_number: "",
    timezone: "UTC"
  });

  useEffect(() => {
    const fetchPrefs = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const idToken = await getIdToken();
        const response = await fetch('/api/reminders/preferences', {
          headers: { 'Authorization': `Bearer ${idToken}` }
        });
        if (response.ok) {
          const data = await response.json();
          setPrefs(data);
        }
      } catch (e) {
        console.error("Failed to fetch prefs", e);
      } finally {
        setLoading(false);
      }
    };
    fetchPrefs();
  }, [user, getIdToken]);

  const handleTestCall = async () => {
    if (!prefs.voice_reminders_enabled || !prefs.phone_number) {
      toast({
        title: "Setup Required",
        description: "Please enable FaceTime reminders and enter your phone number first.",
        variant: "destructive",
      });
      return;
    }

    setTesting(true);
    try {
      const response = await fetch('/api/reminders/test-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await getIdToken()}`
        },
        body: JSON.stringify({ phone_number: prefs.phone_number })
      });

      if (response.ok) {
        const data = await response.json();
        const facetimeUrl = data.facetime_url || `facetime-audio://${prefs.phone_number}`;
        // Open FaceTime immediately on Apple devices
        window.open(facetimeUrl, '_blank');
        toast({
          title: "Opening FaceTime...",
          description: `Starting a FaceTime call to ${prefs.phone_number}. If it didn't open, tap: ${facetimeUrl}`,
        });
      } else {
        const err = await response.json();
        throw new Error(err.detail || "Failed to initiate FaceTime");
      }
    } catch (error: any) {
      toast({
        title: "FaceTime Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  };

  const handleToggle = (key: string) => {
    setPrefs(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));
  };

  const handleTimeChange = (key: string, value: string) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/reminders/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await getIdToken()}`
        },
        body: JSON.stringify(prefs)
      });

      if (response.ok) {
        toast({
          title: "Settings Saved",
          description: "Your reminder preferences have been updated.",
          duration: 3000,
        });
      } else {
        throw new Error("Failed to save");
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Could not save your preferences. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between px-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-display text-xl font-semibold">Reminders</h1>
          <Button variant="ghost" size="icon" disabled={saving} onClick={handleSave}>
            <Save className={`h-5 w-5 ${saving ? 'animate-pulse' : ''}`} />
          </Button>
        </div>
      </header>

      <main className="container max-w-2xl px-4 pt-6 space-y-6">
        <section className="space-y-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Phone size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Voice Notifications</h2>
              <p className="text-sm text-muted-foreground italic">Heali will call you when it's time.</p>
            </div>
          </div>

          <Card className="overflow-hidden border-primary/20 shadow-lg shadow-primary/5">
            <CardContent className="pt-6 space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-base">Enable FaceTime Reminders</Label>
                  <p className="text-sm text-muted-foreground">Get FaceTime calls from your emergency contact for critical reminder slots.</p>
                </div>
                <Switch 
                  checked={prefs.voice_reminders_enabled} 
                  onCheckedChange={() => handleToggle('voice_reminders_enabled')}
                />
              </div>

              {prefs.voice_reminders_enabled && (
                <div className="space-y-3 pt-4 border-t animate-in fade-in slide-in-from-top-2 duration-300">
                  <Label htmlFor="phone">Your Phone Number / Apple ID</Label>
                  <Input
                    id="phone"
                    placeholder="+1 234 567 8900 or email@icloud.com"
                    value={prefs.phone_number}
                    onChange={(e) => setPrefs(prev => ({ ...prev, phone_number: e.target.value }))}
                    className="bg-muted/30"
                  />
                  <p className="text-xs text-muted-foreground">Used to FaceTime you for reminders. Works on iPhone, iPad, and Mac.</p>
                </div>
              )}

              {prefs.voice_reminders_enabled && (
                <div className="pt-4 flex flex-col gap-2">
                  <Button 
                    variant="outline" 
                    className="w-full gap-2 border-primary/30 hover:bg-primary/5"
                    onClick={handleTestCall}
                    disabled={testing || !prefs.phone_number}
                  >
                    <Phone className={`h-4 w-4 ${testing ? 'animate-bounce' : ''}`} />
                    {testing ? 'Opening FaceTime...' : 'Test FaceTime Call'}
                  </Button>
                  <p className="text-[10px] text-center text-muted-foreground">
                    Opens a FaceTime call to your number to verify it works on your Apple device.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4 pt-4">
          <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Scheduled Alerts</h3>
          
          {/* Medications */}
          <Card className="hover:border-primary/50 transition-colors">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Pill className="h-5 w-5 text-blue-500" />
                  <CardTitle className="text-base">Medications</CardTitle>
                </div>
                <Switch 
                  checked={prefs.reminder_meds_enabled} 
                  onCheckedChange={() => handleToggle('reminder_meds_enabled')}
                />
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <p className="text-sm text-muted-foreground">
                Alerts for all prescribed doses in your schedule.
              </p>
            </CardContent>
          </Card>

          {/* Glucose Test */}
          <Card className="hover:border-primary/50 transition-colors">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Droplets className="h-5 w-5 text-red-500" />
                  <CardTitle className="text-base">Glucose Test</CardTitle>
                </div>
                <Switch 
                  checked={prefs.reminder_glucose_enabled} 
                  onCheckedChange={() => handleToggle('reminder_glucose_enabled')}
                />
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-2 space-y-4">
              <p className="text-sm text-muted-foreground">Daily blood sugar check reminder.</p>
              {prefs.reminder_glucose_enabled && (
                <div className="flex items-center justify-between pt-2 border-t">
                  <Label className="text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4" /> Reminder Time
                  </Label>
                  <Input 
                    type="time" 
                    className="w-24 h-8 bg-muted/50" 
                    value={prefs.glucose_reminder_time}
                    onChange={(e) => handleTimeChange('glucose_reminder_time', e.target.value)}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Meals */}
          <Card className="hover:border-primary/50 transition-colors">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Utensils className="h-5 w-5 text-green-500" />
                  <CardTitle className="text-base">Meal Reminders</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-2 space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm">Lunch</Label>
                </div>
                <div className="flex items-center gap-3">
                   <Input 
                    type="time" 
                    className="w-24 h-8 bg-muted/50" 
                    value={prefs.lunch_reminder_time}
                    onChange={(e) => handleTimeChange('lunch_reminder_time', e.target.value)}
                  />
                  <Switch 
                    checked={prefs.reminder_lunch_enabled} 
                    onCheckedChange={() => handleToggle('reminder_lunch_enabled')}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between border-t pt-4">
                <div className="space-y-0.5">
                  <Label className="text-sm">Dinner</Label>
                </div>
                <div className="flex items-center gap-3">
                   <Input 
                    type="time" 
                    className="w-24 h-8 bg-muted/50" 
                    value={prefs.dinner_reminder_time}
                    onChange={(e) => handleTimeChange('dinner_reminder_time', e.target.value)}
                  />
                  <Switch 
                    checked={prefs.reminder_dinner_enabled} 
                    onCheckedChange={() => handleToggle('reminder_dinner_enabled')}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <div className="pt-8">
          <Button 
            className="w-full h-12 text-lg gap-2" 
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : 'Save Preferences'}
            {!saving && <CheckCircle2 className="h-5 w-5" />}
          </Button>
        </div>
      </main>
    </div>
  );
};

export default Reminders;
