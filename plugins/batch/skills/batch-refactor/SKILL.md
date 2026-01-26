---
name: batch-refactor
description: Batch operations across files with confidence-based auto-apply. Use for renaming, search-replace, refactoring code, updating text/markdown, and migrating terminology.
allowed-tools: Bash, Read, Edit, Grep, Glob, AskUserQuestion
---

# Batch Operations Skill

Use this skill when the user wants to make changes across multiple files:
- **Code refactoring**: rename functions, variables, types
- **Text/markdown updates**: change terminology, update docs
- **File operations**: batch rename files (future)
- **Terminology migrations**: widget→gadget, old API→new API

**Trigger phrases**:
- "rename X to Y everywhere"
- "change all X to Y"
- "refactor X across the codebase"
- "batch replace"
- "update terminology"
- "migrate from X to Y"
- "rename function/variable everywhere"
- "change wording in all files"

## Tool Selection

| What you're changing | File Type | Backend | Command |
|---------------------|-----------|---------|---------|
| TypeScript/JS identifiers | .ts, .tsx, .js, .jsx | ts-morph | `rename.batch` |
| Go, Rust, Python structural patterns | .go, .rs, .py | ast-grep | `pattern.replace` |
| JSON/YAML values | .json, .yaml | ast-grep | `pattern.replace` |
| Text/markdown | .md, .txt, any | ripgrep | `pattern.replace` |

**CRITICAL for TypeScript**: Always use ts-morph (via `rename.batch`) for identifiers. It handles destructuring, arrow function params, and nested scopes that text-based tools miss.

**Dependencies:**
- ts-morph: bundled (no external CLI)
- ast-grep: requires `sg` CLI (`brew install ast-grep`)
- ripgrep: requires `rg` CLI (usually pre-installed)

## Editset Workflow (TypeScript)

The editset workflow provides safe, reviewable batch renames with checksum verification.

### 1. Find Symbols

```bash
cd vendor/beorn-claude-tools/plugins/batch
bun tools/refactor.ts symbols.find --pattern widget
```

Output: JSON array of matching symbols with location and reference count.

### 2. Check for Conflicts

```bash
bun tools/refactor.ts rename.batch --pattern widget --replace gadget --check-conflicts
```

Output: Conflict report showing:
- `conflicts`: Symbols that would clash with existing names
- `safe`: Symbols safe to rename

### 3. Create Editset (Proposal)

```bash
# Skip conflicting symbols
bun tools/refactor.ts rename.batch --pattern widget --replace gadget \
  --skip createWidget,Widget \
  --output editset.json
```

Output: JSON editset file with all edits and file checksums.

### 4. Preview Changes

```bash
bun tools/refactor.ts editset.apply editset.json --dry-run
```

### 5. Apply Changes

```bash
bun tools/refactor.ts editset.apply editset.json
```

### 6. Verify

```bash
bun tsc --noEmit  # Check types
bun fix           # Fix lint issues
bun run test:fast # Run tests
```

## CLI Reference

### TypeScript/JavaScript (ts-morph)

| Command | Purpose |
|---------|---------|
| `symbol.at <file> <line> [col]` | Find symbol at location |
| `refs.list <symbolKey>` | List all references to a symbol |
| `symbols.find --pattern <regex>` | Find symbols matching pattern |
| `rename.propose <key> <new>` | Single symbol rename proposal |
| `rename.batch --pattern <p> --replace <r>` | Batch rename proposal |

### Multi-Language (ast-grep/ripgrep)

| Command | Purpose |
|---------|---------|
| `pattern.find --pattern <p> [--glob] [--backend]` | Find structural patterns |
| `pattern.replace --pattern <p> --replace <r> [--glob] [--backend]` | Pattern replace proposal |
| `backends.list` | List available backends |

### Editset Operations

| Command | Purpose |
|---------|---------|
| `editset.select <file> --include/--exclude` | Filter editset refs |
| `editset.verify <file>` | Check editset can be applied |
| `editset.apply <file> [--dry-run]` | Apply with checksum verification |

