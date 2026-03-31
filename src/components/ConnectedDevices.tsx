import { useEffect, useState, useCallback } from "react";
import { Loader2, RefreshCw, Unplug, Wifi, WifiOff, ExternalLink } from "lucide-react";
import {
  getWearableConnections,
  connectWearable,
  connectWearableCredentials,
  disconnectWearable,
  syncWearable,
  WearableConnection,
} from "@/lib/api";
import { toast } from "@/hooks/use-toast";

const DEVICE_INFO: Record<string, { name: string; color: string; icon: string }> = {
  dexcom:           { name: "Dexcom G7",        color: "bg-green-500",  icon: "💉" },
  freestyle_libre:  { name: "FreeStyle Libre",  color: "bg-blue-500",   icon: "💉" },
  fitbit:           { name: "Fitbit",           color: "bg-teal-500",   icon: "⌚" },
  garmin:           { name: "Garmin",           color: "bg-indigo-500", icon: "⌚" },
  strava:           { name: "Strava",           color: "bg-orange-500", icon: "🏃" },
  apple:            { name: "Apple Health",     color: "bg-red-500",    icon: "🍎" },
};

const ALL_PROVIDERS = ["dexcom", "freestyle_libre", "fitbit", "garmin", "strava", "apple"];

interface Props {
  getIdToken: () => Promise<string | null>;
}

