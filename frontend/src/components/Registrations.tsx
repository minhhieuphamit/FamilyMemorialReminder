import { useEffect, useState } from 'react';
import type { Registration, RegistrationAdmin } from '../../../src/types/domain';
import { api, useApi } from '../lib/api';
import { ErrorBox, useToast } from './ui';
import { Pagination } from './Pagination';

export function Registrations({ onApproved }: { onApproved: () => void }) {
  const toast = useToast();
  const [page,setPage] = useState(1);
  const [pageSize,setSize] = useState(10);
  const [status,setStatus] = useState('pending');
  const {data,error,loading,reload} = useApi<{requests:Registration[];total:number}>(`/registrations?status=${status}&page=${page}&pageSize=${pageSize}`);
  const config = useApi<{admins:RegistrationAdmin[]}>('/registrations/admins');
  const [admins,setAdmins] = useState<RegistrationAdmin[]>([]);
  const [busy,setBusy] = useState(false);
  useEffect(()=>{if(config.data) setAdmins(config.data.admins);},[config.data]);
  useEffect(()=>{ if(data && !loading && page>Math.max(1,Math.ceil(data.total/pageSize))) setPage(Math.max(1,Math.ceil(data.total/pageSize))); },[data,loading,page,pageSize]);
  async function review(id:number,decision:'approved'|'rejected') {
    setBusy(true);
    try {
      const result = await api<{warning:string|null}>(`/registrations/${id}/review`,{method:'POST',body:{decision}});
      toast(result.warning ?? (decision==='approved'?'Đã duyệt đăng ký':'Đã từ chối đăng ký'),result.warning?'error':'ok');
      reload();
      if (decision === 'approved') onApproved();
    } catch(e) {toast((e as Error).message,'error'); reload();}
    finally {setBusy(false);}
  }
  async function notify(id:number) {
    setBusy(true);
    try { const r=await api<{ok:boolean;error?:string}>(`/registrations/${id}/notify`,{method:'POST',body:{}});toast(r.ok?'Đã gửi thông báo duyệt':r.error??'Chưa gửi được',r.ok?'ok':'error');reload(); }
    catch(e){toast((e as Error).message,'error');} finally{setBusy(false);}
  }
  return <section id="dang-ky" className="card scroll-mt-6">
    <div className="space-y-3 border-b border-line p-4">
      <h2 className="font-semibold">Đăng ký thành viên theo gia đình</h2>
      <p className="text-sm text-muted">Người dùng nhắn riêng cho bot: <code>/dangky Tên gia đình | Họ tên</code>, hoặc mở <a href="/dang-ky" className="underline">form đăng ký</a>. Chỉ được truy cập sau khi admin duyệt.</p>
      <h3 className="font-medium">Admin duyệt và nhận thông báo</h3>
      <p className="hint">Thêm Chat ID Telegram/Zalo của người quản lý. Các chat này được duyệt hoặc từ chối đăng ký qua bot (<code>/choduyet</code>, <code>/duyet 12</code>, <code>/tuchoi 12</code>) và nhận thông báo khi có quyết định, kể cả quyết định trên website. Chỉ thêm chat bạn tin tưởng; quyền này không cho đăng nhập website.</p>
      {config.error && <ErrorBox message={config.error} onRetry={config.reload}/>}
      <form className="space-y-2" onSubmit={async e=>{
        e.preventDefault();setBusy(true);
        try{await api('/registrations/admins',{method:'PUT',body:{admins:admins.map(a=>({...a,chatId:a.chatId.trim()}))}});toast('Đã lưu người nhận thông báo');config.reload();}
        catch(err){toast((err as Error).message,'error');}finally{setBusy(false);}
      }}>
        {admins.map((a,i)=><div key={i} className="flex flex-wrap gap-2">
          <select className="input w-auto" aria-label={`Kênh admin ${i+1}`} value={a.channel} disabled={busy} onChange={e=>setAdmins(admins.map((x,j)=>j===i?{...x,channel:e.target.value as RegistrationAdmin['channel']}:x))}><option value="telegram">Telegram</option><option value="zalo">Zalo</option></select>
          <input className="input min-w-0 flex-1" aria-label={`Chat ID admin ${i+1}`} placeholder="Chat ID admin" required value={a.chatId} disabled={busy} onChange={e=>setAdmins(admins.map((x,j)=>j===i?{...x,chatId:e.target.value}:x))}/>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={()=>setAdmins(admins.filter((_,j)=>j!==i))}>Gỡ</button>
        </div>)}
        {!admins.length && <p className="text-sm text-muted">Chưa chọn người nhận. Yêu cầu vẫn được lưu để duyệt tại đây.</p>}
        <div className="flex gap-2"><button type="button" className="btn" disabled={busy || admins.length>=10 || config.loading} onClick={()=>setAdmins([...admins,{channel:'telegram',chatId:''}])}>Thêm quản lý</button><button className="btn btn-primary" disabled={busy || config.loading || !!config.error}>Lưu người nhận</button></div>
      </form>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 p-4">
      <h3 className="font-semibold">Yêu cầu đăng ký ({data?.total ?? 0})</h3>
      <div className="flex gap-2"><select className="input w-auto" aria-label="Trạng thái đăng ký" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>
        <option value="pending">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Đã từ chối</option><option value="">Tất cả</option>
      </select><button className="btn" type="button" onClick={reload}>Tải lại</button></div>
    </div>
    {error && <ErrorBox message={error} onRetry={reload}/>}
    {data?.requests.length===0 && <p className="p-4 text-sm text-muted">Không có yêu cầu nào.</p>}
    <div className="divide-y divide-line">{data?.requests.map(r=><div className="space-y-2 p-4" key={r.id}>
      <p className="font-medium">#{r.id} · {r.full_name} · {r.family_name}</p>
      <p className="break-all text-sm text-muted">{r.channel==='zalo'?'Zalo':'Telegram'} · {r.chat_id} · {new Date(r.created_at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</p>
      <p className="text-sm">{r.status==='pending'?'Chờ duyệt':r.status==='approved'?'Đã duyệt':'Đã từ chối'}</p>
      {r.status==='pending' && <>
        {r.admin_notice_error && <p className="text-sm text-danger">{r.admin_notice_error}</p>}
        <div className="flex flex-wrap gap-2"><button className="btn btn-primary" disabled={busy} onClick={()=>review(r.id,'approved')}>Duyệt vào {r.family_name}</button><button className="btn btn-danger" disabled={busy} onClick={()=>review(r.id,'rejected')}>Từ chối</button><button className="btn" disabled={busy} onClick={()=>notify(r.id)}>Gửi lại thông báo cho admin</button></div>
      </>}
      {r.result_notice_error && <p className="text-sm text-danger">{r.result_notice_error}</p>}
    </div>)}</div>
    {data && <Pagination page={page} pageSize={pageSize} total={data.total} disabled={loading||busy} onPageChange={setPage} onPageSizeChange={size=>{setSize(size);setPage(1);}}/>}
  </section>;
}
