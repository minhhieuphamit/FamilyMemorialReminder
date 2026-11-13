/**
 * Vẽ thiệp nhắc ngày giỗ bằng Satori (không cần trình duyệt): cây phần tử -> SVG -> PNG (resvg) -> JPEG (sharp).
 * Mỗi ảnh mất khoảng nửa giây, không bị giới hạn tốc độ như Cloudflare Browser Run.
 * Mẫu thiệp giữ giống bản HTML trong src/services/card-image.ts; đổi một bên thì đổi cả CARD_DESIGN_VERSION bên Worker.
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
import satori from 'satori';
import sharp from 'sharp';

export interface CardData {
  name: string;
  relationship: string;
  family: string;
  lunar: string;
  solar: string;
  remaining: string;
}

const WIDTH = 1200;
const HEIGHT = 800;
const FONT = 'Card Serif';
const MAX_FIELD = 80;

const asset = (name: string) => readFileSync(new URL(`../assets/${name}`, import.meta.url));

// Nạp một lần cho mỗi phiên bản hàm; các lần gọi sau trên cùng máy dùng lại.
let assets: {
  background: string;
  fonts: { name: string; data: Buffer; weight: 400 | 700; style: 'normal' }[];
  regular: opentype.Font;
  bold: opentype.Font;
} | null = null;
const parseFont = (data: Buffer) => opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);

function loadAssets() {
  if (assets) return assets;
  const regular = asset('NotoSerif-Regular.ttf');
  const bold = asset('NotoSerif-Bold.ttf');
  assets = {
    regular: parseFont(regular),
    bold: parseFont(bold),
    background: `data:image/jpeg;base64,${asset('card-bg.jpg').toString('base64')}`,
    // Font đầy đủ (Noto Serif, SIL OFL): Satori không ghép glyph giữa các bộ font con nên phải dùng bản có đủ dấu tiếng Việt.
    fonts: [
      { name: FONT, data: regular, weight: 400, style: 'normal' },
      { name: FONT, data: bold, weight: 700, style: 'normal' },
    ],
  };
  return assets;
}

/** Kiểm tra dữ liệu gửi tới: chỉ nhận chuỗi ngắn, tên là bắt buộc. */
export function parseCardData(input: unknown): CardData | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const field = (key: keyof CardData) => (typeof raw[key] === 'string' ? (raw[key] as string).trim().slice(0, MAX_FIELD) : '');
  const data: CardData = {
    name: field('name'),
    relationship: field('relationship'),
    family: field('family'),
    lunar: field('lunar'),
    solar: field('solar'),
    remaining: field('remaining'),
  };
  return data.name && data.lunar && data.solar && data.remaining ? data : null;
}

type Style = Record<string, string | number>;
interface El {
  type: string;
  props: Record<string, unknown>;
}

function h(type: string, props: Record<string, unknown>, ...children: (El | string | null | false)[]): El {
  const kids = children.filter((c): c is El | string => Boolean(c));
  return { type, props: { ...props, children: kids.length === 1 ? kids[0] : kids } };
}
const div = (style: Style, ...children: (El | string | null | false)[]) => h('div', { style: { display: 'flex', ...style } }, ...children);

const ICONS: Record<string, string[]> = {
  person: ['M12 3a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z', 'M3 22c0-5 4-8.5 9-8.5s9 3.5 9 8.5z'],
  home: ['M12 2.5 1.5 11.5H5V21.5h5v-6.5h4v6.5h5V11.5h3.5z'],
  calendar: ['M7 1.5h2.5V4h5V1.5H17V4h4.5v17.5h-19V4H7zM5 9.5v9.5h14V9.5z', 'M7 11.5h3v3H7zm4 0h3v3h-3zm4 0h2v3h-2z'],
  hourglass: ['M5 2h14v2h-1.5c0 4-2 6.5-4 8 2 1.5 4 4 4 8H19v2H5v-2h1.5c0-4 2-6.5 4-8-2-1.5-4-4-4-8H5zm3.5 2c0 3 1.5 5 3.5 6.5 2-1.5 3.5-3.5 3.5-6.5z'],
  bell: ['M12 2a2 2 0 0 1 2 2v.6c3.5.9 5.5 4 5.5 7.4 0 3.5 1 5 2.5 6.5v1H2v-1c1.5-1.5 2.5-3 2.5-6.5 0-3.4 2-6.5 5.5-7.4V4a2 2 0 0 1 2-2zm-2.5 19h5a2.5 2.5 0 0 1-5 0z'],
};
const icon = (name: string, size: number, fill: string) =>
  h('svg', { width: size, height: size, viewBox: '0 0 24 24' }, ...ICONS[name].map((d) => h('path', { d, fill })));

// Satori tính width/height không gồm padding và viền (content-box), nên các kích thước dưới đây đã trừ sẵn để khớp bản HTML.
const PANEL_INNER = 720 - 2 * 48 - 4;
const LABEL_SIZE = 29;
const MAX_VALUE_SIZE = 37;
const MIN_VALUE_SIZE = 24;

/** Đo chiều rộng thật của chữ (px) theo font, để chọn cỡ chữ vừa một dòng. */
function measure(font: opentype.Font, text: string, size: number): number {
  return font.getAdvanceWidth(text.normalize('NFC'), size);
}

