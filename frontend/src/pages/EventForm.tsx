import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { formatLunarLabel, resolveLunarYear } from '../../../src/services/occurrences';
import type { EventView, Family, LeapMonthRule, MissingDayRule } from '../../../src/types/domain';
import { formatDateVN, parseISODate, todayInVietnam } from '../../../src/utils/dates';
import { solarToLunar } from '../../../src/utils/lunar-calendar';
import { adjustmentNote } from '../components/EventRow';
import { LunarDatePicker, type LunarValue } from '../components/LunarDatePicker';
import { ConfirmDialog, ErrorBox, Loading, Notice, PageHeader, Toggle, useToast } from '../components/ui';
import { api, ApiError, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';
import { LEAP_RULE_OPTIONS, MISSING_DAY_OPTIONS, RELATIONSHIPS, unresolvedReason } from '../lib/labels';

const OFFSET_PRESETS = [30, 14, 7, 5, 3, 2, 1, 0];
const CUSTOM = '__custom__';
const NEW_FAMILY = '__new__';

interface FormState {
  fullName: string;
  familyId: string;
  newFamilyName: string;
  relationship: string;
  customRelationship: string;
  lunar: LunarValue;
  deathYear: string;
  deathSolarDate: string;
  notes: string;
  leapMonthRule: LeapMonthRule;
  missingDayRule: MissingDayRule;
  reminderEnabled: boolean;
  customOffsets: number[] | null;
}

const EMPTY_FORM: FormState = {
  fullName: '',
  familyId: '',
  newFamilyName: '',
  relationship: '',
  customRelationship: '',
  lunar: { day: 1, month: 1, isLeap: false },
  deathYear: '',
  deathSolarDate: '',
  notes: '',
  leapMonthRule: 'exact',
  missingDayRule: 'skip',
  reminderEnabled: true,
  customOffsets: null,
};

function fromEvent(e: EventView): FormState {
  const known = e.relationship === '' || RELATIONSHIPS.includes(e.relationship);
  return {
    fullName: e.fullName,
    familyId: e.familyId === null ? '' : String(e.familyId),
    newFamilyName: '',
    relationship: known ? e.relationship : CUSTOM,
    customRelationship: known ? '' : e.relationship,
    lunar: { day: e.lunarDay, month: e.lunarMonth, isLeap: e.isLeapMonth },
    deathYear: e.deathYear?.toString() ?? '',
    deathSolarDate: e.deathSolarDate ?? '',
    notes: e.notes,
    leapMonthRule: e.leapMonthRule,
    missingDayRule: e.missingDayRule,
    reminderEnabled: e.reminderEnabled,
    customOffsets: e.reminderOffsets,
  };
}

function RulePreview({ form, startYear }: { form: FormState; startYear: number }) {
  const rule = {
    lunarDay: form.lunar.day,
    lunarMonth: form.lunar.month,
    isLeapMonth: form.lunar.isLeap,
    leapMonthRule: form.leapMonthRule,
    missingDayRule: form.missingDayRule,
  };
  const years = Array.from({ length: 5 }, (_, i) => startYear + i);
  return (
    <ul className="divide-y divide-line text-sm">
      {years.map((year) => {
        const { occurrences, unresolved } = resolveLunarYear(rule, year);
        return (
          <li key={year} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 py-2">
            <span className="text-muted">Năm âm {year}</span>
            <span className="text-right">
              {occurrences.map((o) => (
                <span key={o.solarDate} className="block font-medium">
                  {formatDateVN(o.solarDate)}
                  {o.isLeapMonth && <span className="font-normal text-muted"> (tháng nhuận)</span>}
                  {adjustmentNote(o.adjustment) && <span className="block text-xs font-normal text-warn">{adjustmentNote(o.adjustment)}</span>}
                </span>
              ))}
              {unresolved.map((u) => (
                <span key={u.reason} className="block text-warn">
                  Không có ngày: {unresolvedReason(u)}
                </span>
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function RuleOptions<T extends string>(props: {
  legend: string;
  name: string;
  options: { value: T; label: string; hint: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="label">{props.legend}</legend>
      <div className="space-y-1.5">
        {props.options.map((o) => (
          <label key={o.value} className={`flex cursor-pointer gap-2.5 rounded-xl border p-3 ${props.value === o.value ? 'border-accent bg-accent-soft' : 'border-line'}`}>
            <input type="radio" name={props.name} className="mt-0.5 accent-[var(--accent)]" checked={props.value === o.value} onChange={() => props.onChange(o.value)} />
            <span>
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="block text-xs leading-relaxed text-muted">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function EventForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ event: EventView }>(id ? `/events/${id}` : null);
  const { isAdmin } = useAuth();
  const families = useApi<{ families: Family[] }>(isAdmin ? '/families' : null);

  const today = todayInVietnam();
  const currentLunarYear = useMemo(() => solarToLunar(parseISODate(today)).year, [today]);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pickerYear, setPickerYear] = useState(currentLunarYear);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (data) setForm(fromEvent(data.event));
  }, [data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  if (id && loading && !data) return <Loading />;
  if (id && error) return <ErrorBox message={error} onRetry={reload} />;

  const relationship = form.relationship === CUSTOM ? form.customRelationship : form.relationship;
  const deathYearNum = Number(form.deathSolarDate.slice(0, 4)) || Number(form.deathYear);

  function fillFromSolar() {
    const lunar = solarToLunar(parseISODate(form.deathSolarDate));
    setForm((f) => ({ ...f, lunar: { day: lunar.day, month: lunar.month, isLeap: lunar.isLeap }, deathYear: String(lunar.year) }));
    setPickerYear(lunar.year);
  }

  function toggleOffset(offset: number) {
    const current = form.customOffsets ?? [];
    set('customOffsets', current.includes(offset) ? current.filter((x) => x !== offset) : [...current, offset].sort((a, b) => b - a));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFields({});
    setFormError(null);
    let familyId = form.familyId && form.familyId !== NEW_FAMILY ? Number(form.familyId) : null;
    if (form.familyId === NEW_FAMILY) {
      try {
        const created = await api<{ family: Family }>('/families', { method: 'POST', body: { name: form.newFamilyName } });
        familyId = created.family.id;
        // Lưu ngày giỗ có lỗi và bấm lưu lại thì không tạo trùng gia đình.
        set('familyId', String(familyId));
        families.reload();
      } catch (err) {
        setFields({ familyId: (err as Error).message });
        setSaving(false);
        return;
      }
    }
    const body = {
      fullName: form.fullName,
      familyId,
      relationship,
      lunarDay: form.lunar.day,
      lunarMonth: form.lunar.month,
      isLeapMonth: form.lunar.isLeap,
      deathYear: form.deathYear ? Number(form.deathYear) : null,
      deathSolarDate: form.deathSolarDate || null,
      notes: form.notes,
      leapMonthRule: form.leapMonthRule,
      missingDayRule: form.missingDayRule,
      reminderEnabled: form.reminderEnabled,
      reminderOffsets: form.customOffsets,
    };
    try {
      await api(id ? `/events/${id}` : '/events', { method: id ? 'PUT' : 'POST', body });
      toast(id ? 'Đã lưu thay đổi' : 'Đã thêm ngày giỗ');
      navigate('/ngay-gio');
    } catch (err) {
      setFields((err as ApiError).fields ?? {});
      setFormError((err as Error).message);
      setSaving(false);
    }
  }

  async function remove() {
    setConfirmDelete(false);
    try {
      await api(`/events/${id}`, { method: 'DELETE' });
      toast('Đã xóa ngày giỗ');
      navigate('/ngay-gio');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  const lunarLabel = formatLunarLabel({ lunarDay: form.lunar.day, lunarMonth: form.lunar.month, isLeapMonth: form.lunar.isLeap });

  return (
    <>
      <PageHeader title={id ? 'Sửa ngày giỗ' : 'Thêm ngày giỗ'} />
      <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="space-y-4">
          <section className="card space-y-4 p-4">
            <div>
              <label className="label" htmlFor="fullName">
                Họ và tên người mất
              </label>
              <input id="fullName" className="input" required maxLength={120} value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
              {fields.fullName && <p className="field-error">{fields.fullName}</p>}
            </div>
            {isAdmin && (
              <div>
                <label className="label" htmlFor="family">
                  Gia đình <span className="font-normal text-muted">(không bắt buộc)</span>
                </label>
                <select id="family" className="input" value={form.familyId} onChange={(e) => set('familyId', e.target.value)}>
                  <option value="">Chưa xếp gia đình</option>
                  {families.data?.families.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                  <option value={NEW_FAMILY}>Tạo gia đình mới...</option>
                </select>
                {form.familyId === NEW_FAMILY && (
                  <input className="input mt-2" placeholder="Ví dụ: Nhà nội" aria-label="Tên gia đình mới" required maxLength={60} value={form.newFamilyName} onChange={(e) => set('newFamilyName', e.target.value)} />
                )}
                {fields.familyId && <p className="field-error">{fields.familyId}</p>}
              </div>
            )}
            <div>
              <label className="label" htmlFor="relationship">
                Quan hệ <span className="font-normal text-muted">(không bắt buộc)</span>
              </label>
              <select id="relationship" className="input" value={form.relationship} onChange={(e) => set('relationship', e.target.value)}>
                <option value="">Không ghi</option>
                {RELATIONSHIPS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
                <option value={CUSTOM}>Tùy chỉnh...</option>
              </select>
              {form.relationship === CUSTOM && (
                <input className="input mt-2" placeholder="Ví dụ: Cụ nội, Bác cả" aria-label="Quan hệ tùy chỉnh" required maxLength={60} value={form.customRelationship} onChange={(e) => set('customRelationship', e.target.value)} />
              )}
              {fields.relationship && <p className="field-error">{fields.relationship}</p>}
            </div>
          </section>

          <section className="card space-y-4 p-4">
            <div>
              <span className="label">Ngày giỗ âm lịch</span>
              <LunarDatePicker value={form.lunar} onChange={(v) => set('lunar', v)} year={pickerYear} onYearChange={setPickerYear} />
              {(fields.lunarDay || fields.lunarMonth) && <p className="field-error">{fields.lunarDay ?? fields.lunarMonth}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="deathSolarDate">
                  Ngày mất dương lịch <span className="font-normal text-muted">(không bắt buộc)</span>
                </label>
                <input id="deathSolarDate" type="date" className="input" max={today} value={form.deathSolarDate} onChange={(e) => set('deathSolarDate', e.target.value)} />
                {form.deathSolarDate && (
                  <button type="button" className="btn btn-sm mt-2" onClick={fillFromSolar}>
                    Điền ngày âm từ ngày này
                  </button>
                )}
                {fields.deathSolarDate && <p className="field-error">{fields.deathSolarDate}</p>}
              </div>
              <div>
                <label className="label" htmlFor="deathYear">
                  Năm mất <span className="font-normal text-muted">(không bắt buộc)</span>
                </label>
                <input id="deathYear" type="number" inputMode="numeric" className="input" min={1800} max={2200} value={form.deathYear} onChange={(e) => set('deathYear', e.target.value)} />
                {fields.deathYear && <p className="field-error">{fields.deathYear}</p>}
              </div>
            </div>
            {deathYearNum > 0 && deathYearNum < 1968 && (
              <Notice tone="info">Trước năm 1968, lịch âm Việt Nam tính theo múi giờ UTC+8. Ngày đổi tự động có thể lệch so với gia phả, nên đối chiếu nếu có.</Notice>
            )}
          </section>

          <section className="card space-y-4 p-4">
            <RuleOptions legend="Quy tắc tháng nhuận" name="leapRule" options={LEAP_RULE_OPTIONS} value={form.leapMonthRule} onChange={(v) => set('leapMonthRule', v)} />
            {form.lunar.day === 30 && (
              <RuleOptions legend="Khi tháng chỉ có 29 ngày" name="missingRule" options={MISSING_DAY_OPTIONS} value={form.missingDayRule} onChange={(v) => set('missingDayRule', v)} />
            )}
          </section>

          <section className="card space-y-4 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Bật nhắc nhở</span>
              <Toggle label="Bật nhắc nhở" checked={form.reminderEnabled} onChange={(v) => set('reminderEnabled', v)} />
            </div>
            {form.reminderEnabled && (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm">Dùng lịch nhắc riêng cho ngày giỗ này</span>
                  <Toggle label="Dùng lịch nhắc riêng" checked={form.customOffsets !== null} onChange={(v) => set('customOffsets', v ? [7, 3, 1, 0] : null)} />
                </div>
                {form.customOffsets === null ? (
                  <p className="hint">Đang theo lịch chung trong trang Nhắc nhở.</p>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {OFFSET_PRESETS.map((offset) => {
                      const on = form.customOffsets!.includes(offset);
                      return (
                        <button key={offset} type="button" aria-pressed={on} className={`chip ${on ? 'chip-on' : ''}`} onClick={() => toggleOffset(offset)}>
                          {offset === 0 ? 'Đúng ngày' : `${offset} ngày`}
                        </button>
                      );
                    })}
                  </div>
                )}
                {fields.reminderOffsets && <p className="field-error">{fields.reminderOffsets}</p>}
              </div>
            )}
            <div>
              <label className="label" htmlFor="notes">
                Ghi chú
              </label>
              <textarea id="notes" rows={3} className="input" maxLength={1000} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              {fields.notes && <p className="field-error">{fields.notes}</p>}
            </div>
          </section>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-8">
          <section className="card p-4">
            <h2 className="font-semibold">Ngày dương các năm tới</h2>
            <p className="mb-1 text-sm text-muted">Giỗ {lunarLabel} âm lịch</p>
            <RulePreview form={form} startYear={currentLunarYear} />
          </section>
          {formError && <Notice tone="danger">{formError}</Notice>}
          <button type="submit" className="btn btn-primary w-full" disabled={saving}>
            {saving ? 'Đang lưu...' : id ? 'Lưu thay đổi' : 'Thêm ngày giỗ'}
          </button>
          <button type="button" className="btn w-full" onClick={() => navigate(-1)}>
            Hủy
          </button>
          {id && (
            <button type="button" className="btn btn-danger w-full" onClick={() => setConfirmDelete(true)}>
              Xóa ngày giỗ
            </button>
          )}
        </aside>
      </form>

      <ConfirmDialog open={confirmDelete} title="Xóa ngày giỗ này?" confirmLabel="Xóa" danger onConfirm={remove} onCancel={() => setConfirmDelete(false)}>
        Ngày giỗ của <b>{form.fullName}</b> sẽ bị xóa và không còn được nhắc. Lịch sử đã gửi vẫn được giữ lại.
      </ConfirmDialog>
    </>
  );
}
