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
- **Terminology migrations**: vault→repo, old API→new API

**Trigger phrases**:
- "rename X to Y everywhere"
- "change all X to Y"
- "refactor X across the codebase"
- "batch replace"
- "update terminology"
- "migrate from X to Y"
- "rename function/variable everywhere"
- "change wording in all files"

## Workflow

1. **SEARCH**: Find all matches using ast-grep (code) or Grep (text)
2. **FILTER**: Check for project verification scripts (e.g., check-migration.ts)
3. **APPLY**: Apply ALL matches (be aggressive, tests catch mistakes)
4. **VERIFY**: Run project's lint/test commands

## Confidence Philosophy

**Be aggressive. Tests catch mistakes.**

Confidence is based on **our concept vs external reference**, not code vs string/comment.

| Context | Example | Confidence |
|---------|---------|------------|
| Our code | `const vaultRoot = ...` | HIGH |
| Our compound identifier | `vaultHelper`, `byVault` | HIGH |
| Our error message | `"vault not found"` | HIGH |
| Our comment | `// handle vault sync` | HIGH |
| Our docs | `# Vault Guide` | HIGH |
| External reference | `"Obsidian vault"` | LOW |
| External docs | `// Obsidian stores data in vaults` | LOW |
| URL/path | `https://vault.example.com` | LOW |

**Default to HIGH** unless the context clearly refers to an external system.

If project has ALLOWED_PATTERNS (e.g., check-migration.ts), trust those exclusions.

## Step 1: Search

**Check for project verification script first:**
```bash
# If project has check-migration.ts or similar, use it
bun scripts/check-migration.ts 2>&1 | head -50
```

**For code files (.ts, .tsx, .js, .py)** - use ast-grep:
```bash
ast-grep run -p "oldName" -l typescript --json=stream packages/ 2>/dev/null
```

**For text/markdown** - use Grep tool:
```typescript
Grep({ pattern: "oldName", path: "packages/", output_mode: "content", "-C": 3 })
```

## Step 2: Apply ALL Matches

**For code files** - use ast-grep bulk mode:
```bash
ast-grep run -p "oldName" -r "newName" -l typescript -U packages/
```

**For text/markdown** - use Edit tool with replace_all:
```typescript
Edit({
  file_path: match.file,
  old_string: "oldName",
  new_string: "newName",
  replace_all: true
})
```

## Step 3: Verify

Run project verification:
```bash
# Bun projects
bun fix && bun run test:fast

# Check migration completeness if script exists
bun scripts/check-migration.ts
```

Report summary:
```
Applied 765 changes across 93 files.
Verification: PASSED (0 unexpected mentions remaining)
```

## When to Ask User

Only ask if there's genuine ambiguity:
- **Different concept**: "Obsidian vault" (external system, not our term)
- **URL/path**: `https://vault.example.com` (might be intentional)
- **User explicitly said** to review certain patterns

For terminology migrations, default to **apply all**.

## Supported Operations

| Operation | Tool | File types |
|-----------|------|------------|
| Code refactoring | ast-grep -U | .ts, .tsx, .js, .py |
| Text search-replace | Edit replace_all | .md, .txt, any text |
| Type-safe renames | mcp-refactor-typescript | TypeScript |
| File renaming | Bash mv | Any (future) |

## AST Pattern Syntax (ast-grep)

| Pattern | Matches |
|---------|---------|
| `$VAR` | Single identifier/expression |
| `$$$ARGS` | Multiple nodes (spread) |
| `console.log($MSG)` | Function call with one arg |
| `import { $IMPORTS } from "$MOD"` | Import statement |

## Important

1. **Be aggressive** - apply all matches, let tests catch mistakes
2. **Use bulk mode** - ast-grep -U for code, Edit replace_all for text
3. **Trust the tests** - "No refactoring tool guarantees behavior preservation. Your test suite does."
4. **Check for project scripts** - check-migration.ts tells you exactly what to fix
