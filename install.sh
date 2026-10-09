#!/usr/bin/env bash
# claude-kit installer: pick the skills and mods you want, then install, update or remove them.
#
#   ./install.sh                    interactive list (↑/↓ move · space toggle · a all · n none · enter confirm · q quit)
#   ./install.sh --all              install everything, no questions
#   ./install.sh --select kickoff,ship,git-gate
#                                   install exactly these (others from the kit are left as they are)
#   ./install.sh --uninstall        remove every skill and mod this kit installed
#   ./install.sh --list             show what is in the kit and what is installed
#   options: --yes (no confirmation) · --force (replace a same-named skill that is not from this kit;
#            yours is moved to ~/.claude/skills-backup/)
#
# Skills are copied to ~/.claude/skills/<name> (re-run after `git pull` to update them).
# Mods are installed from this folder through a local marketplace named "claude-kit": keep the folder
# where it is. Terminal sessions read them from it, so edits and `git pull` apply after /reload-plugins.
# The desktop app runs the copy in ~/.claude/plugins/cache/claude-kit/<mod>/<version>/ instead, which
# this script refreshes (`claude plugin update`) when the version in the mod's plugin.json changed;
# start a new session afterwards. Changed files under an unchanged version stay old there.
# Works with the bash 3.2 that macOS ships.
set -euo pipefail

KIT="$(cd "$(dirname "$0")" && pwd)"
MARKET="claude-kit"
SKILLS_DIR="$HOME/.claude/skills"
MARKER=".claude-kit-source"
MIN_CLAUDE="2.1.287"

# ── catalog ──────────────────────────────────────────────────────────────────
# kind|name|one line. Folders in skills/ and mods/ that are not listed here are offered too.
CATALOG=(
  "skill|kickoff|/kickoff <plan>: run a multi-step plan to done (worklog, commits, agents, reviews)"
  "skill|ship|/ship: gate, clean commits, push and a PR against the right base"
  "skill|report|/report: short, visual status reports for Slack/Teams, meetings or decks"
  "mod|git-gate|git writes only when you asked (commit, push, PR, merge); no UI"
  "mod|progress-pane|live worklog band + /progress pane; answer Claude's questions mid-run"
  "mod|model-guard|/models: choose which model versions Claude and its agents may use"
  "mod|handoff|/handoff: carry a task's state to another repo or session"
)

KINDS=(); NAMES=(); DESCS=()
add_item() { KINDS+=("$1"); NAMES+=("$2"); DESCS+=("$3"); }
for row in "${CATALOG[@]}"; do
  IFS='|' read -r k n d <<<"$row"
  if [ "$k" = skill ] && [ -f "$KIT/skills/$n/SKILL.md" ]; then add_item "$k" "$n" "$d"; fi
  if [ "$k" = mod ] && [ -f "$KIT/mods/$n/.claude-plugin/plugin.json" ]; then add_item "$k" "$n" "$d"; fi
done
known() { local i; for i in "${!NAMES[@]}"; do [ "${KINDS[$i]}|${NAMES[$i]}" = "$1|$2" ] && return 0; done; return 1; }
for dir in "$KIT"/skills/*/; do n="$(basename "$dir")"; [ -f "$dir/SKILL.md" ] && ! known skill "$n" && add_item skill "$n" "(skill)"; done
for dir in "$KIT"/mods/*/; do n="$(basename "$dir")"; [ -f "$dir/.claude-plugin/plugin.json" ] && ! known mod "$n" && add_item mod "$n" "(mod)"; done
COUNT=${#NAMES[@]}

# ── options ──────────────────────────────────────────────────────────────────
MODE=interactive; SELECT=""; YES=0; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --all) MODE=all; shift ;;
    --select) MODE=select; SELECT="${2:-}"; shift 2 ;;
    --uninstall) MODE=uninstall; shift ;;
    --list) MODE=list; shift ;;
    --yes|-y) YES=1; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  B=$'\033[1m'; D=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; N=$'\033[0m'
else
  B=""; D=""; G=""; Y=""; R=""; C=""; N=""
