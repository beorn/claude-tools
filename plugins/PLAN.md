# Unified Batch-Refactor Plugin - Final Structure

## Summary

Merge `plugins/refactor/` into `plugins/batch/` to create one unified plugin for all batch operations, with a backend abstraction for multi-language support.

## Final Plugin Structure

```
plugins/batch/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── package.json                 # ts-morph, zod dependencies
├── README.md                    # User documentation
├── skills/
│   └── batch-refactor/
│       └── SKILL.md             # Unified skill (merged content)
└── tools/
    ├── refactor.ts              # CLI entry point
    └── lib/
        ├── core/                # Language-agnostic core
        │   ├── types.ts         # Zod schemas (SymbolInfo, Reference, Edit, Editset)
        │   ├── editset.ts       # Generic operations (filter, save, load)
        │   └── apply.ts         # Generic apply with checksum verification
        │
        ├── backend.ts           # Backend interface definition
        │
        └── backends/
            ├── ts-morph/        # TypeScript/JavaScript backend
            │   ├── index.ts     # Exports, registers backend
            │   ├── project.ts   # ts-morph Project management
            │   ├── symbols.ts   # getSymbolAt, getReferences, findSymbols
            │   └── edits.ts     # createRenameProposal, createBatchRenameProposal
            │
            └── ast-grep/        # Pattern-based backend (any language)
                ├── index.ts     # Exports, registers backend
                ├── search.ts    # Pattern search via `sg` CLI
                └── rewrite.ts   # Pattern rewrite via `sg run -r`
```

## Backend Interface

```typescript
// lib/backend.ts
import type { SymbolInfo, SymbolMatch, Reference, Editset } from "./core/types"

export interface RefactorBackend {
  name: string
  extensions: string[]  // Files this backend handles
  priority: number      // Higher = preferred when multiple match

  // Discovery
  getSymbolAt?(file: string, line: number, col: number): SymbolInfo | null
  getReferences?(symbolKey: string): Reference[]
  findSymbols?(pattern: RegExp): SymbolMatch[]

  // Pattern-based (ast-grep style)
  findPatterns?(pattern: string, glob?: string): Reference[]

  // Proposal generation
  createRenameProposal?(symbolKey: string, newName: string): Editset
  createBatchRenameProposal?(pattern: RegExp, replacement: string): Editset
  createPatternReplaceProposal?(pattern: string, replacement: string, glob?: string): Editset
}

// Registry
const backends: RefactorBackend[] = []

export function registerBackend(backend: RefactorBackend): void {
  backends.push(backend)
  backends.sort((a, b) => b.priority - a.priority)  // Higher priority first
}

export function getBackendForFile(file: string): RefactorBackend | null {
  const ext = path.extname(file)
  return backends.find(b => b.extensions.includes(ext)) ?? null
}

export function getBackendByName(name: string): RefactorBackend | null {
  return backends.find(b => b.name === name) ?? null
}
```

## Backends

### ts-morph Backend

```typescript
// lib/backends/ts-morph/index.ts
export const TsMorphBackend: RefactorBackend = {
  name: "ts-morph",
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  priority: 100,  // High priority for JS/TS files

  // Full symbol-based operations
  getSymbolAt, getReferences, findSymbols,
  createRenameProposal, createBatchRenameProposal,
}

registerBackend(TsMorphBackend)
```

### ast-grep Backend

```typescript
// lib/backends/ast-grep/index.ts
export const AstGrepBackend: RefactorBackend = {
  name: "ast-grep",
  extensions: ["*"],  // Fallback for any file
  priority: 10,       // Lower priority than ts-morph for JS/TS

  // Pattern-based operations only
  findPatterns,
  createPatternReplaceProposal,
}

registerBackend(AstGrepBackend)
```

## Backend Selection Logic

```
1. User specifies --backend=ast-grep  → Use that backend
2. File is .ts/.tsx/.js/.jsx         → Use ts-morph (priority 100)
3. File is .go/.py/.rs/etc           → Use ast-grep (fallback)
4. Pattern operation requested        → Use ast-grep (pattern-native)
```

## Future Backends

```
└── backends/
    ├── ts-morph/       # v1 - TypeScript/JavaScript
    ├── ast-grep/       # v1 - Pattern-based (any language)
    ├── gritql/         # Future - When autofix ships
    ├── lsp/            # Future - LSP-based refactoring
    └── comby/          # Future - Structural patterns
```

## CLI Commands

```bash
bun tools/refactor.ts <command> [options]
```