export default function ConnectedDevices({ getIdToken }: Props) {
  const [connections, setConnections] = useState<WearableConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  // LibreView credential form
  const [libreForm, setLibreForm] = useState<{ email: string; password: string } | null>(null);

  const loadConnections = useCallback(async () => {
    try {
      const token = await getIdToken();
      if (!token) return;
      const data = await getWearableConnections(token);
      setConnections(data.connections || []);
    } catch (e) {
      console.error("Failed to load wearable connections", e);
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  // Listen for OAuth popup callback
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const d = event.data;
      if (d?.type === "wearable_connected") {
        toast({ title: "Device connected!", description: `${DEVICE_INFO[d.provider]?.name || d.provider} is now linked.` });
        loadConnections();
      } else if (d?.type === "wearable_error") {
        toast({ title: "Connection failed", description: d.error || "OAuth authorization was denied.", variant: "destructive" });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [loadConnections]);

  const handleConnect = async (provider: string) => {
    setConnectingProvider(provider);
    try {
      const token = await getIdToken();
      if (!token) return;
      const data = await connectWearable(provider, token);

      if (data.auth_type === "native_only") {
        toast({ title: "iOS Only", description: data.message || "Apple Health requires the native iOS app." });
        return;
      }

      if (data.auth_type === "credentials") {
        // Show LibreView login form
        setLibreForm({ email: "", password: "" });
        return;
      }

      if (data.demo_mode) {
        toast({ title: "Demo Mode", description: data.message || `${provider} using demo data.` });
        await loadConnections();
        return;
      }

      if (data.auth_url) {
        // Open OAuth popup
        window.open(data.auth_url, "_blank", "width=500,height=700,popup=yes");
        toast({ title: "Authorize access", description: "Complete the login in the popup window." });
      }
    } catch (e) {
      toast({
        title: "Connection failed",
        description: e instanceof Error ? e.message : "Could not start device connection.",
        variant: "destructive",
      });
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleLibreSubmit = async () => {
    if (!libreForm?.email || !libreForm?.password) return;
    setConnectingProvider("freestyle_libre");
    try {
      const token = await getIdToken();
      if (!token) return;
      await connectWearableCredentials("freestyle_libre", libreForm, token);
      toast({ title: "LibreView connected!", description: "FreeStyle Libre data will now sync." });
      setLibreForm(null);
      await loadConnections();
    } catch (e) {
      toast({
        title: "LibreView login failed",
        description: e instanceof Error ? e.message : "Check your email and password.",
        variant: "destructive",
      });
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleDisconnect = async (provider: string) => {
    setDisconnecting(provider);
    try {
      const token = await getIdToken();
      if (!token) return;
      await disconnectWearable(provider, token);
      setConnections((prev) => prev.filter((c) => c.provider !== provider));
      toast({ title: "Device disconnected", description: `${DEVICE_INFO[provider]?.name || provider} has been disconnected.` });
    } catch (e) {
      toast({ title: "Disconnect failed", description: e instanceof Error ? e.message : "Could not disconnect device.", variant: "destructive" });
    } finally {
      setDisconnecting(null);
    }
  };

  const handleSync = async (provider: string) => {
    setSyncing(provider);
    try {
      const token = await getIdToken();
      if (!token) return;
      await syncWearable(provider, token);
      toast({ title: "Sync complete", description: `${DEVICE_INFO[provider]?.name || provider} data has been synced.` });
      await loadConnections();
    } catch (e) {
      toast({ title: "Sync failed", description: e instanceof Error ? e.message : "Could not sync device.", variant: "destructive" });
    } finally {
      setSyncing(null);
    }
  };

  const connectedProviders = new Set(connections.filter((c) => c.status === "active").map((c) => c.provider));

  if (loading) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="mb-6">
        <h2 className="font-display text-2xl font-bold tracking-tight">
          Connected Devices & Trackers
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sync your wearables and CGM devices for continuous health monitoring
        </p>
      </div>

      {/* LibreView credential modal */}
      {libreForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
            <h3 className="mb-4 font-display text-lg font-bold">Connect LibreView</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              Enter your LibreView account credentials to sync FreeStyle Libre data.
            </p>
            <div className="space-y-3">
              <input
                type="email"
                placeholder="LibreView Email"
                value={libreForm.email}
                onChange={(e) => setLibreForm({ ...libreForm, email: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
              <input
                type="password"
                placeholder="Password"
                value={libreForm.password}
                onChange={(e) => setLibreForm({ ...libreForm, password: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={handleLibreSubmit}
                disabled={connectingProvider === "freestyle_libre"}
                className="flex-1 rounded-md bg-primary py-2 font-mono text-xs uppercase tracking-widest text-primary-foreground disabled:opacity-50"
              >
                {connectingProvider === "freestyle_libre" ? (
                  <Loader2 size={14} className="mx-auto animate-spin" />
                ) : (
                  "Connect"
                )}
              </button>
              <button
                onClick={() => setLibreForm(null)}
                className="rounded-md border border-border px-4 py-2 font-mono text-xs uppercase tracking-widest text-muted-foreground hover:bg-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ALL_PROVIDERS.map((provider) => {
          const info = DEVICE_INFO[provider] || { name: provider, color: "bg-gray-500", icon: "📱" };
          const conn = connections.find((c) => c.provider === provider);
          const isConnected = connectedProviders.has(provider);
          const isApple = provider === "apple";

          return (
            <div
              key={provider}
              className={`relative rounded-lg border-2 p-5 transition-all ${
                isConnected
                  ? "border-primary/40 bg-card shadow-sm"
                  : "border-border/50 bg-card/50 opacity-70"
              }`}
            >
              {/* Status badge */}
              <div className="absolute top-3 right-3">
                {isConnected ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-widest text-green-600">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    Connected
                  </span>
                ) : isApple ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    iOS Only
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    <WifiOff size={10} />
                    Not connected
                  </span>
                )}
              </div>

              {/* Device info */}
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${info.color}/15 text-xl`}>
                  {info.icon}
                </div>
                <div>
                  <h3 className="font-display text-base font-bold">
                    {conn?.device || info.name}
                  </h3>
                  {isConnected && conn?.last_sync && (
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Last sync: {new Date(conn.last_sync).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              {/* Actions */}
              {isConnected ? (
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => handleSync(provider)}
                    disabled={syncing === provider}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-mono uppercase tracking-widest text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
                  >
                    {syncing === provider ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RefreshCw size={12} />
                    )}
                    Sync
                  </button>
                  <button
                    onClick={() => handleDisconnect(provider)}
                    disabled={disconnecting === provider}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-xs font-mono uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                  >
                    {disconnecting === provider ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Unplug size={12} />
                    )}
                  </button>
                </div>
              ) : !isApple ? (
                <button
                  onClick={() => handleConnect(provider)}
                  disabled={connectingProvider === provider}
                  className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary/10 px-3 py-2 text-xs font-mono uppercase tracking-widest text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                >
                  {connectingProvider === provider ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <ExternalLink size={12} />
                  )}
                  Connect {info.name}
                </button>
              ) : (
                <p className="mt-4 text-center text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Available in the iOS app
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