fi

# ── what is installed ────────────────────────────────────────────────────────
HAS_CLAUDE=0; PLUGIN_LIST=""; PLUGIN_JSON=""
if command -v claude >/dev/null 2>&1; then
  HAS_CLAUDE=1
  PLUGIN_LIST="$(claude plugin list 2>/dev/null || true)"
  PLUGIN_JSON="$(claude plugin list --json 2>/dev/null || true)"
fi

# skill: installed (ours) | foreign (same name, not from this kit) | none
skill_state() {
  local dest="$SKILLS_DIR/$1"
  if [ -f "$dest/$MARKER" ]; then echo installed
  elif [ -e "$dest" ]; then echo foreign
  else echo none; fi
}
# Names of the installed mods from this marketplace, matched on the whole id: "x@claude-kit-local"
# is from another marketplace.
kit_mods() { printf '%s\n' "$PLUGIN_LIST" | grep -Eo '[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+' | sed -n "s/@$MARKET\$//p" | sort -u || true; }
mod_state() { if kit_mods | grep -qxF "$1"; then echo installed; else echo none; fi; }
state_of() { if [ "${KINDS[$1]}" = skill ]; then skill_state "${NAMES[$1]}"; else mod_state "${NAMES[$1]}"; fi; }

# The desktop app runs an installed mod's copy in ~/.claude/plugins/cache/claude-kit/<mod>/<version>/.
# `claude plugin update` refreshes it only when the version in the mod's plugin.json changed.
kit_version() { grep -m1 '"version"' "$KIT/mods/$1/.claude-plugin/plugin.json" 2>/dev/null | sed 's/.*"version"[^"]*"\([^"]*\)".*/\1/' || true; }
# "<version>|<path>" of the installed copy. Only the JSON list has it: the text list shows the
# folder's version.
mod_copy() {
  printf '%s\n' "$PLUGIN_JSON" | tr '{},' '\n\n\n' | awk -F'"' -v id="$1@$MARKET" '
    $2 == "id" { on = ($4 == id) }
    on && $2 == "version" && v == "" { v = $4 }
    on && $2 == "installPath" && p == "" { p = $4 }
    END { if (v != "" && p != "") print v "|" p }' || true
}
# "<state> <installed version> <folder version>", state: current | behind (versions differ) |
# changed (same version, different files: the copy stays old) | unknown
copy_state() {
  local n="$1" copy iv kv cache
  copy="$(mod_copy "$n")"; kv="$(kit_version "$n")"
  if [ -z "$copy" ] || [ -z "$kv" ]; then echo unknown; return; fi
  iv="${copy%%|*}"; cache="${copy#*|}"
  if [ "$iv" != "$kv" ]; then echo "behind $iv $kv"; return; fi
  if [ ! -d "$cache" ]; then echo unknown
  elif diff -rq -x .claude-plugin -x .in_use -x .DS_Store "$cache" "$KIT/mods/$n" >/dev/null 2>&1 \
    && cmp -s "$cache/.claude-plugin/plugin.json" "$KIT/mods/$n/.claude-plugin/plugin.json"; then echo "current $iv $kv"
  else echo "changed $iv $kv"; fi
}

STATES=(); COPIES=()
for i in $(seq 0 $((COUNT - 1))); do
  STATES+=("$(state_of "$i")")
  if [ "${KINDS[$i]}" = mod ] && [ "${STATES[$i]}" = installed ]; then COPIES+=("$(copy_state "${NAMES[$i]}")"); else COPIES+=(""); fi
done

# A note on the desktop app's copy, for --list and (with "plan") the plan.
copy_note() {
  local state iv kv
  read -r state iv kv <<<"${COPIES[$1]}"
  case "$state" in
    behind)
      if [ "${2:-}" = plan ]; then printf '  %s(desktop app copy: %s → %s)%s' "$D" "$iv" "$kv" "$N"
      else printf '  %s(desktop app copy %s, folder %s: run ./install.sh)%s' "$Y" "$iv" "$kv" "$N"; fi ;;
    changed) printf '  %s(files changed but the version is still %s: the desktop app keeps its old copy)%s' "$Y" "$iv" "$N" ;;
    current) [ "${2:-}" = plan ] && printf '  %s(%s, up to date)%s' "$D" "$iv" "$N" ;;
  esac
  return 0
}

