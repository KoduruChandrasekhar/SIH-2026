import {
  Bell,
  Home,
  LayoutDashboard,
  LogIn,
  Navigation,
  Route,
  TrafficCone,
} from "lucide-react";

export default function Navbar({ page, navigate, openModal }) {
  const item = (label, icon, target) => {
    const Icon = icon;
    const isActive = page === target;

    return (
      <button
        key={label}
        onClick={() => navigate(target)}
        className={`
          group
          relative
          flex
          items-center
          gap-2
          rounded-xl
          px-3.5
          py-2
          text-xs
          sm:text-sm
          font-bold
          transition-all
          duration-300
          overflow-hidden
          ${
            isActive
              ? "bg-blue-600/10 text-blue-700 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.2)] scale-[1.02]"
              : "text-[#636366] hover:bg-blue-50 hover:text-blue-600 hover:scale-105"
          }
        `}
      >
        <Icon
          size={16}
          className={`
            transition-all
            duration-300
            group-hover:rotate-12
            group-hover:scale-125
            ${isActive ? "text-blue-600" : "group-hover:text-blue-600"}
          `}
        />
        <span className="relative z-10">{label}</span>

        {/* Hover Indicator Slide Bar */}
        <span className="absolute bottom-0 left-0 h-[2px] w-full bg-blue-600 scale-x-0 transition-transform duration-300 group-hover:scale-x-100 origin-left" />
      </button>
    );
  };

  return (
    <header
      className="
        relative
        flex
        flex-col
        gap-4
        rounded-[24px]
        border
        border-white/80
        bg-white/80
        px-5
        py-3.5
        shadow-[0_8px_32px_rgba(0,0,0,0.06)]
        backdrop-blur-2xl
        lg:flex-row
        lg:items-center
        lg:justify-between
        transition-all
      "
    >
      {/* BRAND LOGO & SYSTEM STATUS */}
      <div className="flex items-center justify-between lg:justify-start gap-4">
        <button
          onClick={() =>
            openModal(
              "Trace Net Platform Overview",
              "Trace Net is a centralized AI-powered multi-camera ANPR trajectory tracking and urban traffic analytics platform."
            )
          }
          className="group flex items-center gap-3 text-left transition-transform active:scale-95"
        >
          <div
            className="
              flex
              h-[42px]
              w-[42px]
              shrink-0
              items-center
              justify-center
              rounded-2xl
              bg-gradient-to-tr
              from-blue-600
              via-indigo-600
              to-purple-600
              text-white
              shadow-[0_8px_20px_rgba(79,70,229,0.35)]
              transition-all
              duration-500
              group-hover:rotate-12
              group-hover:scale-110
              group-hover:shadow-[0_12px_25px_rgba(79,70,229,0.5)]
            "
          >
            <Route size={22} className="transition-transform duration-500 group-hover:scale-110" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1
                className="
                  bg-gradient-to-r
                  from-gray-900
                  via-gray-700
                  to-gray-900
                  bg-clip-text
                  text-lg
                  font-black
                  tracking-tight
                  text-transparent
                  sm:text-xl
                  transition-all
                  duration-300
                  group-hover:text-blue-600
                "
              >
                Trace Net
              </h1>
              {/* Live Status Badge with Hover Pulse */}
              <span className="hidden xl:flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-emerald-600 border border-emerald-500/20 transition-transform duration-300 group-hover:scale-105">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 trace-live-dot" /> LIVE AI
              </span>
            </div>
            <p
              className="
                hidden
                text-[10px]
                font-extrabold
                uppercase
                tracking-[2px]
                text-blue-600
                md:block
              "
            >
              AI Traffic Intelligence
            </p>
          </div>
        </button>
      </div>

      {/* NAVIGATION LINKS & CONTROLS */}
      <nav
        className="
          flex
          flex-wrap
          items-center
          gap-1
          sm:gap-1.5
          lg:flex-nowrap
        "
      >
        {item("Home", Home, "home")}
        {item("Dashboard", LayoutDashboard, "dashboard")}
        {item("Tracking", Navigation, "tracking")}
        {item("Traffic", TrafficCone, "traffic")}

        {/* Alerts Center Button with Hover FX */}
        <button
          onClick={() =>
            openModal(
              "Alert Center",
              "Blacklist Alerts & Anomaly Monitor is active.\n\nHigh-interest vehicle events, congestion anomalies and suspicious movement patterns can be reviewed from the centralized alert service."
            )
          }
          className="
            group
            relative
            flex
            items-center
            gap-1.5
            rounded-xl
            px-3.5
            py-2
            text-xs
            font-bold
            text-[#636366]
            transition-all
            duration-300
            hover:bg-red-500/10
            hover:text-red-600
            hover:scale-105
            hover:shadow-[inset_0_0_0_1px_rgba(239,68,68,0.2)]
            sm:text-sm
            overflow-hidden
          "
        >
          <Bell size={16} className="transition-transform duration-300 group-hover:rotate-12 group-hover:scale-125 text-red-500" />
          <span className="relative z-10">Alerts</span>
          <span className="absolute bottom-0 left-0 h-[2px] w-full bg-red-500 scale-x-0 transition-transform duration-300 group-hover:scale-x-100 origin-left" />
        </button>

        <div className="mx-1.5 hidden h-5 w-[1px] rounded-full bg-gray-200 sm:block" />

        {/* Operator Login Button with Hover Animation */}
        <button
          onClick={() =>
            openModal(
              "Operator Login",
              "Trace Net secure operator authentication gateway."
            )
          }
          className="
            group
            relative
            flex
            items-center
            gap-2
            overflow-hidden
            rounded-xl
            bg-gray-900
            px-4
            py-2
            text-xs
            font-bold
            text-white
            shadow-[0_4px_14px_rgba(0,0,0,0.15)]
            transition-all
            duration-300
            hover:scale-105
            hover:shadow-[0_6px_20px_rgba(37,99,235,0.3)]
            active:scale-95
            sm:text-sm
          "
        >
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-purple-600 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <span className="relative z-10 hidden sm:inline">Login</span>
          <LogIn
            size={16}
            className="relative z-10 transition-transform duration-300 group-hover:translate-x-1"
          />
        </button>
      </nav>
    </header>
  );
}