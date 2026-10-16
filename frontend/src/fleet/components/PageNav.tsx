/** The footer shared by the Files tab and the Plan tab: the range shown, then page buttons once there is more than one page. */
export function PageNav(props: { label: string; at: number; pages: number; from: number; shown: number; total: number; perPage: number; onPage: (page: number) => void }) {
  const { label, at, pages, from, shown, total, perPage, onPage } = props;
  return (
    <div className="pager">
      <span>
        Showing {from + 1}
        {"–"}
        {from + shown} of {total}
      </span>
      {pages > 1 ? (
        <nav className="pg" aria-label={label}>
          <button type="button" aria-label="Previous page" disabled={at === 0} onClick={() => onPage(at - 1)}>
            {"‹"}
          </button>
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} type="button" aria-current={i === at ? "page" : undefined} onClick={() => onPage(i)}>
              {i + 1}
            </button>
          ))}
          <button type="button" aria-label="Next page" disabled={at === pages - 1} onClick={() => onPage(at + 1)}>
            {"›"}
          </button>
        </nav>
      ) : (
        <span>{perPage} per page</span>
      )}
    </div>
  );
}
