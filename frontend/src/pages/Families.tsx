import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { Family } from '../../../src/types/domain';
import { ConfirmDialog, Empty, ErrorBox, Loading, PageHeader, useToast } from '../components/ui';
import { api, useApi } from '../lib/api';

function AccountForm({ family, onDone }: { family: Family; onDone: () => void }) {
  const toast = useToast();
  const [username, setUsername] = useState(family.username ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/families/${family.id}/account`, { method: 'PUT', body: { username, password } });
      toast(family.username ? 'Đã đặt lại. Gia đình cần đăng nhập lại.' : 'Đã cấp tài khoản');
      onDone();
    } catch (err) {
      toast((err as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2 bg-subtle px-4 py-3 sm:grid-cols-[1fr_1fr_auto_auto]">
      <input className="input" required autoCapitalize="none" autoComplete="off" maxLength={32} placeholder="Tên đăng nhập, ví dụ nhanoi" aria-label="Tên đăng nhập" value={username} onChange={(e) => setUsername(e.target.value)} />
      <input className="input" required type="password" autoComplete="new-password" minLength={8} maxLength={128} placeholder="Mật khẩu, từ 8 ký tự" aria-label="Mật khẩu" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit" className="btn btn-primary" disabled={busy}>
        Lưu
      </button>
      <button type="button" className="btn" onClick={onDone}>
        Hủy
      </button>
    </form>
  );
}

function FamilyRow({ family, onChanged }: { family: Family; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [confirmRemoveAccount, setConfirmRemoveAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState(false);

  async function removeAccount() {
    setConfirmRemoveAccount(false);
    try {
      await api(`/families/${family.id}/account`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/families/${family.id}`, { method: 'PUT', body: { name } });
      setName(null);
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function remove() {
    setConfirm(false);
    try {
      await api(`/families/${family.id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  if (name !== null) {
    return (
      <form onSubmit={save} className="flex gap-2 px-4 py-3">
        <input className="input" autoFocus required maxLength={60} aria-label="Tên gia đình" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn btn-primary shrink-0">
          Lưu
        </button>
        <button type="button" className="btn shrink-0" onClick={() => setName(null)}>
          Hủy
        </button>
      </form>
    );
  }

  return (
    <div>
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{family.name}</p>
        <Link to={`/ngay-gio?family=${family.id}`} className="text-sm text-muted hover:text-accent hover:underline">
          {family.eventCount} ngày giỗ
        </Link>
        <p className="mt-0.5 text-sm text-muted">
          {family.username ? (
            <>
              Tài khoản: <span className="font-mono text-ink">{family.username}</span>
            </>
          ) : (
            'Chưa có tài khoản'
          )}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn btn-sm" onClick={() => setEditingAccount(true)}>
          {family.username ? 'Đặt lại mật khẩu' : 'Cấp tài khoản'}
        </button>
        {family.username && (
          <button type="button" className="btn btn-sm" onClick={() => setConfirmRemoveAccount(true)}>
            Thu hồi
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={() => setName(family.name)}>
          Đổi tên
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirm(true)}>
          Xóa
        </button>
      </div>
      <ConfirmDialog open={confirmRemoveAccount} title={`Thu hồi tài khoản "${family.username}"?`} confirmLabel="Thu hồi" danger onConfirm={removeAccount} onCancel={() => setConfirmRemoveAccount(false)}>
        Gia đình sẽ không đăng nhập được nữa và bị đăng xuất khỏi mọi thiết bị. Ngày giỗ vẫn được giữ nguyên.
      </ConfirmDialog>
      <ConfirmDialog open={confirm} title={`Xóa gia đình "${family.name}"?`} confirmLabel="Xóa" danger onConfirm={remove} onCancel={() => setConfirm(false)}>
        {family.eventCount > 0 ? `${family.eventCount} ngày giỗ trong gia đình này vẫn được giữ lại, chỉ chuyển sang "Chưa xếp gia đình". ` : ''}
        Tài khoản của gia đình này sẽ bị xóa theo. Chat chỉ nhận riêng gia đình này sẽ không còn nhận tin của gia đình đó.
      </ConfirmDialog>
    </div>
    {editingAccount && (
      <AccountForm
        family={family}
        onDone={() => {
          setEditingAccount(false);
          onChanged();
        }}
      />
    )}
    </div>
  );
}

export function Families() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ families: Family[] }>('/families');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/families', { method: 'POST', body: { name } });
      setName('');
      reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Gia đình" subtitle="Cấp cho mỗi gia đình một tài khoản: họ chỉ thấy và tự quản lý ngày giỗ của gia đình mình." />
      <div className="space-y-4">
        <form onSubmit={add} className="flex gap-2">
          <input className="input" required maxLength={60} placeholder="Ví dụ: Nhà nội, Nhà ngoại" aria-label="Tên gia đình mới" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn-primary shrink-0" disabled={busy}>
            Thêm
          </button>
        </form>
        {loading && !data && <Loading />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {data && data.families.length === 0 && <Empty title="Chưa có gia đình nào">Thêm gia đình đầu tiên ở ô phía trên.</Empty>}
        {data && data.families.length > 0 && (
          <div className="card divide-y divide-line overflow-hidden">
            {data.families.map((family) => (
              <FamilyRow key={family.id} family={family} onChanged={reload} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
