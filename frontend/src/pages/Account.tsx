import { useState, type FormEvent } from 'react';
import { Notice, PageHeader, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export function Account() {
  const { isAdmin, familyName } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError('Hai lần nhập mật khẩu mới không khớp');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      toast('Đã đổi mật khẩu. Các thiết bị khác cần đăng nhập lại.');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (isAdmin) {
    return (
      <>
        <PageHeader title="Tài khoản" />
        <Notice tone="info">Mật khẩu quản trị được đổi bằng lệnh npx wrangler secret put ADMIN_PASSWORD. Tài khoản của từng gia đình được cấp ở trang Gia đình.</Notice>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Tài khoản" subtitle={familyName ?? undefined} />
      <form onSubmit={submit} className="card max-w-md space-y-4 p-4">
        <h2 className="font-semibold">Đổi mật khẩu</h2>
        <div>
          <label className="label" htmlFor="current">
            Mật khẩu hiện tại
          </label>
          <input id="current" type="password" className="input" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="next">
            Mật khẩu mới
          </label>
          <input id="next" type="password" className="input" required minLength={8} maxLength={128} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <p className="hint">Từ 8 ký tự trở lên.</p>
        </div>
        <div>
          <label className="label" htmlFor="confirm">
            Nhập lại mật khẩu mới
          </label>
          <input id="confirm" type="password" className="input" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Đổi mật khẩu
        </button>
      </form>
    </>
  );
}
