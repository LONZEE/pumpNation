import { useState } from "react";
import Clients  from "./pages/Clients.jsx";
import Programs from "./pages/Programs.jsx";

const API_BASE = "/.netlify/functions/admin-api";

export default function App() {
  const [secret, setSecret]   = useState(() => sessionStorage.getItem("pn_admin") || "");
  const [input,  setInput]    = useState("");
  const [page,   setPage]     = useState("clients");
  const [authErr, setAuthErr] = useState("");

  const api = { base: API_BASE, headers: { "Content-Type": "application/json", "x-admin-secret": secret } };

  async function login() {
    setAuthErr("");
    const r = await fetch(`${API_BASE}/api/health`, { headers: { "x-admin-secret": input } });
    if (r.ok) {
      sessionStorage.setItem("pn_admin", input);
      setSecret(input);
    } else {
      setAuthErr("Wrong password");
    }
  }

  if (!secret) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-sm shadow-2xl">
          <div className="flex items-center gap-3 mb-8">
            <span className="text-3xl">🏋️</span>
            <h1 className="text-white text-2xl font-bold">Pump Nation Admin</h1>
          </div>
          <label className="block text-gray-400 text-sm mb-1">Admin Password</label>
          <input
            type="password"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && login()}
            placeholder="Enter your admin password"
            className="w-full bg-gray-800 text-white px-4 py-2.5 rounded-lg border border-gray-700 focus:outline-none focus:border-orange-500 mb-3"
            autoFocus
          />
          {authErr && <p className="text-red-400 text-sm mb-3">{authErr}</p>}
          <button
            onClick={login}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-lg transition"
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "clients",  label: "Clients",  icon: "👥" },
    { id: "programs", label: "Programs", icon: "📋" }
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <span className="text-xl">🏋️</span>
        <span className="text-orange-400 font-bold text-lg mr-auto">Pump Nation Admin</span>
        <nav className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setPage(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                page === t.id
                  ? "bg-orange-500 text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </nav>
        <button
          onClick={() => { sessionStorage.removeItem("pn_admin"); setSecret(""); }}
          className="ml-4 text-gray-500 hover:text-white text-sm"
        >
          Sign out
        </button>
      </header>

      {/* Page */}
      <main className="p-6 max-w-7xl mx-auto">
        {page === "clients"  && <Clients  api={api} />}
        {page === "programs" && <Programs api={api} />}
      </main>
    </div>
  );
}
