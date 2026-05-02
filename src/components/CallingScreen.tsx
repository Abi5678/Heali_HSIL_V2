import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, User, AlertTriangle, Pill } from "lucide-react";

export interface CallingContact {
  name: string;
  phone: string;
  relationship?: string;
}

export interface CallingScreenProps {
  type: "reminder" | "emergency";
  primaryContact: CallingContact;
  secondaryContact?: CallingContact;
  message: string;
  onDismiss: () => void;
}

const AUTO_LAUNCH_SECONDS = 5;

function buildFaceTimeUrl(phone: string): string {
  // Strip non-digit characters for FaceTime URL
  const digits = phone.replace(/\D/g, "");
  return `facetime-audio://${digits}`;
}

export default function CallingScreen({
  type,
  primaryContact,
  secondaryContact,
  message,
  onDismiss,
}: CallingScreenProps) {
  const [countdown, setCountdown] = useState(AUTO_LAUNCH_SECONDS);
  const [launched, setLaunched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const facetimeUrl = buildFaceTimeUrl(primaryContact.phone);

  const openFaceTime = () => {
    setLaunched(true);
    window.open(facetimeUrl, "_blank");
  };

  // Countdown → auto-launch
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          openFaceTime();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isEmergency = type === "emergency";
  const progressPct = ((AUTO_LAUNCH_SECONDS - countdown) / AUTO_LAUNCH_SECONDS) * 100;

  return (
    <AnimatePresence>
      <motion.div
        key="calling-screen"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex flex-col items-center justify-between bg-[#0a0a0a] px-6 py-10 text-white"
      >
        {/* ── Header label ── */}
        <div className="flex w-full items-center justify-center gap-2 text-sm font-semibold uppercase tracking-widest">
          {isEmergency ? (
            <>
              <AlertTriangle size={16} className="text-red-400" />
              <span className="text-red-400">Heali Emergency Alert</span>
            </>
          ) : (
            <>
              <Pill size={16} className="text-blue-400" />
              <span className="text-blue-400">Medication Reminder</span>
            </>
          )}
        </div>

        {/* ── Avatar with pulsing ring ── */}
        <div className="flex flex-col items-center gap-6">
          <div className="relative flex h-36 w-36 items-center justify-center">
            {/* Outer pulse rings */}
            <motion.span
              className="absolute inset-0 rounded-full border-2 border-green-400/40"
              animate={{ scale: [1, 1.4, 1.4], opacity: [0.6, 0, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
            />
            <motion.span
              className="absolute inset-0 rounded-full border-2 border-green-400/30"
              animate={{ scale: [1, 1.7, 1.7], opacity: [0.4, 0, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 0.4 }}
            />
            {/* Avatar circle */}
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-neutral-800 ring-4 ring-green-400">
              <User size={52} strokeWidth={1.5} className="text-neutral-300" />
            </div>
          </div>

          {/* Contact name */}
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              {primaryContact.name}
              {primaryContact.relationship && (
                <span className="ml-2 text-xl font-normal text-neutral-400">
                  ({primaryContact.relationship})
                </span>
              )}
            </h2>
            <motion.p
              className="mt-2 text-base text-neutral-400"
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              FaceTime Audio • {launched ? "Connecting…" : "Calling…"}
            </motion.p>
          </div>

          {/* Message */}
          <p className="max-w-xs text-center text-sm text-neutral-500">{message}</p>

          {/* Secondary contact (emergency only) */}
          {isEmergency && secondaryContact && (
            <div className="rounded-xl border border-neutral-700 bg-neutral-900 px-5 py-3 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Also alerting
              </p>
              <p className="mt-1 text-base font-semibold text-neutral-200">
                {secondaryContact.name}
                {secondaryContact.relationship && (
                  <span className="ml-1 font-normal text-neutral-400">
                    ({secondaryContact.relationship})
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        {/* ── Progress bar + countdown ── */}
        <div className="w-full max-w-xs">
          {!launched && (
            <div className="mb-3 flex items-center justify-between text-xs text-neutral-500">
              <span>Auto-opening FaceTime</span>
              <span className="tabular-nums">{countdown}s</span>
            </div>
          )}
          <div className="h-1 w-full overflow-hidden rounded-full bg-neutral-800">
            <motion.div
              className="h-full rounded-full bg-green-400"
              initial={{ width: "0%" }}
              animate={{ width: launched ? "100%" : `${progressPct}%` }}
              transition={{ ease: "linear" }}
            />
          </div>
        </div>

        {/* ── Buttons ── */}
        <div className="flex w-full max-w-xs gap-4">
          <button
            onClick={onDismiss}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-red-600/20 px-6 py-4 text-sm font-semibold text-red-400 ring-1 ring-red-600/40 transition hover:bg-red-600/30"
          >
            <PhoneOff size={18} />
            Dismiss
          </button>
          <button
            onClick={openFaceTime}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-green-500 px-6 py-4 text-sm font-semibold text-white shadow-lg shadow-green-500/30 transition hover:bg-green-400 active:scale-95"
          >
            <Phone size={18} />
            Open FaceTime
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
