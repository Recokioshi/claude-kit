# Contributing

## Layout
```
skills/<name>/      SKILL.md, references/ (read on demand), evals/evals.json (test prompts)
mods/<name>/        .claude-plugin/plugin.json, hooks/ (logic + register), types/ (state contract),
                    tests/, README.md
.claude-plugin/     marketplace.json: the mods, as the local marketplace "claude-kit"
docs/               worklog-spec.md (the WL1 worklog format) · api-notes.md (mod API facts)
install.sh          the installer; its CATALOG lists every item with a one-line description
tests/              install.test.sh: installer tests (a stub `claude`, a temp HOME)
```

## Working on a mod
Work in your clone. Terminal sessions read the installed mods from it; the desktop app runs a
copy (step 3).
1. Edit `mods/<name>/hooks/…`.
2. Check:
   ```bash
   cd mods/<name>
   claude plugin test .              # unit and UI tests (terminal, desktop, mobile)
   claude plugin validate --strict . # what the engine would refuse at load
   npx tsc -p .                      # types; needs .claude-plugin/types, which the engine
                                     # writes the first time it loads the mod
   ```
3. Try it:
   - Terminal (`claude`): `/reload-plugins` reads the mod from your clone.
   - Desktop app: sessions run the copy in `~/.claude/plugins/cache/claude-kit/<name>/<version>/`,
     and `/reload-plugins` or reopening the app reloads that copy, not your edits. Bump `version` in
     `mods/<name>/.claude-plugin/plugin.json` and in the mod's entry in `.claude-plugin/marketplace.json`,
     run `claude plugin update <name>@claude-kit` (it does nothing while the version is unchanged),
     then start a new session.

Loader rules worth knowing (the engine reads the source before running it):
- `$` calls are spelled `$.noun.method(...)` literally; helpers that take `$` are top-level
  functions in the same file; event names are string literals.
- An event may have one hook without a matcher per mod.
- `$.command.run` and `$.prompt.submit` skip the calling mod's own hooks: from a button, call
  your own function, not your own command.
- State the UI reads lives in `$.state` (declared in `types/index.d.ts`); anything that must
  outlive a restart goes to `$.store`.

## Working on a skill
- Keep `SKILL.md` short (under ~120 lines); move detail to `references/`.
- The front matter `description` says *when* to use the skill ("Use when …"); check it parses:
  `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]).read().split('---')[1])" skills/<name>/SKILL.md`
- Add a case to `evals/evals.json` for each behaviour you change.
- No project names, customer data or personal preferences: this kit is shared.

## Adding a skill or mod
1. Create the folder (as above).
2. Add a line to `CATALOG` in `install.sh` (an unlisted folder is still offered, with no description).
3. A mod also goes into `.claude-plugin/marketplace.json`.
4. Add it to the table in `README.md`.

## Before a pull request
- Every mod: `claude plugin test .` and `claude plugin validate --strict .` pass.
- `bash -n install.sh`, and run `./install.sh --list` once.
