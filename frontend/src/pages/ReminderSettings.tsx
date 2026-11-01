import { useEffect, useState } from 'react';
import type { CronRunResult, ReminderSetting } from '../../../src/types/domain';
import { ErrorBox, Loading, Notice, PageHeader, Toggle, useToast } from '../components/ui';
import { api, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';

interface SettingsData {
  reminders: ReminderSetting[];
  notificationsEnabled: boolean;
  upcomingWindowDays: number;
}

export function ReminderSettings() {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const { data, error, loading, reload } = useApi<SettingsData>('/settings/reminders');
  const [form, setForm] = useState<SettingsData | null>(null);
  const [newOffset, setNewOffset] = useState('');
  const [busy, setBusy] = useState(false);
  const [runResult, setRunResult] = useState<CronRunResult | null>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (loading && !form) return <Loading />;
  if (error || !form) return <ErrorBox message={error ?? 'Không tải được cài đặt'} onRetry={reload} />;

  function addOffset() {
    const value = Number(newOffset);
    if (!form || newOffset === '' || !Number.isInteger(value) || value < 0 || value > 60) {
      toast('Mốc nhắc phải là số ngày từ 0 đến 60', 'error');
      return;
    }
    if (form.reminders.some((r) => r.daysBefore === value)) {
      toast('Mốc này đã có', 'error');
      return;
    }
    setForm({ ...form, reminders: [...form.reminders, { daysBefore: value, enabled: true }].sort((a, b) => b.daysBefore - a.daysBefore) });
    setNewOffset('');
  }

  async function save() {
    setBusy(true);
    try {
      await api('/settings/reminders', { method: 'PUT', body: form });
      toast('Đã lưu lịch nhắc');
      reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function previewCard() {
    setBusy(true);
    try {
      const res = await fetch('/api/notifications/card-preview', { method: 'POST' });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Lỗi ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      setCardUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return url;
      });
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setBusy(true);
    try {
      const { result } = await api<{ result: CronRunResult }>('/notifications/run-now', { method: 'POST', body: {} });
      setRunResult(result);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Cài đặt nhắc nhở" subtitle="Bot tự gửi lúc 07:00 sáng giờ Việt Nam mỗi ngày." />
      <div className="space-y-4">
        <section className="card flex items-center justify-between gap-3 p-4">
          <div>
            <h2 className="font-semibold">Gửi thông báo tự động</h2>
            <p className="mt-0.5 text-sm text-muted">{isAdmin ? 'Tắt mục này thì không gia đình nào nhận nhắc, bot vẫn tra cứu được.' : 'Tắt mục này thì gia đình không nhận nhắc, bot vẫn tra cứu được.'}</p>
          </div>
          <Toggle label="Gửi thông báo tự động" checked={form.notificationsEnabled} onChange={(v) => setForm({ ...form, notificationsEnabled: v })} />
        </section>

        <section className="card overflow-hidden">
          <div className="p-4">
            <h2 className="font-semibold">{isAdmin ? 'Lịch nhắc chung' : 'Lịch nhắc của gia đình'}</h2>
            <p className="mt-0.5 text-sm text-muted">{isAdmin ? 'Áp dụng cho gia đình chưa đặt lịch riêng và ngày giỗ chưa xếp gia đình.' : 'Áp dụng cho ngày giỗ của gia đình không đặt lịch riêng.'}</p>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {form.reminders.map((r) => (
              <li key={r.daysBefore} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm font-medium">{r.daysBefore === 0 ? 'Đúng ngày giỗ' : `Trước ${r.daysBefore} ngày`}</span>
                <span className="flex items-center gap-3">
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => setForm({ ...form, reminders: form.reminders.filter((x) => x.daysBefore !== r.daysBefore) })}>
                    Bỏ
                  </button>
                  <Toggle
                    label={`Bật mốc ${r.daysBefore} ngày`}
                    checked={r.enabled}
                    onChange={(enabled) => setForm({ ...form, reminders: form.reminders.map((x) => (x.daysBefore === r.daysBefore ? { ...x, enabled } : x)) })}
                  />
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 border-t border-line bg-subtle p-4">
            <input type="number" inputMode="numeric" min={0} max={60} className="input" placeholder="Số ngày trước, ví dụ 14" aria-label="Thêm mốc nhắc" value={newOffset} onChange={(e) => setNewOffset(e.target.value)} />
            <button type="button" className="btn shrink-0" onClick={addOffset}>
              Thêm mốc
            </button>
          </div>
        </section>

        <section className="card p-4">
          <label className="label" htmlFor="window">
            Khoảng "Sắp tới" trên trang Tổng quan (ngày)
          </label>
          <input id="window" type="number" inputMode="numeric" min={1} max={365} className="input max-w-32" value={form.upcomingWindowDays} onChange={(e) => setForm({ ...form, upcomingWindowDays: Number(e.target.value) })} />
        </section>

        <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={busy} onClick={save}>
          Lưu lịch nhắc
        </button>

        <section className="card space-y-3 p-4">
          <div>
            <h2 className="font-semibold">Ảnh thiệp nhắc ngày giỗ</h2>
            <p className="mt-0.5 text-sm text-muted">Mỗi nhắc được gửi kèm ảnh thiệp. Khi không tạo được ảnh, tin nhắc tự chuyển sang dạng chữ.</p>
          </div>
          <button type="button" className="btn" disabled={busy} onClick={previewCard}>
            Xem thử thiệp
          </button>
          {cardUrl && <img src={cardUrl} alt="Ảnh thiệp nhắc ngày giỗ" className="w-full max-w-xl rounded-xl border border-line" />}
        </section>

        <section className="card space-y-3 p-4">
          <div>
            <h2 className="font-semibold">Chạy đợt nhắc ngay</h2>
            <p className="mt-0.5 text-sm text-muted">Gửi những nhắc đến hạn hôm nay tới mọi người nhận. Mỗi lần bấm đều gửi lại, kể cả nhắc đã gửi.</p>
          </div>
          <button type="button" className="btn" disabled={busy} onClick={runNow}>
            Chạy ngay
          </button>
          {runResult && (
            <Notice tone={runResult.failed > 0 ? 'warn' : 'ok'}>
              Đến hạn {runResult.due} · Đã gửi {runResult.sent} · Lỗi {runResult.failed}
              {runResult.note ? ` · ${runResult.note}` : ''}
            </Notice>
          )}
        </section>
      </div>
    </>
  );
}
