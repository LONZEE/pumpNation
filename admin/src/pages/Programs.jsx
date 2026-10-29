import { useState, useEffect } from "react";

const DAYS = ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6"];
const EMPTY_EX = { Day: "Day 1", Focus: "", Exercise: "", TargetSets: "3", TargetReps: "10", TargetWeight: "", Notes: "", Type: "strength" };

export default function Programs({ api }) {
  const [grouped,  setGrouped]  = useState({});
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState("");
  const [expanded, setExpanded] = useState(null);
  const [showNew,  setShowNew]  = useState(false);
  const [newName,  setNewName]  = useState("");
  const [exercises, setExercises] = useState([{ ...EMPTY_EX }]);
  const [saving,   setSaving]   = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true); setError("");
    try {
      const r    = await fetch(`${api.base}/api/programs`, { headers: api.headers });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setGrouped(data.grouped || {});
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function del(name) {
    if (!confirm(`Delete program "${name}" and all its exercises?`)) return;
    const r    = await fetch(`${api.base}/api/programs/${encodeURIComponent(name)}`, { method: "DELETE", headers: api.headers });
    const data = await r.json();
    if (data.error) return alert("Error: " + data.error);
    load();
  }

  async function saveNew() {
    if (!newName.trim()) return alert("Program name is required");
    if (!exercises.some(e => e.Exercise.trim())) return alert("Add at least one exercise");
    setSaving(true);
    try {
      const rows = exercises
        .filter(e => e.Exercise.trim())
        .map(e => ({ ...e, ProgramName: newName.trim() }));
      const r    = await fetch(`${api.base}/api/programs`, {
        method: "POST", headers: api.headers, body: JSON.stringify(rows)
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      setShowNew(false);
      setNewName("");
      setExercises([{ ...EMPTY_EX }]);
      load();
    } catch (e) { alert("Error: " + e.message); }
    finally { setSaving(false); }
  }

  const programNames = Object.keys(grouped);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Programs <span className="text-gray-500 text-base font-normal">({programNames.length})</span></h2>
        <button onClick={() => setShowNew(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded-lg font-semibold transition">
          + New Program
        </button>
      </div>

      {error   && <p className="text-red-400 mb-4">{error}</p>}
      {loading && <p className="text-gray-400">Loading…</p>}

      {/* Program list */}
      <div className="space-y-3">
        {programNames.length === 0 && !loading && (
          <p className="text-gray-500 text-center py-10">No programs yet. Click "+ New Program" to create one.</p>
        )}
        {programNames.map(name => {
          const rows = grouped[name] || [];
          const daySet = [...new Set(rows.map(r => r.Day))].sort();
          const isOpen = expanded === name;
          return (
            <div key={name} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : name)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-800/50 transition text-left"
              >
                <div>
                  <span className="font-semibold text-white">{name}</span>
                  <span className="ml-3 text-gray-500 text-sm">{rows.length} exercises · {daySet.length} days</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={e => { e.stopPropagation(); del(name); }}
                    className="text-red-500 hover:text-red-400 text-xs px-2 py-1 rounded"
                  >Delete</button>
                  <span className="text-gray-500">{isOpen ? "▲" : "▼"}</span>
                </div>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 border-t border-gray-800">
                  {daySet.map(day => (
                    <div key={day} className="mt-4">
                      <h4 className="text-orange-400 text-sm font-semibold mb-2">{day}</h4>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-gray-500 text-xs uppercase">
                            <th className="text-left py-1 pr-4">Exercise</th>
                            <th className="text-left py-1 pr-4">Sets</th>
                            <th className="text-left py-1 pr-4">Reps</th>
                            <th className="text-left py-1 pr-4">Weight</th>
                            <th className="text-left py-1">Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.filter(r => r.Day === day).map((r, i) => (
                            <tr key={i} className="border-t border-gray-800/50">
                              <td className="py-1.5 pr-4 text-white">{r.Exercise}</td>
                              <td className="py-1.5 pr-4 text-gray-400">{r.TargetSets || "—"}</td>
                              <td className="py-1.5 pr-4 text-gray-400">{r.TargetReps || "—"}</td>
                              <td className="py-1.5 pr-4 text-gray-400">{r.TargetWeight || "—"}</td>
                              <td className="py-1.5 text-gray-500 text-xs">{r.Type || "strength"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* New Program Modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl p-6 my-8">
            <h3 className="text-xl font-bold mb-5">New Program</h3>

            <div className="mb-5">
              <label className="block text-gray-400 text-sm mb-1">Program Name *</label>
              <input
                value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Strength Phase 1"
                className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:border-orange-500"
              />
            </div>

            <h4 className="text-gray-400 text-sm font-semibold uppercase tracking-wide mb-3">Exercises</h4>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {exercises.map((ex, i) => (
                <div key={i} className="bg-gray-800 rounded-xl p-3 relative">
                  <button
                    onClick={() => setExercises(list => list.filter((_, idx) => idx !== i))}
                    className="absolute top-3 right-3 text-gray-500 hover:text-red-400 text-xs"
                  >✕</button>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <label className="block text-gray-500 text-xs mb-1">Exercise *</label>
                      <input
                        value={ex.Exercise}
                        onChange={e => setExercises(list => list.map((x, idx) => idx === i ? {...x, Exercise: e.target.value} : x))}
                        placeholder="e.g. Bench Press"
                        className="w-full bg-gray-700 text-white px-3 py-1.5 rounded-lg text-sm border border-gray-600 focus:outline-none focus:border-orange-500"
                      />
                    </div>
                    <ExField label="Day" value={ex.Day} onChange={v => setExercises(l => l.map((x,idx) => idx===i?{...x,Day:v}:x))}>
                      <select value={ex.Day} onChange={e => setExercises(l => l.map((x,idx) => idx===i?{...x,Day:e.target.value}:x))}
                        className="w-full bg-gray-700 text-white px-3 py-1.5 rounded-lg text-sm border border-gray-600 focus:outline-none focus:border-orange-500">
                        {DAYS.map(d => <option key={d}>{d}</option>)}
                      </select>
                    </ExField>
                    <ExInput label="Focus / Theme"    value={ex.Focus}         onChange={v => setExercises(l => l.map((x,idx)=>idx===i?{...x,Focus:v}:x))}         ph="e.g. Push" />
                    <ExInput label="Target Sets"      value={ex.TargetSets}    onChange={v => setExercises(l => l.map((x,idx)=>idx===i?{...x,TargetSets:v}:x))}    ph="3" />
                    <ExInput label="Target Reps"      value={ex.TargetReps}    onChange={v => setExercises(l => l.map((x,idx)=>idx===i?{...x,TargetReps:v}:x))}    ph="10" />
                    <ExInput label="Target Weight"    value={ex.TargetWeight}  onChange={v => setExercises(l => l.map((x,idx)=>idx===i?{...x,TargetWeight:v}:x))}  ph="135 lbs" />
                    <ExField label="Type">
                      <select value={ex.Type} onChange={e => setExercises(l => l.map((x,idx)=>idx===i?{...x,Type:e.target.value}:x))}
                        className="w-full bg-gray-700 text-white px-3 py-1.5 rounded-lg text-sm border border-gray-600 focus:outline-none focus:border-orange-500">
                        <option value="strength">Strength</option>
                        <option value="cardio">Cardio</option>
                      </select>
                    </ExField>
                    <ExInput label="Notes"            value={ex.Notes}         onChange={v => setExercises(l => l.map((x,idx)=>idx===i?{...x,Notes:v}:x))}         ph="" />
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setExercises(l => [...l, { ...EMPTY_EX }])}
              className="mt-3 w-full border border-dashed border-gray-600 hover:border-orange-500 text-gray-400 hover:text-orange-400 py-2 rounded-xl text-sm transition"
            >+ Add Exercise</button>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { setShowNew(false); setNewName(""); setExercises([{...EMPTY_EX}]); }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-lg transition"
              >Cancel</button>
              <button
                onClick={saveNew} disabled={saving || !newName.trim()}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition"
              >{saving ? "Saving…" : "Create Program"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExInput({ label, value, onChange, ph }) {
  return (
    <div>
      <label className="block text-gray-500 text-xs mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={ph}
        className="w-full bg-gray-700 text-white px-3 py-1.5 rounded-lg text-sm border border-gray-600 focus:outline-none focus:border-orange-500"
      />
    </div>
  );
}

function ExField({ label, children }) {
  return (
    <div>
      <label className="block text-gray-500 text-xs mb-1">{label}</label>
      {children}
    </div>
  );
}
