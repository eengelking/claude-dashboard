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
- **The mod acting on a session.** Podium only observes. A way for the mod or the server to send a prompt
  to, stop, or change a session is a security bug.

A few things are by design, so they are not vulnerabilities on their own. Reads (`GET /api/fleet/*`) are
open on localhost; only reports, hooks and deletes need a token. Tokens travel in a header over plain HTTP, so a
server reachable over a network needs a trusted network or a TLS proxy, and a person who holds a valid token can
delete any session. Anyone with access to your user
account or to `~/.podium` can read the token and the data, and `podman inspect podium` shows the token
because it is part of the container's environment. And if you start the server with `--bind` or
`HOST` set to something other than `127.0.0.1`, other machines can read the dashboard. The README and `docs/GOTCHAS.md` say all
of this. A report that shows a way to do those things *without* the setting that allows them is in scope.

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
