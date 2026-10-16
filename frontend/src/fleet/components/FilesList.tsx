import { useState } from "react";
import type { ChangedFile, FilesReport } from "../types";
import { PageNav } from "./PageNav";

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

/** Five blocks, green for the share of added lines and red for the rest. Decoration only; the counts carry the numbers. */
function ChangeBar({ added, removed }: { added: number; removed: number }) {
  const total = added + removed;
  let green = total ? Math.round((5 * added) / total) : 0;
  if (total && added && !green) green = 1;
  if (total && removed && green === 5) green = 4;
  return (
    <span className="bars" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={!total ? undefined : i < green ? "g" : "r"} />
      ))}
    </span>
  );
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="cnt">
      <span className="add">+{added}</span>
      <span className="del">
        {MINUS}
        {removed}
      </span>
    </span>
  );
}

function FileRow({ f }: { f: ChangedFile }) {
  const [dir, name] = split(f.path);
  const binary = f.added === null || f.removed === null;
  return (
    <li className={f.status}>
      <span className={`st ${LETTER[f.status]}`} aria-hidden="true" title={f.status}>
        {LETTER[f.status]}
      </span>
      <span className="fn" title={f.path}>
        <b>{name}</b>
        <span className="vh"> ({f.status})</span>
        {(dir || (f.status === "renamed" && f.from)) && (
          <i>
            <bdi>{dir}</bdi>
            {f.status === "renamed" && f.from ? ` \u2190 ${f.from}` : null}
          </i>
        )}
      </span>
      <span className="df">
        {binary ? (
          <span className="cnt">
            <span className="fnone" title="Binary file, no line counts">
              binary
            </span>
          </span>
        ) : (
          <>
            <Counts added={f.added!} removed={f.removed!} />
            <ChangeBar added={f.added!} removed={f.removed!} />
          </>
        )}
      </span>
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
      <div className="sumline">
        {plural(report.total)} {"\u00b7"} <Counts added={report.added} removed={report.removed} />
      </div>
      <ul className="files">
        {shown.map((f) => (
          <FileRow key={f.path} f={f} />
        ))}
      </ul>
      <PageNav label="Files pages" at={at} pages={pages} from={from} shown={shown.length} total={report.files.length} perPage={FILES_PER_PAGE} onPage={setPage} />
      {(report.total > report.files.length || note) && (
        <div className="foot-note">
          {report.total > report.files.length && <div>Listing the first {report.files.length} of {report.total} files.</div>}
          {note && <div>{note}</div>}
        </div>
      )}
    </>
  );
}
