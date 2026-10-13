// A server-driven pager: the count comes from the server's total, and Previous and Next ask for another page.
export const PAGE_SIZES = [25, 50, 100];

export function Pager(props: { id: string; page: number; pageSize: number; total: number; onPage: (page: number) => void; onSize: (size: number) => void }) {
  const { id, page, pageSize, total } = props;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="apager">
      <span className="hint" role="status">
        Showing {from} to {to} of {total}
      </span>
      <span className="row2">
        <label className="hint" htmlFor={`${id}-size`}>
          Rows per page
        </label>
        <select className="field sm" id={`${id}-size`} value={pageSize} onChange={(e) => props.onSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button type="button" className="btn sm" id={`${id}-prev`} disabled={page <= 1} onClick={() => props.onPage(page - 1)}>
          Previous
        </button>
        <span className="hint">
          Page {page} of {pages}
        </span>
        <button type="button" className="btn sm" id={`${id}-next`} disabled={page >= pages} onClick={() => props.onPage(page + 1)}>
          Next
        </button>
      </span>
    </div>
  );
}
