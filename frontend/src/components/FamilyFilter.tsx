import type { Family } from '../../../src/types/domain';
import { useAuth } from '../lib/auth';

/** Ô lọc theo gia đình, chỉ quản trị viên mới cần. Giá trị: "" tất cả, "none" chưa xếp, hoặc id gia đình. */
export function FamilyFilter({ families, value, onChange }: { families: Family[]; value: string; onChange: (v: string) => void }) {
  const { isAdmin } = useAuth();
  if (!isAdmin || families.length === 0) return null;
  return (
    <select className="input w-auto flex-1 sm:flex-none" aria-label="Lọc theo gia đình" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Mọi gia đình</option>
      {families.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
      <option value="none">Chưa xếp gia đình</option>
    </select>
  );
}
