import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import {
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { getPublicConfig } from "@/lib/api";

const USE_LOCAL_AUTH = import.meta.env.VITE_USE_LOCAL_AUTH === "true";
const LOCAL_TOKEN_KEY = "heali_local_token";

interface UserInfo {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

interface AuthContextType {
  user: User | UserInfo | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
  skipAuth: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ---------------------------------------------------------------------------
// Local JWT helpers
// ---------------------------------------------------------------------------

function _decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

async function _localPost(path: string, body: object): Promise<{ token: string; uid: string; email: string; display_name: string }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail ?? "Request failed");
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [skipAuth, setSkipAuth] = useState(false);

  useEffect(() => {
    // ── Local auth path ───────────────────────────────────────────────────
    if (USE_LOCAL_AUTH) {
      (async () => {
        try {
          const config = await getPublicConfig();
          if (config.skipAuth) {
            setSkipAuth(true);
            setUser({ uid: "demo_user", displayName: "Demo User", email: "demo@example.com", photoURL: null });
            setLoading(false);
            return;
          }
        } catch {}
        const token = localStorage.getItem(LOCAL_TOKEN_KEY);
        if (token) {
          const payload = _decodeJwtPayload(token);
          if (payload && typeof payload.exp === "number" && payload.exp * 1000 > Date.now()) {
            setUser({
              uid: payload.uid as string,
              email: payload.email as string,
              displayName: (payload.display_name as string) || null,
              photoURL: null,
            });
          } else {
            localStorage.removeItem(LOCAL_TOKEN_KEY);
          }
        }
        setLoading(false);
      })();
      return;
    }

    // ── Firebase path (unchanged) ─────────────────────────────────────────
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    async function initAuth() {
      try {
        const config = await getPublicConfig();
        if (cancelled) return;
        setSkipAuth(config.skipAuth);
        if (config.skipAuth) {
          setUser({
            uid: "demo_user",
            displayName: "Demo User",
            email: "demo@example.com",
            photoURL: null,
          });
          setLoading(false);
          return;
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("Failed to fetch public config:", err);
      }

      if (cancelled) return;
      let prevUid: string | null = null;
      unsubscribe = onAuthStateChanged(auth!, (firebaseUser) => {
        const newUid = firebaseUser?.uid ?? null;
        if (newUid !== prevUid) {
          localStorage.removeItem("heali_onboarding");
        }
        prevUid = newUid;
        setUser(firebaseUser);
        setLoading(false);
      });
    }

    initAuth();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // ── signIn ────────────────────────────────────────────────────────────────
  const signIn = async (email: string, password: string) => {
    if (USE_LOCAL_AUTH) {
      const data = await _localPost("/api/auth/login", { email, password });
      localStorage.setItem(LOCAL_TOKEN_KEY, data.token);
      localStorage.removeItem("heali_onboarding");
      setUser({ uid: data.uid, email: data.email, displayName: data.display_name || null, photoURL: null });
      return;
    }
    await signInWithEmailAndPassword(auth!, email, password);
  };

  // ── signUp ────────────────────────────────────────────────────────────────
  const signUp = async (email: string, password: string) => {
    if (USE_LOCAL_AUTH) {
      const data = await _localPost("/api/auth/register", { email, password });
      localStorage.setItem(LOCAL_TOKEN_KEY, data.token);
      localStorage.removeItem("heali_onboarding");
      setUser({ uid: data.uid, email: data.email, displayName: data.display_name || null, photoURL: null });
      return;
    }
    await createUserWithEmailAndPassword(auth!, email, password);
  };

  // ── signInWithGoogle ──────────────────────────────────────────────────────
  const signInWithGoogle = async () => {
    if (USE_LOCAL_AUTH) {
      throw new Error("Google Sign-In is not available in local mode. Please use email and password.");
    }
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth!, provider);
  };

  // ── logout ────────────────────────────────────────────────────────────────
  const logout = async () => {
    if (USE_LOCAL_AUTH) {
      localStorage.removeItem(LOCAL_TOKEN_KEY);
      setUser(null);
      return;
    }
    await signOut(auth!);
  };

  // ── getIdToken ────────────────────────────────────────────────────────────
  const getIdToken = useCallback(async () => {
    if (skipAuth) return "demo";
    if (USE_LOCAL_AUTH) {
      return localStorage.getItem(LOCAL_TOKEN_KEY);
    }
    if (!auth?.currentUser) return null;
    return auth.currentUser.getIdToken();
  }, [skipAuth]);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signInWithGoogle, logout, getIdToken, skipAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
