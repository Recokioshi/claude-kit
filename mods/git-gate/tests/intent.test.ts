import { describe, expect, test } from 'claude-code/testing'

import Hooks from '../hooks'

const grantsOf = (text: string) => Hooks.readIntent(text).grants
const deniesOf = (text: string) => Hooks.readIntent(text).denies

describe('readIntent: the user\'s real phrasings', () => {
  test('"commit changes" grants commit only', () => {
    expect(grantsOf('commit changes')).toEqual(['commit'])
  })
  test('"open PR to master" grants commit, push, pr', () => {
    expect(grantsOf('open PR to master')).toEqual(['commit', 'push', 'pr'])
  })
  test('"Yes, push same create a PR, and remove worktrees"', () => {
    expect(grantsOf('Yes, push same create a PR, and remove worktrees')).toEqual(['commit', 'push', 'pr', 'worktree-remove'])
  })
  test('"create a branch, commit … create a PR. Don\'t merge it yet"', () => {
    const text = 'Yes, create a branch, commit the changes and create a PR. Don’t merge it yet, I’d like to have it reviewed by myself'
    expect(grantsOf(text)).toEqual(['commit', 'push', 'pr'])
    expect(deniesOf(text)).toEqual(['merge'])
  })
  test('"wrap it up in the separate branch, commit changes and merge to schema-v2/main"', () => {
    const intent = Hooks.readIntent('ok, wrap it up in the separate branch, commit changes and merge to schema-v2/main')
    expect(intent.grants).toEqual(['commit', 'merge'])
    expect(intent.mergeTargets).toEqual(['schema-v2/main'])
  })
  test('"create branches, commit and PRs in both … web to beta of course"', () => {
    expect(grantsOf('create branches, commit and PRs in both web and api with your changes')).toEqual(['commit', 'push', 'pr'])
    expect(grantsOf('create branches, commit and create PRs in both web and api')).toEqual(['commit', 'push', 'pr'])
  })
  test('"yes, fix all of that, then commit and push"', () => {
    expect(grantsOf('yes, fix all of that, then commit and push')).toEqual(['commit', 'push'])
  })
  test('push notifications are not a push', () => {
    expect(grantsOf('reword the push notification copy')).toEqual([])
  })
  test('merge conflicts are not a merge', () => {
    expect(grantsOf('resolve the merge conflicts in schema.py')).toEqual([])
  })
  test('talking about an existing PR grants nothing', () => {
    expect(grantsOf('PR 323 android-polish testing')).toEqual([])
  })
  test('Polish: "zacommituj i wypchnij, ale nie merguj"', () => {
    const intent = Hooks.readIntent('zacommituj i wypchnij, ale nie merguj')
    expect(intent.grants).toEqual(['commit', 'push'])
    expect(intent.denies).toEqual(['merge'])
  })
  test('Polish: "zmerguj do master"', () => {
    const intent = Hooks.readIntent('zmerguj do master')
    expect(intent.grants).toEqual(['merge'])
    expect(intent.mergeTargets).toEqual(['master'])
  })
  test('force push needs its own words', () => {
    expect(grantsOf('push it')).not.toContain('force')
    expect(grantsOf('force push the rebased branch')).toContain('force')
  })
  test('"Remove all other existing worktrees"', () => {
    expect(grantsOf('Remove all other existing worktrees, even those related to this task.')).toEqual(['worktree-remove'])
  })
  test('"never use git stash" denies stash', () => {
    expect(deniesOf('never use git stash in this repo')).toEqual(['stash'])
  })
})

describe('readIntent: continuations, affirmations, commands', () => {
  test('continuations keep grants', () => {
    for (const text of ['Continue', 'continue.', 'go on', 'dalej', 'kontynuuj']) {
      expect(Hooks.readIntent(text).isContinuation).toBe(true)
    }
  })
  test('affirmations take what Claude proposed', () => {
    for (const text of ['yes', 'Yes, do it', 'ok', 'tak', 'dawaj', 'sure']) {
      expect(Hooks.readIntent(text).isAffirmation).toBe(true)
    }
    expect(Hooks.readIntent('yes but first explain why the test failed and what you would change').isAffirmation).toBe(false)
    expect(Hooks.readIntent('the onboarding screen is broken').isAffirmation).toBe(false)
  })
  test('/ship modes', () => {
    expect(Hooks.readIntent('/ship').grants).toEqual(['commit', 'push', 'pr'])
    expect(Hooks.readIntent('/ship commit').grants).toEqual(['commit'])
    expect(Hooks.readIntent('/ship merge').grants).toEqual(['commit', 'push', 'pr', 'merge'])
    expect(Hooks.readIntent('/ship --base beta').ship).toBe('pr')
  })
  test('/kickoff grants commits for the task', () => {
    const intent = Hooks.readIntent('/kickoff plans/x.md claude/main')
    expect(intent.isKickoff).toBe(true)
    expect(intent.grants).toContain('commit')
  })
})

