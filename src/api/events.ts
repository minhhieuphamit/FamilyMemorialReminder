import { Hono, type Context } from 'hono';
import {
  createEvent,
  deleteEvent,
  getEvent,
  updateEvent,
} from '../database/events-repo';
import { listFamilies } from '../database/families-repo';
import { familyScope, visibleEvents } from '../middleware/auth';
import { buildEventView, filterByFamily, searchEvents } from '../services/memorial-service';
import type { EventView, MemorialEvent } from '../types/domain';
import type { AppEnv } from '../types/env';
import { parseISODate, todayInVietnam } from '../utils/dates';
import { validateEventInput } from '../utils/validation';

export const eventRoutes = new Hono<AppEnv>();

const NOT_FOUND = { error: 'Không tìm thấy ngày giỗ' };

/** Ngày giỗ của nhà khác trả về như không tồn tại, để không lộ id nào đang có dữ liệu. */
async function getOwnEvent(c: Context<AppEnv>): Promise<MemorialEvent | null> {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return null;
  const event = await getEvent(c.env.DB, id);
  const scope = familyScope(c);
  return event && (scope === null || event.familyId === scope) ? event : null;
}

function sortViews(views: EventView[], sort: string): EventView[] {
  if (sort === 'name') return views.sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'));
  if (sort === 'lunar') return views.sort((a, b) => a.lunarMonth - b.lunarMonth || a.lunarDay - b.lunarDay);
  return views.sort((a, b) => (a.next?.daysLeft ?? Infinity) - (b.next?.daysLeft ?? Infinity));
}

eventRoutes.get('/', async (c) => {
  const today = todayInVietnam();
  const q = c.req.query('q') ?? '';
  const sort = c.req.query('sort') ?? 'next';
  const solarMonth = Number(c.req.query('solarMonth'));
  const lunarMonth = Number(c.req.query('lunarMonth'));

  const events = searchEvents(filterByFamily(await visibleEvents(c), c.req.query('family')), q, true);
  let views = events.map((e) => buildEventView(e, today));
  if (solarMonth >= 1 && solarMonth <= 12) {
    views = views.filter((v) => v.thisYear.some((o) => parseISODate(o.solarDate).month === solarMonth));
  }
  if (lunarMonth >= 1 && lunarMonth <= 12) {
    views = views.filter((v) => v.lunarMonth === lunarMonth);
  }
  return c.json({ today, events: sortViews(views, sort) });
});

async function familyExists(db: D1Database, familyId: number | null): Promise<boolean> {
  return familyId === null || (await listFamilies(db)).some((f) => f.id === familyId);
}

const FAMILY_MISSING = { error: 'Dữ liệu không hợp lệ', fields: { familyId: 'Gia đình không tồn tại' } };

eventRoutes.post('/', async (c) => {
  const parsed = validateEventInput(await c.req.json().catch(() => null));
  if (!parsed.ok) return c.json({ error: 'Dữ liệu không hợp lệ', fields: parsed.errors }, 400);
  // Tài khoản gia đình luôn tạo vào gia đình của mình, bỏ qua familyId gửi lên.
  const familyId = familyScope(c) ?? parsed.data.familyId;
  if (!(await familyExists(c.env.DB, familyId))) return c.json(FAMILY_MISSING, 400);
  const event = await createEvent(c.env.DB, { ...parsed.data, familyId });
  return c.json({ event: buildEventView(event, todayInVietnam()) }, 201);
});

eventRoutes.get('/:id', async (c) => {
  const event = await getOwnEvent(c);
  if (!event) return c.json(NOT_FOUND, 404);
  return c.json({ event: buildEventView(event, todayInVietnam()) });
});

eventRoutes.put('/:id', async (c) => {
  const current = await getOwnEvent(c);
  if (!current) return c.json(NOT_FOUND, 404);
  const parsed = validateEventInput(await c.req.json().catch(() => null));
  if (!parsed.ok) return c.json({ error: 'Dữ liệu không hợp lệ', fields: parsed.errors }, 400);
  const familyId = familyScope(c) ?? parsed.data.familyId;
  if (!(await familyExists(c.env.DB, familyId))) return c.json(FAMILY_MISSING, 400);
  const event = await updateEvent(c.env.DB, current.id, { ...parsed.data, familyId });
  if (!event) return c.json(NOT_FOUND, 404);
  return c.json({ event: buildEventView(event, todayInVietnam()) });
});

eventRoutes.delete('/:id', async (c) => {
  const current = await getOwnEvent(c);
  if (!current || !(await deleteEvent(c.env.DB, current.id))) return c.json(NOT_FOUND, 404);
  return c.json({ ok: true });
});
