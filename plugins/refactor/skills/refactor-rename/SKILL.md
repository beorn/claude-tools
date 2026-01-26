---
name: refactor-rename
description: Type-safe TypeScript refactoring with editset workflow. Use for renaming symbols, terminology migrations, and batch refactoring.
allowed-tools: Bash, Read
---

# TypeScript Refactoring Skill

Use this skill for type-safe TypeScript refactoring:
- **Symbol renames**: function, variable, type, interface, property
- **Terminology migrations**: vault→repo, oldApi→newApi
- **Batch refactoring**: rename all symbols matching a pattern

**Key principle**: Editset workflow (propose → select → apply) gives you inspection and rollback.

## CLI Location

```bash
bun vendor/beorn-claude-tools/plugins/refactor/tools/refactor.ts <command>
```

## Workflow

### 1. Discover Symbols

```bash
# Find all symbols matching pattern
bun tools/refactor.ts symbols.find --pattern vault
```

Output:
```json
[
  { "symbolKey": "src/types.ts:42:5:vault", "name": "vault", "kind": "variable", "refCount": 47 },
  { "symbolKey": "src/types.ts:10:1:Vault", "name": "Vault", "kind": "interface", "refCount": 23 }
]
```

### 2. Create Editset Proposal

```bash
# Single symbol
bun tools/refactor.ts rename.propose "src/types.ts:42:5:vault" repo --output editset.json

# Batch (all matching symbols)
bun tools/refactor.ts rename.batch --pattern vault --replace repo --output editset.json
```

### 3. Inspect Editset (Optional)

Read `editset.json` to review what will be changed:
- `refs[]` - all references with file, range, preview
- `edits[]` - exact byte-level changes

### 4. Filter Editset (Optional)

If some refs should be excluded (e.g., external references):

```bash
# Exclude specific refs
bun tools/refactor.ts editset.select editset.json --exclude ref1,ref2 --output filtered.json

# Or include only specific refs
bun tools/refactor.ts editset.select editset.json --include ref3,ref4
```

### 5. Verify (Optional)

```bash
bun tools/refactor.ts editset.verify editset.json
```

Checks:
- All files exist
- Checksums match (no drift since proposal)

### 6. Apply

```bash
# Dry run first
bun tools/refactor.ts editset.apply editset.json --dry-run

# Apply for real
bun tools/refactor.ts editset.apply editset.json
```

### 7. Verify Types

```bash
bun tsc --noEmit
```

**CRITICAL**: Always check types after refactoring. Partial renames break code.

## Case Preservation

Batch renames preserve case automatically:
- `vault` → `repo`
- `Vault` → `Repo`
- `VAULT` → `REPO`
- `vaultPath` → `repoPath`

## When to Use This vs Other Tools

| What you're changing | Tool |
|---------------------|------|
| TypeScript identifiers | This tool (type-aware) |
| String literals `"vault"` | ast-grep |
| Comments/docs | Edit replace_all |
| Markdown text | Edit replace_all |

## Editset Schema

```typescript
{
  id: string,           // "rename-vault-to-repo-1706000000"
  operation: "rename",
  from: string,         // original pattern/name
  to: string,           // replacement
  refs: [{
    refId: string,      // stable ID for selection
    file: string,
    range: [startLine, startCol, endLine, endCol],
    preview: string,    // context line
    checksum: string,   // file checksum at proposal time
    selected: boolean
  }],
  edits: [{
    file: string,
    offset: number,     // byte offset
    length: number,
    replacement: string
  }]
}
```

## Example: Terminology Migration

```bash
# 1. Discover scope
bun tools/refactor.ts symbols.find --pattern vault
# → Found 40 symbols, 506 references

# 2. Create proposal
bun tools/refactor.ts rename.batch --pattern vault --replace repo --output vault-to-repo.json

# 3. Review (optional)
cat vault-to-repo.json | jq '.refs | length'  # 506 refs

# 4. Exclude external refs (if any)
bun tools/refactor.ts editset.select vault-to-repo.json --exclude abc123,def456

# 5. Apply
bun tools/refactor.ts editset.apply vault-to-repo.json

# 6. Verify
bun tsc --noEmit  # Must pass!
```

## Benefits Over Direct Renames

1. **Inspection** - See all changes before applying
2. **Selection** - Exclude specific refs (external systems, etc.)
3. **Checksums** - Won't corrupt files that changed since proposal
4. **Reproducibility** - Editset is a durable artifact
5. **Rollback** - `git checkout .` if something goes wrong