describe('proposals and answers', () => {
  test('a closing question carries its verbs', () => {
    const text = 'All phases are merged into the working branch and dod is green.\n\nShall I push the branch and open a PR to master?'
    expect(Hooks.proposalsIn(text).grants).toEqual(['commit', 'push', 'pr'])
  })
  test('AskUserQuestion: "Yes" takes the question\'s verbs', () => {
    expect(Hooks.grantsFromAnswer('Push and open a PR to master?', 'Yes').grants).toEqual(['commit', 'push', 'pr'])
  })
  test('AskUserQuestion: an option naming less grants less', () => {
    expect(Hooks.grantsFromAnswer('How should I ship this?', 'Commit only').grants).toEqual(['commit'])
  })
  test('AskUserQuestion: "No" grants nothing', () => {
    expect(Hooks.grantsFromAnswer('Push and open a PR?', 'No, not yet').grants).toEqual([])
  })
})

describe('isTrusted', () => {
  const trusted = ['composer', 'bridge', 'sdk', 'auto-continuation']
  test('typed, Remote Control and absent origins count', () => {
    expect(Hooks.isTrusted({ kind: 'composer' }, trusted)).toBe(true)
    expect(Hooks.isTrusted({ kind: 'bridge' }, trusted)).toBe(true)
    expect(Hooks.isTrusted(undefined, trusted)).toBe(true)
  })
  test('peers, notifications, schedules, channels and plugins never grant', () => {
    for (const kind of ['peer', 'peer-send-message', 'task-notification', 'scheduled-trigger', 'channel', 'plugin', 'observer', 'unclassified']) {
      expect(Hooks.isTrusted({ kind }, trusted)).toBe(false)
    }
  })
})

describe('review regressions: words that are not requests', () => {
  const none: string[] = [
    'why did the push fail?',
    'fix the push notifications on Android',
    'read plans/2026-09-12-push-notifications-plan.md first',
    'the last commit broke the build, fix it',
    'resolve the merge conflict in `git push origin main` docs',
    'use --force in the test runner',
    'discard that idea and try another approach',
    'review this PR to fix the crash',
    'did you commit it?',
  ]
  for (const text of none) {
    test(`"${text}" grants nothing`, () => {
      expect(grantsOf(text)).toEqual([])
    })
  }
  test('negation is scoped to the next verb', () => {
    expect(grantsOf('commit, but don\'t push')).toEqual(['commit'])
    expect(deniesOf('commit, but don\'t push')).toEqual(['push'])
    expect(deniesOf('skip the merge for now')).toEqual(['merge'])
    expect(deniesOf('hold off on merging')).toEqual(['merge'])
    expect(deniesOf('no need to push yet')).toEqual(['push'])
    expect(grantsOf('don\'t change the tests and commit')).toEqual(['commit'])
    expect(grantsOf('don\'t forget to push')).toEqual(['commit', 'push'])
  })
  test('force and discard need their own words', () => {
    expect(grantsOf('force push the branch')).toContain('force')
    expect(grantsOf('discard the local changes')).toEqual(['discard'])
  })
  test('/kickoff arguments grant nothing beyond commits', () => {
    expect(grantsOf('/kickoff plans/x.md claude/main then push and open a PR to master')).toEqual(['commit'])
  })
  test('only a whole "yes" message is an affirmation', () => {
    expect(Hooks.readIntent('ok, go ahead').isAffirmation).toBe(true)
    expect(Hooks.readIntent('tak, dawaj').isAffirmation).toBe(true)
    expect(Hooks.readIntent('ok but rename the file first').isAffirmation).toBe(false)
  })
  test('an offer with a negation offers less', () => {
    expect(Hooks.proposalsIn('All green. Shall I push now, without merging?').grants).toEqual(['commit', 'push'])
    expect(Hooks.proposalsIn('Phase A is done and ready to merge.').grants).toEqual([])
  })
})
