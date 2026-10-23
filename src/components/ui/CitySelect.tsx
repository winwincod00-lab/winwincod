"use client";
import { useId } from 'react';
export default function CitySelect({ value, onChange, cities, error, id, disabled, label = 'المدينة' }: {
  value: string; onChange: (city: string) => void; cities: readonly string[]; error?: string; id?: string; disabled?: boolean; label?: string;
}) {
  const generated = useId();
  const controlId = id ?? generated;
  return <div>
    <label htmlFor={controlId} className="block text-xs font-bold mb-1">{label}</label>
    <select id={controlId} value={value} onChange={event => onChange(event.target.value)} disabled={disabled} required
      aria-invalid={!!error} aria-describedby={error ? controlId + '-error' : undefined}
      className="w-full min-h-11 border border-slate-300 rounded-xl bg-white p-3 text-sm focus-visible:outline-2 focus-visible:outline-blue-700">
      <option value="">اختر المدينة / Choisir la ville</option>
      {value && !cities.includes(value) && <option value={value}>{value}</option>}
      {cities.map(city => <option key={city} value={city}>{city}</option>)}
    </select>
    {error && <p id={controlId + '-error'} className="text-red-700 text-sm mt-1">{error}</p>}
  </div>;
}
