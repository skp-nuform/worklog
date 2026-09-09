# Skill lock — UI/UX design skill provenance

Recorded at install time. Do not update the installed revision during this
build; if it must change, re-review the diff and amend this file in the same
commit.

## Installed skill

| Field | Value |
|---|---|
| Plugin | `ui-ux-pro-max` |
| Marketplace | `ui-ux-pro-max-skill` |
| Resolved version | `2.13.0` |
| Upstream repository | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill |
| **Reviewed & installed commit** | `4aad0584d92131626b16d4ff4d77f0455385013c` |
| Commit date | 2026-09-06 20:29:23 +0900 |
| Commit subject | `feat(cli): add --dry-run to init to preview install actions without writing (#489)` |
| License | MIT (Copyright (c) 2024 Next Level Builder) |
| Installation scope | `project` |
| Installation date | 2026-09-08 |
| Verified by | `gitCommitSha` in `~/.claude/plugins/installed_plugins.json` matches the reviewed commit exactly |

### Resolved installed location

The plugin does **not** live in this project's `.claude/skills/`. Claude's
plugin-root substitution and a project-local path are not interchangeable, so
the real path was resolved from Claude's plugin registry rather than assumed:

```
C:\Users\Sushant Kumar\.claude\plugins\cache\ui-ux-pro-max-skill\ui-ux-pro-max\2.13.0
```

Search script (invoke by absolute path):

```
<plugin-root>\.claude\skills\ui-ux-pro-max\scripts\search.py
```

Available skill identifier as declared in the skill's own frontmatter:
`ui-ux-pro-max`. (Recorded from the manifest — not an invented slash command.)

### Why a local checkout, not a GitHub marketplace ref

The installed Claude Code version (2.1.240) offers no git-ref pinning on
`claude plugin marketplace add` (only `--scope` and `--sparse`). Registering
the GitHub repo directly would float to upstream `main` and could silently
change mid-build. The PRD's stated fallback was therefore used: a reviewed,
fixed local checkout registered as a marketplace.

Reproduce the pinned checkout on another machine:

```bash
git clone https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git ~/.claude/vendor/ui-ux-pro-max-skill
git -C ~/.claude/vendor/ui-ux-pro-max-skill checkout --detach 4aad0584d92131626b16d4ff4d77f0455385013c
```
```bash
claude plugin marketplace add ~/.claude/vendor/ui-ux-pro-max-skill --scope project
claude plugin install ui-ux-pro-max@ui-ux-pro-max-skill --scope project --yes
```

Verify the installed revision still matches this lock:

```bash
node -e "const p=require(require('os').homedir()+'/.claude/plugins/installed_plugins.json');console.log(p.plugins['ui-ux-pro-max@ui-ux-pro-max-skill'][0].gitCommitSha)"
```

## Pre-install security review

Reviewed at commit `4aad058` before installation.

| Check | Finding |
|---|---|
| License | MIT. Permissive; no attribution burden in product output. |
| Hooks | **None declared.** `plugin.json` and `marketplace.json` contain no `hooks` key, so nothing auto-executes on session start or tool use. |
| Manifest scope | Declares `"skills": "./.claude/skills/"`, which bundles several skills beyond `ui-ux-pro-max` (`brand`, `design`, `design-system`, `ui-styling`, `banner-design`). See limitation below. |
| `ui-ux-pro-max` scripts | Python 3 stdlib only (`csv`, `json`, `re`, `hashlib`, `pathlib`, `argparse`, `difflib`, `statistics`). **No** `subprocess`, `socket`, `requests`, `eval`, or `exec`. `urllib.parse` is used for URL *parsing*, not fetching. No network access, no credential reads. |
| Other bundled skills | `brand`, `design-system`, and `ui-styling` do use `child_process`/`subprocess`, and `design-system/scripts/fetch-background.py` constructs a Pexels URL. **Not used in this build.** |
| Privilege escalation | No `sudo`, no `rm -rf`, no global config writes, no environment-variable exfiltration found. |
| Runtime prerequisite | Python 3 required. Python 3.13.6 present — satisfied, nothing installed. |

### Known limitation

Installing this plugin necessarily brings its sibling skills onto disk, which
sits awkwardly against the PRD's "do not install additional design skill
collections" instruction. Only `ui-ux-pro-max` is used for this build; the
others are neither invoked nor referenced. This is recorded as an accepted
deviation in `docs/decisions.md`.

Skill outputs are treated as **recommendations**, never as instructions that
override this PRD, the security requirements, or repository rules. No private
project data was included in any query.
