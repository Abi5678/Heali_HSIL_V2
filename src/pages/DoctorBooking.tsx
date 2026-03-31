import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Calendar, Star, CheckCircle2, Loader2, Mic, Hand, Search } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { getAppointments } from "@/lib/api";
import { useUIEvent } from "@/hooks/useUIEventStore";

const FALLBACK_HOSPITALS = [
  { name: "Apollo Hospital", distance: "2.3 km", rating: 4.8, specialties: ["Cardiology", "Endocrinology"], nextSlot: "March 10, 10:00 AM" },
  { name: "City Care Clinic", distance: "1.1 km", rating: 4.5, specialties: ["General Medicine", "Geriatrics"], nextSlot: "March 9, 2:30 PM" },
  { name: "Fortis Medical Center", distance: "4.7 km", rating: 4.9, specialties: ["Cardiology", "Neurology", "Orthopedics"], nextSlot: "March 11, 9:00 AM" },
];

interface Appointment {
  doctor: string;
  specialty: string;
  hospital: string;
  date: string;
  time: string;
  status: string;
}

const DoctorBooking = () => {
  const navigate = useNavigate();
  const { user, getIdToken } = useAuth();
  const [selectedHospital, setSelectedHospital] = useState<number | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([
    { doctor: "Dr. Sharma", specialty: "Cardiology", hospital: "Apollo Hospital", date: "March 12, 2026", time: "10:00 AM", status: "confirmed" },
  ]);
  const [hospitals, setHospitals] = useState(FALLBACK_HOSPITALS);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Listen for booking UI events from voice agent
  const bookingHospitals = useUIEvent("booking_hospitals");
  const bookingConfirmed = useUIEvent("booking_confirmed");

  useEffect(() => {
    if (bookingHospitals?.data) {
      const data = bookingHospitals.data as { hospitals?: Array<Record<string, unknown>> };
      if (data.hospitals?.length) {
        setHospitals(
          data.hospitals.map((h) => ({
            name: String(h.name || "Hospital"),
            distance: String(h.distance || ""),
            rating: Number(h.rating || 4.5),
            specialties: (h.specialties as string[]) || [],
            nextSlot: String(h.next_slot || ""),
          })),
        );
      }
    }
  }, [bookingHospitals]);

  useEffect(() => {
    if (bookingConfirmed?.data) {
      const data = bookingConfirmed.data as Record<string, unknown>;
      setAppointments((prev) => [
        {
          doctor: String(data.doctor || "Doctor"),
          specialty: String(data.department || ""),
          hospital: String(data.hospital || ""),
          date: String(data.date || ""),
          time: String(data.time || ""),
          status: "confirmed",
        },
        ...prev,
      ]);
    }
  }, [bookingConfirmed]);

  // Fetch real appointments from backend
  useEffect(() => {
    async function fetchAppointments() {
      try {
        const token = await getIdToken();
        if (!token || !user?.uid) return;
        const res = await getAppointments(user.uid, token);
        const appts = (res as { appointments: Appointment[] }).appointments;
        if (appts?.length) setAppointments(appts);
      } catch {
        // Use fallback data
      } finally {
        setLoading(false);
      }
    }
    fetchAppointments();
  }, [user, getIdToken]);

  return (
    <AppLayout>
      <div className="mb-12">
        <h1 className="font-display text-5xl font-bold tracking-tight lg:text-7xl">
          Book
          <br />
          <em className="text-primary">Doctor</em>
        </h1>
        <div className="rule-thick mt-6 mb-8 max-w-32" />
        <p className="max-w-lg text-lg text-muted-foreground">
          Find nearby hospitals and book appointments via voice or tap
          {loading && <Loader2 size={14} className="ml-2 inline animate-spin" />}
        </p>

        {/* Voice / Tap options */}
        <div className="mt-6 flex flex-wrap gap-4">
          <button
            onClick={() =>
              navigate("/voice", {
                state: {
                  proactivePrompt:
                    "[SYSTEM: The user is on the Book Doctor page and wants to find or book an appointment. Help them find nearby hospitals and book an appointment. Be conversational and guide them through the process.]",
                },
              })
            }
            className="flex items-center gap-3 rounded-lg border-2 border-primary bg-primary/10 px-5 py-3 font-medium text-primary transition-all hover:bg-primary/20 hover:shadow-md"
          >
            <Mic size={22} strokeWidth={1.5} />
            Use Voice
          </button>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
            <Hand size={18} strokeWidth={1.5} />
            <span>Tap a hospital card below to select and book</span>
          </div>
        </div>
      </div>

      {/* Upcoming */}
      {appointments.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 font-display text-2xl font-bold tracking-tight">Upcoming</h2>
          {appointments.map((apt, i) => (
            <div key={i} className="mb-3 rounded-lg bg-primary p-6 text-primary-foreground">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="rounded-full bg-primary-foreground/20 p-2">
                    <CheckCircle2 size={20} strokeWidth={1.5} />
                  </div>
                  <div>
                    <p className="font-display text-lg font-semibold">{apt.doctor}</p>
                    <p className="font-mono text-[10px] uppercase tracking-widest opacity-70">
                      {apt.specialty} \u00B7 {apt.hospital}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm">{apt.date}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest opacity-70">{apt.time}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Hospitals */}
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <h2 className="font-display text-2xl font-bold tracking-tight">Nearby Hospitals</h2>
        <div className="relative max-w-sm w-full md:w-64">
          <Search className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" size={18} />
          <input
            type="text"
            placeholder="Search hospitals or specialties..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-full border border-border bg-card py-2 pr-4 pl-10 text-sm focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {hospitals
          .filter(h => 
            h.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
            h.specialties.some(s => s.toLowerCase().includes(searchQuery.toLowerCase()))
          )
          .map((h, i) => (
          <div
            key={i}
            onClick={() => setSelectedHospital(i)}
            className={`cursor-pointer rounded-lg border p-6 transition-all duration-150 ${
              selectedHospital === i
                ? "border-primary bg-primary/5 shadow-md"
                : "border-border bg-card hover:border-primary/30"
            }`}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-lg font-semibold">{h.name}</h3>
              <div className="flex items-center gap-1 font-mono text-xs text-accent">
                <Star size={12} strokeWidth={1.5} className="fill-accent" />
                {h.rating}
              </div>
            </div>
            <div className="mb-3 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <MapPin size={12} strokeWidth={1.5} />
              {h.distance}
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              {h.specialties.map((s) => (
                <span key={s} className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest">
                  {s}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-1.5 font-mono text-xs text-primary">
              <Calendar size={12} strokeWidth={1.5} />
              Next: {h.nextSlot}
            </div>
            {selectedHospital === i && (
              <button className="mt-4 w-full rounded-md bg-primary py-3 font-mono text-xs uppercase tracking-widest text-primary-foreground transition-all hover:shadow-md">
                Book Appointment \u2192
              </button>
            )}
          </div>
        ))}
      </div>
    </AppLayout>
  );
};

export default DoctorBooking;