/**
 * Cỡ chữ lớn nhất (37 → 24px) để giá trị nằm trên một dòng; nhỏ nhất vẫn tràn thì Satori tự xuống dòng.
 * suffix là phần chữ thường cỡ 72% đi sau (quan hệ với người mất).
 */
function fitSize(label: string, value: string, suffix = ''): number {
  const { regular, bold } = loadAssets();
  const available = PANEL_INNER - 40 - 16 * 2 - measure(regular, label, LABEL_SIZE) - 4;
  for (let size = MAX_VALUE_SIZE; size > MIN_VALUE_SIZE; size--) {
    const width = measure(bold, value, size) + (suffix ? 10 + measure(regular, suffix, Math.round(size * 0.72)) : 0);
    if (width <= available) return size;
  }
  return MIN_VALUE_SIZE;
}

function row(iconName: string, label: string, value: El | string, size: number, last = false): El {
  return div(
    { alignItems: 'center', gap: 16, minHeight: last ? 62 : 61, padding: '12px 0', borderBottom: last ? 'none' : '1px solid #e0d0b2' },
    icon(iconName, 40, '#8d5a33'),
    h('span', { style: { fontSize: LABEL_SIZE, color: '#5a4030', flexShrink: 0 } }, label),
    div({ flex: 1, minWidth: 0, flexWrap: 'wrap', alignItems: 'baseline', fontSize: size, fontWeight: 700, color: '#7f2518', lineHeight: 1.3 }, value),
  );
}

export function cardTree(data: CardData, background: string): El {
  const nameSize = fitSize('Người mất:', data.name, data.relationship ? `(${data.relationship})` : '');
  const person = data.relationship
    ? div(
        { flexWrap: 'wrap', alignItems: 'baseline', gap: 10 },
        h('span', {}, data.name),
        h('span', { style: { fontSize: Math.round(nameSize * 0.72), fontWeight: 400, color: '#7a5a45' } }, `(${data.relationship})`),
      )
    : data.name;

  return div(
    { width: WIDTH, height: HEIGHT, position: 'relative', fontFamily: FONT, color: '#3f2a1d', backgroundImage: 'linear-gradient(120deg,#f6ecd9,#efe0c6 70%,#e8d3b3)' },
    h('img', {
      src: background,
      width: 450,
      height: 800,
      style: { position: 'absolute', left: 0, top: 0, width: 450, height: 800, maskImage: 'linear-gradient(90deg,#000 92%,transparent)' },
    }),
    div({ position: 'absolute', right: 70, top: 30, width: 120, height: 120, borderRadius: 60, backgroundImage: 'radial-gradient(circle,#f3c58a,#eaa968)', opacity: 0.65 }),
    h(
      'svg',
      { width: 820, height: 190, viewBox: '0 0 820 190', style: { position: 'absolute', right: 0, bottom: 0, opacity: 0.55 } },
      h('path', { d: 'M0 190C120 110 200 150 300 100s150 10 240-30 170 20 280-20v140z', fill: '#d9bf98' }),
    ),
    div(
      {
        position: 'absolute',
        left: 405,
        top: 104,
        width: 714,
        height: 102,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        borderRadius: 56,
        backgroundImage: 'linear-gradient(90deg,#7a2a1c,#96402a)',
        border: '3px solid #d7ac62',
        color: '#fff5e1',
        fontSize: 42,
        fontWeight: 700,
        boxShadow: '0 8px 24px rgba(74,32,17,.3)',
      },
      icon('bell', 48, '#eec36e'),
      'Nhắc Ngày Giỗ Gia Đình',
    ),
    div(
      {
        position: 'absolute',
        left: 439,
        top: 240,
        width: PANEL_INNER,
        flexDirection: 'column',
        padding: '14px 48px',
        backgroundImage: 'linear-gradient(110deg,rgba(255,243,220,.94),rgba(255,248,233,.91))',
        border: '2px solid #d7ac62',
        borderRadius: 26,
        boxShadow: '0 10px 30px rgba(74,32,17,.18)',
      },
      div({ position: 'absolute', left: 8, top: 8, right: 8, bottom: 8, border: '1px solid #d7ac62', borderRadius: 19 }),
      div({ position: 'absolute', right: 16, top: 16, width: 9, height: 9, backgroundColor: '#cf9b49', transform: 'rotate(45deg)' }),
      div({ position: 'absolute', right: 16, bottom: 16, width: 9, height: 9, backgroundColor: '#cf9b49', transform: 'rotate(45deg)' }),
      row('person', 'Người mất:', person, nameSize),
      data.family ? row('home', 'Gia đình:', data.family, fitSize('Gia đình:', data.family)) : null,
      row('calendar', 'Ngày giỗ âm:', data.lunar, fitSize('Ngày giỗ âm:', data.lunar)),
      row('calendar', 'Ngày dương:', data.solar, fitSize('Ngày dương:', data.solar)),
      row(
        'hourglass',
        'Còn lại:',
        div({ padding: '4px 30px 6px', borderRadius: 30, backgroundColor: '#a8422e', color: '#fff5e1', fontSize: 30 }, data.remaining),
        30,
        true,
      ),
    ),
  );
}

export async function renderCard(data: CardData): Promise<Buffer> {
  const { background, fonts } = loadAssets();
  const svg = await satori(cardTree(data, background) as unknown as Parameters<typeof satori>[0], { width: WIDTH, height: HEIGHT, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
  return sharp(png).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}
