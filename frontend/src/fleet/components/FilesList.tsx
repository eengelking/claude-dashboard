import { useState } from "react";
import type { ChangedFile, FilesReport } from "../types";

/** Files shown per page; the reporter sends at most 200, so there are at most ten pages. */
export const FILES_PER_PAGE = 20;

const LETTER: Record<ChangedFile["status"], string> = { added: "A", modified: "M", deleted: "D", renamed: "R" };
const MINUS = "−";

const SINCE_NOTE: Record<FilesReport["since"], string | null> = {
  start: null,
  upstream: "The commit this session started from is gone (a rebase or amend). Showing changes since the branch's upstream.",
  worktree: "The commit this session started from is gone (a rebase or amend). Showing changes in the working tree only.",
};

const plural = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;

function split(path: string): [string, string] {
  const i = path.lastIndexOf("/");
  return i < 0 ? ["", path] : [path.slice(0, i + 1), path.slice(i + 1)];
}

/** A GitHub-style bar: five blocks, green for the share of added lines and red for the rest. Decoration only; the counts carry the numbers. */
function ChangeBar({ added, removed }: { added: number; removed: number }) {
  const total = added + removed;
  let green = total ? Math.round((5 * added) / total) : 0;
  if (total && added && !green) green = 1;
  if (total && removed && green === 5) green = 4;
  return (
    <span className="blocks" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <b key={i} className={!total ? "" : i < green ? "g" : "r"} />
      ))}
    </span>
  );
}

function Counts({ f }: { f: ChangedFile }) {
  if (f.added === null || f.removed === null) {
    return (
      <span className="cnt">
        <span className="fnone" title="Binary file, no line counts">
          binary
        </span>
      </span>
    );
  }
  return (
    <span className="cnt">
      <span className="add">+{f.added}</span>
      <span className="del">
        {MINUS}
        {f.removed}
      </span>
    </span>
  );
}

function FileRow({ f }: { f: ChangedFile }) {
  const [dir, name] = split(f.path);
  return (
    <li className={`f ${f.status}`}>
      <span className={`fst ${LETTER[f.status]}`} aria-hidden="true" title={f.status}>
        {LETTER[f.status]}
      </span>
      <div className="fbody">
        <div className="ftop">
          <span className="path l1" title={f.path}>
            <span className="nm">{name}</span>
            <span className="vh"> ({f.status})</span>
            {f.status === "renamed" && f.from ? <span className="old"> {"←"} {f.from}</span> : null}
          </span>
          {f.added !== null && f.removed !== null && <ChangeBar added={f.added} removed={f.removed} />}
          <Counts f={f} />
        </div>
        {dir && (
          <span className="path l2" title={f.path}>
            <bdi>{dir}</bdi>
          </span>
        )}
      </div>
    </li>
  );
}

/** The Files tab: a summary, the current page of files, and a pager when there is more than one page. */
export function FilesList({ report, hint }: { report: FilesReport | null; hint: string | null }) {
  const [page, setPage] = useState(0);
  if (!report || report.files.length === 0) {
    return (
      <>
        <div className="empty">Files will appear here once a file has been updated.</div>
        {hint && <div className="foot-note">{hint}</div>}
      </>
    );
  }
  const pages = Math.ceil(report.files.length / FILES_PER_PAGE);
  const at = Math.min(page, pages - 1);
  const from = at * FILES_PER_PAGE;
  const shown = report.files.slice(from, from + FILES_PER_PAGE);
  const note = SINCE_NOTE[report.since];
  return (
    <>
      <div className="sum">
        <span>{plural(report.total)}</span>
        <span className="cnt">
          <span className="add">+{report.added}</span>
          <span className="del">
            {MINUS}
            {report.removed}
          </span>
        </span>
      </div>
      <ul className="files">
        {shown.map((f) => (
          <FileRow key={f.path} f={f} />
        ))}
      </ul>
      {pages > 1 && (
        <nav className="pager" aria-label="Files pages">
          <span>
            {from + 1}
            {"–"}
            {from + shown.length} of {report.files.length}
          </span>
          <span className="pg">
            <button type="button" aria-label="Previous page" disabled={at === 0} onClick={() => setPage(at - 1)}>
              {"‹"}
            </button>
            {Array.from({ length: pages }, (_, i) => (
              <button key={i} type="button" aria-current={i === at ? "page" : undefined} onClick={() => setPage(i)}>
                {i + 1}
              </button>
            ))}
            <button type="button" aria-label="Next page" disabled={at === pages - 1} onClick={() => setPage(at + 1)}>
              {"›"}
            </button>
          </span>
        </nav>
      )}
      {(report.total > report.files.length || note) && (
        <div className="foot-note">
          {report.total > report.files.length && <div>Listing the first {report.files.length} of {report.total} files.</div>}
          {note && <div>{note}</div>}
        </div>
      )}
    </>
  );
}
