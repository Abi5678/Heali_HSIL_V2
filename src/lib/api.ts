import { REST_API_BASE_URL } from "./voiceConfig";

/** Helper: build headers with Firebase auth token */
function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function handleResponse<T = unknown>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Dashboard & Profile
// ---------------------------------------------------------------------------

export async function getDashboard(patientUid: string, token: string) {
  const res = await fetch(
    `${REST_API_BASE_URL}/api/dashboard?patient_uid=${encodeURIComponent(patientUid)}`,
    { headers: authHeaders(token) },
  );
  return handleResponse<{
    adherence: { score: number; rating: string; details: Record<string, unknown>[] };
    blood_sugar_trend: unknown;
    blood_pressure_trend: unknown;
    digest: { medications: unknown[]; vitals: unknown[]; meals: unknown[] };
  }>(res);
}

export async function getProfile(token: string) {
  const res = await fetch(`${REST_API_BASE_URL}/api/auth/profile`, {
    headers: authHeaders(token),
  });
  return handleResponse(res);
}

export async function saveProfile(data: Record<string, unknown>, token: string) {
  const res = await fetch(`${REST_API_BASE_URL}/api/auth/profile`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

// ---------------------------------------------------------------------------
// Medications
// ---------------------------------------------------------------------------

export async function getMedications(token: string) {
  const res = await fetch(`${REST_API_BASE_URL}/api/medications`, {
    headers: authHeaders(token),
  });
  return handleResponse<{ medications: unknown[] }>(res);
}

export async function addMedication(
  data: { name: string; dosage?: string; purpose?: string; times?: string[]; schedule_type?: string },
  token: string,
) {
  const res = await fetch(`${REST_API_BASE_URL}/api/medications`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

export async function logMedicationTaken(medicationName: string, token: string) {
  const res = await fetch(`${REST_API_BASE_URL}/api/medications/taken`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ medication_name: medicationName }),
  });
  return handleResponse(res);
}

export async function logVital(type: string, value: string, unit: string, token: string) {
  const res = await fetch(`${REST_API_BASE_URL}/api/vitals`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ type, value, unit }),
  });
  return handleResponse(res);
}

export async function logSymptom(
  symptoms: string,
  severity: "mild" | "moderate" | "severe" = "mild",
  nextSteps: string = "",
  followupScheduled: boolean = true,
  token: string,
) {
  const res = await fetch(`${REST_API_BASE_URL}/api/symptoms`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      symptoms,
      severity,
      next_steps: nextSteps,
      followup_scheduled: followupScheduled,
    }),
  });
  return handleResponse(res);
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

export async function getAppointments(patientUid: string, token: string) {
  const res = await fetch(
    `${REST_API_BASE_URL}/api/appointments?patient_uid=${encodeURIComponent(patientUid)}`,
    { headers: authHeaders(token) },
  );
  return handleResponse<{ appointments: unknown[] }>(res);
}

// ---------------------------------------------------------------------------
// Scanning (Prescriptions & Lab Reports)
// ---------------------------------------------------------------------------

export async function scanDocument(imageB64: string, scanType: "prescription" | "report", token: string) {
  const res = await fetch(`${REST_API_BASE_URL}/api/scan`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ image_b64: imageB64, scan_type: scanType }),
  });
  return handleResponse(res);
}

export async function getScanHistory(uid: string, token: string) {
  const res = await fetch(
    `${REST_API_BASE_URL}/api/scan/history?uid=${encodeURIComponent(uid)}`,
    { headers: authHeaders(token) },
  );
  return handleResponse<{
    prescriptions: Array<Record<string, unknown>>;
    reports: Array<Record<string, unknown>>;
  }>(res);
}

// ---------------------------------------------------------------------------
// Food
// ---------------------------------------------------------------------------

export async function analyzeFood(imageBase64: string) {
  const res = await fetch(`${REST_API_BASE_URL}/api/food/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64: imageBase64 }),
  });
  return handleResponse<{
    food_items: string[];
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  }>(res);
}

export async function getFoodLogs(uid: string, date?: string) {
  let url = `${REST_API_BASE_URL}/api/food/logs?uid=${encodeURIComponent(uid)}`;
  if (date) url += `&date=${encodeURIComponent(date)}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });
  return handleResponse<{
    logs: Array<{ id?: string; meal_type?: string; description?: string; food_items?: string[]; calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number; timestamp?: string; date?: string }>;
  }>(res);
}

export async function deleteFoodLog(uid: string, logId: string) {
  const res = await fetch(
    `${REST_API_BASE_URL}/api/food/log?uid=${encodeURIComponent(uid)}&log_id=${encodeURIComponent(logId)}`,
    { method: "DELETE", headers: { "Content-Type": "application/json" } },
  );
  return handleResponse(res);
}

