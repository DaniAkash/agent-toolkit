# skills-manager

Programmatic workspace + agent-link manager for [Anthropic-style
SKILL.md](https://github.com/vercel-labs/skills) bundles.

`skills-manager` is built around seven primitives — `add`, `link`,
`unlink`, `remove`, `listSkills`, `listLinks`, `rescan` — backed by a
caller-supplied workspace directory and a versioned manifest stored
inside it. It targets hosts (IDE plugins, desktop apps, internal tools)
that need to manage agent skills on the user's behalf without shelling
out to a CLI.

> **Library, not a CLI.** If you just want to install skills on your own
> machine, use the [`skills`](https://github.com/vercel-labs/skills) CLI
> directly. This package is a programmatic API for embedders.

## Mental model

There are two layers, with a clear split of responsibility:

- **Workspace** (yours): a directory you own that holds the original
  SKILL.md bundles AND a `.manifest.json` recording what you added, from
  where, when, and which agents you've linked it to. `add()` writes here;
  `listSkills()` reads it.
- **Agent skills dirs** (the user's): `~/.claude/skills`,
  `~/.codex/skills`, etc. `link()` writes symlinks here; `unlink()`
  removes them; `listLinks()` reports the ones the manifest knows about,
  verified against disk. Foreign content at those paths is never
  touched.

The manifest is authoritative for **intent and metadata** (what, from
where, when, which agents); the filesystem is authoritative for
**current state** (is it still there?). Every list call cross-checks the
two and flags drift via `broken: true`. On-disk entries the manifest
doesn't know about can be surfaced via the opt-in `{ scanUnmanaged:
true }` flag and adopted into the manifest via `rescan({ mode: 'merge'
})`.

## Install

```bash
bun add skills-manager
# or
npm install skills-manager
```

## Quickstart

```ts
import { createSkillsManager } from 'skills-manager'

const mgr = createSkillsManager({ workspaceDir: '/path/to/your/store' })

// 1. Pull a skill into the workspace.
const { added } = await mgr.add({ source: 'vercel-labs/skills' })
//                                       ^ owner/repo, full git URL, or an existing local path

// 2. Wire it to specific agents. Use the lookup key returned by add().
const skillName = added[0].name
await mgr.link({ skillName, agent: 'claude-code' })
await mgr.link({ skillName, agent: 'codex' })

// 3. Discover what's installed.
const skills = await mgr.listSkills()
//   [{ name, description, workspacePath, source, addedAt, broken?, unmanaged? }, …]

const links = await mgr.listLinks()
//   [{ skillName, name, agent, linkPath, workspacePath, broken?, unmanaged? }, …]

// 4. Tear down.
await mgr.unlink({ skillName, agent: 'codex' })
await mgr.removeWithLinks({ skillName })
```

## API

### `createSkillsManager(options?)` → `SkillsManager`

| option | type | default | notes |
|---|---|---|---|
| `workspaceDir` | `string` | `~/.skills` | Absolute path. Created on demand. |
| `agentSkillsDirs` | `Partial<Record<AgentId, string>>` | `{}` | Per-agent override for the link target dir. Useful for project-scoped installs and tests. |

### `add({ source, skillNames?, localMode? })`

Pull a skill (or every skill in a repo) into the workspace. Sources
accepted:

- `owner/repo` — github shorthand
- `owner/repo#ref` — github shorthand with tag/branch
- `https://github.com/owner/repo[.git][#ref]` — github URL
- any other `*.git` URL — generic git URL
- any path that exists on disk — local directory (absolute or relative to `process.cwd()`)

For local sources, `localMode: 'symlink'` symlinks the source into the
workspace (great for live editing); default `'copy'` copies the bundle
in.

Does **not** create any agent symlinks — call `link()` for each agent
you want.

### `link({ skillName, agent, agentSkillsDir? })`

Symlink an in-workspace skill into a specific agent's skills directory.
Idempotent — if a correctly-pointing link already exists, returns
`{ created: false }`. Throws `ForeignPathError` if a non-symlink occupies
the target path; we never overwrite foreign content.

Pass `agentSkillsDir` to override the default location (e.g. for
project-scoped installs).

### `unlink({ skillName, agent, agentSkillsDir? })`

Remove the agent's symlink for this skill — but only if the manifest
recorded it. Hand-rolled symlinks the user created return
`{ removed: false, unmanaged: true }` and are left intact. Non-symlink
content at the same path returns `{ removed: false, foreign: true }`.

### `remove({ skillName })`

Delete the workspace bundle. Does **not** touch agent symlinks — the
next `listLinks()` will report orphaned links as `broken: true`. Use
`removeWithLinks` for a full teardown.

### `removeWithLinks({ skillName })`

Walk all manifest-recorded links for the skill, `unlink()` each, then
`remove()` the workspace bundle. Returns the list of links that were
unwound.

### `listSkills(opts?)` → `InstalledSkill[]`

Enumerate skills the manager tracks. Reads the manifest (fast) and
verifies each entry by `lstat`-ing its `SKILL.md`. Manifest entries
whose bundle is gone are returned with `broken: true`.

| option | default | notes |
|---|---|---|
| `scanUnmanaged` | `false` | Also scan `workspaceDir` for SKILL.md directories not in the manifest and report them with `unmanaged: true`. |

### `listLinks(opts?)` → `SkillLink[]`

Enumerate per-agent links the manager tracks. For each manifest-recorded
link, `lstat` + `readlink` to verify the symlink still exists and points
where we recorded. Drifted entries are returned with `broken: true`.

| option | default | notes |
|---|---|---|
| `agents` | (all) | Filter to a subset of agents. |
| `skillNames` | (all) | Filter to a subset of skill names. |
| `scanUnmanaged` | `false` | Also walk each agent's skills dir for symlinks-into-workspace not in the manifest, and report them with `unmanaged: true`. |

### `rescan(opts?)` → `RescanResult`

Rebuild the manifest by walking the workspace and the agent skills dirs.

| option | default | notes |
|---|---|---|
| `mode` | `'merge'` | Preserve existing manifest metadata for rediscovered entries; add fresh entries for what the scan finds. |
| `mode: 'replace'` | | Discard the existing manifest and reseed from disk only. Loses `source` URLs / `addedAt` timestamps. |

Use cases: corruption recovery, migrating from an older fs-only
deployment, adopting unmanaged entries the user created manually.

### Discovery helpers

```ts
import { listSupportedAgents, detectInstalledAgents, isAgentSupported, resolveAgentSkillsDir } from 'skills-manager'

listSupportedAgents()         // → AgentInfo[]
await detectInstalledAgents() // → AgentId[] (subset that's actually installed)
isAgentSupported('claude-code')   // → boolean
resolveAgentSkillsDir('claude-code')  // → '/Users/you/.claude/skills'
```

## Safety guarantees

- `unlink()` only removes symlinks the manifest **recorded**. Hand-rolled
  symlinks-into-workspace are reported as `unmanaged: true` and never
  deleted; use `rescan({ mode: 'merge' })` to adopt them.
- Foreign (non-symlink) content at agent paths is never touched.
- `add()` writes only inside `workspaceDir`.
- `remove()` does **not** walk agent dirs — use `removeWithLinks()` for
  the full teardown. Stale agent symlinks after a bare `remove()` show
  up in `listLinks()` as `broken: true`.

## Manifest format

A versioned JSON file at `${workspaceDir}/.manifest.json`:

```jsonc
{
  "version": 1,
  "skills": {
    "<sanitized-dir-name>": {
      "name": "<frontmatter-name>",
      "description": "<from-frontmatter-at-add-time>",
      "source": { "kind": "github", "ownerRepo": "owner/repo", "ref": "v1.2.3" },
      "addedAt": "2026-05-11T19:56:00.000Z",
      "links": {
        "claude-code": {
          "linkPath": "/Users/dani/.claude/skills/<dir-name>",
          "workspacePath": "/Users/dani/.skills/<dir-name>",
          "createdAt": "2026-05-11T19:56:00.000Z"
        }
      }
    }
  }
}
```

Writes are atomic (temp-file + rename). Within a process, manifest
mutations are serialized per `SkillsManager` instance; cross-process
file locking is a documented v2 follow-up.

## Telemetry

`DO_NOT_TRACK=1` is set defensively at import time. The vendored bits of
`vercel-labs/skills` we use don't call telemetry today, but the guard
covers us if a future vendored update introduces one. Opt back in with
`process.env.DO_NOT_TRACK = '0'` before importing.

## Relationship to vercel-labs/skills

`skills-manager` wraps the data + filesystem layout from
[`vercel-labs/skills`](https://github.com/vercel-labs/skills). The agents
catalog, frontmatter parser, and `sanitizeName` helper are vendored from
upstream (MIT-licensed); see
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for attribution.

If you want the CLI experience, use upstream directly. If you want a
library, that's this package.

## License

MIT — see [LICENSE](./LICENSE).