| Command | Purpose | Output |
|---------|---------|--------|
| `symbol.at <file> <line> [col]` | Find symbol at location | `SymbolInfo` |
| `refs.list <symbolKey>` | List all references | `Reference[]` |
| `symbols.find --pattern <regex>` | Find matching symbols | `SymbolMatch[]` |
| `rename.propose <key> <new> [-o]` | Single symbol editset | `ProposeOutput` |
| `rename.batch --pattern --replace [-o]` | Batch rename editset | `ProposeOutput` |
| `editset.select <file> [--include/--exclude] [-o]` | Filter editset | Updated editset |
| `editset.verify <file>` | Check for drift | `{valid, issues[]}` |
| `editset.apply <file> [--dry-run]` | Apply with checksums | `ApplyOutput` |

## Exported Types (from lib/core/types.ts)

### Core Data Structures

```typescript
// Symbol found at a location
interface SymbolInfo {
  symbolKey: string      // "file:line:col:name"
  name: string
  kind: "variable" | "function" | "type" | "interface" | "property" | "class" | "method" | "parameter"
  file: string
  line: number
  column: number
}

// A reference to a symbol
interface Reference {
  refId: string          // 8-char hash of location
  file: string
  range: [number, number, number, number]  // [startLine, startCol, endLine, endCol]
  preview: string        // Context line
  checksum: string       // SHA256 of file (first 12 chars)
  selected: boolean      // For filtering
}

// A single edit operation
interface Edit {
  file: string
  offset: number         // Byte offset
  length: number         // Bytes to replace
  replacement: string
}

// Complete editset (rename proposal)
interface Editset {
  id: string             // "rename-vault-to-repo-1706000000"
  operation: "rename"
  symbolKey?: string     // For single-symbol renames
  pattern?: string       // For batch renames
  from: string
  to: string
  refs: Reference[]
  edits: Edit[]
  createdAt: string      // ISO timestamp
}

// Symbol discovery result
interface SymbolMatch {
  symbolKey: string
  name: string
  kind: string
  file: string
  line: number
  refCount: number
}
```

### Command Outputs

```typescript
interface ProposeOutput {
  editsetPath: string
  refCount: number
  fileCount: number
  symbolCount?: number   // For batch renames
}

interface ApplyOutput {
  applied: number
  skipped: number
  driftDetected: Array<{
    file: string
    reason: string
  }>
}
```

## Exported Functions

### Generic Core (`lib/core/`)

#### core/types.ts
All Zod schemas - language-agnostic data shapes:
- `SymbolInfo`, `SymbolMatch`, `Reference`, `Edit`, `Editset`
- `ProposeOutput`, `ApplyOutput`, `SymbolsFindOutput`
- `Conflict`, `SafeRename`, `ConflictReport` (conflict detection)

#### core/editset.ts
| Function | Purpose |
|----------|---------|
| `filterEditset(editset, include?, exclude?)` | Toggle ref selection (pure JSON) |
| `saveEditset(editset, path)` | Write editset to JSON file |
| `loadEditset(path)` | Read editset from JSON file |

#### core/apply.ts
| Function | Purpose |
|----------|---------|
| `applyEditset(editset, dryRun?)` | Apply byte-offset edits with checksum verification |
| `verifyEditset(editset)` | Check files exist & checksums match |
| `computeChecksum(content)` | SHA256 hash (12 chars) |
| `computeRefId(file, ...)` | Stable ref ID (8 chars) |

### Backend Interface (`lib/backend.ts`)

| Function | Purpose |
|----------|---------|
| `registerBackend(backend)` | Add backend to registry |
| `getBackendForFile(file)` | Find backend by file extension |
| `getBackendByName(name)` | Find backend by name (e.g., "ts-morph") |

### ts-morph Backend (`lib/backends/ts-morph/`)

#### ts-morph/project.ts
| Function | Purpose |
|----------|---------|
| `getProject(tsConfigPath?)` | Get/cache ts-morph Project |
| `resetProject()` | Clear cached project |

#### ts-morph/symbols.ts
| Function | Purpose |
|----------|---------|
| `getSymbolAt(project, file, line, col)` | Find identifier at position via AST |
| `getReferences(project, symbolKey)` | Find all refs via ts-morph |
| `findSymbols(project, pattern)` | Search AST for matching symbols |
| `findAllSymbols(project)` | Get all symbols (for conflict detection) |

