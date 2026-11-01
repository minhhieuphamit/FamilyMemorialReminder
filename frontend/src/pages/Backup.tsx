import { useState, type ChangeEvent } from 'react';
import { ConfirmDialog, Notice, PageHeader } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Pending {
  name: string;
  format: 'json' | 'csv';
  content: string;
}

export function Backup() {
  const { isAdmin } = useAuth();
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setResult(null);
    setPending({ name: file.name, format: file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json', content: await file.text() });
  }

  async function runImport() {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await api<{ inserted: number; updated: number }>('/backup/import', {
        method: 'POST',
        body: { format: pending.format, content: pending.content, mode },
      });
      setResult({ tone: 'ok', text: `Đã nhập xong: thêm mới ${res.inserted}, cập nhật ${res.updated}.` });
    } catch (err) {
      setResult({ tone: 'danger', text: (err as ApiError).message });
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Sao lưu và khôi phục" />
      <div className="space-y-4">
        <section className="card space-y-3 p-4">
          <div>
            <h2 className="font-semibold">Xuất dữ liệu</h2>
            <p className="mt-0.5 text-sm text-muted">
              {isAdmin ? 'JSON gồm ngày giỗ, gia đình, lịch nhắc và Chat ID. CSV chỉ gồm ngày giỗ kèm tên gia đình, mở được bằng Excel.' : 'JSON gồm ngày giỗ và lịch nhắc của gia đình. CSV chỉ gồm ngày giỗ, mở được bằng Excel.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a className="btn" href="/api/backup/export?format=json" download>
              Tải JSON
            </a>
            <a className="btn" href="/api/backup/export?format=csv" download>
              Tải CSV
            </a>
          </div>
        </section>

        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Nhập dữ liệu</h2>
          <fieldset className="space-y-1.5">
            <legend className="sr-only">Chế độ nhập</legend>
            <label className={`flex cursor-pointer gap-2.5 rounded-xl border p-3 ${mode === 'merge' ? 'border-accent bg-accent-soft' : 'border-line'}`}>
              <input type="radio" name="mode" className="accent-[var(--accent)]" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              <span className="text-sm">
                <b className="font-medium">Gộp:</b> cập nhật dòng trùng họ tên và ngày âm, thêm dòng mới{isAdmin ? ' và Chat ID còn thiếu' : ''}.
              </span>
            </label>
            <label className={`flex cursor-pointer gap-2.5 rounded-xl border p-3 ${mode === 'replace' ? 'border-accent bg-accent-soft' : 'border-line'}`}>
              <input type="radio" name="mode" className="accent-[var(--accent)]" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span className="text-sm">
                <b className="font-medium">Thay thế:</b> xóa toàn bộ ngày giỗ {isAdmin ? 'hiện có' : 'của gia đình'} rồi nhập theo file, khôi phục cả lịch nhắc nếu file có.
              </span>
            </label>
          </fieldset>
          <label className="btn cursor-pointer">
            Chọn file JSON hoặc CSV
            <input type="file" accept=".json,.csv,application/json,text/csv" className="sr-only" onChange={pickFile} />
          </label>
          <p className="hint">File có dòng không hợp lệ sẽ bị từ chối toàn bộ, dữ liệu hiện tại giữ nguyên.</p>
          {result && <Notice tone={result.tone}>{result.text}</Notice>}
        </section>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={mode === 'replace' ? 'Thay thế toàn bộ ngày giỗ?' : 'Nhập dữ liệu từ file?'}
        confirmLabel={busy ? 'Đang nhập...' : mode === 'replace' ? 'Xóa và nhập' : 'Nhập'}
        danger={mode === 'replace'}
        onConfirm={runImport}
        onCancel={() => setPending(null)}
      >
        File <b>{pending?.name}</b>.{' '}
        {mode === 'replace' ? 'Toàn bộ ngày giỗ hiện có sẽ bị xóa. Nên tải bản sao lưu JSON trước.' : 'Dòng trùng sẽ được cập nhật theo file.'}
      </ConfirmDialog>
    </>
  );
}
