---
name: batch-refactor
description: Batch operations across files with confidence-based auto-apply. Use for renaming, search-replace, refactoring code, updating text/markdown, and migrating terminology.
allowed-tools: Bash, Read, Edit, Grep, Glob, AskUserQuestion
---

# Batch Operations Skill

Use this skill when the user wants to make changes across multiple files:
- **Code refactoring**: rename functions, variables, types
- **Text/markdown updates**: change terminology, update docs
- **File operations**: batch rename files with import path updates
- **Terminology migrations**: widget→gadget, vault→repo, old API→new API

**Trigger phrases**:
- "rename X to Y everywhere"
- "change all X to Y"
- "refactor X across the codebase"
- "batch replace"
- "update terminology"
- "migrate from X to Y"
- "rename function/variable everywhere"
- "change wording in all files"

---

## Comprehensive Migration Workflow

For large terminology migrations (e.g., "rename vault to repo"), follow this phased approach:

### Phase 1: Conflict Analysis (BEFORE any changes)

**CRITICAL: Analyze ALL conflicts before making ANY changes.**

```bash
cd vendor/beorn-claude-tools/plugins/batch

# 1. Check file name conflicts
bun tools/refactor.ts file.rename --pattern vault --replace repo --glob "**/*.ts" --check-conflicts

# 2. Check symbol conflicts
bun tools/refactor.ts rename.batch --pattern vault --replace repo --check-conflicts

# 3. Check for existing targets manually
ls **/repo*.ts 2>/dev/null || echo "No existing repo files"
```

**For each conflict**, document resolution:
| Conflict | Resolution |
|----------|------------|
| `vault.ts` → `repo.ts` (exists) | Merge and delete |
| `createVault` → `createRepo` (exists) | Update references, keep new |

**Never use --skip without explicit user approval.**

### Phase 2: File Renames

Rename files FIRST (before symbol renames) because:
- Import paths need to be valid for ts-morph to work
- File renames update import paths automatically

```bash
# Create file rename proposal
bun tools/refactor.ts file.rename --pattern vault --replace repo \
  --glob "**/*.{ts,tsx}" \
  --output file-editset.json

# Preview
bun tools/refactor.ts file.apply file-editset.json --dry-run

# Apply
bun tools/refactor.ts file.apply file-editset.json
```

### Phase 3: Symbol Renames (TypeScript)

After files are renamed, rename symbols:

```bash
# Create symbol rename proposal
bun tools/refactor.ts rename.batch --pattern vault --replace repo \
  --output symbol-editset.json

# Preview
bun tools/refactor.ts editset.apply symbol-editset.json --dry-run

# Apply
bun tools/refactor.ts editset.apply symbol-editset.json
```

### Phase 4: Text/Comment Renames

Rename remaining mentions in comments, strings, markdown:

```bash
# TypeScript comments and strings
bun tools/refactor.ts pattern.replace --pattern vault --replace repo \
  --glob "**/*.{ts,tsx}" \
  --backend ripgrep \
  --output text-editset.json

# Markdown documentation
bun tools/refactor.ts pattern.replace --pattern vault --replace repo \
  --glob "**/*.md" \
  --backend ripgrep \
  --output docs-editset.json

# Preview and apply each
bun tools/refactor.ts editset.apply text-editset.json --dry-run
bun tools/refactor.ts editset.apply text-editset.json
```

### Phase 5: Vendor Submodules

For changes in git submodules:

```bash
# For each vendor submodule with matches
cd vendor/<submodule>

# Run the same workflow (conflicts, files, symbols, text)
bun ../beorn-claude-tools/plugins/batch/tools/refactor.ts rename.batch \
  --pattern vault --replace repo --check-conflicts

# After applying
git add -A
git commit -m "refactor: rename vault → repo"
git push

# Return to main repo
cd ../..
git add vendor/<submodule>
git commit -m "chore(vendor): update <submodule> with repo terminology"
```

### Phase 6: Verification

```bash
# Check for remaining mentions
grep -ri vault . --include="*.ts" --include="*.tsx" | grep -v node_modules | wc -l

# Type check
bun tsc --noEmit

# Lint and fix
bun fix

# Run tests
bun run test:all
```

---

## Tool Selection

| What you're changing | File Type | Backend | Command |
|---------------------|-----------|---------|---------|
| **File names** | any | file-ops | `file.rename` |
| TypeScript/JS identifiers | .ts, .tsx, .js, .jsx | ts-morph | `rename.batch` |
| Go, Rust, Python structural patterns | .go, .rs, .py | ast-grep | `pattern.replace` |
| JSON/YAML values | .json, .yaml | ast-grep | `pattern.replace` |
| Text/markdown/comments | .md, .txt, any | ripgrep | `pattern.replace` |

**CRITICAL for TypeScript**: Always use ts-morph (via `rename.batch`) for identifiers. It handles destructuring, arrow function params, and nested scopes that text-based tools miss.

**Dependencies:**
- ts-morph: bundled (no external CLI)
- ast-grep: requires `sg` CLI (`brew install ast-grep`)
- ripgrep: requires `rg` CLI (usually pre-installed)

---

## CLI Reference

### File Operations