#### ts-morph/edits.ts
| Function | Purpose |
|----------|---------|
| `createRenameProposal(project, symbolKey, newName)` | Single symbol editset |
| `createBatchRenameProposal(project, pattern, replacement)` | Batch editset |
| `generateEditsFromRefs(project, refs, old, new)` | Convert refs to byte-offset edits |
| `computeNewName(old, pattern, replacement)` | Case-preserving replacement |
| `detectConflicts(project, pattern, replacement)` | Find naming conflicts |

### ast-grep Backend (`lib/backends/ast-grep/`)

#### ast-grep/search.ts
| Function | Purpose |
|----------|---------|
| `findPatterns(pattern, glob?)` | Search via `sg run -p` |
| `parseAstGrepOutput(json)` | Parse sg JSON output to Reference[] |

#### ast-grep/rewrite.ts
| Function | Purpose |
|----------|---------|
| `createPatternReplaceProposal(pattern, replacement, glob?)` | Editset from pattern |
| `runAstGrepRewrite(pattern, replacement, dryRun?)` | Direct `sg run -r` |

## SKILL.md Content (Merged)

The unified SKILL.md will include:

### From batch SKILL.md (keep)
- Safety check (git status, clean working tree)
- Context gathering (CLAUDE.md, ADRs)
- Confidence philosophy ("be aggressive, tests catch mistakes")
- When to ask user (only for external references)
- Tool selection table (ts-morph vs ast-grep vs Edit)
- AST pattern syntax for ast-grep

### From refactor SKILL.md (keep)
- Editset workflow steps
- Command reference with examples
- Case preservation explanation
- Schema documentation
- Benefits of editset approach

### New routing section
```markdown
## Tool Selection

| What you're changing | File Type | Tool |
|---------------------|-----------|------|
| TypeScript identifiers | .ts, .tsx, .js, .jsx | `refactor.ts` (editset) |
| Code patterns | Any language | ast-grep |
| String literals | Any | ast-grep or Edit |
| Text/markdown | .md, .txt | Edit with `replace_all` |
```

## Files to Delete

```
plugins/batch/scripts/ts-rename.ts        # Superseded by ts-morph backend
plugins/batch/scripts/ts-batch-rename.ts  # Superseded by ts-morph backend
plugins/refactor/                         # Entire directory (merged into batch)
```

## Implementation Steps

### Phase 1: Restructure existing code

1. **Create directory structure**:
   ```bash
   mkdir -p plugins/batch/tools/lib/{core,backends/ts-morph,backends/ast-grep}
   ```

2. **Move core files**:
   ```bash
   mv plugins/refactor/tools/lib/types.ts plugins/batch/tools/lib/core/
   mv plugins/refactor/tools/lib/apply.ts plugins/batch/tools/lib/core/
   # Extract generic parts of editset.ts to core/editset.ts
   ```

3. **Move ts-morph backend**:
   ```bash
   mv plugins/refactor/tools/lib/symbols.ts plugins/batch/tools/lib/backends/ts-morph/
   # Move proposal functions from editset.ts to backends/ts-morph/edits.ts
   ```

4. **Create backend interface** (`lib/backend.ts`)

5. **Update imports** in refactor.ts to use new paths

### Phase 2: Add ast-grep backend

6. **Create ast-grep backend**:
   - `backends/ast-grep/index.ts` - Backend registration
   - `backends/ast-grep/search.ts` - Wrap `sg run -p` with JSON output
   - `backends/ast-grep/rewrite.ts` - Generate editset from pattern match

7. **Add CLI commands** for ast-grep:
   - `pattern.find <pattern> [--glob]` - Search via ast-grep
   - `pattern.replace <pattern> <replacement> [--glob]` - Editset from pattern

### Phase 3: Merge and cleanup

8. **Merge SKILL.md**: Combine both skills with routing table
9. **Update package.json**: Ensure ts-morph, zod deps
10. **Delete deprecated files**: ts-rename.ts, ts-batch-rename.ts, plugins/refactor/
11. **Install deps**: `cd plugins/batch && bun install`

## Verification

### ts-morph backend
```bash
bun tools/refactor.ts symbol.at src/foo.ts 42
bun tools/refactor.ts symbols.find --pattern vault
bun tools/refactor.ts rename.batch --pattern vault --replace repo -o editset.json
bun tools/refactor.ts editset.apply editset.json --dry-run
```

