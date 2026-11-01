import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Notice } from '../components/ui';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { username, password } });
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <img src="/favicon.svg" alt="" className="mb-4 size-10" />
        <h1 className="text-xl font-semibold tracking-tight">Ngày giỗ gia đình</h1>
        <p className="mt-1 mb-5 text-sm text-muted">Đăng nhập để quản lý lịch giỗ.</p>
        <label className="label" htmlFor="username">
          Tên đăng nhập
        </label>
        <input
          id="username"
          className="input"
          autoComplete="username"
          autoCapitalize="none"
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <label className="label mt-4" htmlFor="password">
          Mật khẩu
        </label>
        <input
          id="password"
          type="password"
          className="input"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <div className="mt-3">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <button type="submit" className="btn btn-primary mt-4 w-full" disabled={busy}>
          {busy ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  );
}
