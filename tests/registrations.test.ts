import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from './helpers/fake-d1';
import { createFamily } from '../src/database/families-repo';
import { createChat, getChatAccess, listChats } from '../src/database/chats-repo';
import { createEvent } from '../src/database/events-repo';
import { getRegistration, listRegistrations, reviewRegistration, setRegistrationAdmins, submitRegistration } from '../src/database/registrations-repo';
import { handleIncoming, handleZaloUpdate } from '../src/bot/handler';
import { makeEvent, makeFakeSender } from './helpers/factories';
import { createApp } from '../src/api';
import { createSession } from '../src/database/sessions-repo';
import { sha256Hex } from '../src/utils/crypto';
import type { Env } from '../src/types/env';

describe('Đăng ký theo gia đình',()=>{
  let db:D1Database; let familyId:number;
  const now=new Date();
  beforeEach(async()=>{db=createTestDb().db;familyId=(await createFamily(db,'Nhà ngoại')).id;});
  afterEach(()=>vi.unstubAllGlobals());
  it.each(['telegram','zalo'] as const)('danh sách công khai %s có gia đình chưa có ngày giỗ, không cấp quyền',async(channel)=>{
    await createFamily(db,'Nhà nội');
    const user=makeFakeSender();
    for(const text of ['/giadinh','/danhsachgiadinh','có những gia đình nào','/dangky']) {
      await handleIncoming({channel,chatId:'123',text,isGroup:false},db,user.sender,now);
      expect(user.sent.at(-1)?.text).toContain('/dangky Nhà ngoại | Họ tên của bạn');
      expect(user.sent.at(-1)?.text).toContain('Nhà nội');
    }
    expect(await getChatAccess(db,channel,'123')).toBeNull();
    expect((await listRegistrations(db,'',1,10)).total).toBe(0);
  });
  it.each(['telegram','zalo'] as const)('%s tách gia đình đã tham gia, chờ duyệt và chưa tham gia theo Chat ID',async(channel)=>{
    const noi=(await createFamily(db,'Nhà nội')).id;
    await createFamily(db,'Nhà chú');
    await createChat(db,{channel,chatId:'123',title:'Test',canQuery:true,receiveNotifications:true,allFamilies:false,familyIds:[familyId]});
    await submitRegistration(db,channel,'123','Test',noi);
    const user=makeFakeSender();
    for(const text of ['/giadinh','Gia đình nào đã tham gia, gia đình nào chưa tham gia?','toi da tham gia gia dinh nao','liệt kê gia đình','danh sách các gia đình','có những gia đình nào?']) {
      await handleIncoming({channel,chatId:'123',text,isGroup:false},db,user.sender,now);
      const reply=user.sent.at(-1)?.text??'';
      expect(reply.indexOf('Đã tham gia')).toBeLessThan(reply.indexOf('Nhà ngoại'));
      expect(reply.indexOf('Nhà ngoại')).toBeLessThan(reply.indexOf('Đang chờ duyệt'));
      expect(reply.indexOf('Đang chờ duyệt')).toBeLessThan(reply.indexOf('Nhà nội'));
      expect(reply.indexOf('Nhà nội')).toBeLessThan(reply.indexOf('Chưa tham gia'));
      expect(reply).toContain('/dangky Nhà chú | Họ tên của bạn');
      expect(reply).not.toContain('/dangky Nhà ngoại');
      expect(reply).not.toContain('/dangky Nhà nội');
    }
    const other=channel==='telegram'?'zalo':'telegram';
    await handleIncoming({channel:other,chatId:'123',text:'/giadinh',isGroup:false},db,user.sender,now);
    expect(user.sent.at(-1)?.text).not.toContain('Đã tham gia');
  });
  it('chat nhận mọi gia đình thấy tất cả đã tham gia, không còn lệnh đăng ký',async()=>{
    await createFamily(db,'Nhà nội');
    await createChat(db,{chatId:'123',title:'Test',canQuery:true,receiveNotifications:true,allFamilies:true});
    const user=makeFakeSender();
    await handleIncoming({channel:'telegram',chatId:'123',text:'gia đình nào đã tham gia',isGroup:false},db,user.sender,now);
    expect(user.sent[0].text).toContain('Đã tham gia</b> (2)');
    expect(user.sent[0].text).not.toContain('Chưa tham gia');
    expect(user.sent[0].text).not.toContain('/dangky');
  });
  it('câu hỏi ngày giỗ và chuyện phiếm trong nhóm không bị coi là hỏi danh sách',async()=>{
    await createChat(db,{chatId:'123',title:'Test',canQuery:true,receiveNotifications:true,allFamilies:true});
    const user=makeFakeSender();
    await handleIncoming({channel:'telegram',chatId:'123',text:'gia đình nào có giỗ tháng này',isGroup:true},db,user.sender,now);
    expect(user.sent.at(-1)?.text).toContain('Ngày giỗ tháng');
    const count=user.sent.length;
    await handleIncoming({channel:'telegram',chatId:'123',text:'gia đình nào cũng vui',isGroup:true},db,user.sender,now);
    expect(user.sent).toHaveLength(count);
  });
  describe('Duyệt qua bot',()=>{
    async function setup(){
      await setRegistrationAdmins(db,[{channel:'telegram',chatId:'999'},{channel:'zalo',chatId:'admin-zalo'}]);
      const tg=makeFakeSender(),zalo=makeFakeSender();
      const req=await submitRegistration(db,'telegram','123','Người mới',familyId);
      return {tg,zalo,req:req!,context:{senders:{telegram:tg.sender,zalo:zalo.sender},baseUrl:'https://gio.test'}};
    }
    it('admin Zalo duyệt: cấp quyền, báo người đăng ký và cả hai admin',async()=>{
      const {tg,zalo,req,context}=await setup();
      await handleIncoming({channel:'zalo',chatId:'admin-zalo',text:`/duyet ${req.id}`,isGroup:false},db,zalo.sender,now,context);
      expect(await getChatAccess(db,'telegram','123')).toEqual({allFamilies:false,familyIds:[familyId]});
      expect(tg.sent.find(m=>m.chatId==='123')?.text).toContain('đã được duyệt cho gia đình Nhà ngoại');
      for(const [user,chatId] of [[tg,'999'],[zalo,'admin-zalo']] as const){
        const notice=user.sent.find(m=>m.chatId===chatId)?.text;
        expect(notice).toContain(`Đăng ký #${req.id} đã được duyệt`);
        expect(notice).toContain('Người xử lý: Zalo');
      }
    });
    it.each([['/tuchoi','#'],['từ chối','']])('admin từ chối bằng "%s": không cấp quyền, báo mọi admin',async(verb,hash)=>{
      const {tg,zalo,req,context}=await setup();
      await handleIncoming({channel:'telegram',chatId:'999',text:`${verb} ${hash}${req.id}`,isGroup:false},db,tg.sender,now,context);
      expect(await getChatAccess(db,'telegram','123')).toBeNull();
      expect(tg.sent.find(m=>m.chatId==='123')?.text).toContain('chưa được chấp thuận');
      expect(zalo.sent[0].text).toContain('đã bị từ chối');
    });
    it('câu tự nhiên "duyệt 12" được nhận; duyệt lần hai báo đã xử lý, không báo lại',async()=>{
      const {tg,zalo,req,context}=await setup();
      await handleIncoming({channel:'telegram',chatId:'999',text:`duyệt ${req.id}`,isGroup:false},db,tg.sender,now,context);
      expect((await getRegistration(db,req.id))?.status).toBe('approved');
      const count=zalo.sent.length;
      await handleIncoming({channel:'telegram',chatId:'999',text:`/tuchoi ${req.id}`,isGroup:false},db,tg.sender,now,context);
      expect(tg.sent.at(-1)?.text).toContain('đã được xử lý');
      expect(zalo.sent).toHaveLength(count);
      expect((await getRegistration(db,req.id))?.status).toBe('approved');
    });
    it('/choduyet và /duyet không số liệt kê yêu cầu; hết yêu cầu thì báo không có',async()=>{
      const {tg,req,context}=await setup();
      for(const text of ['/choduyet','/duyet','chờ duyệt']){
        await handleIncoming({channel:'telegram',chatId:'999',text,isGroup:false},db,tg.sender,now,context);
        expect(tg.sent.at(-1)?.text).toContain(`/duyet ${req.id}`);
        expect(tg.sent.at(-1)?.text).toContain('Người mới');
      }
      await handleIncoming({channel:'telegram',chatId:'999',text:`/duyet ${req.id}`,isGroup:false},db,tg.sender,now,context);
      await handleIncoming({channel:'telegram',chatId:'999',text:'/choduyet',isGroup:false},db,tg.sender,now,context);
      expect(tg.sent.at(-1)?.text).toContain('Không có yêu cầu');
    });
    it('người không phải admin không duyệt được và không thấy danh sách, kể cả trùng Chat ID ở kênh khác',async()=>{
      const {req,context}=await setup();
      const user=makeFakeSender();
      for(const [channel,chatId] of [['telegram','123'],['zalo','999']] as const) for(const text of [`/duyet ${req.id}`,`duyệt ${req.id}`,'/choduyet']){
        await handleIncoming({channel,chatId,text,isGroup:false},db,user.sender,now,context);
      }
      expect(user.sent.map(m=>m.text).join()).not.toContain('Người mới');
      expect((await getRegistration(db,req.id))?.status).toBe('pending');
      expect(await getChatAccess(db,'telegram','123')).toBeNull();
    });
    it('Chat ID admin trong nhóm không duyệt được',async()=>{
      const {tg,req,context}=await setup();
      await handleIncoming({channel:'telegram',chatId:'999',text:`/duyet ${req.id}`,isGroup:true},db,tg.sender,now,context);
      expect(tg.sent.at(-1)?.text).toContain('nhắn riêng');
      expect((await getRegistration(db,req.id))?.status).toBe('pending');
    });
    it('một admin không nhận được thì vẫn lưu quyết định và cảnh báo người duyệt',async()=>{
      const {tg,req}=await setup();
      await handleIncoming({channel:'telegram',chatId:'999',text:`/duyet ${req.id}`,isGroup:false},db,tg.sender,now,{senders:{telegram:tg.sender},baseUrl:'https://gio.test'});
      expect((await getRegistration(db,req.id))?.status).toBe('approved');
      expect(tg.sent.at(-1)?.text).toContain('Chưa báo được cho admin qua Zalo');
      expect((await getRegistration(db,req.id))?.result_notice_error).toContain('Zalo');
    });
    it('thông báo có đăng ký mới kèm lệnh duyệt',async()=>{
      await setRegistrationAdmins(db,[{channel:'telegram',chatId:'999'}]);
      const user=makeFakeSender(),admin=makeFakeSender();
      await handleIncoming({channel:'zalo',chatId:'z1',text:'/dangky Nhà ngoại | Người mới',isGroup:false},db,user.sender,now,{senders:{telegram:admin.sender},baseUrl:'https://gio.test'});
      expect(admin.sent[0].text).toMatch(/\/duyet \d+/);
      expect(admin.sent[0].text).toMatch(/\/tuchoi \d+/);
    });
  });
  describe('Hủy đăng ký',()=>{
    const say=(channel:'telegram'|'zalo',text:string,sender:ReturnType<typeof makeFakeSender>['sender'],isGroup=false)=>handleIncoming({channel,chatId:'123',text,isGroup},db,sender,now);
    it.each(['telegram','zalo'] as const)('%s rời một gia đình, vẫn giữ gia đình còn lại',async(channel)=>{
      const noi=(await createFamily(db,'Nhà nội')).id;
      await createChat(db,{channel,chatId:'123',title:'Tên cũ',canQuery:true,receiveNotifications:true,allFamilies:false,familyIds:[familyId,noi]});
      const user=makeFakeSender();
      await say(channel,'/huydangky Nhà ngoại',user.sender);
      expect(user.sent.at(-1)?.text).toContain('Đã hủy đăng ký gia đình Nhà ngoại');
      expect(await getChatAccess(db,channel,'123')).toEqual({allFamilies:false,familyIds:[noi]});
      expect((await listChats(db))[0]).toMatchObject({title:'Tên cũ',receiveNotifications:true});
    });
    it('hủy gia đình cuối cùng thì xóa chat và đăng ký lại được',async()=>{
      await createChat(db,{chatId:'123',title:'Test',canQuery:true,receiveNotifications:true,allFamilies:false,familyIds:[familyId]});
      const user=makeFakeSender();
      await say('telegram','huỷ đăng ký nha ngoai',user.sender);
      expect(await listChats(db)).toHaveLength(0);
      await say('telegram','/dangky Nhà ngoại | Test',user.sender);
      expect((await listRegistrations(db,'pending',1,10)).total).toBe(1);
    });
    it('chat nhận mọi gia đình chuyển thành các gia đình còn lại',async()=>{
      const noi=(await createFamily(db,'Nhà nội')).id;
      await createChat(db,{channel:'zalo',chatId:'123',title:'Test',canQuery:true,receiveNotifications:true,allFamilies:true});
      await say('zalo','/huydangky Nhà ngoại',makeFakeSender().sender);
      expect(await getChatAccess(db,'zalo','123')).toEqual({allFamilies:false,familyIds:[noi]});
    });
    it('rút yêu cầu chờ duyệt, yêu cầu đó không còn duyệt được',async()=>{
      const req=await submitRegistration(db,'telegram','123','Test',familyId);
      const user=makeFakeSender();
      await say('telegram','/huydangky Nhà ngoại',user.sender);
      expect(user.sent.at(-1)?.text).toContain('Đã hủy yêu cầu');
      expect(await reviewRegistration(db,req!.id,'approved')).toBeNull();
      expect(await listChats(db)).toHaveLength(0);
    });
    it('chỉ tác động chat đang nhắn, đúng kênh',async()=>{
      await createChat(db,{chatId:'123',title:'Telegram',canQuery:true,receiveNotifications:true,allFamilies:false,familyIds:[familyId]});
      await createChat(db,{chatId:'456',title:'Khác',canQuery:true,receiveNotifications:true,allFamilies:false,familyIds:[familyId]});
      const user=makeFakeSender();
      await say('zalo','/huydangky Nhà ngoại',user.sender);
      expect(user.sent.at(-1)?.text).toContain('chưa tham gia');
      expect(await listChats(db)).toHaveLength(2);
    });
    it('nhận tên bắt đầu bằng "Gia đình" và câu có thêm từ "gia đình"',async()=>{
      const pham=(await createFamily(db,'Gia đình họ Phạm')).id;
      await createChat(db,{chatId:'123',title:'Test',canQuery:true,receiveNotifications:true,allFamilies:false,familyIds:[familyId,pham]});
      await say('telegram','hủy đăng ký gia đình họ phạm',makeFakeSender().sender);
      expect(await getChatAccess(db,'telegram','123')).toEqual({allFamilies:false,familyIds:[familyId]});
      await say('telegram','hủy đăng ký gia đình nhà ngoại',makeFakeSender().sender);
      expect(await listChats(db)).toHaveLength(0);
    });
    it('thiếu tên hoặc tên lạ thì hướng dẫn, không đổi gì; trong nhóm thì từ chối',async()=>{
      await createChat(db,{chatId:'123',title:'Test',canQuery:true,receiveNotifications:true,allFamilies:false,familyIds:[familyId]});
      const user=makeFakeSender();
      await say('telegram','/huydangky',user.sender);
      expect(user.sent.at(-1)?.text).toContain('/huydangky Nhà ngoại');
      await say('telegram','/huydangky Không có',user.sender);
      expect(user.sent.at(-1)?.text).toContain('/huydangky Nhà ngoại');
      await say('telegram','/huydangky Nhà ngoại',user.sender,true);
      expect(user.sent.at(-1)?.text).toContain('nhắn riêng');
      expect(await getChatAccess(db,'telegram','123')).toEqual({allFamilies:false,familyIds:[familyId]});
    });
  });
  describe('Hỏi hôm nay',()=>{
    // 01/11/2026 là 23/09 âm.
    const today=new Date('2026-11-01T02:00:00.000Z');
    async function setup(){
      const {id:_i,createdAt:_c,updatedAt:_u,familyName:_n,...input}=makeEvent({fullName:'Ông cố',relationship:'',familyId,lunarDay:23,lunarMonth:9});
      await createEvent(db,input);
      await createChat(db,{chatId:'123',title:'Test',canQuery:true,receiveNotifications:true,allFamilies:true});
      return makeFakeSender();
    }
    const context=(imageUrlFor:()=>Promise<string|null>)=>({senders:{},baseUrl:'https://gio.test',cards:{imageUrlFor}});
    const ask=(user:ReturnType<typeof makeFakeSender>,cards:ReturnType<typeof context>|undefined,text='hôm nay có giỗ ai')=>handleIncoming({channel:'telegram',chatId:'123',text,isGroup:false},db,user.sender,today,cards);
    it('gửi thiệp kèm chú thích, không gửi thêm chữ',async()=>{
      const user=await setup();
      await ask(user,context(async()=>'https://gio.test/cards/a.jpg'));
      expect(user.photos).toHaveLength(1);
      expect(user.photos[0].url).toBe('https://gio.test/cards/a.jpg');
      expect(user.photos[0].caption).toContain('Hôm nay là ngày giỗ của <b>Ông cố</b>');
      expect(user.sent).toHaveLength(0);
    });
    it('không tạo được ảnh thì trả lời bằng chữ',async()=>{
      const user=await setup();
      await ask(user,context(async()=>null));
      expect(user.photos).toHaveLength(0);
      expect(user.sent.at(-1)?.text).toContain('Ông cố');
    });
    it('gửi ảnh lỗi thì trả lời bằng chữ',async()=>{
      const user=await setup();
      user.failPhotos.set('123',new Error('Zalo từ chối ảnh') as never);
      await ask(user,context(async()=>'https://gio.test/cards/a.jpg'));
      expect(user.sent.at(-1)?.text).toContain('Ông cố');
    });
    it('hôm nay không có giỗ thì không tạo thiệp, vẫn trả lời',async()=>{
      const user=makeFakeSender();
      await createChat(db,{chatId:'123',title:'Test',canQuery:true,receiveNotifications:true,allFamilies:true});
      const imageUrlFor=vi.fn(async()=>'x');
      await ask(user,context(imageUrlFor));
      expect(imageUrlFor).not.toHaveBeenCalled();
      expect(user.sent.at(-1)?.text).toContain('Không có ngày giỗ nào');
    });
    it('câu hỏi khác vẫn trả lời bằng chữ, không tạo thiệp',async()=>{
      const user=await setup();
      const imageUrlFor=vi.fn(async()=>'x');
      await ask(user,context(imageUrlFor),'/thangnay');
      expect(imageUrlFor).not.toHaveBeenCalled();
      expect(user.sent.at(-1)?.text).toContain('Ông cố');
    });
  });
  it('danh sách rỗng trả hướng dẫn liên hệ admin',async()=>{
    const user=makeFakeSender();
    await handleIncoming({channel:'telegram',chatId:'123',text:'/giadinh',isGroup:false},createTestDb().db,user.sender,now);
    expect(user.sent[0].text).toContain('chưa có gia đình');
  });
  it('bot lưu chờ duyệt, gửi cả hai admin, không cấp quyền và không tạo trùng',async()=>{
    await setRegistrationAdmins(db,[{channel:'telegram',chatId:'999'},{channel:'zalo',chatId:'admin-zalo'}]);
    const user=makeFakeSender(),tg=makeFakeSender(),zalo=makeFakeSender();
    const msg={channel:'telegram' as const,chatId:'123',text:'/dangky Nhà ngoại | Người mới',isGroup:false};
    const context={senders:{telegram:tg.sender,zalo:zalo.sender},baseUrl:'https://gio.test'};
    await handleIncoming(msg,db,user.sender,now,context);
    expect(await getChatAccess(db,'telegram','123')).toBeNull();
    expect(tg.sent[0].chatId).toBe('999');expect(zalo.sent[0].chatId).toBe('admin-zalo');
    expect(tg.sent[0].text).toContain('/kenh-gui#dang-ky');
    await handleIncoming(msg,db,user.sender,now,context);
    expect((await listRegistrations(db,'pending',1,10)).total).toBe(1);
    expect(tg.sent).toHaveLength(1);expect(user.sent[1].text).toContain('đang chờ duyệt');
  });
  it('Zalo nhận câu đăng ký tự nhiên và thông báo sang Telegram',async()=>{
    await setRegistrationAdmins(db,[{channel:'telegram',chatId:'999'}]);
    const user=makeFakeSender(),admin=makeFakeSender();
    await handleZaloUpdate({event_name:'message.text.received',message:{chat:{id:'z-user',chat_type:'PRIVATE'},text:'đăng ký Nhà ngoại | Người mới'}},db,user.sender,now,{senders:{telegram:admin.sender},baseUrl:'https://gio.test'});
    expect(admin.sent).toHaveLength(1);expect((await listRegistrations(db,'pending',1,10)).requests[0].channel).toBe('zalo');
  });
  it('chặn nhóm, không hợp lệ, gia đình lạ và giới hạn spam',async()=>{
    const user=makeFakeSender();const msg={channel:'telegram' as const,chatId:'123',text:'/dangky Nhà ngoại | Test',isGroup:true};
    await handleIncoming(msg,db,user.sender,now);expect((await listRegistrations(db,'',1,10)).total).toBe(0);
    await handleIncoming({...msg,isGroup:false,text:'/dangky'},db,user.sender,now);expect(user.sent.at(-1)?.text).toContain('/dangky');
    for(let i=0;i<6;i++) await handleIncoming({...msg,isGroup:false,text:'/dangky Không có | Test'},db,user.sender,now);
    expect(user.sent.at(-1)?.text).toContain('1 giờ');expect((await listRegistrations(db,'',1,10)).total).toBe(0);
  });
  it('duyệt chỉ cấp phạm vi gia đình yêu cầu; không duyệt hai lần',async()=>{
    const req=await submitRegistration(db,'telegram','123','Test',familyId);
    expect((await reviewRegistration(db,req!.id,'approved'))?.status).toBe('approved');
    expect(await getChatAccess(db,'telegram','123')).toEqual({allFamilies:false,familyIds:[familyId]});
    expect(await reviewRegistration(db,req!.id,'rejected')).toBeNull();
    expect((await listChats(db))).toHaveLength(1);
  });
  it('giữ nguyên cài đặt cũ khi nối thêm gia đình; từ chối không cấp quyền',async()=>{
    const other=(await createFamily(db,'Nhà nội')).id;
    await createChat(db,{chatId:'123',title:'Tên cũ',canQuery:false,receiveNotifications:false,allFamilies:false,familyIds:[other]});
    const req=await submitRegistration(db,'telegram','123','Test',familyId);await reviewRegistration(db,req!.id,'approved');
    const chat=(await listChats(db))[0];expect(chat).toMatchObject({title:'Tên cũ',canQuery:false,receiveNotifications:false,allFamilies:false});expect(chat.familyIds.sort()).toEqual([familyId,other].sort());
    const reject=await submitRegistration(db,'zalo','z123','Test',familyId);await reviewRegistration(db,reject!.id,'rejected');expect(await getChatAccess(db,'zalo','z123')).toBeNull();
  });
  it('lỗi gửi một admin vẫn gửi kênh kia và giữ yêu cầu để duyệt',async()=>{
    await setRegistrationAdmins(db,[{channel:'telegram',chatId:'999'},{channel:'zalo',chatId:'admin'}]);
    const user=makeFakeSender(),zalo=makeFakeSender();
    await handleIncoming({channel:'telegram',chatId:'123',text:'/dangky Nhà ngoại | Test',isGroup:false},db,user.sender,now,{senders:{zalo:zalo.sender},baseUrl:'https://gio.test'});
    expect(zalo.sent).toHaveLength(1);expect((await listRegistrations(db,'pending',1,10)).requests[0].admin_notice_error).toContain('telegram');
  });
  const app=createApp();
  const request=(env:Env,path:string,body?:unknown,cookie?:string,method=body?'POST':'GET')=>app.request('https://gio.test/api'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})},env);
  async function cookie(family:number|null=null){const token=family?'family':'admin';await createSession(db,await sha256Hex(token),new Date(Date.now()+3600000),family);return 'fmr_session='+token;}
  it('chỉ admin được quản lý nơi nhận và duyệt; API lưu quyết định dù gửi kết quả lỗi',async()=>{
    const env={DB:db,ASSETS:{} as Fetcher};const req=await submitRegistration(db,'telegram','123','Test',familyId);
    expect((await request(env,'/registrations')).status).toBe(401);
    const family=await cookie(familyId);
    for(const path of ['/registrations','/registrations/admins'])expect((await request(env,path,undefined,family)).status).toBe(403);
    expect((await request(env,`/registrations/${req!.id}/review`,{decision:'approved'},family)).status).toBe(403);
    const admin=await cookie();
    expect((await request(env,'/registrations/admins',{admins:[{channel:'telegram',chatId:'999'},{channel:'zalo',chatId:'abc'}]},admin,'PUT')).status).toBe(200);
    const r=await request(env,`/registrations/${req!.id}/review`,{decision:'approved'},admin);expect(r.status).toBe(200);expect(await r.json()).toMatchObject({ok:true,warning:expect.any(String)});
    expect((await getRegistration(db,req!.id))?.status).toBe('approved');
  });
  it('duyệt trên website báo người đăng ký và admin cả hai kênh',async()=>{
    await setRegistrationAdmins(db,[{channel:'telegram',chatId:'999'},{channel:'zalo',chatId:'admin-zalo'}]);
    const calls:{url:string;body:{chat_id:string;text:string}}[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,body:JSON.parse(String(init.body))});return new Response(JSON.stringify({ok:true,result:{message_id:1}}),{headers:{'content-type':'application/json'}});}));
    const env={DB:db,ASSETS:{} as Fetcher,TELEGRAM_BOT_TOKEN:'tg',ZALO_BOT_TOKEN:'za'};
    const req=await submitRegistration(db,'telegram','123','Người mới',familyId);
    const r=await request(env,`/registrations/${req!.id}/review`,{decision:'rejected'},await cookie());
    expect(await r.json()).toEqual({ok:true,warning:null});
    expect(calls.find(c=>c.body.chat_id==='123')?.body.text).toContain('chưa được chấp thuận');
    for(const chatId of ['999','admin-zalo']){
      const text=calls.find(c=>c.body.chat_id===chatId)?.body.text;
      expect(text).toContain('đã bị từ chối');
      expect(text).toContain('Website');
    }
  });
  it('website yêu cầu OTP: không tạo đăng ký trước xác nhận, mã không lộ trong API, không tái dùng',async()=>{
    let otp='';
    vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);otp=body.text.match(/<code>(\d{6})<\/code>/)?.[1]??otp;return new Response(JSON.stringify({ok:true,result:{message_id:1}}),{headers:{'content-type':'application/json'}});}));
    const env={DB:db,ASSETS:{} as Fetcher,TELEGRAM_BOT_TOKEN:'test-token'};
    const started=await request(env,'/registration-public/start',{channel:'telegram',chatId:'123',name:'Test',family:'Nhà ngoại'});
    expect(started.status).toBe(200);const body=await started.json() as {token:string};expect(Object.keys(body)).toEqual(['token']);expect(otp).toHaveLength(6);
    expect((await listRegistrations(db,'',1,10)).total).toBe(0);
    expect((await request(env,'/registration-public/verify',{token:body.token,code:otp==='000000'?'111111':'000000'})).status).toBe(400);
    expect((await request(env,'/registration-public/verify',{token:body.token,code:otp})).status).toBe(200);
    expect((await listRegistrations(db,'pending',1,10)).total).toBe(1);expect(await getChatAccess(db,'telegram','123')).toBeNull();
    expect((await request(env,'/registration-public/verify',{token:body.token,code:otp})).status).toBe(400);
  });
  it('OTP hết hạn hoặc sai 5 lần không tạo yêu cầu',async()=>{
    let otp='';vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{otp=JSON.parse(init.body).text.match(/<code>(\d{6})<\/code>/)[1];return new Response(JSON.stringify({ok:true,result:{message_id:1}}));}));
    const env={DB:db,ASSETS:{} as Fetcher,TELEGRAM_BOT_TOKEN:'test'};
    const start=async()=>await (await request(env,'/registration-public/start',{channel:'telegram',chatId:'123',name:'Test',family:'Nhà ngoại'})).json() as {token:string};
    let {token}=await start();
    for(let i=0;i<5;i++)expect((await request(env,'/registration-public/verify',{token,code:otp==='000000'?'111111':'000000'})).status).toBe(400);
    expect((await request(env,'/registration-public/verify',{token,code:otp})).status).toBe(400);
    ({token}=await start());await db.prepare("UPDATE registration_challenges SET expires_at='2000-01-01' WHERE token=?").bind(token).run();
    expect((await request(env,'/registration-public/verify',{token,code:otp})).status).toBe(400);expect((await listRegistrations(db,'',1,10)).total).toBe(0);
  });
});