### ast-grep backend
```bash
bun tools/refactor.ts pattern.find "console.log(\$MSG)" --glob "**/*.ts"
bun tools/refactor.ts pattern.replace "console.log(\$MSG)" "debug(\$MSG)" -o editset.json
bun tools/refactor.ts editset.apply editset.json --dry-run
```

### Integration
```bash
bun tsc --noEmit  # Types pass after refactoring
```

## Test Suite

### Directory Structure

```
plugins/batch/
└── tests/
    ├── fixtures/                    # Test fixtures
    │   ├── simple-project/          # Small TS project for fast tests
    │   │   ├── tsconfig.json
    │   │   └── src/
    │   │       ├── vault.ts         # Has vault* symbols to rename
    │   │       └── utils.ts         # Has references to vault
    │   └── patterns/                # Pattern matching fixtures
    │       ├── console-logs.ts
    │       └── deprecated-api.ts
    │
    ├── core/                        # Core module tests
    │   ├── types.test.ts            # Zod schema validation
    │   ├── editset.test.ts          # filter, save, load
    │   └── apply.test.ts            # apply, verify, checksums
    │
    ├── backends/
    │   ├── ts-morph/
    │   │   ├── project.test.ts      # Project caching
    │   │   ├── symbols.test.ts      # Symbol discovery
    │   │   └── edits.test.ts        # Proposal generation
    │   └── ast-grep/
    │       ├── search.test.ts       # Pattern search
    │       └── rewrite.test.ts      # Pattern rewrite
    │
    ├── integration/
    │   ├── rename-single.test.ts    # Single symbol rename E2E
    │   ├── rename-batch.test.ts     # Batch rename E2E
    │   ├── pattern-replace.test.ts  # ast-grep pattern E2E
    │   └── conflict-detection.test.ts
    │
    └── cli/
        └── commands.test.ts         # CLI command parsing
```

### Core Tests

#### types.test.ts
```typescript
describe("Zod schemas", () => {
  test("SymbolInfo validates correctly", () => {
    const valid = { symbolKey: "src/foo.ts:1:1:foo", name: "foo", kind: "variable", file: "src/foo.ts", line: 1, column: 1 }
    expect(() => SymbolInfo.parse(valid)).not.toThrow()
  })

  test("SymbolInfo rejects invalid kind", () => {
    const invalid = { ...valid, kind: "invalid" }
    expect(() => SymbolInfo.parse(invalid)).toThrow()
  })

  test("Reference validates with tuple range", () => {
    const valid = { refId: "abc12345", file: "src/foo.ts", range: [1, 1, 1, 10], preview: "const foo", checksum: "abc123456789", selected: true }
    expect(() => Reference.parse(valid)).not.toThrow()
  })

  test("Editset validates complete structure", () => { ... })
})
```

#### editset.test.ts
```typescript
describe("filterEditset", () => {
  const editset = createMockEditset()

  test("filters by include list", () => {
    const filtered = filterEditset(editset, ["R1", "R3"])
    expect(filtered.refs.filter(r => r.selected)).toHaveLength(2)
  })

  test("filters by exclude list", () => {
    const filtered = filterEditset(editset, undefined, ["R2"])
    expect(filtered.refs.find(r => r.refId === "R2")?.selected).toBe(false)
  })

  test("regenerates edits for selected files only", () => { ... })
})

describe("saveEditset / loadEditset", () => {
  test("roundtrips editset through JSON", () => {
    const path = "/tmp/test-editset.json"
    saveEditset(editset, path)
    const loaded = loadEditset(path)
    expect(loaded).toEqual(editset)
  })

  test("throws on missing file", () => {
    expect(() => loadEditset("/nonexistent")).toThrow()
  })
})
```

#### apply.test.ts
```typescript
describe("verifyEditset", () => {
  test("passes when all files exist and checksums match", () => {
    const result = verifyEditset(editset)
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
  })

  test("fails when file is missing", () => {
    const badEditset = { ...editset, refs: [{ ...editset.refs[0], file: "/nonexistent" }] }
    const result = verifyEditset(badEditset)
    expect(result.valid).toBe(false)
    expect(result.issues[0]).toContain("not found")
  })

  test("fails when checksum drifts", () => {
    // Modify file after editset was created
    const result = verifyEditset(editset)
    expect(result.valid).toBe(false)
    expect(result.issues[0]).toContain("mismatch")
  })
})

describe("applyEditset", () => {
  test("applies edits in correct order (end to start)", () => { ... })
  test("skips files with checksum drift", () => { ... })
  test("dry-run doesn't modify files", () => { ... })
  test("returns accurate counts", () => { ... })
})
```

