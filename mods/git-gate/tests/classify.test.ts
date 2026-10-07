import { describe, expect, test } from 'claude-code/testing'

import Hooks from '../hooks'

const kinds = (command: string) => Hooks.classifyBash(command).map(op => op.kind)

describe('classifyBash: what needs a grant', () => {
  const cases: [string, string[]][] = [
    // free
    ['git status && git log --oneline -5', []],
    ['git diff HEAD~1 -- src', []],
    ['git checkout -b claude/fix-x', []],
    ['git switch main', []],
    ['git fetch origin main', []],
    ['git branch -d merged-branch', []],
    ['git stash list', []],
    ['git merge --abort', []],
    ['git rebase --abort', []],
    ['git clean -n', []],
    ['git restore --staged src/a.ts', []],
    ['git reset src/a.ts', []],
    ['echo "git push is how you publish"', []],
    ['npm run dod', []],
    ['gh pr view 12 --json url', []],
    ['gh pr list --state merged', []],
    // commit
    ['git commit -m "fix(auth): x"', ['commit']],
    ['git add -A && git commit -q -F - <<\'EOF\'\nmsg\nEOF', ['commit']],
    ['git cherry-pick abc1234', ['commit']],
    ['git revert HEAD', ['commit']],
    ['git rebase main', ['commit']],
    ['git reset --soft HEAD~1', ['commit']],
    ['git merge --continue', ['commit']],
    // merge
    ['git merge --no-ff claude/fc-a8 -m "Merge"', ['merge']],
    ['git pull origin main', ['merge']],
    ['gh pr merge 333 --merge', ['merge']],
    ['gh pr merge --auto --squash', ['merge']],
    ['gh api -X PUT repos/o/r/pulls/12/merge', ['merge']],
    // push
    ['git push -u origin claude/x', ['push']],
    ['git push', ['push']],
    ['git push origin HEAD', ['push']],
    // pr
    ['gh pr create --base master --title t --body b', ['pr']],
    ['gh pr create -B beta --fill', ['pr']],
    // force / delete remote
    ['git push --force origin x', ['force']],
    ['git push -f', ['force']],
    ['git push --force-with-lease', ['force']],
    ['git push origin +main', ['force']],
    ['git push origin :old-branch', ['force']],
    ['git push --delete origin old', ['force']],
    ['git push --mirror', ['force']],
    // discard
    ['git reset --hard origin/main', ['discard']],
    ['git clean -fd', ['discard']],
    ['git clean -xdf', ['discard']],
    ['git checkout -- .', ['discard']],
    ['git checkout .', ['discard']],
    ['git restore src/a.ts', ['discard']],
    ['git switch --discard-changes main', ['discard']],
    ['git filter-branch --tree-filter x', ['discard']],
    // branch delete
    ['git branch -D claude/old', ['branch-delete']],
    ['git branch -f main HEAD~3', ['branch-delete']],
    // worktree / stash
    ['git worktree remove --force .claude/worktrees/fc-a1', ['worktree-remove']],
    ['git stash', ['stash']],
    ['git stash pop', ['stash']],
    ['git stash drop stash@{0}', ['stash']],
  ]

  for (const [command, expected] of cases) {
    test(command.split('\n')[0] ?? command, () => {
      expect(kinds(command)).toEqual(expected)
    })
  }
})

