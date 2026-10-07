#!/usr/bin/env bash
# Tests for install.sh. A stub `claude` on PATH answers what the installer reads, and HOME is a
# temp folder, so nothing touches your real setup.
#
#   tests/install.test.sh
set -euo pipefail

KIT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/home" "$TMP/other-kit"
ln -s "$KIT" "$TMP/kit-link"

# STUB_MARKET: the folder registered as the "claude-kit" marketplace. STUB_PLUGINS: `plugin list`.
cat >"$TMP/bin/claude" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  --version) echo "9.9.9 (Claude Code)" ;;
  "plugin list") printf '%s\n' "${STUB_PLUGINS:-}" ;;
  "plugin list --json") echo '[]' ;;
  "plugin marketplace list --json")
    printf '[\n  {\n    "name": "claude-kit",\n    "source": "directory",\n    "path": "%s",\n    "installLocation": "%s"\n  }\n]\n' "$STUB_MARKET" "$STUB_MARKET" ;;
esac
EOF
chmod +x "$TMP/bin/claude"

fails=0
OUT=""; CODE=0
run() {
  set +e
  OUT="$(PATH="$TMP/bin:$PATH" HOME="$TMP/home" NO_COLOR=1 "$@" </dev/null 2>&1)"; CODE=$?
  set -e
}
check() {
  if [ "$2" = ok ]; then echo "ok    $1"; else echo "FAIL  $1"; printf '%s\n' "$OUT" | sed 's/^/      /'; fails=1; fi
}
has() { if printf '%s\n' "$OUT" | grep -qF "$1"; then echo ok; else echo no; fi; }
lacks() { if printf '%s\n' "$OUT" | grep -qF "$1"; then echo no; else echo ok; fi; }

# Without a terminal or --yes the installer stops at "add --yes to apply", before changing anything.
STUB_MARKET="$TMP/other-kit" STUB_PLUGINS="" run "$KIT/install.sh" --select git-gate
check "warns when another folder is the claude-kit marketplace" "$(has 'is in use by another folder')"

STUB_MARKET="$TMP/kit-link" STUB_PLUGINS="" run "$KIT/install.sh" --select git-gate
check "no warning when the marketplace is this folder by another path" "$(lacks 'is in use by another folder')"

STUB_MARKET="$TMP/other-kit" STUB_PLUGINS="only-there@claude-kit" run "$KIT/install.sh" --select git-gate --yes
check "--yes stops before dropping mods only the other folder has" \
  "$([ "$CODE" -eq 1 ] && [ "$(has 'would stop loading: only-there')" = ok ] && echo ok || echo no)"

# Another marketplace whose name starts with "claude-kit" is not this one.
STUB_MARKET="$TMP/other-kit" STUB_PLUGINS="  ❯ paid-run-guard@claude-kit-local" run "$KIT/install.sh" --select git-gate
check "a mod from claude-kit-local is not counted as lost" "$(lacks 'would stop loading')"

STUB_MARKET="$TMP/kit-link" STUB_PLUGINS="  ❯ git-gate@claude-kit-local" run "$KIT/install.sh" --list
check "a same-named mod from claude-kit-local is not installed from the kit" \
  "$(printf '%s\n' "$OUT" | grep -Eq 'git-gate +installed' && echo no || echo ok)"

OUT="$(git -C "$KIT" check-attr eol -- install.sh tests/install.test.sh)"
check "shell scripts check out with LF line endings" \
  "$([ "$(printf '%s\n' "$OUT" | grep -c ': eol: lf$')" -eq 2 ] && echo ok || echo no)"

exit $fails