### ts-morph Backend Tests

#### symbols.test.ts
```typescript
describe("getSymbolAt", () => {
  const project = createTestProject()

  test("finds variable at position", () => {
    const symbol = getSymbolAt(project, "fixtures/simple-project/src/vault.ts", 5, 7)
    expect(symbol?.name).toBe("vaultPath")
    expect(symbol?.kind).toBe("variable")
  })

  test("finds interface property", () => {
    const symbol = getSymbolAt(project, "fixtures/simple-project/src/vault.ts", 1, 20)
    expect(symbol?.name).toBe("vaultDir")
    expect(symbol?.kind).toBe("property")
  })

  test("returns null for non-identifier position", () => {
    const symbol = getSymbolAt(project, "fixtures/simple-project/src/vault.ts", 1, 1)
    expect(symbol).toBeNull()
  })
})

describe("getReferences", () => {
  test("finds all references including destructuring", () => {
    const refs = getReferences(project, "fixtures/simple-project/src/vault.ts:1:20:vaultDir")
    expect(refs.length).toBeGreaterThan(1)
    expect(refs.some(r => r.preview.includes("{ vaultDir }"))).toBe(true)
  })

  test("includes references in other files", () => {
    const refs = getReferences(project, "fixtures/simple-project/src/vault.ts:5:7:vaultPath")
    expect(refs.some(r => r.file.includes("utils.ts"))).toBe(true)
  })

  test("computes stable refIds", () => {
    const refs1 = getReferences(project, symbolKey)
    const refs2 = getReferences(project, symbolKey)
    expect(refs1.map(r => r.refId)).toEqual(refs2.map(r => r.refId))
  })
})

describe("findSymbols", () => {
  test("finds symbols matching pattern", () => {
    const symbols = findSymbols(project, /vault/i)
    expect(symbols.length).toBeGreaterThan(0)
    expect(symbols.every(s => s.name.toLowerCase().includes("vault"))).toBe(true)
  })

  test("includes interfaces, types, functions, variables", () => {
    const symbols = findSymbols(project, /vault/i)
    const kinds = new Set(symbols.map(s => s.kind))
    expect(kinds.has("interface")).toBe(true)
    expect(kinds.has("variable")).toBe(true)
  })

  test("sorts by refCount descending", () => {
    const symbols = findSymbols(project, /vault/i)
    for (let i = 1; i < symbols.length; i++) {
      expect(symbols[i-1].refCount).toBeGreaterThanOrEqual(symbols[i].refCount)
    }
  })
})
```

#### edits.test.ts
```typescript
describe("createRenameProposal", () => {
  test("creates editset with all refs", () => {
    const editset = createRenameProposal(project, symbolKey, "repoPath")
    expect(editset.from).toBe("vaultPath")
    expect(editset.to).toBe("repoPath")
    expect(editset.refs.length).toBeGreaterThan(0)
    expect(editset.edits.length).toBe(editset.refs.length)
  })

  test("computes byte offsets correctly", () => {
    const editset = createRenameProposal(project, symbolKey, "repoPath")
    // Verify offsets by reading file and checking position
    for (const edit of editset.edits) {
      const content = readFileSync(edit.file, "utf-8")
      const atOffset = content.slice(edit.offset, edit.offset + edit.length)
      expect(atOffset).toBe("vaultPath")
    }
  })
})

describe("createBatchRenameProposal", () => {
  test("renames all matching symbols", () => {
    const editset = createBatchRenameProposal(project, /vault/i, "repo")
    expect(editset.refs.length).toBeGreaterThan(10)
  })

  test("preserves case", () => {
    const editset = createBatchRenameProposal(project, /vault/i, "repo")
    expect(editset.refs.some(r => r.preview.includes("→ repoPath"))).toBe(true)
    expect(editset.refs.some(r => r.preview.includes("→ Repo"))).toBe(true)
  })

  test("deduplicates refs", () => {
    const editset = createBatchRenameProposal(project, /vault/i, "repo")
    const refIds = editset.refs.map(r => r.refId)
    expect(new Set(refIds).size).toBe(refIds.length)
  })
})

describe("checkConflicts", () => {
  test("detects naming conflicts", () => {
    // If we have both `vault` and `repo` symbols, renaming vault→repo conflicts
    const report = checkConflicts(project, /vault/i, "repo")
    expect(report.conflicts.length).toBeGreaterThan(0)
    expect(report.conflicts[0].existingSymbol).toBeDefined()
  })

  test("identifies safe renames", () => {
    const report = checkConflicts(project, /vault/i, "repository")
    expect(report.safe.length).toBeGreaterThan(0)
  })
})
```

