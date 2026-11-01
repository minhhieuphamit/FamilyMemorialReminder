import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { htmlToPlainText } from '../../../src/utils/text';

export function Register() {
  const [channel,setChannel]=useState('telegram');
  const [chatId,setChatId]=useState('');
  const [name,setName]=useState('');
  const [family,setFamily]=useState('');
  const [token,setToken]=useState('');
  const [code,setCode]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  return <main className="mx-auto max-w-lg p-4 sm:py-12"><div className="card space-y-4 p-6">
    <h1 className="text-2xl font-semibold">Đăng ký nhận tin gia đình</h1>
    <p className="text-sm text-muted">Chọn gia đình bạn tham gia. Admin sẽ duyệt trước khi bạn được nhận thông báo và tra cứu ngày giỗ. Đây là đăng ký nhận tin qua bot, không tạo tài khoản đăng nhập website.</p>
    {message ? <p role="status" className="whitespace-pre-line">{htmlToPlainText(message)}</p> : <form className="space-y-3" onSubmit={async e=>{
      e.preventDefault();setBusy(true);setError('');
      try {
        if(token){const r=await api<{message:string}>('/registration-public/verify',{method:'POST',body:{token,code}});setMessage(r.message);}
        else {const r=await api<{token:string}>('/registration-public/start',{method:'POST',body:{channel,chatId,name,family}});setToken(r.token);}
      }catch(err){setError((err as Error).message);}finally{setBusy(false);}
    }}>
      {!token ? <>
        <label className="block text-sm">Họ tên<input className="input mt-1" required maxLength={100} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
        <label className="block text-sm">Tên gia đình<input className="input mt-1" required maxLength={100} placeholder="Ví dụ: Nhà ngoại" value={family} disabled={busy} onChange={e=>setFamily(e.target.value)}/></label>
        <label className="block text-sm">Kênh nhận tin<select className="input mt-1" value={channel} disabled={busy} onChange={e=>setChannel(e.target.value)}><option value="telegram">Telegram</option><option value="zalo">Zalo</option></select></label>
        <label className="block text-sm">Chat ID<input className="input mt-1" required value={chatId} disabled={busy} onChange={e=>setChatId(e.target.value)}/></label>
        <p className="hint">Nhắn /start rồi /id cho bot để lấy Chat ID. Mã xác nhận sẽ được gửi tới chat này.</p>
      </> : <>
        <p className="text-sm">Nhập mã 6 số bot vừa gửi qua {channel==='telegram'?'Telegram':'Zalo'}. Mã có hiệu lực 10 phút.</p>
        <label className="block text-sm">Mã xác nhận<input className="input mt-1" required pattern="[0-9]{6}" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={busy} onChange={e=>setCode(e.target.value)}/></label>
        <button className="text-sm underline" type="button" disabled={busy} onClick={()=>{setToken('');setCode('');setError('');}}>Sửa thông tin / yêu cầu mã mới</button>
      </>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>{busy?'Đang xử lý...':token?'Xác nhận và gửi đăng ký':'Gửi mã xác nhận'}</button>
    </form>}
    <p className="text-sm text-muted">Hoặc nhắn trực tiếp cho bot: <code>/dangky Tên gia đình | Họ tên</code></p>
    <Link className="inline-block text-sm underline" to="/">Về trang đăng nhập / trang chủ</Link>
  </div></main>;
}
