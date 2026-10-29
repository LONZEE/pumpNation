import { useState, useEffect } from "react";

const EMPTY = { Email: "", Name: "", AssignedProgram: "", StartDate: "", Active: "Yes" };

export default function Clients({ api }) {
  const [clients,      setClients]     = useState([]);
  const [programNames, setProgramNames] = useState([]);
  const [loading,      setLoading]     = useState(true);
  const [error,        setError]       = useState("");
  const [modal,        setModal]       = useState(null); // null | "add" | client-object for edit
  const [form,         setForm]        = useState(EMPTY);
  const [saving,       setSaving]      = useState(false);
  const [search,       setSearch]      = useState("");

  useEffect(() => { load(); loadPrograms(); }, []);

  async function load() {
    setLoading(true); setError("");
    try {
      const r    = await fetch(`${api.base}/api/clients`, { headers: api.headers });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setClients(data.clients || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function loadPrograms() {
    try {
      const r    = await fetch(`${api.base}/api/programs`, { headers: api.headers });
      const data = await r.json();
      if (data.programNames) setProgramNames(data.programNames);
    } catch {}
  }

  function openAdd()        { setForm(EMPTY);    setModal("add"); }
  function openEdit(client) { setForm({ ...client }); setModal(client); }

  async function save() {
    setSaving(true);
    try {
      let r;
      if (modal === "add") {
        r = await fetch(`${api.base}/api/clients`, {
          method: "POST", headers: api.headers, body: JSON.stringify(form)
        });
      } else {
        r = await fetch(`${api.base}/api/clients/${encodeURIComponent(modal.Email)}`, {
          method: "PUT", headers: api.headers, body: JSON.stringify(form)
        });
      }
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setModal(null);
      load();
    } catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  }

  async function del(email) {
    if (!confirm(`Remove client ${email}? This only removes them from the sheet — logs are kept.`)) return;
    const r    = await fetch(`${api.base}/api/clients/${encodeURIComponent(email)}`, { method: "DELETE", headers: api.headers });
    const data = await r.json();
    if (data.error) return alert("Error: " + data.error);
    load();
  }

  const filtered = clients.filter(c =>
    !search ||
    (c.Email  || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.Name   || "").toLowerCase().includes(search.toLowerCase()) ||
    (c.AssignedProgram || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Clients <span className="text-gray-500 text-base font-normal">({clients.length})</span></h2>
        <button onClick={openAdd} className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded-lg font-semibold transition">
          + Add Client
        </button>
      </div>

      {/* Search */}
      <input
        value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, email or program…"
        className="w-full max-w-md bg-gray-800 text-white px-4 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-orange-500 mb-5"
      />

      {error   && <p className="text-red-400 mb-4">{error}</p>}
      {loading && <p className="text-gray-400">Loading…</p>}

      {/* Table */}
      {!loading && (
        <div className="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-800 text-gray-400 uppercase text-xs">
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Email</th>
                <th className="px-4 py-3 text-left">Program</th>
                <th className="px-4 py-3 text-left">Start Date</th>
                <th className="px-4 py-3 text-left">Active</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No clients found</td></tr>
              )}
              {filtered.map((c, i) => (
                <tr key={c.Email || i} className="border-t border-gray-800 hover:bg-gray-800/50">
                  <td className="px-4 py-3 font-medium">{c.Name}</td>
                  <td className="px-4 py-3 text-gray-400">{c.Email}</td>
                  <td className="px-4 py-3">
                    {c.AssignedProgram
                      ? <span className="bg-orange-500/20 text-orange-300 text-xs px-2 py-1 rounded">{c.AssignedProgram}</span>
                      : <span className="text-gray-600 text-xs">none</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{c.StartDate || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded ${
                      String(c.Active || "").toLowerCase() === "yes"
                        ? "bg-green-500/20 text-green-400"
                        : "bg-gray-700 text-gray-400"
                    }`}>
                      {c.Active || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(c)} className="text-gray-400 hover:text-white mr-3 text-xs">Edit</button>
                    <button onClick={() => del(c.Email)} className="text-red-500 hover:text-red-400 text-xs">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal !== null && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md p-6">
            <h3 className="text-xl font-bold mb-5">{modal === "add" ? "Add Client" : "Edit Client"}</h3>
            <div className="space-y-3">
              <Field label="Email *"          value={form.Email}           onChange={v => setForm(f => ({...f, Email: v}))}           disabled={modal !== "add"} />
              <Field label="Full Name *"       value={form.Name}            onChange={v => setForm(f => ({...f, Name: v}))} />
              <div>
                <label className="block text-gray-400 text-sm mb-1">Assigned Program</label>
                <select
                  value={form.AssignedProgram}
                  onChange={e => setForm(f => ({...f, AssignedProgram: e.target.value}))}
                  className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-orange-500"
                >
                  <option value="">— none —</option>
                  {programNames.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <Field label="Start Date (YYYY-MM-DD)" value={form.StartDate}        onChange={v => setForm(f => ({...f, StartDate: v}))} />
              <div>
                <label className="block text-gray-400 text-sm mb-1">Active</label>
                <select
                  value={form.Active}
                  onChange={e => setForm(f => ({...f, Active: e.target.value}))}
                  className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-orange-500"
                >
                  <option>Yes</option>
                  <option>No</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setModal(null)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg transition"
              >Cancel</button>
              <button
                onClick={save} disabled={saving || !form.Email || !form.Name}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg transition"
              >{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, disabled }) {
  return (
    <div>
      <label className="block text-gray-400 text-sm mb-1">{label}</label>
      <input
        value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-orange-500 disabled:opacity-50"
      />
    </div>
  );
}
