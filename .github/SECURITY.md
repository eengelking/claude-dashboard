# Security Policy

## What "security" means for this repo

Podium is a small local service, not a hosted product. A server stores what Claude Code sessions report
about themselves in SQLite and serves a browser UI. A mod (`podium-reporter`) runs inside each Claude Code
session and sends reports to that server. `podiumctl` and a container image run the server. So the
problems that matter here are:

| Area | In scope |
|---|---|
| **Input to the server** | A report, a settings-hook payload or any other request that crashes the server, gets past validation, reads or writes a file, or runs a command. The server checks every report by hand (`server/src/fleet/protocol.ts`), so a gap in that check is in scope. |
| **Reported text reaching the browser or a shell** | Anything a session sends (a Bash command, an agent's answer, a path) that ends up rendered as markup or script in the UI, or in a command line. |
| **Secrets leaving a session** | The mod cuts text to fixed limits and replaces things that look like secrets with `[redacted]` (see "What leaves the session" in the README). A real credential format that the redaction misses, or data the README says never leaves the session but does. |
| **Tokens and Admin** | `PODIUM_TOKEN` (the admin secret) opens Admin, and each person's token is bound to their name. A way around either; a token or the admin secret that shows up in a log, an error, the browser's storage or a command line; a token stored in a readable form; a way to open Admin or call its API without the secret or from another site; a way past the lockout; a config file with loose permissions. |
| **`podiumctl` and the container** | Command injection through a config value, the server listening on more than the user asked for, the container running as root, or a boot service file that does more than it should. |
| **The mod acting on a session** | Podium can answer a session that waits on its person, and nothing else (see "Responding from Podium" below). A way for the mod or the server to do more than that is a security bug: to send a prompt or an answer to a session whose owner didn't turn the `respond` option on, past the Admin's switch, at a level the session didn't allow, or from anyone but the session's owner or an Admin; to run any command but `/clear` and `/compact`; to change a session's permission rules ("always allow"); or to stop or start a session. |

### By design

These are not vulnerabilities on their own. The README ("Several people on one Podium") and
`docs/GOTCHAS.md` say all of this.

| Behavior | Why it is not a bug |
|---|---|
| **Fleet reads are open on localhost.** `GET /api/fleet/state`, `/stream`, `/sessions/...`, `/events` and `/history` need no token; only reports, hooks and deletes do. | They show how the wall looks. A waiting session's question, plan or tool input (under `/api/fleet/respond`) is the exception: it is shown only to its owner or an Admin who has signed in. |
| **Tokens travel in a header over plain HTTP.** | A server reachable over a network needs a trusted network or a TLS proxy. |
| **A person who holds a valid token can delete any session.** | Any valid credential may `DELETE` a session. |
| **Anyone with access to your user account or to `~/.podium` can read the token and the data.** `podman inspect podium` also shows the token, because it is part of the container's environment. | The token has to live somewhere the server can read it. |
| **`--bind` or `HOST` set to something other than `127.0.0.1` lets other machines read the dashboard,** including every person's name and machine name. | That is what binding to another address asks for. |
| **A reporter sends a name and its machine's host name only when its user set `userName`.** Who a session belongs to comes from the token, so a name sent with the shared admin secret, or with auth turned off, is not shown as a person at all. | The setting is the user's consent. |

A session shown under a person whose token did not send it, or a name or machine name sent while `userName`
is empty, is in scope. So is a report that shows a way to do any of the above *without* the setting that
allows it.

## Responding from Podium

Since #206 Podium can answer a session that waits on its person: an AskUserQuestion form, a plan to approve, a
tool's permission prompt, a new message, `/clear` and `/compact`. It is off until the Admin and the session's
owner both turn it on. What it exposes:

| Topic | How it works |
|---|---|
| **Identity** | Each person gets a server-generated token, `pdm_<12 hex key id>_<48 hex secret>`: 192 bits of randomness, shown once, stored only as a SHA-256 hash and compared in constant time. The token decides who you are; the name is only a consistency check. One shared secret, `PODIUM_TOKEN`, works only under the name `Admin` and is meant as a break-glass path. |
| **The browser's sign-in** | The browser signs in with a name and a token, the same pair as the reporter's `userName` and `token`. That starts a random server-side session in an `HttpOnly; SameSite=Strict` cookie scoped to `/api`, held in the server's memory. It ends after 12 hours without use, on sign-out, on restart, and when the person's token is rotated or revoked. |
| **Who can respond** | Only the session's owner (the person whose token reports it) or an Admin (the admin secret, or a person in Administrators). A session owned by `Admin` can be answered only by an Admin. Anyone who holds a person's token, or the admin secret, can put text into that person's sessions, as far as each session's `respond` level allows. |
| **What it needs** | All of these on: authentication (`PODIUM_TOKEN`), the Admin's Respond from Podium flag, the Admin's activity feed flag, and on the session's machine the reporter's `respond` option and `activityFeed` option. `respond` is `off` by default. |
| **Browser requests** | Every change needs the header `X-Podium-Respond: 1` and, when the browser sends an `Origin`, that Origin must name this server. No CORS is offered. The server refuses a `Host` it does not expect. |
| **Guessing** | Five wrong tries from one address lock signing in for 15 minutes, counted together with Admin unlocks. Wrong admin-secret guesses on the report routes have a throttle of their own. |
| **The mod never trusts the server** | It checks its own `respond` level, answers only an ask it has open, and runs no command but `/clear` and `/compact`. It never sends "always allow" or any other change to permission rules, and a command too long to show in full can only be allowed in the terminal. |
| **What is seen and kept** | A question, a plan or a tool's input is shown only to the session's owner or an Admin, and kept in the server's memory only. The text of an answer, a message, a question, a plan or a tool's input is never stored or logged. |
| **Audit** | Each accepted answer, message or command is written to the admin log with who sent it, the source address, the session (its name and the first 8 characters of its id) and the kind of answer, for example "Allowed a tool once". Sign-ins, failed sign-ins, lockouts and flag changes are logged too. The log is shown only in Admin, and nothing edits or deletes its entries. The same events go to the structured server log, which can be shipped to VictoriaLogs. |

A way to answer a session without the switches above, without being its owner or an Admin, from another site, or
by sending more than the session's level allows, is in scope.

### Known limits

| Limit | What to do about it |
|---|---|
| **The admin secret is a shared credential.** Anything done with it is attributed to "Admin secret", not to a person. | Give each person a token, and turn off reporting with the admin secret in Admin when you no longer need it. |
| **The token and the session cookie travel over plain HTTP.** | On any network but your own machine, put a TLS proxy in front. |
| **The admin log has no retention policy and no export.** It keeps every entry. | Ship the server log to VictoriaLogs if you need a copy or a retention rule. |

If you think you have found something like this, please report it rather than opening a public issue.

## Where to read more

| For | Read |
|---|---|
| Why per-person tokens, and how Admin and the shared secret relate | `docs/DECISIONS.md` 20 (per-person tokens) and 30 (Admin sign-in) |
| Why responding exists, and what it costs | `docs/DECISIONS.md` 28 |
| What the security sweep found, fixed and accepted | `docs/DECISIONS.md` 31, with 32 (guess throttling) and 33 (the Host check) |
| The rules the server and the mod follow | `docs/SPEC.md` 7.7 "Hardening": "Who a report is from", "Who", "The browser's credential", "The mod never trusts the server" and "The admin log" |
| How a person turns responding on and uses it | `docs/USER_GUIDE.md`, "Answering a session from Podium" |
| What is open by design | `docs/GOTCHAS.md` and the README ("Several people on one Podium") |

## Reporting a vulnerability

Open a private GitHub Security Advisory on this repo:
[github.com/eengelking/podium](https://github.com/eengelking/podium) → the "Security" tab →
"Report a vulnerability". That is GitHub's built-in private disclosure, so the report stays visible only
to the maintainer until it is resolved.

Please don't file a public issue for a suspected vulnerability. This repo is public, so a public issue
discloses it before there is a fix.

## Supported versions

Only the latest release gets fixes. A fix may arrive in the next release rather than as a backport to an
older one.

## What to expect

This is a solo-maintained project, so response times aren't guaranteed, but reports are read and taken
seriously. If a report turns out to be valid, the fix ships as a normal PR, with an entry under "Security"
in `CHANGELOG.md`. If the fix is in the mod, the `version` in `mod/podium-reporter/.claude-plugin/plugin.json`
is bumped too, because installed copies only update when it changes.