### ast-grep Backend Tests

#### search.test.ts
```typescript
describe("findPatterns", () => {
  test("finds console.log calls", () => {
    const refs = findPatterns("console.log($MSG)", "fixtures/patterns/*.ts")
    expect(refs.length).toBeGreaterThan(0)
    expect(refs[0].preview).toContain("console.log")
  })

  test("returns stable refIds", () => {
    const refs1 = findPatterns("console.log($MSG)")
    const refs2 = findPatterns("console.log($MSG)")
    expect(refs1.map(r => r.refId)).toEqual(refs2.map(r => r.refId))
  })
})

describe("parseAstGrepOutput", () => {
  test("parses JSON stream output", () => {
    const output = `{"file":"src/foo.ts","start":{"line":1,"column":0},"end":{"line":1,"column":20},"match":"console.log(x)"}`
    const refs = parseAstGrepOutput(output)
    expect(refs[0].file).toBe("src/foo.ts")
    expect(refs[0].range).toEqual([1, 0, 1, 20])
  })
})
```

#### rewrite.test.ts
```typescript
describe("createPatternReplaceProposal", () => {
  test("creates editset from pattern match", () => {
    const editset = createPatternReplaceProposal("console.log($MSG)", "debug($MSG)")
    expect(editset.operation).toBe("rename")
    expect(editset.refs.length).toBeGreaterThan(0)
  })

  test("preserves metavariables in replacement", () => {
    const editset = createPatternReplaceProposal("console.log($MSG)", "debug($MSG)")
    // The actual replacement text should have the captured value
  })
})
```

### Integration Tests

#### rename-batch.test.ts
```typescript
describe("E2E: Batch rename workflow", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = copyFixtureToTemp("simple-project")
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true })
  })

  test("complete vault→repo migration", async () => {
    // 1. Find symbols
    const symbols = findSymbols(project, /vault/i)
    expect(symbols.length).toBeGreaterThan(0)

    // 2. Check conflicts
    const conflicts = checkConflicts(project, /vault/i, "repo")

    // 3. Create editset (skip conflicts)
    const editset = createBatchRenameProposalFiltered(
      project, /vault/i, "repo",
      conflicts.conflicts.map(c => c.from)
    )

    // 4. Verify
    const verification = verifyEditset(editset)
    expect(verification.valid).toBe(true)

    // 5. Apply
    const result = applyEditset(editset, false)
    expect(result.applied).toBeGreaterThan(0)
    expect(result.driftDetected).toHaveLength(0)

    // 6. Check types
    const tscResult = spawnSync("bun", ["tsc", "--noEmit"], { cwd: tempDir })
    expect(tscResult.status).toBe(0)
  })
})
```

### CLI Tests

#### commands.test.ts
```typescript
describe("CLI commands", () => {
  test("symbol.at outputs JSON", () => {
    const result = execSync("bun tools/refactor.ts symbol.at fixtures/simple-project/src/vault.ts 5")
    const parsed = JSON.parse(result.toString())
    expect(parsed.symbolKey).toBeDefined()
    expect(parsed.name).toBeDefined()
  })

  test("symbols.find --pattern outputs array", () => {
    const result = execSync("bun tools/refactor.ts symbols.find --pattern vault")
    const parsed = JSON.parse(result.toString())
    expect(Array.isArray(parsed)).toBe(true)
  })

  test("rename.batch --check-conflicts outputs conflict report", () => {
    const result = execSync("bun tools/refactor.ts rename.batch --pattern vault --replace repo --check-conflicts")
    const parsed = JSON.parse(result.toString())
    expect(parsed.conflicts).toBeDefined()
    expect(parsed.safe).toBeDefined()
  })

  test("editset.apply --dry-run doesn't modify files", () => {
    // Create editset, apply with --dry-run, verify files unchanged
  })

  test("errors output JSON with error field", () => {
    const result = execSync("bun tools/refactor.ts symbol.at nonexistent 1", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] })
    const parsed = JSON.parse(result)
    expect(parsed.error).toBeDefined()
  })
})
```

### Test Commands

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/core/editset.test.ts

# Run with coverage
bun test --coverage

# Run only unit tests (fast)
bun test tests/core tests/backends

# Run integration tests (slower)
bun test tests/integration
```
