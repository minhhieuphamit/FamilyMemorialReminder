// Tạo src/services/card-fonts.ts: nhúng font Noto Serif (latin + tiếng Việt) vào HTML thiệp dưới dạng data URI,
// để trình duyệt của Browser Run luôn có đủ dấu tiếng Việt mà không phải tải font qua mạng.
// Chạy lại khi đổi font hoặc nâng @fontsource/noto-serif: node scripts/generate-card-fonts.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'node_modules/@fontsource/noto-serif');
const SUBSETS = ['vietnamese', 'latin'];
const WEIGHTS = [400, 700];

const faces = [];
for (const weight of WEIGHTS) {
  const css = readFileSync(join(pkg, `${weight}.css`), 'utf8');
  for (const subset of SUBSETS) {
    const block = css.split('@font-face').find((b) => b.includes(`noto-serif-${subset}-${weight}-normal.woff2`));
    const range = block?.match(/unicode-range:\s*([^;]+);/)?.[1];
    if (!range) throw new Error(`Không tìm thấy unicode-range cho ${subset} ${weight}`);
    const data = readFileSync(join(pkg, `files/noto-serif-${subset}-${weight}-normal.woff2`)).toString('base64');
    faces.push(
      `@font-face{font-family:'Card Serif';font-style:normal;font-weight:${weight};font-display:block;` +
        `src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${range}}`,
    );
  }
}

const out = `// File tự sinh bởi scripts/generate-card-fonts.mjs từ @fontsource/noto-serif (SIL Open Font License). Không sửa tay.
export const CARD_FONT_CSS = ${JSON.stringify(faces.join(''))};
`;
writeFileSync(join(root, 'src/services/card-fonts.ts'), out);
console.log(`Đã ghi src/services/card-fonts.ts (${(out.length / 1024).toFixed(0)} KB)`);
