import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard,
  Mic,
  Pill,
  Camera,
  CalendarCheck,
  Users,
  User,
  FileText,
  Dumbbell,
  Menu,
  X,
  Heart,
  Home,
  LogOut,
  Bell,
  Languages,
  Stethoscope,
  ClipboardList,
} from "lucide-react";

const navItems = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/voice", icon: Mic, label: "Voice Guardian" },
  { to: "/translator", icon: Languages, label: "Translator" },
  { to: "/pills", icon: Pill, label: "Pill Check" },
  { to: "/food", icon: Camera, label: "Food Log" },
  { to: "/exercise", icon: Dumbbell, label: "Exercise" },
  { to: "/prescriptions", icon: FileText, label: "Reports & Rx" },
  { to: "/booking", icon: CalendarCheck, label: "Book Doctor" },
  { to: "/reminders", icon: Bell, label: "Reminders" },
  { to: "/family", icon: Users, label: "Family" },
  { to: "/clinical-brief", icon: ClipboardList, label: "Clinical Brief" },
  { to: "/doctor", icon: Stethoscope, label: "Doctor View" },
  { to: "/profile", icon: User, label: "Profile" },
];

const AppSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const displayName = user?.displayName || user?.email?.split("@")[0] || "User";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 rounded-md border border-border bg-card p-2 shadow-sm lg:hidden"
      >
        <Menu size={20} strokeWidth={1.5} className="text-foreground" />
      </button>

      {/* Mobile overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-150 lg:relative ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${collapsed ? "w-[72px]" : "w-64"}`}
      >
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
          <NavLink 
            to="/" 
            className={`flex items-center gap-2.5 overflow-hidden transition-all duration-200 ${collapsed ? "w-8" : "w-auto"}`}
          >
            <img 
              src="/heali-logo.png" 
              alt="Heali" 
              className={`h-10 object-left object-contain ${collapsed ? "" : "min-w-[140px]"}`} 
            />
          </NavLink>
          <button
            onClick={() => {
              setCollapsed(!collapsed);
              setMobileOpen(false);
            }}
            className="hidden rounded p-1 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground lg:block"
          >
            <Menu size={16} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded p-1 text-sidebar-foreground/60 hover:text-sidebar-foreground lg:hidden"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {/* Nav items */}
        <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-3">
          {navItems.map(({ to, icon: Icon, label }) => {
            const isActive = location.pathname === to;
            return (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={`group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors duration-100 ${
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
              >
                <Icon size={18} strokeWidth={1.5} className="shrink-0" />
                {!collapsed && <span>{label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div className="border-t border-sidebar-border p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-sidebar-accent font-mono text-xs font-semibold text-sidebar-primary">
                {initials}
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <p className="truncate font-mono text-[10px] uppercase tracking-widest text-sidebar-foreground/50">
                  {user?.email}
                </p>
              </div>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="shrink-0 rounded p-1.5 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <LogOut size={14} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};

export default AppSidebar;
