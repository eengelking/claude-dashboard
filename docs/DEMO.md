# Demo script

A script for showing Podium to other people, built to be screen-recorded. It has three parts: setup,
a prompt to paste into a live Claude Code session, and a simulated fleet for the "many sessions" shot.
Everything the demo prompt does is read-only, so it is safe to run in this repo or any other.

Nothing here has been run end to end by the author of this file. Do one dry run before you record,
and fix the wording of the prompt if Claude takes a different route than the script expects.

## What the demo shows

1. A session shows up in the browser within about two seconds of starting, with no refresh.
2. The plan Claude writes appears as steps, and the steps tick off as the work finishes.
3. Agents Claude launches appear as rows with their model, effort, status, tokens and cost.
4. A failed call is captured with the command, the exit code and the last lines of output.
5. A second, third and fourth session join the same wall (simulated), including ones that go silent
   and ones whose context window fills.
6. When the sessions end, they leave on their own.

Podium only watches. It never sends a prompt to a session, which is worth saying out loud.

## Before you record

Use two terminals and one browser window. Keep the browser and the Claude terminal side by side so the
viewer sees both at once.

1. Install and start the server (Node 24 and npm):

   ```sh
   npm install
   npm run dev
   ```

   The API is on http://127.0.0.1:4317 and the UI is on http://localhost:5173/#/.

   To show the production-style service instead, use `podiumctl start` and open
   http://127.0.0.1:4317/#/. If the server has a token (`podiumctl token` prints it), set the same
   value in the mod's `token` option.

2. Open http://localhost:5173/#/ in the browser. With nothing reporting, the wall explains how to start
   a session. That empty state is a good first shot.

3. Pick the theme you want from the toggle in the top bar and size the window before you start
   recording. Layout changes mid-take are distracting.

4. In the second terminal, start Claude Code with the mod loaded:

   ```sh
   claude --plugin-dir /path/to/claude-dashboard/mod/podium-reporter
   ```

   The session should appear on the wall at once. The status line under the prompt reads
   `podium ● 1 live`.

5. Type `/podium` to show the link, connection state and report counts. Then give the session a
   readable name, because the wall shows it on the card:

   ```
   /podium name demo-orchestrator
   ```

6. Optional: set `explainFailures` to `true` in the mod options before the take if you want a short
   Haiku explanation under the failed agent. It costs a little and is off by default.

## Beat 1: the live session (the prompt)

Paste this into the Claude session. The agent descriptions are written to match the plan step titles
word for word on purpose. Podium links an agent to a plan step by matching the text, and a loose match
leaves the owner column empty.

````text
This is a live demo of a fleet dashboard that is watching this session. Please do exactly the
following, and keep your own commentary short.

1. Create a plan with these five steps using TaskCreate, in this order. Use these exact titles.
   - Map the server routes
   - Map the reporter hooks
   - Map the frontend views
   - Check a path that does not exist
   - Write the summary

2. Mark "Map the server routes" in progress, then launch three Explore agents in parallel, in one
   message, so they run at the same time. Give each agent the exact description shown, and use the
   cheapest model with low effort for each.
   - description "Map the server routes": list the HTTP routes under server/src/fleet and what each does.
   - description "Map the reporter hooks": list the hooks in mod/podium-reporter/hooks and what each
     one reports.
   - description "Map the frontend views": list the views and main components under
     frontend/src/fleet.
   Each agent should answer in under 120 words. They are read-only. They must not edit anything.

3. As each agent returns, mark its matching step completed with TaskUpdate.

4. Launch one more Explore agent with the exact description "Check a path that does not exist". Its
   only job is to run `ls /tmp/podium-demo-this-path-does-not-exist` and report what happened. The
   command is supposed to fail. That failure is the point of this step.

5. Mark that step completed, mark "Write the summary" in progress, and write a six-line summary of how
   Podium is put together from what the agents found. Then mark the last step completed.

