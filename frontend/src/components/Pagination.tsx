export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, disabled = false }: {
  page: number; pageSize: number; total: number; onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void; disabled?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav aria-label="Phân trang" className="flex flex-wrap items-center justify-between gap-3 p-4">
    <label className="flex items-center gap-2 text-sm">Số dòng mỗi trang
      <select className="input w-auto" value={pageSize} disabled={disabled} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
        {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
      </select>
    </label>
    <span className="text-sm text-muted">{total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} / {total} dòng</span>
    <div className="flex items-center gap-3">
      <button type="button" className="btn btn-sm" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>‹ Trước</button>
      <span className="text-sm">Trang {page}/{pages}</span>
      <button type="button" className="btn btn-sm" disabled={disabled || page >= pages} onClick={() => onPageChange(page + 1)}>Sau ›</button>
    </div>
  </nav>;
}