# Fixed width (10 columns) so the next column lines up, colors or not.
status_text() {
  case "$1" in
    installed) printf '%sinstalled%s ' "$G" "$N" ;;
    foreign) printf '%sname taken%s' "$Y" "$N" ;;
    *) printf '%s—%s         ' "$D" "$N" ;;
  esac
}

if [ "$MODE" = list ]; then
  printf '%sclaude-kit%s  %s\n\n' "$B" "$N" "$KIT"
  for i in $(seq 0 $((COUNT - 1))); do
    printf '  %-6s %-14s %s  %s%s\n' "${KINDS[$i]}" "${NAMES[$i]}" "$(status_text "${STATES[$i]}")" "${DESCS[$i]}" "$(copy_note "$i")"
  done
  exit 0
fi

# ── where the kit lives ──────────────────────────────────────────────────────
# Mods are loaded from this folder. A kit unpacked in Downloads or a temp folder breaks
# the moment that folder is cleaned up.
case "$KIT" in
  "$HOME/Downloads"*|/tmp/*|/private/tmp/*|/private/var/folders/*|/var/folders/*)
    printf '%s!%s This kit is in %s.\n  Mods are loaded from this folder, so it has to stay. Better: move it first, e.g.\n    mv "%s" ~/claude-kit && ~/claude-kit/install.sh\n' "$Y" "$N" "$KIT" "$KIT"
    if [ "$YES" -eq 0 ] && [ -t 0 ]; then
      printf '  Continue from here anyway? [y/N] '; read -r ans
      case "$ans" in y|Y|yes) ;; *) exit 1 ;; esac
    fi
    ;;
esac

# ── choose ───────────────────────────────────────────────────────────────────
CHOSEN=()
preselect() {
  # Interactive start: what is installed; on a first install, everything.
  local any=0 i
  for i in $(seq 0 $((COUNT - 1))); do [ "${STATES[$i]}" = installed ] && any=1; done
  CHOSEN=()
  for i in $(seq 0 $((COUNT - 1))); do
    if [ $any -eq 0 ] || [ "${STATES[$i]}" = installed ]; then CHOSEN+=(1); else CHOSEN+=(0); fi
  done
}

HIDE_CURSOR=$'\033[?25l'; SHOW_CURSOR=$'\033[?25h'
pick() {
  local cur=0 key rest lines=0 i hide="$HIDE_CURSOR" show="$SHOW_CURSOR"
  printf '%s' "$hide"
  # The cursor and echo come back however the script ends.
  trap 'printf "%s" "$SHOW_CURSOR"; stty echo 2>/dev/null || true' EXIT
  trap 'printf "%s\n" "$SHOW_CURSOR"; exit 130' INT
  while true; do
    [ $lines -gt 0 ] && printf '\033[%dA' "$lines"
    lines=0
    printf '\033[K%sclaude-kit%s  pick what to install %s(↑↓ move · space toggle · a all · n none · enter continue · q quit)%s\n' "$B" "$N" "$D" "$N"; lines=$((lines + 1))
    local last=""
    for i in $(seq 0 $((COUNT - 1))); do
      if [ "${KINDS[$i]}" != "$last" ]; then
        last="${KINDS[$i]}"
        printf '\033[K\n\033[K  %s%s%s\n' "$B" "$([ "$last" = skill ] && echo 'Skills' || echo 'Mods')" "$N"; lines=$((lines + 2))
      fi
      local pointer="  " box="[ ]" name="${NAMES[$i]}"
      [ "$i" -eq "$cur" ] && pointer="${C}›${N} "
      [ "${CHOSEN[$i]}" -eq 1 ] && box="${G}[x]${N}"
      [ "$i" -eq "$cur" ] && name="${B}${name}${N}"
      printf '\033[K  %s%s %-*s %s  %s%s%s\n' "$pointer" "$box" $((14 + ${#name} - ${#NAMES[$i]})) "$name" "$(status_text "${STATES[$i]}")" "$D" "${DESCS[$i]}" "$N"
      lines=$((lines + 1))
    done
    printf '\033[K\n'; lines=$((lines + 1))

    IFS= read -rsn1 key || key=q
    if [ "$key" = $'\033' ]; then
      IFS= read -rsn2 -t 1 rest || rest=""
      key="$key$rest"
    fi
    case "$key" in
      $'\033[A'|k) cur=$(( (cur - 1 + COUNT) % COUNT )) ;;
      $'\033[B'|j) cur=$(( (cur + 1) % COUNT )) ;;
      " ") CHOSEN[$cur]=$((1 - CHOSEN[$cur])) ;;
      a|A) for i in $(seq 0 $((COUNT - 1))); do CHOSEN[$i]=1; done ;;
      n|N) for i in $(seq 0 $((COUNT - 1))); do CHOSEN[$i]=0; done ;;
      "") break ;;
      q|Q) printf '%s' "$show"; echo "Nothing changed."; exit 0 ;;
    esac
  done
  printf '%s' "$show"
}

case "$MODE" in
  interactive)
    if [ -t 0 ] && [ -t 1 ]; then
      preselect; pick
    else
      echo "Not a terminal: use --all, --select <names> or --uninstall (see --help)." >&2; exit 2
    fi
    ;;
  all) CHOSEN=(); for i in $(seq 0 $((COUNT - 1))); do CHOSEN+=(1); done ;;
  uninstall) CHOSEN=(); for i in $(seq 0 $((COUNT - 1))); do CHOSEN+=(0); done ;;
  select)
    CHOSEN=()
    for i in $(seq 0 $((COUNT - 1))); do
      # --select names only what to add; anything else keeps its current state
      if printf ',%s,' "$SELECT" | grep -q ",${NAMES[$i]},"; then CHOSEN+=(1)
      elif [ "${STATES[$i]}" = installed ]; then CHOSEN+=(1)
      else CHOSEN+=(0); fi
    done
    for w in $(printf '%s' "$SELECT" | tr ',' ' '); do
      found=0; for i in $(seq 0 $((COUNT - 1))); do [ "${NAMES[$i]}" = "$w" ] && found=1; done
      [ $found -eq 1 ] || { echo "not in the kit: $w (see --list)" >&2; exit 2; }
    done
    ;;
esac

# ── plan ─────────────────────────────────────────────────────────────────────
TODO=()   # action|index
for i in $(seq 0 $((COUNT - 1))); do
  st="${STATES[$i]}"
  if [ "${CHOSEN[$i]}" -eq 1 ]; then
    if [ "$st" = installed ]; then TODO+=("update|$i")
    elif [ "$st" = foreign ] && [ "$FORCE" -eq 0 ]; then TODO+=("skip|$i")
    else TODO+=("install|$i"); fi
  elif [ "$st" = installed ]; then
    TODO+=("remove|$i")
  fi
done

if [ ${#TODO[@]} -eq 0 ]; then echo "Nothing selected, nothing installed. Nothing to do."; exit 0; fi

needs_claude=0
for t in "${TODO[@]}"; do i="${t#*|}"; [ "${KINDS[$i]}" = mod ] && [ "${t%%|*}" != skip ] && needs_claude=1; done
if [ $needs_claude -eq 1 ] && [ $HAS_CLAUDE -eq 0 ]; then
  echo "${R}✗${N} The claude CLI is not on PATH; mods need it. Install Claude Code first, or pick skills only." >&2; exit 1
fi
if [ $needs_claude -eq 1 ]; then
  have="$(claude --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  if [ -n "$have" ] && [ "$(printf '%s\n%s\n' "$MIN_CLAUDE" "$have" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" != "$MIN_CLAUDE" ]; then
    echo "${Y}!${N} Claude Code $have is older than $MIN_CLAUDE; mods need $MIN_CLAUDE or newer (run: claude update)."
  fi
fi

# Another folder already registered as the "claude-kit" marketplace (an older copy, a
# personal fork)? Installing points the name here, and mods only that folder has stop loading.
# -ef: the same folder reached by another path (a symlink) is not another folder.
if [ $needs_claude -eq 1 ]; then
  other="$(claude plugin marketplace list --json 2>/dev/null | tr '{},' '\n\n\n' | awk -F'"' -v m="$MARKET" '
    $2 == "name" { on = ($4 == m) }
    on && $2 == "path" && p == "" { p = $4 }
    END { if (p != "") print p }' || true)"
  if [ -n "$other" ] && [ -d "$other" ] && ! [ "$other" -ef "$KIT" ]; then
    lost=""
    for p in $(kit_mods); do
      [ -d "$KIT/mods/$p" ] || lost="$lost $p"
    done
    echo
    echo "${Y}!${N} The marketplace name \"$MARKET\" is in use by another folder: $other"
    echo "  Installing makes it point here instead."
    if [ -n "$lost" ]; then
      echo "  ${R}These mods are only in that folder and would stop loading:${N}$lost"
      echo "  To keep them, give that folder's .claude-plugin/marketplace.json another \"name\","
      echo "  then: claude plugin marketplace add \"$other\" and install them from it."
    fi
    if [ "$YES" -eq 0 ] && [ -t 0 ]; then
      printf '  Point "%s" here? [y/N] ' "$MARKET"; read -r ans
      case "$ans" in y|Y|yes) ;; *) echo "Nothing changed."; exit 0 ;; esac
    elif [ -n "$lost" ] && [ "$YES" -eq 1 ]; then
      echo "  Stopping: --yes would break those mods. Rename that marketplace first, or run without --yes." >&2; exit 1
    fi
  fi
fi

echo
echo "${B}Plan${N}"
for t in "${TODO[@]}"; do
  a="${t%%|*}"; i="${t#*|}"
  case "$a" in
    install) mark="${G}+${N} install" ;;
    update) mark="${C}↻${N} update " ;;
    remove) mark="${R}−${N} remove " ;;
    skip) mark="${Y}!${N} skip   " ;;
  esac
  note=""; [ "$a" = skip ] && note="  ${D}(~/.claude/skills/${NAMES[$i]} exists and is not from this kit; --force replaces it and moves yours to ~/.claude/skills-backup/)${N}"
  [ "$a" = update ] && note="$(copy_note "$i" plan)"
  printf '  %s %-5s %s%s\n' "$mark" "${KINDS[$i]}" "${NAMES[$i]}" "$note"
done
if [ "$YES" -eq 0 ]; then
  if [ -t 0 ]; then printf '\nApply? [Y/n] '; read -r ans; case "$ans" in ""|y|Y|yes) ;; *) echo "Nothing changed."; exit 0 ;; esac
  else echo "Not a terminal: add --yes to apply." >&2; exit 2; fi
fi

# ── apply ────────────────────────────────────────────────────────────────────
version="$(git -C "$KIT" rev-parse --short HEAD 2>/dev/null || echo local)"
install_skill() {
  local name="$1" dest="$SKILLS_DIR/$1"
  mkdir -p "$SKILLS_DIR"
  if [ -e "$dest" ] && [ ! -f "$dest/$MARKER" ]; then
    # Backups go outside skills/: a copy left there would load as a second skill of that name.
    local backup="$HOME/.claude/skills-backup/$name-$(date +%Y%m%d%H%M%S)"
    mkdir -p "$HOME/.claude/skills-backup"
    mv "$dest" "$backup"
    echo "    your own $name skill is kept in ${backup/#$HOME/~}"
  fi
  rm -rf "$dest.kit-new"
  cp -R "$KIT/skills/$name" "$dest.kit-new"
  printf 'source: %s\nversion: %s\ninstalled: %s\n' "$KIT" "$version" "$(date +%Y-%m-%d)" > "$dest.kit-new/$MARKER"
  rm -rf "$dest"
  mv "$dest.kit-new" "$dest"
}
remove_skill() {
  local dest="$SKILLS_DIR/$1"
  [ -f "$dest/$MARKER" ] && rm -rf "$dest"
}
market_ready=0
ensure_market() {
  [ $market_ready -eq 1 ] && return 0
  # add (or point an existing claude-kit marketplace at this folder)
  claude plugin marketplace add "$KIT" >/dev/null 2>&1 || claude plugin marketplace update "$MARKET" >/dev/null 2>&1 || true
  market_ready=1
}

echo
fail=0; stale=""
for t in "${TODO[@]}"; do
  a="${t%%|*}"; i="${t#*|}"; k="${KINDS[$i]}"; n="${NAMES[$i]}"
  case "$k:$a" in
    skill:install|skill:update) install_skill "$n" && echo "  ${G}✓${N} skill $n → ~/.claude/skills/$n" ;;
    skill:remove) remove_skill "$n" && echo "  ${G}✓${N} skill $n removed" ;;
    mod:install)
      ensure_market
      claude plugin install "$n@$MARKET" >/dev/null 2>&1 || true
      PLUGIN_LIST="$(claude plugin list 2>/dev/null || true)"
      if [ "$(mod_state "$n")" = installed ]; then echo "  ${G}✓${N} mod $n"; else echo "  ${R}✗${N} mod $n: install failed (try: claude plugin install $n@$MARKET)"; fail=1; fi
      ;;
    mod:update)
      # `plugin install` leaves an installed mod's copy as it is; `plugin update` replaces it
      # when the version in plugin.json changed and does nothing otherwise.
      ensure_market
      claude plugin update "$n@$MARKET" >/dev/null 2>&1 || true
      PLUGIN_LIST="$(claude plugin list 2>/dev/null || true)"
      PLUGIN_JSON="$(claude plugin list --json 2>/dev/null || true)"
      read -r was from to <<<"${COPIES[$i]}"
      read -r now iv kv <<<"$(copy_state "$n")"
      case "$now" in
        current) if [ "$was" = behind ]; then echo "  ${G}✓${N} mod $n $from → $to"; else echo "  ${G}✓${N} mod $n ${D}($iv, up to date)${N}"; fi ;;
        changed)
          echo "  ${Y}!${N} mod $n: files changed but the version is still $iv, so the desktop app keeps its old copy."
          echo "    To ship them there, bump \"version\" in mods/$n/.claude-plugin/plugin.json (and in .claude-plugin/marketplace.json), then run ./install.sh again."
          stale="$stale $n" ;;
        behind) echo "  ${R}✗${N} mod $n: the desktop app's copy is still $iv (try: claude plugin update $n@$MARKET)"; fail=1 ;;
        *) if [ "$(mod_state "$n")" = installed ]; then echo "  ${G}✓${N} mod $n"; else echo "  ${R}✗${N} mod $n: update failed (try: claude plugin install $n@$MARKET)"; fail=1; fi ;;
      esac
      ;;
    mod:remove)
      if claude plugin uninstall "$n@$MARKET" >/dev/null 2>&1; then echo "  ${G}✓${N} mod $n removed"; else echo "  ${R}✗${N} mod $n: could not remove (try: claude plugin uninstall $n@$MARKET)"; fail=1; fi
      ;;
    *:skip) echo "  ${Y}!${N} skipped $n" ;;
  esac
done

# No mod left: drop the marketplace too.
if [ $HAS_CLAUDE -eq 1 ]; then
  PLUGIN_LIST="$(claude plugin list 2>/dev/null || true)"
  if [ -z "$(kit_mods)" ]; then claude plugin marketplace remove "$MARKET" >/dev/null 2>&1 || true; fi
fi

echo
echo "Done. To load the changes: in the desktop app, start a new session; in a terminal session, run /reload-plugins."
[ -n "$stale" ] && echo "${Y}!${N} The desktop app keeps its old copy of:$stale (bump the version, see above)."
echo "${D}Update later: git pull && ./install.sh   ·   change your picks: ./install.sh   ·   remove all: ./install.sh --uninstall${N}"
exit $fail