| Command | Purpose |
|---------|---------|
| `file.find --pattern <p> --replace <r> [--glob]` | Find files to rename |
| `file.rename --pattern <p> --replace <r> [--glob] [--output] [--check-conflicts]` | Create file rename proposal |
| `file.verify <file>` | Verify file editset can be applied |
| `file.apply <file> [--dry-run]` | Apply file renames |

### TypeScript/JavaScript (ts-morph)

| Command | Purpose |
|---------|---------|
| `symbol.at <file> <line> [col]` | Find symbol at location |
| `refs.list <symbolKey>` | List all references to a symbol |
| `symbols.find --pattern <regex>` | Find symbols matching pattern |
| `rename.propose <key> <new>` | Single symbol rename proposal |
| `rename.batch --pattern <p> --replace <r> [--check-conflicts]` | Batch rename proposal |

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

---

## Case Preservation

The tool preserves case during renames:

| Original | Pattern | Replacement | Result |
|----------|---------|-------------|--------|
| `vault` | `vault` | `repo` | `repo` |
| `Vault` | `vault` | `repo` | `Repo` |
| `VAULT` | `vault` | `repo` | `REPO` |
| `vaultPath` | `vault` | `repo` | `repoPath` |
| `VaultConfig.ts` | `vault` | `repo` | `RepoConfig.ts` |

---

## Conflict Resolution

**Never skip conflicts without understanding them.**

### File Conflicts

| Conflict Type | Resolution Strategy |
|--------------|---------------------|
| Target exists (duplicate) | Merge content, delete source |
| Target exists (different) | Rename to avoid collision |
| Same path (no-op) | Skip (no change needed) |

### Symbol Conflicts

| Conflict Type | Resolution Strategy |
|--------------|---------------------|
| Target name exists | Check if same symbol (safe to merge) or different (needs rename) |
| Multiple symbols same name | May be scoped (function-local vs module) - often safe |

**Process:**
1. Run `--check-conflicts` first
2. Document each conflict and its resolution
3. Get user approval on resolution strategy
4. Execute with explicit handling (no blind --skip)

---

## Safety Checks

**Before making batch changes:**

```bash
git rev-parse --is-inside-work-tree 2>/dev/null
git status --porcelain
```

| Situation | Action |
|-----------|--------|
| Git repo, clean working tree | ✅ Proceed |
| Git repo, uncommitted changes | ⚠️ Ask user to commit first |
| Not a git repo | ⚠️ Warn: no undo available |

---

## Context Gathering

Before making changes, gather project context:

1. **Read CLAUDE.md** - look for:
   - Mentioned migrations or refactoring plans
   - ADR references
   - Terminology notes

2. **Check for migration scripts** (optional):
   - `scripts/check-migration.ts` or similar
   - May have ALLOWED_PATTERNS for exclusions

3. **Understand scope**:
   ```bash
   grep -ri <pattern> . --include="*.ts" | wc -l  # Total mentions
   find . -name "*<pattern>*" -not -path "./node_modules/*"  # File names
   ```

---

## Confidence Philosophy

**Be aggressive. Tests catch mistakes.**

| Context | Confidence |
|---------|------------|
| Our code (`const vaultRoot`) | HIGH |
| Our compound identifier (`vaultHelper`) | HIGH |
| Our error message (`"vault not found"`) | HIGH |
| External reference (`"Obsidian vault"`) | LOW - may need to keep |
| URL/path (`vault.example.com`) | LOW |

**Default to HIGH** unless clearly external.

---

## Why ast-grep Fails for TypeScript Identifiers

ast-grep misses TypeScript-specific patterns:

```typescript
// ast-grep renames this ✓
const vaultDir = "/path"

// But MISSES these ✗
interface TestEnv { vaultDir: string }  // property definition
({ vaultDir }) => { ... }               // destructuring
```

**Rule**: If it shows up in "Find All References" in your IDE, use ts-morph.

---

## Example: Complete Migration

**User request:** "rename vault to repo everywhere"

**Claude's plan:**

1. **Analyze scope**
   ```bash
   grep -ri vault . --include="*.ts" | wc -l
   find . -name "*vault*" -not -path "./node_modules/*"
   ```

2. **Check ALL conflicts**
   ```bash
   # File conflicts
   bun tools/refactor.ts file.rename --pattern vault --replace repo --check-conflicts

   # Symbol conflicts
   bun tools/refactor.ts rename.batch --pattern vault --replace repo --check-conflicts
   ```

3. **Document conflict resolutions** (ask user if unclear)

4. **Execute in phases:**
   - Phase 2: File renames
   - Phase 3: Symbol renames
   - Phase 4: Text/comment renames
   - Phase 5: Vendor submodules

5. **Verify:**
   ```bash
   grep -ri vault . --include="*.ts" | wc -l  # Should be 0 (or only allowed)
   bun tsc --noEmit
   bun fix
   bun run test:all
   ```

---

## Important Rules

1. **Check conflicts FIRST** - never blind rename
2. **File renames BEFORE symbol renames** - import paths must be valid
3. **Use editset workflow** for TypeScript identifiers
4. **Always run tsc** after batch changes
5. **Preview with --dry-run** before applying
6. **Trust checksums** - editset won't apply to modified files
7. **Vendor submodules** - commit and push separately, then update reference
8. **Be aggressive** - apply all matches, let tests catch mistakes
