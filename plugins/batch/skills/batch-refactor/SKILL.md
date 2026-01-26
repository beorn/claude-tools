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

## Why Use Batch Refactor (Not Manual Edit)

**ALWAYS use this tool instead of manual editing when:**

| Situation | Manual Edits | Batch Refactor |
|-----------|--------------|----------------|
| Rename a function used in 47 files | 47 separate Edit calls | 1 command |
| Rename parameter in destructuring patterns | Miss edge cases | Catches all patterns |
| Update terminology across codebase | Hours of work | Minutes |
| Rename file + update all imports | Break builds | Atomic, safe |

### Example: Why Manual Editing Fails

**Task**: Rename `createVault` to `createRepo`

**Manual approach (WRONG)**:
```bash
# You'd miss these patterns:
const { createVault } = api          # destructuring
const init = createVault             # assignment
type Factory = typeof createVault    # type reference
async ({ createVault }: Deps) => {}  # parameter destructuring
```

**Batch refactor approach (CORRECT)**:
```bash
bun tools/refactor.ts rename.batch --pattern createVault --replace createRepo --output edits.json
bun tools/refactor.ts editset.apply edits.json
# Finds ALL 127 references including destructuring, types, re-exports
```

### Quick Reference: When to Use Each Command

| You want to... | Command | Example |
|----------------|---------|---------|
| Rename TypeScript function/variable | `rename.batch` | `--pattern createVault --replace createRepo` |
| Rename TypeScript type/interface | `rename.batch` | `--pattern VaultConfig --replace RepoConfig` |
| Rename files | `file.rename` | `--pattern vault --replace repo --glob "**/*.ts"` |
| Update text in markdown | `pattern.replace --backend ripgrep` | `--pattern vault --replace repo --glob "**/*.md"` |
| Full terminology migration | `migrate` | `--from vault --to repo` |

---

## Comprehensive Migration Workflow

For large terminology migrations (e.g., "rename vault to repo"), follow this phased approach:

### Phase 1: Conflict Analysis (BEFORE any changes)

**CRITICAL: Analyze ALL conflicts before making ANY changes.**

```bash
# Run from the batch plugin directory

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
| Wiki links only | .md | wikilink | `wikilink.rename` |
| package.json paths | package.json | package-json | `package.rename` |
| tsconfig.json paths | tsconfig*.json | tsconfig-json | `tsconfig.rename` |

**`file.rename` auto-detects file type** and updates references:
- `.ts/.tsx/.js/.jsx` → updates import paths
- `.md/.markdown/.mdx` → updates `[[wikilinks]]` (Obsidian, Foam, etc.)
- `package.json` → updates exports, main, types, bin paths
- `tsconfig.json` → updates paths mappings, includes, references

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

## Concrete Examples by Operation Type

### Example 1: Batch File Rename

**Scenario**: Rename all files containing "user-service" to "account-service"

```bash
# 1. Find files that would be renamed
bun tools/refactor.ts file.find --pattern "user-service" --replace "account-service" --glob "**/*.ts"

# 2. Check for conflicts (target files already exist?)
bun tools/refactor.ts file.rename --pattern "user-service" --replace "account-service" \
  --glob "**/*.ts" --check-conflicts

# 3. Create editset
bun tools/refactor.ts file.rename --pattern "user-service" --replace "account-service" \
  --glob "**/*.ts" --output file-renames.json

# 4. Preview (dry run)
bun tools/refactor.ts file.apply file-renames.json --dry-run

# 5. Apply
bun tools/refactor.ts file.apply file-renames.json
```

**Result**:
- `src/user-service.ts` → `src/account-service.ts`
- `src/testing/mock-user-service.ts` → `src/testing/mock-account-service.ts`
- `UserServiceConfig.ts` → `AccountServiceConfig.ts` (case preserved)

---

### Example 2: Import Path Updates (after file renames)

**Scenario**: Update all imports that reference renamed files

```bash
# After renaming user-service.ts → account-service.ts, update imports:
bun tools/refactor.ts pattern.replace \
  --pattern "user-service" \
  --replace "account-service" \
  --glob "**/*.ts" \
  --backend ripgrep \
  --output import-updates.json