describe('classifyBash: spellings that try to hide', () => {
  const hidden: [string, string][] = [
    ['cd ../web && git push origin x', 'push'],
    ['git -C .claude/worktrees/fc-a1 push', 'push'],
    ['git -c user.name=x commit -m y', 'commit'],
    ['env GIT_TRACE=1 git push', 'push'],
    ['sudo -u me git push', 'push'],
    ['nice -n 5 git push', 'push'],
    ['timeout 30 git push', 'push'],
    ['command git push', 'push'],
    ['bash -c "git push origin main"', 'push'],
    ["sh -c 'cd x && git merge feature'", 'merge'],
    ['eval "git push --force"', 'force'],
    ['echo $(git push)', 'push'],
    ['echo `git push`', 'push'],
    ['true; git push', 'push'],
    ['false || git push', 'push'],
    ['git status | cat; git push', 'push'],
    ['(cd sub && git push)', 'push'],
    ['/usr/bin/git push', 'push'],
    ['\\git push', 'push'],
    ['git push -fu origin x', 'force'],
    ['git -c alias.ship=push ship', 'opaque'],
    ['xargs -I{} git push origin {} < branches.txt', 'push'],
    ['git push origin x &', 'push'],
  ]

  for (const [command, expected] of hidden) {
    test(command, () => {
      expect(kinds(command)).toContain(expected)
    })
  }

  test('cd and -C set the folder the operation runs in', () => {
    const [op] = Hooks.classifyBash('cd ../web && git -C apps push')
    expect(op?.dir).toBe('../web/apps')
  })

  test('gh pr create without --base is flagged for base injection', () => {
    const [op] = Hooks.classifyBash('gh pr create --title x --body y')
    expect(op?.missingBase).toBe(true)
    const [named] = Hooks.classifyBash('gh pr create --base=master --title x')
    expect(named?.base).toBe('master')
  })

  test('push names the target branch of a refspec', () => {
    expect(Hooks.classifyBash('git push origin HEAD:master')[0]?.target).toBe('master')
    expect(Hooks.classifyBash('git push origin feature')[0]?.target).toBe('feature')
  })

  test('worktree adds are found with their paths', () => {
    expect(Hooks.worktreeAdds('git worktree add -q .claude/worktrees/fc-b1 -b claude/fc-b1 main')).toEqual([
      { path: '.claude/worktrees/fc-b1', dir: null },
    ])
  })
})

describe('classifyMcp', () => {
  test('GitHub MCP tools that change the remote', () => {
    expect(Hooks.classifyMcp('mcp__github__create_pull_request', { base: 'master' })[0]?.kind).toBe('pr')
    expect(Hooks.classifyMcp('mcp__github__merge_pull_request', {})[0]?.kind).toBe('merge')
    expect(Hooks.classifyMcp('mcp__github__push_files', { branch: 'x' })[0]?.kind).toBe('push')
    expect(Hooks.classifyMcp('mcp__github__get_file_contents', {})).toEqual([])
  })
})

describe('review regressions: shell shapes', () => {
  const cases: [string, string[]][] = [
    ['if true; then git push; fi', ['push']],
    ['{ git push; }', ['push']],
    ['git push 2>&1 | tail -5', ['push']],
    ['cat <<EOF\ngit push origin main\nEOF', []],
    ['git commit -F - <<\'EOF\'\nfix: no git push here\nEOF', ['commit']],
    ['git push origin a b:master', ['push', 'push']],
    ['git push --del origin x', ['force']],
    ['git push origin +claude/x', ['force']],
    ['git push --all', ['push']],
    ['git checkout -B claude/x', ['branch-delete']],
    ['git checkout -- src/a.ts', ['discard']],
    ['git update-ref refs/heads/main abc123', ['force']],
    ['gh repo sync --force', ['force']],
    ['stdbuf -oL git push', ['push']],
  ]
  for (const [command, expected] of cases) {
    test(command.replace(/\n/g, '⏎'), () => {
      expect(kinds(command)).toEqual(expected)
    })
  }
  test('the target of a push names every refspec', () => {
    expect(Hooks.classifyBash('git push origin a b:master').map(op => op.target)).toEqual(['a', 'master'])
    expect(Hooks.classifyBash('git push --all')[0]?.target).toBe('*')
  })
  test('a checkout earlier on the line is remembered', () => {
    expect(Hooks.classifyBash('git checkout master && git merge x')[0]?.lineBranch).toBe('master')
  })
})
