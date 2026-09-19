import { useState } from "react";
import {
  Shield,
  Settings,
  User,
  Lock,
  ArrowRight,
  ArrowLeft,
  KeyRound,
} from "lucide-react";
import traceforceLogo from "../assets/traceforce-logo.png";

export default function LoginPage({ navigate }) {
  const [role, setRole] = useState("police");

  const handleLogin = (e) => {
    e.preventDefault();
    navigate("dashboard");
  };

  return (
    <div className="relative flex min-h-[90vh] w-full flex-col items-center justify-center p-4 text-[var(--text-primary)]">
      {/* Background Glow */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-[20%] top-[10%] h-[500px] w-[500px] rounded-full bg-blue-600/10 blur-[140px]" />
        <div className="absolute right-[20%] top-[30%] h-[500px] w-[500px] rounded-full bg-indigo-600/10 blur-[140px]" />
      </div>

      {/* Back Button Header */}
      <div className="w-full max-w-4xl mb-4 flex justify-start">
        <button
          onClick={() => navigate("home")}
          className="btn-glass flex items-center gap-2 px-4 py-2 text-xs font-bold"
        >
          <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" />
          Back to Home
        </button>
      </div>

      {/* Main Login Card */}
      <div className="fade-up relative flex w-full max-w-4xl flex-col overflow-hidden rounded-[32px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] shadow-2xl backdrop-blur-2xl md:flex-row">
        {/* Left Side - Branding */}
        <div className="relative flex w-full flex-col items-center justify-center bg-gradient-to-br from-[#0a1128] via-[#0f172a] to-[#030712] p-10 text-center md:w-5/12 lg:p-12 border-b md:border-b-0 md:border-r border-[var(--border-subtle)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.15),transparent_70%)]" />

          <div className="relative z-10 flex flex-col items-center">
            <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] p-2.5 shadow-2xl backdrop-blur-md">
              <img
                src={traceforceLogo}
                alt="TraceNet Logo"
                className="h-full w-full object-contain rounded-xl"
              />
            </div>
            <h1 className="mb-1 text-3xl font-black tracking-tight bg-gradient-to-r from-blue-400 via-cyan-400 to-blue-500 bg-clip-text text-transparent">
              TRACENET
            </h1>
            <p className="mb-6 text-[10px] font-extrabold uppercase tracking-[2px] text-cyan-400">
              by Team Trace Force
            </p>
            <p className="text-xs font-medium leading-relaxed text-[var(--text-secondary)] max-w-[260px]">
              Secure authentication gateway for city-wide ANPR multi-camera tracking &amp; traffic analytics.
            </p>
          </div>
        </div>

        {/* Right Side - Login Form */}
        <div className="flex w-full flex-col p-8 md:w-7/12 lg:p-12">
          <div className="mb-8">
            <h2 className="text-2xl font-black tracking-tight text-[var(--text-primary)]">
              Authorized Access
            </h2>
            <p className="text-xs font-medium text-[var(--text-secondary)] mt-1">
              Select your authorization level to authenticate into the network.
            </p>
          </div>

          {/* Role Selection Tabs */}
          <div className="mb-8 flex rounded-xl border border-[var(--border-subtle)] bg-white/[0.02] p-1">
            <button
              type="button"
              onClick={() => setRole("police")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-extrabold transition-all duration-300 ${
                role === "police"
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/30"
                  : "text-[var(--text-secondary)] hover:text-white"
              }`}
            >
              <Shield size={16} />
              Police Operator
            </button>
            <button
              type="button"
              onClick={() => setRole("admin")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-extrabold transition-all duration-300 ${
                role === "admin"
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                  : "text-[var(--text-secondary)] hover:text-white"
              }`}
            >
              <Settings size={16} />
              System Admin
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            {/* Username / Badge ID */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-muted)] pl-1">
                {role === "police" ? "Badge ID / Operator Username" : "System Admin ID"}
              </label>
              <div className="relative">
                <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  required
                  defaultValue={role === "police" ? "POL-4921" : "SYS-ADMIN"}
                  placeholder={role === "police" ? "e.g. POL-4921" : "e.g. SYS-ADMIN"}
                  className="glass-input w-full pl-10 pr-4 text-xs font-bold font-mono"
                />
              </div>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-muted)] pl-1">
                Tactical Security Key / Password
              </label>
              <div className="relative">
                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="password"
                  required
                  defaultValue="••••••••••••"
                  placeholder="••••••••"
                  className="glass-input w-full pl-10 pr-4 text-xs font-bold"
                />
              </div>
            </div>

            {/* Options */}
            <div className="flex items-center justify-between mt-1 text-xs">
              <label className="flex items-center gap-2 cursor-pointer text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-4 w-4 rounded border-gray-700 bg-gray-900 text-blue-600 focus:ring-blue-500"
                />
                <span>Persist session</span>
              </label>
              <span className="text-xs font-bold text-cyan-400 hover:text-cyan-300 cursor-pointer">
                Certificate verification
              </span>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="btn-primary mt-3 flex w-full items-center justify-center gap-2 py-3.5 text-xs font-black uppercase tracking-wider"
            >
              <KeyRound size={15} />
              Authenticate &amp; Access Central Command
              <ArrowRight size={15} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
