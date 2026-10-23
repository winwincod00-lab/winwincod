"use client";
import { moroccoCities } from '@/data/moroccoCities';
import CitySelect from '@/components/ui/CitySelect';
export default function CitySelector({ value, onChange, error }: { value: string; onChange: (city: string) => void; error?: boolean }) {
  return <CitySelect value={value} onChange={onChange} cities={moroccoCities} error={error ? 'اختر المدينة' : undefined} />;
}
