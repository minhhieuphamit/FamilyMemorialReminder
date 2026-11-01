/** Bỏ dấu tiếng Việt, về chữ thường, gom khoảng trắng và bỏ dấu câu. */
export function normalizeVietnamese(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Bỏ thẻ HTML của tin nhắn, cho các kênh chỉ gửi văn bản thuần. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/?[a-z][^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Chia văn bản dài theo dòng, mỗi phần không vượt quá giới hạn của Telegram. */
export function splitMessage(text: string, limit = 4000): string[] {
  const parts: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && current.length + line.length + 1 > limit) {
      parts.push(current);
      current = '';
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) parts.push(current);
  return parts;
}