bun tools/refactor.ts editset.apply import-updates.json --dry-run
bun tools/refactor.ts editset.apply import-updates.json
```

**Before**:
```typescript
import { createUser } from "./user-service"
import { UserService } from "../services/user-service"
```

**After**:
```typescript
import { createUser } from "./account-service"
import { UserService } from "../services/account-service"
```

---

### Example 3: TypeScript Symbol Rename (ts-morph)

**Scenario**: Rename function `createWidget` to `createGadget` across codebase

```bash
# 1. Check for conflicts (does createGadget already exist?)
bun tools/refactor.ts rename.batch --pattern "createWidget" --replace "createGadget" --check-conflicts

# 2. Create editset
bun tools/refactor.ts rename.batch --pattern "createWidget" --replace "createGadget" \
  --output symbol-renames.json

# 3. Preview
bun tools/refactor.ts editset.apply symbol-renames.json --dry-run

# 4. Apply
bun tools/refactor.ts editset.apply symbol-renames.json
```

**Handles correctly**:
```typescript
// Function declaration
export function createWidget(config: Config) { }  → createGadget

// Arrow function
const createWidget = (opts) => { }  → createGadget

// Destructuring
const { createWidget } = api  → createGadget

// Parameter
function init({ createWidget }: Deps) { }  → createGadget

// Type reference
type Factory = typeof createWidget  → createGadget
```

---

### Example 4: Type/Interface Rename

**Scenario**: Rename `ApiClient` to `HttpClient` across codebase

```bash
# Check conflicts
bun tools/refactor.ts rename.batch --pattern "ApiClient" --replace "HttpClient" --check-conflicts

# Create and apply
bun tools/refactor.ts rename.batch --pattern "ApiClient" --replace "HttpClient" \
  --output type-renames.json
bun tools/refactor.ts editset.apply type-renames.json
```

**Handles correctly**:
```typescript
// Interface definition
export interface ApiClient { }  → HttpClient

// Type alias
type Client = ApiClient  → HttpClient

// Variable type annotation
const client: ApiClient = ...  → HttpClient

// Generic constraint
function fetch<T extends ApiClient>()  → HttpClient

// Import
import type { ApiClient } from "./api"  → HttpClient
```

---

### Example 5: Text/Comment/String Replace (ripgrep)

**Scenario**: Update documentation and comments from "widget" to "gadget"

```bash
# Markdown docs
bun tools/refactor.ts pattern.replace \
  --pattern "widget" \
  --replace "gadget" \
  --glob "**/*.md" \
  --backend ripgrep \
  --output docs-updates.json

# TypeScript comments and strings
bun tools/refactor.ts pattern.replace \
  --pattern "widget" \
  --replace "gadget" \
  --glob "**/*.ts" \
  --backend ripgrep \
  --output comment-updates.json

# Preview and apply
bun tools/refactor.ts editset.apply docs-updates.json --dry-run
bun tools/refactor.ts editset.apply docs-updates.json
```

**Updates**:
```typescript
// This creates a new widget  → gadget
const msg = "Widget not found"  → "Gadget not found"
/** @description Widget factory */  → Gadget factory
```

```markdown
# Widget Guide  → Gadget Guide
Create a widget with...  → Create a gadget with...
```

---

### Example 6: Structural Pattern Replace (ast-grep)

**Scenario**: Migrate Go logging from `fmt.Println` to `log.Info`

```bash
bun tools/refactor.ts pattern.replace \
  --pattern 'fmt.Println($MSG)' \
  --replace 'log.Info($MSG)' \
  --glob "**/*.go" \
  --backend ast-grep \
  --output go-logging.json

bun tools/refactor.ts editset.apply go-logging.json
```

**Before**:
```go
fmt.Println("Starting server")
fmt.Println(err.Error())
```

**After**:
```go
log.Info("Starting server")
log.Info(err.Error())
```

---

### Example 7: Complete Terminology Migration

**Scenario**: Migrate entire codebase from "user" terminology to "account"

```bash
# Phase 1: Conflict Analysis
bun tools/refactor.ts file.rename --pattern "user" --replace "account" --check-conflicts
bun tools/refactor.ts rename.batch --pattern "user" --replace "account" --check-conflicts

