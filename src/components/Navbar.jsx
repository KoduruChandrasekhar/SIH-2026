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

    return (
      <button
        key={label}
        onClick={() => navigate(target)}
        className={`
          relative
          flex
          items-center
          gap-1.5
          rounded-xl
          px-2.5
          py-1.5
          text-xs
          sm:text-sm
          font-bold
          transition-all
          duration-300
          overflow-hidden

          ${
            page === target
              ? "bg-blue-600/10 text-blue-700 shadow-[inset_0_0_0_1px_rgba(37,99,235,0.2)]"
              : "text-[#636366] hover:bg-gray-900/5 hover:text-[#1c1c1e]"
          }
        `}
      >
        <Icon size={16} className={page === target ? "text-blue-600" : ""} />
        {label}
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
        border-white/60
        bg-white/70
        px-4
        py-3
        shadow-[0_8px_32px_rgba(0,0,0,0.04)]
        backdrop-blur-xl
        lg:flex-row
        lg:items-center
        lg:justify-between
      "
    >
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
            h-[38px]
            w-[38px]
            shrink-0
            items-center
            justify-center
            rounded-xl
            bg-gradient-to-br
            from-blue-600
            via-indigo-500
            to-purple-600
            text-white
            shadow-[0_8px_16px_rgba(79,70,229,0.4)]
            transition-all
            duration-300
            group-hover:rotate-6
            group-hover:scale-110
            sm:h-[42px]
            sm:w-[42px]
          "
        >
          <Route size={20} className="sm:h-[22px] sm:w-[22px]" />
        </div>

        <div>
          <h1
            className="
              animate-text-shimmer
              bg-gradient-to-r
              from-gray-900
              via-gray-600
              to-gray-900
              bg-clip-text
              text-lg
              font-extrabold
              tracking-tight
              text-transparent
              sm:text-xl
            "
          >
            Trace Net
          </h1>
          <p
            className="
              hidden
              text-[10px]
              font-extrabold
              uppercase
              tracking-[1.5px]
              text-blue-600
              md:block
            "
          >
            AI Traffic Intelligence
          </p>
        </div>
      </button>

      {/* lg:flex-nowrap added here so it doesn't wrap the Login button to a new line on desktops */}
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
        {item("Tracking", Navigation, "dashboard")}
        {item("Traffic", TrafficCone, "dashboard")}

        <button
          onClick={() =>
            openModal(
              "Alert Center",
              "Blacklist Alerts & Anomaly Monitor is active.\n\nHigh-interest vehicle events, congestion anomalies and suspicious movement patterns can be reviewed from the centralized alert service."
            )
          }
          className="
            flex
            items-center
            gap-1.5
            rounded-xl
            px-2.5
            py-1.5
            text-xs
            font-bold
            text-[#636366]
            transition-all
            duration-300
            hover:bg-red-500/10
            hover:text-red-600
            hover:shadow-[inset_0_0_0_1px_rgba(239,68,68,0.2)]
            sm:text-sm
          "
        >
          <Bell size={16} />
          Alerts
        </button>

        <div className="mx-1 hidden h-5 w-[2px] rounded-full bg-gray-200 sm:block"></div>

        <button
          onClick={() =>
            openModal(
              "Operator Login",
              "Trace Net secure operator authentication gateway."
            )
          }
          className="
            group
            flex
            items-center
            gap-2
            rounded-xl
            border
            border-gray-200
            bg-white/50
            px-3
            py-1.5
            text-xs
            font-bold
            text-[#1c1c1e]
            transition-all
            duration-300
            hover:border-blue-300
            hover:bg-blue-50
            hover:text-blue-700
            hover:shadow-[0_4px_12px_rgba(37,99,235,0.15)]
            sm:text-sm
          "
        >
          <span className="hidden sm:inline">Login</span>
          <LogIn
            size={16}
            className="transition-transform group-hover:translate-x-1"
          />
        </button>
      </nav>
    </header>
  );
}