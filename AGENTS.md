# Lead Emergence — Agent Operating Rules

Read this file completely before changing code.

These rules implement Software Factory V1. Repository-specific rules in this file remain in force. If an older repository-specific rule conflicts with the factory workflow below, the factory workflow governs only that conflict; otherwise preserve the stricter local rule.

## Ground-truth rule

Never diagnose the current system from a stale handoff, prior agent summary, or historical status document.

- Live observable state outranks documentation.
- Canonical roadmap and production-state documents outrank handoffs and summaries.
- If a canonical document contradicts a live observable, the live observable wins and the canonical document must be corrected in the same session.
- Do not create a second hand-maintained live-status registry.

For production diagnosis or production-affecting work, use the canonical Lead Emergence control-plane `ROADMAP.md` and `PRODUCTION_STATE.md` when available. If they are not accessible, do not invent their contents or treat a local historical document as current truth. Verify live state and stop for Andrew if the task depends on unresolved roadmap authority.

## Software Factory V1

Every implementation task follows:

**Scope → Preflight → Isolate → Build → Prove → Ship**

### 1. Scope

Before changing code:

1. Name the approved roadmap phase/slice and the single task being claimed.
2. State the desired observable that defines success.
3. State the expected files/layer/boundary if known.
4. State a time or token budget.
5. Write one falsifiable hypothesis for defects, plus the cheapest observable that would prove it wrong.

If the task grows beyond that scope, stop. Record adjacent work for backlog rather than absorbing it into the branch.

### 2. Preflight

Before creating or adopting a task branch/worktree, editing code, or committing, run:

```bash
git fetch origin
git worktree list
git branch -vv
git status -sb
```

Compare the proposed task/slice against every active worktree and branch.

State exactly one result:

- **PASS — no material overlap found.** Proceed to Isolate.
- **POTENTIAL OVERLAP — stop.** Name the active branch/worktree and suspected overlap, then escalate to Andrew. Do not auto-resolve, merge around it, reassign it, delete it, or proceed and hope a later merge conflict catches it.

Treat these as potential overlap even when branch names differ:

- same roadmap slice or task
- same feature boundary
- shared authentication/authorization code
- migrations, schemas, RLS, or shared database objects
- root configuration or shared build/deployment configuration
- common service, library, layout, or other shared code both tasks are expected to modify

### 3. Isolate

One active implementation task gets one dedicated task branch and one dedicated worktree.

- One agent works in one task worktree at a time.
- Never have two agents actively edit the same task branch.
- Never edit another agent's worktree.
- Never reuse an unrelated feature branch for a new task.
- Base new task work on the current approved base, normally current `origin/main`, unless the task explicitly names another base.
- Prefer roadmap-linked branch names: `p<phase-or-slice>-<short-task>`.

Examples:

```text
p2.4-lewis-auth-callback
p2.5-onboarding-ui
p3.1-client-activation
```

Branch names are navigation aids, not proof of ownership. Preflight remains mandatory.

After a PASS preflight, these local reversible Git actions are pre-authorized for the assigned task: fetch remote state, create/adopt the task branch and dedicated worktree, edit within it, run tests/checks, and make bounded local commits.

### 4. Build

Make the smallest change that closes the verified gap.

- Existing architecture wins.
- No agent-initiated refactor.
- No speculative abstraction.
- No new dependency, external service, table, function, role, schema, migration, or shared infrastructure unless the task explicitly authorizes it and existing repository rules permit it.
- Stay inside the claimed task/worktree.
- If evidence changes the diagnosis, return to the cheapest falsifying observable before changing direction.
- If work begins touching a boundary another active worktree may own, stop and escalate.

### 5. Prove

Tests are evidence, not acceptance criteria.

Prove the task against the observable named during Scope. Use the cheapest relevant evidence first, then only the checks required by the changed boundary.

Examples:

- database defect → direct query/state observable
- auth/integration defect → real boundary result, token/claim/state observable, or contract call
- UI defect → rendered behavior through the affected path
- build/type defect → targeted typecheck/build output
- production defect → production-relevant evidence, not only a local passing test

If proof fails, record the exact failed observable. Return to Build only if the failure is still inside approved scope; otherwise stop and escalate. Never redefine acceptance to match the implementation.

### 6. Ship

Before calling work mergeable:

1. Review `git status -sb`.
2. Review the final diff and confirm every changed file belongs to the claimed task.
3. Run the required targeted validations.
4. Re-run the success observable from Prove.
5. Commit only bounded task changes.
6. Report evidence, remaining uncertainty, and every changed file.

Software Factory V1 does not authorize:

- merging into `main` or another shared branch
- force-pushing or rewriting shared history
- deleting another agent's branch/worktree
- deploying
- mutating production
- changing external-service/provider settings or subscriptions
- broadening migrations, auth behavior, RLS, or shared infrastructure beyond the approved task

Pushing a task branch or creating/updating a pull request requires the task or repository workflow to authorize it; otherwise stop and ask Andrew.

## Evidence discipline

For factual claims about the system, distinguish:

- **VERIFIED** — direct command/query/file/runtime evidence
- **INFERRED** — derived from named verified facts
- **ASSUMED** — not checked

If a recommendation depends on an ASSUMED item, check it before recommending.

Before proposing a fix, answer:

1. What observable proves the defect exists right now?
2. What cheapest check could prove me wrong, and what returned?
3. Does a supported path already exist?
4. What is the smallest change that closes the verified gap?
5. What future error does this change make impossible or easier to detect?

## Hard stop conditions

Stop and report to Andrew when:

- preflight contradicts the task
- parallel-work preflight returns POTENTIAL OVERLAP
- the same class of fix has already been attempted twice for the symptom
- the change requires loosening RLS or changing shared auth behavior outside explicit scope
- the change requires deleting production data
- the task grows from a bounded change into a redesign
- 50% of the stated budget is consumed without a verified observable
- no falsifying observable can be stated
- the task begins modifying a shared boundary another active worktree may own

## Cost discipline

- Check the cheapest disproving observable first.
- Do not rerun a full suite when a targeted query/check answers the question.
- Do not run a browser suite, full database suite, or Docker stack to answer a question a cheaper observable settles.
- At half budget without a verified observable, stop and report.

## Session exit

At the end of implementation work:

1. Report every file changed.
2. Report the proof/acceptance observable and result.
3. Report what remains uncertain.
4. State whether production changed. If production changed, update the canonical production-state record in the same session.
5. Record durable decisions in the canonical decisions record when one exists.
