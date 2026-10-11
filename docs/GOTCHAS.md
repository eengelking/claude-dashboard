# Gotchas

Sharp edges that are easy to hit. Each has what you see, why, and what to do. The full list of known
limitations is under "Known issues" in `docs/ARCHITECTURE.md`; this file is the short, practical version.

## Connecting the mod

### `/podium` says "offline" and "Last error: HTTP 401"

The server has a token and the mod is not sending it. Get it with `podiumctl token` and enter it with
`/plugin configure podium-reporter@eengelking-marketplace`. Queued reports go out as soon as it is right.

### The token option has no row in the `/config` menu

It is marked `sensitive`, and Claude Code only draws menu rows for options that are not secret. Use
`/plugin configure`. For a copy loaded with `--plugin-dir`, putting the token in `~/.claude/settings.json`
under `pluginConfigs`, `podium-reporter`, `options`, `token` also worked when we tried it.

### The status line has a warning sign in front of `podium ● 1 live`

That is how Claude Code draws a plugin's status line entry, not a Podium warning. The mod sets plain text
and has no way to set a severity (inferred, not confirmed). `podium ○ offline` is the real warning.

### The effort shown is the old one after I run `/effort`

The mod reads the effort the session sends with each model request, and the plugin API has no event for the
setting changing. The new level shows after your next prompt. This is expected.

### Installing the mod from the marketplace fails with "Permission denied (publickey)"

A marketplace entry that points at a subfolder of another repo with the `owner/repo` shorthand makes Claude
Code clone over SSH. The `podium-reporter` entry uses the full `https://github.com/eengelking/podium.git`
URL for that reason. If you add your own entry for a public repo, do the same.

## Running the server

### `podiumctl start --mode standalone` says it is up, but another Podium is already on the port

`start` waits until `http://<bind>:<port>/api/fleet/state` answers. If another Podium (a leftover
`podiumctl run`, `npm run dev`) already answers there, the new process fails to bind and the check still
passes. Run `podiumctl status` and look at the pid, or stop the other one first. Container mode should
fail instead, since `podman run` cannot publish a port that is taken (not tested).

### I changed a setting and nothing happened

`podiumctl config set` only edits `~/.podium/config.env`. Run `podiumctl restart` to apply it. The
`--mode`, `--port` and `--bind` flags are saved by `start`, `restart`, `build` and `enable`.

### On macOS the first `podiumctl start` takes a while

Podman runs in a VM. If it is not running, `podiumctl` starts it, and the first start also builds the
image (about 20 seconds on a warm cache).

### `podiumctl disable` stopped my standalone server

Under the launchd or systemd service the server is the service's child, so removing the service stops it.
In container mode the container keeps running. Check with `podiumctl status`.

### A restart shows every session as stale

Sessions come back from SQLite as stale and recover when their reporters next send, within about five
seconds. A session whose reporter never comes back is dropped about a minute after the server's own start.

### `podman inspect podium` shows the token

`podiumctl` keeps the token out of the command line, but it is part of the container's environment, and
`podman inspect` prints that. Anyone who can run Podman as you can read it. See `.github/SECURITY.md`.

### Anyone on localhost can read the dashboard

The token guards reports, hooks and deletes. Reads (`GET /api/fleet/*`) are open on localhost by design
(`docs/SPEC.md`, 7.7). With `--bind` or `HOST` set to anything but `127.0.0.1`, other machines can read it
too.

### The Linux start-on-boot unit has not run on Linux

`podiumctl enable` generates a systemd user unit that has only been tested as text. Try it and tell us.

## What the dashboard shows

### The usage page (`#/usage`) is empty for Claude Code in container mode

It reads the logs under `~/.claude/projects` in the server's home directory, and a container has its own
home with no logs in it. The Podium fleet console is not affected. Use `podiumctl start --mode standalone`
if you want that page. (Mounting your logs into the container read-only would fix it; it is not done.)

### A plan step has no owner

Podium links an agent to a plan step by matching the agent's description to the step's title, and the match
is literal. "Count .ts files under server" and "Count .ts files in server" do not match.

### Elapsed times freeze when the tab is in the background

Browsers throttle timers in hidden tabs. The numbers catch up when you look at the tab again.

### A session sitting at the prompt shows as waiting

That is correct, since it is waiting on you. With many idle sessions the wall fills with waiting callouts.

### A session started without the mod stays "live" for ten minutes after it goes quiet

Settings hooks send no heartbeat, so a hook-only session gets `HOOK_STALE_AFTER_MS` (10 minutes) before it
shows as stale. A session the mod reports uses the 15-second default.

## Developing

### `npm run test:mod` and `npm run typecheck:mod` fail on a clean machine

Both need Claude Code installed, and CI cannot run them. Run them locally when you change the mod.

### A mod fix did not reach anyone

Installed copies only update when `version` in `mod/podium-reporter/.claude-plugin/plugin.json` changes.
Bump it in the same PR, together with `VERSION` in `mod/podium-reporter/hooks/register.ts` (the number the
mod reports; a test checks the two match). CI (`mod-version-check`) fails a PR that forgets the first.