# Phase 2: File Renames (FIRST)
bun tools/refactor.ts file.rename --pattern "user" --replace "account" \
  --glob "**/*.ts" --output phase2-files.json
bun tools/refactor.ts file.apply phase2-files.json

# Phase 3: Symbol Renames
bun tools/refactor.ts rename.batch --pattern "user" --replace "account" \
  --output phase3-symbols.json
bun tools/refactor.ts editset.apply phase3-symbols.json

# Phase 4: Text/Comments
bun tools/refactor.ts pattern.replace --pattern "user" --replace "account" \
  --glob "**/*.ts" --backend ripgrep --output phase4-text.json
bun tools/refactor.ts editset.apply phase4-text.json

# Phase 5: Documentation
bun tools/refactor.ts pattern.replace --pattern "user" --replace "account" \
  --glob "**/*.md" --backend ripgrep --output phase5-docs.json
bun tools/refactor.ts editset.apply phase5-docs.json

# Phase 6: Verify
grep -ri user . --include="*.ts" | wc -l  # Should be 0
bun tsc --noEmit
bun fix
bun run test:all
```

---

### Example 8: Selective Rename with Filtering

**Scenario**: Rename only specific occurrences, not all

```bash
# Create full editset
bun tools/refactor.ts rename.batch --pattern "config" --replace "options" \
  --output full-editset.json

# Filter to only certain files
bun tools/refactor.ts editset.select full-editset.json \
  --include "src/core/**" \
  --exclude "src/core/legacy/**" \
  --output filtered-editset.json

# Apply filtered set
bun tools/refactor.ts editset.apply filtered-editset.json
```

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

---

## LLM Patch Workflow

Editsets now include enriched context fields that allow an LLM to review and selectively modify replacements before applying. This enables intelligent, context-aware refactoring decisions.

### Enriched Reference Fields

Each reference in an editset includes:

| Field | Type | Description |
|-------|------|-------------|
| `kind` | `"call"` \| `"decl"` \| `"type"` \| `"string"` \| `"comment"` | What kind of reference this is |
| `scope` | `string \| null` | Enclosing function/class name, or null for module-level |
| `ctx` | `string[]` | Array of context lines with `►` marker on the matching line |
| `replace` | `string \| null` | `null` to skip this reference, `string` for custom replacement |

### Workflow

```bash
# Run from the batch plugin directory

# 1. Generate editset with enriched context
bun tools/refactor.ts rename.batch --pattern vault --replace repo -o editset.json

# 2. LLM reviews the editset and patches specific references
#    - Set replace to null to skip a reference
#    - Set replace to a custom string for non-standard replacement
bun tools/refactor.ts editset.patch editset.json <<'EOF'
{ "b2c3": "Repository", "c3d4": null }
EOF

# 3. Apply the patched editset
bun tools/refactor.ts editset.apply editset.json
```

### Example: Selective Replacement

Given an editset with these references:

```json
{
  "refs": [
    { "id": "a1b2", "kind": "decl", "scope": "createVault", "replace": "repo" },
    { "id": "b2c3", "kind": "type", "scope": null, "replace": "repo" },
    { "id": "c3d4", "kind": "comment", "scope": null, "replace": "repo" }
  ]
}
```

An LLM might decide:
- Keep `a1b2` as-is (standard replacement)
- Change `b2c3` to `"Repository"` (capitalize for type name)
- Set `c3d4` to `null` (skip comment, it refers to external Obsidian vault)

```bash
bun tools/refactor.ts editset.patch editset.json <<'EOF'
{ "b2c3": "Repository", "c3d4": null }
EOF
```

### Context Lines

The `ctx` field shows surrounding lines with the match marked:

```json
{
  "ctx": [
    "  // Create a new vault for the user",
    "► const vault = createVault(config)",
    "  return vault"
  ]
}
```

This helps LLMs understand whether a reference is:
- Internal code (safe to rename)
- External reference (may need to preserve)
- Documentation (may need different wording)

---

## Migrate Command

The `migrate` command orchestrates a full terminology migration in phases:

```bash
# Run from the batch plugin directory

