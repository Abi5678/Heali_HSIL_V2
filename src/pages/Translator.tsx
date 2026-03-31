import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Languages, ArrowRight, Mic } from "lucide-react";
import AppLayout from "@/components/AppLayout";

const Translator = () => {
  const navigate = useNavigate();

  const handleStartLiveTranslation = () => {
    navigate("/voice", { state: { activateLiveInterpreter: true } });
  };

  return (
    <AppLayout>
      <div className="mb-12">
        <h1 className="font-display text-5xl font-bold tracking-tight text-foreground lg:text-7xl">
          Live
          <br />
          <em className="text-primary">Translator</em>
        </h1>
        <div className="rule-thick mt-6 mb-8 max-w-32" />
        <p className="max-w-lg text-lg text-muted-foreground">
          Real-time voice translation with your doctor or family. Speak in your language; Heali translates for the other person using Gemini Live — no separate app needed.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-xl border-2 border-primary/40 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-8 transition-all duration-200 hover:border-primary hover:shadow-lg hover:shadow-primary/20"
      >
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
              <Languages size={36} strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Start live translation
              </h2>
              <p className="mt-1 text-muted-foreground">
                Opens Voice Guardian with interpreter mode on. You and the other person can speak in turn; Heali will translate each side in real time.
              </p>
            </div>
          </div>
          <button
            onClick={handleStartLiveTranslation}
            className="flex items-center gap-2 rounded-lg bg-primary px-6 py-3 font-medium text-primary-foreground shadow-lg transition-all duration-200 hover:bg-primary/90 hover:shadow-primary/30"
          >
            <Mic size={20} strokeWidth={1.5} />
            <span>Start live translation</span>
            <ArrowRight size={20} strokeWidth={1.5} />
          </button>
        </div>
      </motion.div>

      <div className="mt-8 rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-lg font-bold tracking-tight text-foreground">How it works</h3>
        <ul className="mt-3 list-inside list-disc space-y-2 text-muted-foreground">
          <li>Tap &quot;Start live translation&quot; to open Voice Guardian with interpreter mode on.</li>
          <li>Speak in your language (e.g. Hindi, Spanish, Kannada, or English).</li>
          <li>Heali translates your words for the other person and their words for you.</li>
          <li>Turn off interpreter mode anytime from the Translator button in Voice Guardian.</li>
        </ul>
      </div>
    </AppLayout>
  );
};

export default Translator;
