# Security Policy

## What "security" means for this repo

Podium is a small local service, not a hosted product. A server stores what Claude Code sessions report
about themselves in SQLite and serves a browser UI. A mod (`podium-reporter`) runs inside each Claude Code
session and sends reports to that server. `podiumctl` and a container image run the server. So the
problems that matter here are:

- **Input to the server.** A report, a settings-hook payload or any other request that crashes the server,
  gets past validation, reads or writes a file, or runs a command. The server checks every report by hand
  (`server/src/fleet/protocol.ts`), so a gap in that check is in scope.
- **Reported text reaching the browser or a shell.** Anything a session sends (a Bash command, an agent's
  answer, a path) that ends up rendered as markup or script in the UI, or in a command line.
- **Secrets leaving a session.** The mod cuts text to fixed limits and replaces things that look like
  secrets with `[redacted]` (see "What leaves the session" in the README). A real credential format that
  the redaction misses, or data the README says never leaves the session but does, is in scope.
- **Tokens and Admin.** `PODIUM_TOKEN` (the admin secret) opens Admin, and each person's token is bound to
  their name. A way around either, a token or the admin secret that shows up in a log, an error, the browser's
  storage or a command line, a token stored in a readable form, a way to open Admin or call its API without
  the secret or from another site, a way past the lockout, or a config file with loose permissions.
- **`podiumctl` and the container.** Command injection through a config value, the server listening on
  more than the user asked for, the container running as root, or a boot service file that does more
  than it should.
- **The mod acting on a session.** Podium can answer a session that waits on its person, and nothing else (see
  "Responding from Podium" below). A way for the mod or the server to do more than that is a security bug: to send
  a prompt or an answer to a session whose owner didn't turn the `respond` option on, past the Admin's switch, at a
  level the session didn't allow, or from anyone but the session's owner or an Admin; to run any command but
  `/clear` and `/compact`; to change a session's permission rules ("always allow"); or to stop or start a session.

A few things are by design, so they are not vulnerabilities on their own. Fleet reads (`GET /api/fleet/state`, `/stream`,
`/sessions/...`, `/events`, `/history`) are open on localhost; only reports, hooks and deletes need a token, and a
waiting session's question, plan or tool input (under `/api/fleet/respond`) is shown only to its owner or an Admin
who has signed in. Tokens travel in a header over plain HTTP, so a
server reachable over a network needs a trusted network or a TLS proxy, and a person who holds a valid token can
delete any session. Anyone with access to your user
account or to `~/.podium` can read the token and the data, and `podman inspect podium` shows the token
because it is part of the container's environment. And if you start the server with `--bind` or
`HOST` set to something other than `127.0.0.1`, other machines can read the dashboard, including every
person's name and machine name. A reporter sends a name and its machine's host name only when its user set
`userName`; who a session belongs to comes from the token, so a name with the shared admin secret, or with
auth turned off, is not shown as a person at all. The README ("Several people on one Podium") and
`docs/GOTCHAS.md` say all of this. A session shown under a person whose token did not send it, or a name or
machine name sent while `userName` is empty, is in scope. A report that shows a way to do those things *without* the setting that allows them is in scope.

## Responding from Podium

Since #206 Podium can answer a session that waits on its person: an AskUserQuestion form, a plan to approve, a
tool's permission prompt, a new message, `/clear` and `/compact`. What that exposes:

- **Who can.** Only the session's owner (the person whose token reports it) or an Admin (the admin secret, or a
  person in Administrators). The browser signs in with a name and a token, the same pair as the reporter's
  `userName` and `token`. Anyone who holds a person's token, or the admin secret, can put text into that person's
  sessions, as far as each session's `respond` level allows.
- **What it needs.** It is off unless all of these are on: authentication (`PODIUM_TOKEN`), the Admin's Respond
  from Podium flag, the Admin's activity feed flag, and on the session's machine the reporter's `respond` option and
  `activityFeed` option. The reporter checks its own level itself and never relies on the server for it.
- **The sign-in.** A random id in an `HttpOnly; SameSite=Strict` cookie scoped to `/api`, held in the
  server's memory; it ends after 12 hours without use, on sign-out, on restart, and when the person's token is
  rotated or revoked. Every change needs the header `X-Podium-Respond: 1` and, when the browser sends an `Origin`, that
  Origin must name this server. No CORS is offered. Five wrong tries from one address lock signing in for 15 minutes, counted together with Admin unlocks.
- **What is seen and kept.** A question, a plan or a tool's input is shown only to the session's owner or an Admin,
  and kept in the server's memory only. Each answer is written to the admin log with who sent it, the session and
  the kind of answer, never its text. The token, and the session cookie, travel over plain HTTP unless you put a TLS
  proxy in front, so on any network but your own machine use one.

A way to answer a session without the switches above, without being its owner or an Admin, from another site, or
by sending more than the session's level allows, is in scope.

If you think you have found something like this, please report it rather than opening a public issue.

## Reporting a vulnerability

Open a private GitHub Security Advisory on this repo:
[github.com/eengelking/podium](https://github.com/eengelking/podium) → the "Security" tab →
"Report a vulnerability". That is GitHub's built-in private disclosure, so the report stays visible only
to the maintainer until it is resolved.

Please don't file a public issue for a suspected vulnerability. This repo is public, so a public issue
discloses it before there is a fix.

## Supported versions

Only the latest release gets fixes. Podium is pre-1.0, so a fix may arrive in the next minor release
rather than a backport.

## What to expect

This is a solo-maintained project, so response times aren't guaranteed, but reports are read and taken
seriously. If a report turns out to be valid, the fix ships as a normal PR, with an entry under "Security"
in `CHANGELOG.md`. If the fix is in the mod, the `version` in `mod/podium-reporter/.claude-plugin/plugin.json`
is bumped too, because installed copies only update when it changes.
