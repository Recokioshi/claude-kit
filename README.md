# claude-kit

Skills and mods for [Claude Code](https://claude.com/claude-code) that make long, autonomous
runs safe to leave alone: Claude follows a plan to done, you see where it is at a glance and can
answer its questions mid-run, and git stays in your hands.

Pick what you need; every piece works on its own.

| | What it does | You use it by |
|---|---|---|
| **Skills** | | |
| `kickoff` | Runs a multi-step plan to done: a worklog, a branch per phase, a commit per step with a green gate, subagents, reviews. `/kickoff continue` resumes an interrupted run | `/kickoff plans/x.md [branch] [scope]` |
| `ship` | Gate, clean commits, push and a pull request against the right base; merges only when asked | `/ship [pr\|commit\|push\|merge]` |
| `report` | Short, visual status reports: a Slack/Teams message, a one-page meeting summary, a deck outline | `/report [teams\|meeting\|deck\|chat]` |
| **Mods** | | |
| `git-gate` | Commits, pushes, PRs, merges and destructive git run only when your message asked for them; everything else is refused before it runs | automatic · `/git-gate` |
| `progress-pane` | A one-line progress band above the prompt and a `/progress` pane: plan, step details, log, and the questions Claude is waiting on, answerable from the pane while it works | automatic during `/kickoff` · `/progress` |
| `model-guard` | Choose which models Claude and its subagents may use, per session, per repo or for everything | `/models` |
| `handoff` | Writes the state of a task (done, open, decisions, gotchas) for the next repo or session to pick up | `/handoff [to <repo>]` · `/handoff pick` |

**Cost:** the three skills add ≈ 420 tokens to every session (their descriptions) and
1.5–3.5k while one runs. Of the mods, only progress-pane adds to the prompt: its `worklog` tool,
and a short contract while a worklog is active.

## Requirements
- Claude Code **2.1.287 or newer** (mods need it; check with `claude --version`, update with
  `claude update`). Mods are an early-access feature: re-run the tests after a Claude Code update.
- macOS or Linux, bash (the 3.2 that macOS ships is fine).

## Install
```bash
git clone <this repo> ~/claude-kit     # keep it here: mods are loaded from this folder
cd ~/claude-kit
./install.sh
```
`./install.sh` shows a list. Pick what you want and press enter:
```
claude-kit  pick what to install (↑↓ move · space toggle · a all · n none · enter continue · q quit)

  Skills
  › [x] kickoff        —           /kickoff <plan>: run a multi-step plan to done (worklog, commits, …)
    [x] ship           —           /ship: gate, clean commits, push and a PR against the right base
    [ ] report         —           /report: short, visual status reports for Slack/Teams, meetings or decks

  Mods
    [x] git-gate       installed   git writes only when you asked (commit, push, PR, merge); no UI
    [x] progress-pane  installed   live worklog band + /progress pane; answer Claude's questions mid-run
    [ ] model-guard    —           /models: choose which models Claude and its agents may use
    [ ] handoff        —           /handoff: carry a task's state to another repo or session
```
It then shows the plan (install, update, remove) and asks before applying it. Start a new
Claude Code session afterwards (or run `/reload-plugins`).

| To | Run |
|---|---|
| change your picks (add or remove) | `./install.sh` |
| update after a `git pull` | `./install.sh` (enter keeps your picks) |
| install everything without questions | `./install.sh --all` |
| install specific ones | `./install.sh --select kickoff,git-gate --yes` |
| see what is installed | `./install.sh --list` |
| remove everything the kit installed | `./install.sh --uninstall` |

**Where things go.**
- **Skills** are copied to `~/.claude/skills/<name>` with a `.claude-kit-source` marker. A skill
  of the same name that you made yourself is never overwritten (unless `--force`, which moves
  yours to `~/.claude/skills-backup/`).
- **Mods** are installed from this folder through a local plugin marketplace named
  `claude-kit` and are **read in place**. Moving or deleting the folder breaks them; after a
  move, run `./install.sh` again from the new place.

**Cloud sessions** (claude.ai/code) don't read your `~/.claude`. To use a skill there, commit
it to the repo's `.claude/skills/`. Mods don't draw in cloud sessions; their commands answer in
text there.

**Where each part shows up:**

| | Terminal | Desktop app | VS Code extension | Mobile (Remote Control) | Cloud session |
|---|---|---|---|---|---|
| Skills | ✓ | ✓ | ✓ | ✓ | from the repo's `.claude/skills/` |
| git-gate, model-guard enforcement | ✓ | ✓ | ✓ | ✓ | – |
| Panes (`/progress`, `/models`, `/handoff`) | ✓ | ✓ | ✓ | ✓ | text answers |
| progress band above the prompt | ✓ | ✓ | – (use `/progress`) | – | – |

## How the pieces work together
- **`/kickoff`** writes the worklog through progress-pane's tool (a validated format: a step is
  "done" only after the gate passed), and git-gate allows commits and phase merges for that task.
  Never onto `main`/`master`, never a push.
- **An interrupted run** (sleep, lost connection, app restart): type `continue` as your first
  message, or `/kickoff continue`. The kickoff permission comes back and the run resumes from its
  worklog. `/clear` ends it: the next job starts with no permissions.
- **Questions mid-run:** Claude records a question with its context and recommendation instead of
  stopping. Click `? 1` on the band, answer in the pane, and the answer reaches Claude between two
  steps.
- **`/ship`** is how the work leaves your machine: typing it allows the push and the PR
  (`/ship merge` the merge). git-gate refuses anything past what you typed.
- **model-guard** keeps subagents on the models you allow; `/kickoff` passes a model on every
  agent call. **handoff** carries the state to the next repo or session.

## Settings per person and per repo
| What | Where |
|---|---|
| protected branches, default PR base per repo (`owner/repo=branch`) | `/plugin configure git-gate@claude-kit` |
| models allowed by default, fallback, deny or swap | `/models` → `g` (global), `s` (this repo) |
| a repo's gate command and PR base for `/ship` | `.claude/ship.json` in that repo: `{"gate": "npm test", "prBase": "develop"}` |

Each mod's README has the details: [git-gate](mods/git-gate/README.md) ·
[progress-pane](mods/progress-pane/README.md) · [model-guard](mods/model-guard/README.md) ·
[handoff](mods/handoff/README.md).

## Limits
- git-gate is a safety net for an eager but honest agent, not a security boundary. It reads every
  shell command and GitHub MCP call, but not git run from inside a script file, from
  `python -c`/`node -e`, or through aliases in your `~/.gitconfig`. Branch protection on GitHub
  is the hard guarantee for shared branches.
- Mods are early access; an engine update can change their API. The tests tell you quickly.

## Developing
See [CONTRIBUTING.md](CONTRIBUTING.md). In short: `cd mods/<name> && claude plugin test . &&
claude plugin validate --strict .`