# Preview what would be migrated
bun tools/refactor.ts migrate --from vault --to repo --dry-run

# Run migration (creates editsets in .editsets/ directory)
bun tools/refactor.ts migrate --from vault --to repo

# Custom output directory
bun tools/refactor.ts migrate --from vault --to repo --output ./my-editsets

# Custom file glob
bun tools/refactor.ts migrate --from vault --to repo --glob "**/*.{ts,tsx,md}"
```

### What Migrate Does

| Phase | Description | Output File |
|-------|-------------|-------------|
| 1. File renames | Rename files containing pattern | `01-file-renames.json` |
| 2. Symbol renames | TypeScript identifiers via ts-morph | `02-symbol-renames.json` |
| 3. Text patterns | Comments, strings via ripgrep | `03-text-patterns.json` |

After running, review each editset and apply:

```bash
# Review and apply each phase
bun tools/refactor.ts file.apply .editsets/01-file-renames.json --dry-run
bun tools/refactor.ts file.apply .editsets/01-file-renames.json

bun tools/refactor.ts editset.apply .editsets/02-symbol-renames.json --dry-run
bun tools/refactor.ts editset.apply .editsets/02-symbol-renames.json

bun tools/refactor.ts editset.apply .editsets/03-text-patterns.json --dry-run
bun tools/refactor.ts editset.apply .editsets/03-text-patterns.json
```

### Migrate Command Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--from <pattern>` | Pattern to match (required) | - |
| `--to <replacement>` | Replacement string (required) | - |
| `--glob <glob>` | File glob filter | `**/*.{ts,tsx}` |
| `--dry-run` | Preview without creating editsets | false |
| `--output <dir>` | Output directory for editsets | `.editsets`|

---

## Enriched Editset JSON Format

When an LLM reviews an editset, it sees enriched context for each reference:

```json
{
  "id": "rename-vault-to-repo-1706123456789",
  "operation": "rename",
  "from": "vault",
  "to": "repo",
  "refs": [
    {
      "refId": "a1b2c3d4",
      "file": "src/storage.ts",
      "line": 45,
      "range": [45, 12, 45, 17],
      "kind": "call",
      "scope": "initStorage",
      "ctx": [
        "  function initStorage() {",
        "► const root = createVault(config);",
        "  return root;"
      ],
      "replace": "repo",
      "preview": "const root = createVault(config);",
      "checksum": "abc123...",
      "selected": true
    },
    {
      "refId": "b2c3d4e5",
      "file": "src/errors.ts",
      "line": 12,
      "range": [12, 25, 12, 30],
      "kind": "string",
      "scope": "errorHandler",
      "ctx": [
        "► throw new Error(\"vault not found\");"
      ],
      "replace": "repo",
      "preview": "throw new Error(\"vault not found\");",
      "checksum": "def456...",
      "selected": true
    }
  ],
  "edits": [ /* ... byte-level edits */ ],
  "createdAt": "2024-01-24T12:00:00.000Z"
}
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `refId` | string | Stable identifier for this reference |
| `kind` | `"call"` \| `"decl"` \| `"type"` \| `"string"` \| `"comment"` | Semantic kind |
| `scope` | string \| null | Enclosing function/class, or null for module-level |
| `ctx` | string[] | Context lines with `►` marker on match line |
| `replace` | string \| null | Replacement text, or null to skip |
| `line` | number | 1-indexed line number |
| `range` | [number, number, number, number] | [startLine, startCol, endLine, endCol] |

---

## editset.patch Command

Apply LLM-generated patches to editsets via stdin (heredoc):

```bash
# Minimal patch format: refId → replacement or null
bun tools/refactor.ts editset.patch editset.json <<'EOF'
{
  "b2c3d4e5": "repository",
  "c3d4e5f6": null
}
EOF

# Or pipe from a file
cat my-patch.json | bun tools/refactor.ts editset.patch editset.json