Do not edit any files, do not commit, and do not run anything other than reading files and the one
failing `ls`.
````

### What to point at while it runs

| When | Where to look | What to say |
|---|---|---|
| Plan appears | The plan panel on the session | "Claude wrote a five-step plan. This is read from its task list, not typed by hand." |
| Three agents launch | The agent tree under the session | "Three agents in parallel. Each shows its model, effort, status and token count as it works." |
| Agents finish | Plan steps and agent rows | "The step is linked to the agent that owns it, and the cost rolls up to the session." |
| The `ls` fails | The failure box on that agent | "Failed calls are captured with the command, the exit code and the last lines of output, with anything that looks like a secret removed." |
| Summary written | The session card and the facts bar | "Context fill, cost and the git branch are all live. The orchestrator's cost is the session ledger. The agent figures are estimates, and the UI labels them that way." |

Click the session card to open the focused view if you want a closer look at one session. Click an
agent row to open its detail panel.

## Beat 2: a whole fleet (the simulator)

One real session looks tidy. The point of Podium is many at once. With the dev server still running,
open a third terminal and start the simulator while the recording is going:

```sh
npm run podium:sim -- --sessions 5 --chaos
```

The simulator posts realistic reports for five fake sessions, so the wall fills up next to your real one.
`--chaos` makes some of them go silent (they turn stale), fail more often and overflow their context
windows, which are the three situations that are hard to produce on cue with a real session. Use `--seed`
if you want the same run twice, and `--speed 2` to make it move faster.

Things to show while it runs:

- A stale session. Say how long a session can be silent before it shows as stale, then let it drop off.
- A context blowout. The window fill and the blowout count are on the session card and in the focused view.
- Several failures. Open one and show the failure record.
- The sort controls on the agent table. Click a column header, and click it again to reverse it.

Stop the simulator with Ctrl-C. It ends every session it started, and they leave the wall a few seconds
later with no refresh. That is the last shot of this beat.

## Beat 3: sessions that never loaded the mod (optional)

If you want to make the point that you do not have to restart anything, add the settings hooks from the
README ("Sessions without the mod") to `~/.claude/settings.json`, start a plain `claude` session in
another terminal, and send a prompt. It shows up marked "settings hooks" with the session, directory,
model and agents, and with the context, cost and plan left empty. Remove the hooks afterwards if you do
not want them on permanently.

## Beat 4: history and usage (optional)

- `#/history` lists the sessions that ended on a chosen day. Open one to see its agent detail from
  stored rows. This works after a server restart too, because everything is in SQLite.
- `#/usage` is the older dashboard that charts Claude Code and Admin API usage.

To show that nothing is lost, run `podiumctl restart` (or stop and start `npm run dev`) with a session
live. The session comes back as stale and recovers as soon as its reporter sends again.

## Known rough edges, so they do not surprise you on camera

These come from the known issues in `docs/ARCHITECTURE.md`.

- Elapsed times and the stale countdown pause when the browser tab is in the background. Keep the
  window visible while recording.
- A plan step shows no owner if the agent description does not match the step title. The prompt above
  is written to avoid that. If you edit it, keep the two in sync.
- An idle interactive session counts as "waiting on you", so a session sitting at the prompt shows a
  waiting callout. That is correct, but it can look like an error.
- The status line and a few interactive paths have only been exercised in tests and headless runs, not
  in a long interactive session. Do the dry run.
- Cost for agents is an estimate from token counts and a price table. Do not call it a bill.

## Clean up after the take

- Stop the simulator (Ctrl-C) and confirm its sessions have left the wall.
- Type `/exit` in the Claude session and confirm it leaves too.
- Stop the server (`Ctrl-C` on `npm run dev`, or `podiumctl stop`).
- If you added the settings hooks for Beat 3, remove them from `~/.claude/settings.json`.
- `git status` should show nothing changed. The demo prompt reads files and runs one failing `ls`.