export async function logFood(
  data: { uid: string; food_items: string[]; calories: number; protein_g: number; carbs_g: number; fat_g: number; meal_type?: string; description?: string },
) {
  const res = await fetch(`${REST_API_BASE_URL}/api/food/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

// ---------------------------------------------------------------------------
// Family
// ---------------------------------------------------------------------------

export async function generateFamilyCode(token: string) {
  const res = await fetch(`${REST_API_BASE_URL}/api/family/code/generate`, {
    method: "POST",
    headers: authHeaders(token),
  });
  return handleResponse<{ code: string; expires_at: string }>(res);
}

export async function verifyFamilyCode(code: string, token: string) {
  const res = await fetch(`${REST_API_BASE_URL}/api/family/code/verify`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ code }),
  });
  return handleResponse<{ parent_name: string; linked: boolean }>(res);
}

export async function generateAvatar(formData: FormData) {
  const res = await fetch(`${REST_API_BASE_URL}/api/avatar/generate`, {
    method: "POST",
    body: formData, // the browser sets the correct Content-Type for FormData automatically
  });
  return handleResponse<{ avatar_b64: string }>(res);
}

// ---------------------------------------------------------------------------
// Clinical Brief & Risk Score
// ---------------------------------------------------------------------------

export async function getClinicalBrief(
  patientUid: string,
  token: string,
  format: "json" | "fhir" = "json",
  days: number = 7,
) {
  let url = `${REST_API_BASE_URL}/api/clinical-brief/${encodeURIComponent(patientUid)}?days=${days}`;
  if (format === "fhir") url += "&format=fhir";
  const res = await fetch(url, { headers: authHeaders(token) });
  return handleResponse(res);
}

export async function getRiskScore(patientUid: string, token: string, days: number = 30) {
  const res = await fetch(
    `${REST_API_BASE_URL}/api/clinical-brief/${encodeURIComponent(patientUid)}/risk?days=${days}`,
    { headers: authHeaders(token) },
  );
  return handleResponse<{
    risk_score: number;
    risk_level: "low" | "moderate" | "high";
    contributing_factors: string[];
    recommended_actions: string[];
    features: Record<string, unknown>;
  }>(res);
}

// ---------------------------------------------------------------------------
// Safety Alerts
// ---------------------------------------------------------------------------

export async function getAlertHistory(
  patientUid: string,
  token: string,
  tier?: string,
  since?: string,
) {
  let url = `${REST_API_BASE_URL}/api/alerts/history?patient_uid=${encodeURIComponent(patientUid)}`;
  if (tier) url += `&tier=${encodeURIComponent(tier)}`;
  if (since) url += `&since=${encodeURIComponent(since)}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  return handleResponse<{
    alerts: Array<{
      timestamp: string;
      alert_tier: "green" | "amber" | "red";
      trigger_source: string;
      symptoms: string;
      action_taken: string;
      human_notified: string[];
      patient_acknowledged: boolean;
      resolution: string | null;
      vitals_at_time?: Array<{ type: string; value: string; unit: string }>;
    }>;
    count: number;
  }>(res);
}

// ---------------------------------------------------------------------------
// Wearables & CGM
// ---------------------------------------------------------------------------

export interface WearableConnection {
  provider: string;
  device: string;
  connected_at: string;
  last_sync: string;
  status: "active" | "disconnected";
  terra_user_id?: string;
}

export interface CGMReading {
  date: string;
  time?: string;
  type: string;
  value: number;
  unit: string;
  source: string;
  timestamp?: string;
}

export async function getWearableConnections(token: string) {
  const res = await fetch(`${REST_API_BASE_URL}/api/wearables/connections`, {
    headers: authHeaders(token),
  });
  return handleResponse<{ connections: WearableConnection[] }>(res);
}

export async function connectWearable(provider: string, token: string) {
  const res = await fetch(
    `${REST_API_BASE_URL}/api/wearables/auth/${encodeURIComponent(provider)}`,
    { headers: authHeaders(token) },
  );
  return handleResponse<{
    auth_url?: string;
    auth_type?: string;
    fields?: string[];
    message?: string;
    demo_mode?: boolean;
  }>(res);
}

export async function connectWearableCredentials(
  provider: string,
  credentials: Record<string, string>,
  token: string,
) {
  const res = await fetch(
    `${REST_API_BASE_URL}/api/wearables/auth/${encodeURIComponent(provider)}`,
    {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    },
  );
  return handleResponse(res);
}

export async function disconnectWearable(provider: string, token: string) {
  const res = await fetch(
    `${REST_API_BASE_URL}/api/wearables/connections/${encodeURIComponent(provider)}`,
    { method: "DELETE", headers: authHeaders(token) },
  );
  return handleResponse(res);
}

export async function syncWearable(provider: string, token: string) {
  const res = await fetch(
    `${REST_API_BASE_URL}/api/wearables/sync/${encodeURIComponent(provider)}`,
    { method: "POST", headers: authHeaders(token) },
  );
  return handleResponse(res);
}

export async function getCGMCurrent(token: string) {
  const res = await fetch(`${REST_API_BASE_URL}/api/wearables/cgm/current`, {
    headers: authHeaders(token),
  });
  return handleResponse<{
    available: boolean;
    value?: number;
    unit?: string;
    trend?: string;
    rate_of_change?: number | null;
    timestamp?: string;
    source?: string;
    time_in_range?: number;
    message?: string;
  }>(res);
}

export async function getCGMHistory(token: string, hours: number = 24) {
  const res = await fetch(
    `${REST_API_BASE_URL}/api/wearables/cgm/history?hours=${hours}`,
    { headers: authHeaders(token) },
  );
  return handleResponse<{
    readings: CGMReading[];
    count: number;
    summary: {
      avg_glucose: number;
      time_in_range: number;
      gmi: number;
      hypo_events: number;
      hyper_events: number;
    };
  }>(res);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function getPublicConfig() {
  const res = await fetch(`${REST_API_BASE_URL}/api/config`);
  return handleResponse<{ vapidKey: string; skipAuth: boolean }>(res);
}