# Output to different file
bun tools/refactor.ts editset.patch editset.json --output patched.json <<'EOF'
{ "b2c3": null }
EOF
```

### Patch Format

The patch is a simple JSON object mapping refIds to actions:

```json
{
  "refId1": "custom replacement",  // Use this replacement instead of default
  "refId2": null,                   // Skip this reference
  // refId3 not mentioned           // Apply with default replacement
}
```

| Patch Value | Action |
|-------------|--------|
| `"string"` | Use this replacement text |
| `null` | Skip this reference (don't apply) |
| *(not in patch)* | Apply with default `to` replacement |

### Full Editset Patch

You can also pass a full editset with modified `replace` fields:

```json
{
  "refs": [
    { "refId": "a1b2", "replace": "Repository" },
    { "refId": "b2c3", "replace": null }
  ]
}
```

The patch command extracts `refId` and `replace` from each ref.

---

## More Examples: Edge Cases Manual Editing Misses

### Example 9: Destructuring Parameters (ts-morph REQUIRED)

**Scenario**: Rename `vaultPath` to `repoPath` — appears in destructuring patterns

**Manual grep would find:**
```typescript
const vaultPath = "/path/to/vault"  // ✓ obvious
```

**But MISS these (ts-morph catches them):**
```typescript
// Destructuring in function parameter
export function init({ vaultPath, config }: Options) {
  return load(vaultPath)
}

// Nested destructuring
const { paths: { vaultPath } } = config

// Arrow function parameter destructuring
const handler = ({ vaultPath }: Ctx) => vaultPath

// Object shorthand
return { vaultPath }  // property AND value both renamed
```

**Command:**
```bash
bun tools/refactor.ts rename.batch --pattern vaultPath --replace repoPath --output edits.json
bun tools/refactor.ts editset.apply edits.json
# All 47 occurrences updated atomically
```

---

### Example 10: Re-exports and Barrel Files (ts-morph REQUIRED)

**Scenario**: Rename `Widget` to `Gadget` — used in index.ts re-exports

**Manual editing misses:**
```typescript
// src/index.ts - barrel file
export { Widget } from "./widget"
export type { Widget, WidgetConfig } from "./widget"

// src/components/index.ts - nested barrel
export * from "./Widget"
export { Widget as DefaultWidget } from "./Widget"
```

**ts-morph finds ALL of these:**
```bash
bun tools/refactor.ts rename.batch --pattern Widget --replace Gadget --output edits.json
# Found: 89 references across 23 files including all re-exports
```

---

### Example 11: Type-Only Imports

**Scenario**: Rename `UserService` interface — used in type-only imports

**Manual editing risks:**
```typescript
// Type-only import - easy to miss with grep
import type { UserService } from "./services"

// Inline type import
const fn = (service: import("./services").UserService) => {}

// Generic constraints
function process<T extends UserService>(svc: T) {}
```

**ts-morph finds all patterns:**
```bash
bun tools/refactor.ts rename.batch --pattern UserService --replace AccountService --check-conflicts
bun tools/refactor.ts rename.batch --pattern UserService --replace AccountService --output edits.json
```

---

### Example 12: JSDoc References

**Scenario**: Rename `parseConfig` — referenced in JSDoc comments

```typescript
/**
 * @see parseConfig for config format
 * @param {ReturnType<typeof parseConfig>} config
 */
function initApp(config) {}
```

**ripgrep backend catches JSDoc:**
```bash
bun tools/refactor.ts pattern.replace \
  --pattern parseConfig \
  --replace loadConfig \
  --glob "**/*.{ts,js}" \
  --backend ripgrep \
  --output jsdoc-updates.json
```

---

### Example 13: Dynamic Imports

**Scenario**: Rename file `user-api.ts` to `account-api.ts` — dynamic imports exist

```typescript
// Static import (caught by ts-morph file.rename)
import { getUser } from "./user-api"

// Dynamic import (caught by ripgrep pattern.replace)
const api = await import("./user-api")
const { handler } = await import(`./user-api`)
```

**Two-step approach:**
```bash
# 1. Rename file + static imports
bun tools/refactor.ts file.rename --pattern user-api --replace account-api --output files.json
bun tools/refactor.ts file.apply files.json

