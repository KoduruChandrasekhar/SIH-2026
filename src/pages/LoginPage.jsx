import { useState } from "react";
import { 
  Shield, 
  Settings, 
  User, 
  Lock, 
  ArrowRight, 
  ArrowLeft 
} from "lucide-react";
import tracenetLogo from "../assets/tracenet-logo.jpg";
import { login } from "../auth";

export default function LoginPage({ navigate }) {
  // Toggle between 'police' and 'admin'
  const [role, setRole] = useState("police");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Phase 6: real JWT login (demo accounts: officer / police123, admin / admin123)
  const handleLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await login(username, password);
      const expected = role === "police" ? "law_enforcement" : "camera_admin";
      if (session.role !== expected) setError(`Signed in as ${session.role.replace("_", " ")}.`);
      navigate(session.role === "camera_admin" ? "admin" : "dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-[85vh] w-full flex-col items-center justify-center p-4">
      
      {/* Back Button Header */}
      <div className="w-full max-w-4xl mb-4 flex justify-start">
        <button
          onClick={() => navigate("home")}
          className="group flex items-center gap-2 rounded-xl border border-gray-200/80 bg-white/80 px-4 py-2 text-xs font-bold text-gray-600 shadow-sm backdrop-blur-md transition-all duration-300 hover:bg-white hover:text-blue-600 hover:scale-105 active:scale-95"
        >
          <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" />
          Back to Home
        </button>
      </div>


      {/* Main Login Card */}
      <div className="fade-up relative flex w-full max-w-4xl flex-col overflow-hidden rounded-[32px] border border-white/80 bg-white/60 shadow-[0_8px_40px_rgba(0,0,0,0.08)] backdrop-blur-2xl md:flex-row">
        
        {/* Left Side - Branding */}
        <div className="relative flex w-full flex-col items-center justify-center bg-gradient-to-br from-blue-900 via-indigo-950 to-gray-900 p-10 text-center md:w-5/12 lg:p-12">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.15),transparent_70%)]" />
          
          <div className="relative z-10 flex flex-col items-center">
            <img 
              src={tracenetLogo} 
              alt="TraceNet" 
              className="mb-6 h-20 w-20 rounded-2xl border-2 border-white/10 bg-white/5 object-contain p-2 shadow-2xl backdrop-blur-md"
            />
            <h1 className="mb-2 text-3xl font-black tracking-tighter text-white">
              TraceNet
            </h1>
            <p className="mb-8 text-xs font-bold uppercase tracking-[2px] text-blue-300">
              AI Traffic Intelligence
            </p>
            <p className="text-sm font-medium leading-relaxed text-gray-300">
              Secure authentication gateway for city-wide ANPR trajectory tracking and urban analytics.
            </p>
          </div>
        </div>

        {/* Right Side - Login Form */}
        <div className="flex w-full flex-col p-8 md:w-7/12 lg:p-12">
          <div className="mb-8">
            <h2 className="text-2xl font-black text-gray-900">Welcome Back</h2>
            <p className="text-xs font-bold text-gray-500 mt-1">Select your authorization level to continue.</p>
          </div>

          {/* Role Selection Tabs */}
          <div className="mb-8 flex rounded-xl border border-gray-200/60 bg-gray-50/50 p-1 shadow-inner">
            <button
              type="button"
              onClick={() => setRole("police")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-extrabold transition-all duration-300 ${
                role === "police"
                  ? "bg-white text-blue-600 shadow-sm ring-1 ring-black/5"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
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
                  ? "bg-white text-indigo-600 shadow-sm ring-1 ring-black/5"
                  : "text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <Settings size={16} />
              System Admin
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            {error && (
              <p role="alert" className="rounded-xl border border-red-500/30 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
                {error}
              </p>
            )}
            {/* Username / Badge ID */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-500 pl-1">
                {role === "police" ? "Badge ID / Username" : "Admin ID"}
              </label>
              <div className="relative">
                <User size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder={role === "police" ? "e.g. POL-4921" : "e.g. SYS-ADMIN"}
                  className="w-full rounded-xl border border-gray-200 bg-white/50 py-3 pl-10 pr-4 text-sm font-bold text-gray-900 transition-all placeholder:font-semibold placeholder:text-gray-300 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                />
              </div>
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-gray-500 pl-1">
                Password
              </label>
              <div className="relative">
                <Lock size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-gray-200 bg-white/50 py-3 pl-10 pr-4 text-sm font-bold text-gray-900 transition-all placeholder:text-gray-300 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10"
                />
              </div>
            </div>

            {/* Options */}
            <div className="flex items-center justify-between mt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                <span className="text-xs font-bold text-gray-500">Remember me</span>
              </label>
              <a href="#" className="text-xs font-bold text-blue-600 hover:text-blue-700">
                Forgot password?
              </a>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className={`group relative mt-4 flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-4 py-3.5 text-sm font-black text-white shadow-lg transition-all duration-300 hover:scale-[1.02] active:scale-95 ${
                role === "police" 
                  ? "bg-blue-600 shadow-blue-600/30 hover:bg-blue-700" 
                  : "bg-indigo-600 shadow-indigo-600/30 hover:bg-indigo-700"
              }`}
            >
              <span className="relative z-10 flex items-center gap-2">
                Authenticate & Login
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </span>
            </button>
          </form>
          
        </div>
      </div>
    </div>
  );
}