## Case Preservation

The tool preserves case during renames:

| Original | Pattern | Replacement | Result |
|----------|---------|-------------|--------|
| `widget` | `widget` | `gadget` | `gadget` |
| `Widget` | `widget` | `gadget` | `Gadget` |
| `WIDGET` | `widget` | `gadget` | `GADGET` |
| `widgetPath` | `widget` | `gadget` | `gadgetPath` |

## Safety Check

**Before making batch changes, ensure they can be undone.**

```bash
git rev-parse --is-inside-work-tree 2>/dev/null
git status --porcelain
```

| Situation | Action |
|-----------|--------|
| Git repo, clean working tree | ✅ Proceed |
| Git repo, uncommitted changes | ⚠️ Ask user to commit first |
| Not a git repo | ⚠️ Warn: no undo available |

## Context Gathering

Before making changes, gather project context:

1. **Read CLAUDE.md** - look for:
   - Mentioned migrations or refactoring plans
   - ADR references
   - Terminology notes

2. **Check for migration scripts** (optional):
   - `scripts/check-migration.ts` or similar
   - May have ALLOWED_PATTERNS for exclusions

## Confidence Philosophy

**Be aggressive. Tests catch mistakes.**

| Context | Confidence |
|---------|------------|
| Our code (`const widgetRoot`) | HIGH |
| Our compound identifier (`widgetHelper`) | HIGH |
| Our error message (`"widget not found"`) | HIGH |
| External reference (`"third-party widget"`) | LOW |
| URL/path (`widget.example.com`) | LOW |

**Default to HIGH** unless clearly external.

## Why ast-grep Fails for TypeScript Identifiers

ast-grep misses TypeScript-specific patterns:

```typescript
// ast-grep renames this ✓
const widgetDir = "/path"

// But MISSES these ✗
interface TestEnv { widgetDir: string }  // property definition
({ widgetDir }) => { ... }               // destructuring
```

**Rule**: If it shows up in "Find All References" in your IDE, use ts-morph.

## Text/Markdown Operations (ripgrep)

For batch text replace across many files, use the ripgrep backend:

```bash
# Find all "widget" mentions in docs
bun tools/refactor.ts pattern.find --pattern widget --glob "**/*.md"

# Create editset for batch replace
bun tools/refactor.ts pattern.replace \
  --pattern widget \
  --replace gadget \
  --glob "**/*.md" \
  --backend ripgrep \
  --output editset.json

# Preview and apply
bun tools/refactor.ts editset.apply editset.json --dry-run
bun tools/refactor.ts editset.apply editset.json
```

**Advantages over Edit+replace_all:**
- Dry-run preview before applying
- Checksum verification (drift detection)
- Batch replace across hundreds of files in one operation
- JSON output for programmatic use

## Pattern Operations (ast-grep)

For structural patterns in Go, Rust, Python, JSON, YAML:

```bash
# Find all fmt.Println calls in Go
bun tools/refactor.ts pattern.find --pattern 'fmt.Println($MSG)' --glob "**/*.go"

# Replace with log.Info
bun tools/refactor.ts pattern.replace \
  --pattern 'fmt.Println($MSG)' \
  --replace 'log.Info($MSG)' \
  --glob "**/*.go" \
  --output editset.json

# Preview and apply
bun tools/refactor.ts editset.apply editset.json --dry-run
bun tools/refactor.ts editset.apply editset.json
```

**ast-grep patterns use metavariables:**
- `$VAR` - matches any single node
- `$$$ARGS` - matches multiple nodes (variadic)

## Important

1. **Use editset workflow** for TypeScript identifiers
2. **Always run tsc** after batch changes
3. **Check conflicts first** with `--check-conflicts`
4. **Preview with --dry-run** before applying
5. **Trust checksums** - editset won't apply to modified files
6. **Be aggressive** - apply all matches, let tests catch mistakes