# 2. Catch dynamic imports
bun tools/refactor.ts pattern.replace \
  --pattern "user-api" \
  --replace "account-api" \
  --glob "**/*.ts" \
  --backend ripgrep \
  --output dynamic.json
bun tools/refactor.ts editset.apply dynamic.json
```

---

### Example 14: Test Mocks and Fixtures

**Scenario**: Rename `createVault` — but test mocks use it too

```typescript
// src/vault.ts
export function createVault() {}

// tests/vault.test.ts
vi.mock("../vault", () => ({
  createVault: vi.fn(),  // Mock uses same name
}))

// tests/fixtures/vault-fixture.ts
export const mockCreateVault = () => {}  // Compound identifier
```

**ts-morph renames ALL including mocks:**
```bash
bun tools/refactor.ts rename.batch --pattern createVault --replace createRepo --output edits.json
# Found in: src/vault.ts, 12 test files, 3 fixture files
```

---

### Example 15: Partial Word Match with Case Preservation

**Scenario**: Rename all `vault` occurrences — different casings exist

```typescript
const vault = {}           // lowercase
const Vault = {}           // PascalCase
const VAULT_PATH = ""      // SCREAMING_CASE
const vaultConfig = {}     // camelCase compound
class VaultManager {}      // PascalCase compound
const VAULT_OPTIONS = {}   // SCREAMING compound
```

**Automatic case preservation:**
```bash
bun tools/refactor.ts rename.batch --pattern vault --replace repo --output edits.json
```

**Result:**
```typescript
const repo = {}            // lowercase preserved
const Repo = {}            // PascalCase preserved
const REPO_PATH = ""       // SCREAMING_CASE preserved
const repoConfig = {}      // camelCase compound
class RepoManager {}       // PascalCase compound
const REPO_OPTIONS = {}    // SCREAMING compound
```

---

### Example 16: Multi-Package Monorepo

**Scenario**: Rename across multiple packages in a monorepo

```
packages/
  core/src/vault.ts
  cli/src/commands/vault.ts
  tui/src/views/vault-view.tsx
  storage/src/vault-loader.ts
```

**Single command handles all:**
```bash
bun tools/refactor.ts migrate --from vault --to repo --glob "packages/**/*.{ts,tsx}"

# Creates editsets in .editsets/:
# - 01-file-renames.json (4 files)
# - 02-symbol-renames.json (234 symbols)
# - 03-text-patterns.json (89 text occurrences)
```

---

### Example 17: Rollback Safety with Checksums

**Scenario**: Someone edited a file after you created the editset

```bash
# Create editset
bun tools/refactor.ts rename.batch --pattern Widget --replace Gadget --output edits.json

# ... time passes, teammate edits src/widget.ts ...

# Apply fails safely with drift detection
bun tools/refactor.ts editset.apply edits.json
# Error: Drift detected in src/widget.ts (checksum mismatch)
# Skipped: 3 edits in src/widget.ts
# Applied: 45 edits in other files
```

The editset NEVER corrupts files — if the file changed, it skips that file.

---

## Decision Tree: Which Command to Use

```
Is this a terminology migration (file names + code + docs)?
├── YES → `migrate --from X --to Y`
└── NO
    ├── Renaming files?
    │   └── YES → `file.rename --pattern X --replace Y`
    ├── Renaming TypeScript identifiers?
    │   └── YES → `rename.batch --pattern X --replace Y`
    ├── Updating Go/Rust/Python structural patterns?
    │   └── YES → `pattern.replace --backend ast-grep`
    └── Updating text/markdown/comments?
        └── YES → `pattern.replace --backend ripgrep`
```

---

## Performance Comparison

| Task | Manual Edits | Batch Refactor |
|------|--------------|----------------|
| Rename function (50 refs) | ~50 Edit calls | 2 commands |
| Rename file + imports | Risk broken build | Atomic update |
| Full terminology migration | Hours | Minutes |
| Rollback on error | Manual git restore | Automatic (checksums) |

**Rule of thumb**: If you'd make more than 5 edits, use batch refactor
