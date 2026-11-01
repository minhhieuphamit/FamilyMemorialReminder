import { useState, type FormEvent } from 'react';
import type { Channel, ChannelStatus, Family, NotificationChat } from '../../../src/types/domain';
import { ConfirmDialog, ErrorBox, Loading, Notice, PageHeader, StatusDot, Toggle, useToast } from '../components/ui';
import { Registrations } from '../components/Registrations';
import { Pagination } from '../components/Pagination';
import { api, useApi } from '../lib/api';
import { useAuth } from '../lib/auth';

export const CHANNEL_LABELS: Record<Channel, string> = { telegram: 'Telegram', zalo: 'Zalo' };

const SECRET_NAMES: Record<Channel, { token: string; secret: string }> = {
  telegram: { token: 'TELEGRAM_BOT_TOKEN', secret: 'TELEGRAM_WEBHOOK_SECRET' },
  zalo: { token: 'ZALO_BOT_TOKEN', secret: 'ZALO_WEBHOOK_SECRET' },
};

interface TestResult {
  results: { chatId: string; ok: boolean; error?: string }[];
}

function StatusCard({ channel }: { channel: Channel }) {
  const { data, error, loading, reload } = useApi<ChannelStatus>(`/channels/${channel}/status`);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const names = SECRET_NAMES[channel];

  async function setupWebhook() {
    setBusy(true);
    try {
      await api(`/channels/${channel}/webhook`, { method: 'POST', body: {} });
      toast('Đã thiết lập webhook');
      reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const title = <h2 className="font-semibold">{CHANNEL_LABELS[channel]}</h2>;
  if (loading && !data) {
    return (
      <section className="card p-4">
        {title}
        <Loading />
      </section>
    );
  }
  if (error || !data) return <ErrorBox message={error ?? 'Không tải được trạng thái'} onRetry={reload} />;

  const webhookOk = data.webhook?.url === data.expectedWebhookUrl;
  return (
    <section className="card space-y-3 p-4">
      {title}
      <div className="flex flex-col gap-2">
        <StatusDot ok={data.bot !== null} label={data.bot ? `Bot đã kết nối: ${data.bot.name}` : data.tokenConfigured ? 'Không kết nối được bot' : `Chưa cấu hình ${names.token}`} />
        <StatusDot ok={data.webhookSecretConfigured} label={data.webhookSecretConfigured ? 'Đã có secret webhook' : `Chưa cấu hình ${names.secret}`} />
        <StatusDot ok={webhookOk} label={webhookOk ? 'Webhook đang trỏ đúng về website này' : 'Webhook chưa được thiết lập cho website này'} />
      </div>
      {data.error && <Notice tone="danger">{data.error}</Notice>}
      {data.webhook?.lastError && <Notice tone="warn">Lỗi webhook gần nhất: {data.webhook.lastError}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={busy || !data.tokenConfigured || !data.webhookSecretConfigured} onClick={setupWebhook}>
          {webhookOk ? 'Thiết lập lại webhook' : 'Thiết lập webhook'}
        </button>
        <button type="button" className="btn" onClick={reload}>
          Kiểm tra lại
        </button>
      </div>
    </section>
  );
}

function ChatRow({ chat, families, onChanged }: { chat: NotificationChat; families: Family[]; onChanged: () => void }) {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState(chat.chatId);
  const [editTitle, setEditTitle] = useState(chat.title);

  async function update(patch: Partial<NotificationChat>) {
    const { chatId, title, canQuery, receiveNotifications, allFamilies, familyIds } = { ...chat, ...patch };
    try {
      await api(`/chats/${chat.id}`, { method: 'PUT', body: { chatId, title, canQuery, receiveNotifications, allFamilies, familyIds } });
      onChanged();
      return true;
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function sendTest() {
    setSending(true);
    try {
      const { results } = await api<TestResult>('/chats/test', { method: 'POST', body: { id: chat.id } });
      if (results[0]?.ok) toast('Đã gửi tin nhắn thử');
      else toast(`Gửi thất bại: ${results[0]?.error ?? 'không rõ lỗi'}`, 'error');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSending(false);
    }
  }

  async function remove() {
    setConfirm(false);
    try {
      await api(`/chats/${chat.id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  function toggleFamily(id: number) {
    update({ familyIds: chat.familyIds.includes(id) ? chat.familyIds.filter((x) => x !== id) : [...chat.familyIds, id] });
  }

  return (
    <div className="space-y-2.5 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            <span className="mr-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">{CHANNEL_LABELS[chat.channel]}</span>
            {chat.title || 'Chưa đặt tên'}
          </p>
          <p className="mt-1 font-mono text-xs break-all text-muted">{chat.chatId}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {chat.editable && <button type="button" className="btn btn-sm" disabled={saving} onClick={() => { setEditId(chat.chatId); setEditTitle(chat.title); setEditing(true); }}>Sửa</button>}
          <button type="button" className="btn btn-sm" disabled={sending} onClick={sendTest}>
            {sending ? 'Đang gửi...' : 'Gửi thử'}
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setConfirm(true)}>
            {chat.editable ? 'Xóa' : 'Gỡ'}
          </button>
        </div>
      </div>
      {editing && <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]" onSubmit={async (e) => {
        e.preventDefault(); setSaving(true);
        try { if (await update({ chatId: editId.trim(), title: editTitle.trim() })) { setEditing(false); toast('Đã cập nhật Chat ID'); } }
        finally { setSaving(false); }
      }}>
        <label className="text-sm">Chat ID<input className="input" required value={editId} onChange={(e) => setEditId(e.target.value)} disabled={saving} /></label>
        <label className="text-sm">Tên gợi nhớ<input className="input" maxLength={100} value={editTitle} onChange={(e) => setEditTitle(e.target.value)} disabled={saving} /></label>
        <button className="btn btn-primary self-end" type="submit" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu'}</button>
        <button className="btn self-end" type="button" disabled={saving} onClick={() => setEditing(false)}>Hủy</button>
      </form>}
      {!chat.editable && <p className="hint">Chat này đã được dùng ở nơi khác nên không sửa được, chỉ gỡ khỏi gia đình của bạn.</p>}
      {chat.editable && <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <span className="flex items-center gap-2">
          <Toggle label={`Nhận thông báo: ${chat.chatId}`} checked={chat.receiveNotifications} onChange={(v) => update({ receiveNotifications: v })} />
          Nhận thông báo
        </span>
        <span className="flex items-center gap-2">
          <Toggle label={`Được tra cứu: ${chat.chatId}`} checked={chat.canQuery} onChange={(v) => update({ canQuery: v })} />
          Được tra cứu qua bot
        </span>
        {isAdmin && families.length > 0 && (
          <span className="flex items-center gap-2">
            <Toggle label={`Mọi gia đình: ${chat.chatId}`} checked={chat.allFamilies} onChange={(v) => update({ allFamilies: v, familyIds: v ? [] : chat.familyIds })} />
            Mọi gia đình
          </span>
        )}
      </div>}
      {isAdmin && !chat.allFamilies && (
        <div>
          <div className="flex flex-wrap gap-1.5">
            {families.map((f) => {
              const on = chat.familyIds.includes(f.id);
              return (
                <button key={f.id} type="button" aria-pressed={on} className={`chip ${on ? 'chip-on' : ''}`} onClick={() => toggleFamily(f.id)}>
                  {f.name}
                </button>
              );
            })}
          </div>
          <p className="hint">{chat.familyIds.length === 0 ? 'Chưa chọn gia đình nào nên chat này không nhận tin và không xem được ngày giỗ.' : 'Chat này chỉ thấy các gia đình đã chọn, không thấy ngày giỗ chưa xếp gia đình.'}</p>
        </div>
      )}
      <ConfirmDialog open={confirm} title="Xóa Chat ID này?" confirmLabel="Xóa" danger onConfirm={remove} onCancel={() => setConfirm(false)}>
        Chat này sẽ không còn nhận thông báo và không tra cứu được qua bot.
      </ConfirmDialog>
    </div>
  );
}

function ChatsCard() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ chats: NotificationChat[] }>('/chats');
  const { isAdmin } = useAuth();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const visiblePage = Math.min(page, Math.max(1, Math.ceil((data?.chats.length ?? 0) / pageSize)));
  const families = useApi<{ families: Family[] }>(isAdmin ? '/families' : null);
  const [channel, setChannel] = useState<Channel>('telegram');
  const [chatId, setChatId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/chats', { method: 'POST', body: { channel, chatId: chatId.trim(), title } });
      setChatId('');
      setTitle('');
      reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function testAll() {
    setBusy(true);
    try {
      const { results } = await api<TestResult>('/chats/test', { method: 'POST', body: {} });
      const ok = results.filter((r) => r.ok).length;
      toast(`Đã gửi thử: ${ok}/${results.length} chat thành công`, ok === results.length ? 'ok' : 'error');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <div>
          <h2 className="font-semibold">Chat ID được phép</h2>
          <p className="mt-0.5 text-sm text-muted">Chat không có trong danh sách sẽ không xem được dữ liệu. Gửi /id cho bot để lấy mã.</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={busy || !data?.chats.length} onClick={testAll}>
          Gửi thông báo thử
        </button>
      </div>
      {loading && !data && <Loading />}
      {error && (
        <div className="px-4 pb-4">
          <ErrorBox message={error} onRetry={reload} />
        </div>
      )}
      <div className="divide-y divide-line border-t border-line">
        {data?.chats.slice((visiblePage - 1) * pageSize, visiblePage * pageSize).map((chat) => <ChatRow key={chat.id} chat={chat} families={families.data?.families ?? []} onChanged={reload} />)}
        {data && <Pagination page={visiblePage} pageSize={pageSize} total={data.chats.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} />}
        <form onSubmit={add} className="grid gap-2 bg-subtle p-4 sm:grid-cols-[auto_1fr_1fr_auto]">
          <select className="input sm:w-auto" aria-label="Kênh" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            <option value="telegram">Telegram</option>
            <option value="zalo">Zalo</option>
          </select>
          <input className="input" required placeholder="Chat ID" aria-label="Chat ID" value={chatId} onChange={(e) => setChatId(e.target.value)} />
          <input className="input" placeholder="Tên gợi nhớ, ví dụ Mẹ" aria-label="Tên gợi nhớ" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="submit" className="btn" disabled={busy}>
            Thêm
          </button>
        </form>
      </div>
    </section>
  );
}

export function ChannelSettings() {
  const [chatVersion, setChatVersion] = useState(0);
  const { isAdmin } = useAuth();
  return (
    <>
      <PageHeader
        title="Kênh gửi"
        subtitle={isAdmin ? 'Kết nối bot Telegram, Zalo và chọn ai nhận thông báo.' : 'Chọn ai trong gia đình nhận thông báo qua Telegram hoặc Zalo.'}
      />
      <div className="space-y-4">
        {isAdmin && (
          <div className="grid gap-4 md:grid-cols-2">
            <StatusCard channel="telegram" />
            <StatusCard channel="zalo" />
          </div>
        )}
        {isAdmin && <Registrations onApproved={() => setChatVersion(v => v + 1)} />}
        <ChatsCard key={chatVersion} />
      </div>
    </>
  );
}
