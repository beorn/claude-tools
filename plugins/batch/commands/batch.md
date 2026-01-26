---
description: Batch search, select, and transform code. Use for mass refactoring with interactive selection.
argument-hint: [rename|search|apply] <pattern> [replacement] [--glob <glob>]
allowed-tools: Bash, Read, Edit, Grep, Glob, AskUserQuestion
---

# /batch - Batch Code Transformation

Intelligent batch refactoring with confidence-based auto-apply. Claude reviews all matches, auto-applies high-confidence changes, and asks about uncertain ones.

## Main Command: `/batch rename`

```
/batch rename "oldName" "newName" --glob "packages/**/*.ts"
```

### Workflow

1. **SEARCH**: Find all matches using ast-grep
2. **ANALYZE**: Claude reviews each match and scores confidence
3. **AUTO-CATEGORIZE**:
   - HIGH confidence → auto-apply
   - MEDIUM confidence → ask user
   - LOW confidence → skip with explanation
4. **REVIEW**: Present uncertain matches to user via AskUserQuestion
5. **APPLY**: Execute approved changes
6. **VERIFY**: Run `bun fix && bun run test:fast`

### Confidence Scoring

| Confidence | Criteria | Action |
|------------|----------|--------|
| **HIGH** | Exact match in code context (function call, import, type) | Auto-apply |
| **MEDIUM** | Match in string, comment, or ambiguous context | Ask user |
| **LOW** | False positive, different semantic meaning, or risky | Skip |

**Examples:**
- `oldFunc()` call site → HIGH (clear usage)
- `"oldFunc"` in error message → MEDIUM (might be intentional)
- `oldFunc` as part of `myOldFuncHelper` → LOW (partial match, different thing)

## Step-by-Step Instructions

When user invokes `/batch rename "old" "new" --glob "path"`:

### Step 1: Search
```bash
ast-grep run -p "old" -l typescript --json=stream path/ 2>/dev/null
```

Parse JSON output. Each match has: `file`, `range.start.line`, `range.start.column`, `text`, surrounding context.

### Step 2: Analyze Each Match

For each match, read surrounding context (5 lines before/after) and classify:

```typescript
interface Match {
  file: string
  line: number
  column: number
  matchText: string
  context: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
}
```

### Step 3: Report Summary

```
Found 47 matches across 12 files.

Confidence breakdown:
- HIGH (auto-apply): 38 matches
- MEDIUM (needs review): 7 matches
- LOW (skip): 2 matches
```

### Step 4: Review MEDIUM Matches

Use AskUserQuestion with multiSelect to present uncertain matches:

```typescript
AskUserQuestion({
  question: "Which of these matches should be renamed?",
  header: "Review",
  options: [
    { label: "src/foo.ts:45", description: "In string: \"oldName not found\"" },
    { label: "src/bar.ts:120", description: "In comment: // oldName handler" },
    // ...
  ],
  multiSelect: true
})
```

### Step 5: Apply Changes

For each approved match, use Edit tool:

```typescript
Edit({
  file_path: match.file,
  old_string: matchContext,  // Include enough context to be unique
  new_string: replacedContext
})
```

### Step 6: Verify

```bash
bun fix && bun run test:fast
```

Report final summary:
```
Applied 43 changes (38 auto + 5 user-approved)
Skipped 4 (2 low-confidence + 2 user-rejected)
Verification: PASSED
```

## Other Commands

### `/batch search <pattern>` - Preview Only

Just search and show matches without making changes:

```bash
ast-grep run -p "pattern" -l typescript -C 3 packages/
```

### `/batch apply --all` - Force Apply All

Skip confidence analysis and apply all matches (use with caution):

```bash
ast-grep run -p "old" -r "new" -l typescript -U packages/
```

## Tools Available

| Tool | Best for | When to use |
|------|----------|-------------|
| **ast-grep** | Structural patterns | Most refactoring |
| **Grep** | Simple text search | Quick exploration |
| **mcp-refactor-typescript** | Type-safe renames | Complex scoping |

## AST Pattern Syntax

| Pattern | Matches |
|---------|---------|
| `$VAR` | Single node (identifier, expression) |
| `$$$ARGS` | Multiple nodes (spread) |
| `console.log($MSG)` | Function call with one arg |
| `function $NAME($ARGS) { $BODY }` | Function declaration |

## MCP Integration

For semantically-correct renames using TypeScript's language server:

```
Use mcp__refactor-typescript__rename_symbol to rename
"oldFunction" to "newFunction" in packages/km-core/src/index.ts
```

**Setup** (if MCP not connected):
```bash
claude mcp add --transport stdio --scope project refactor-typescript -- bunx mcp-refactor-typescript
# Restart Claude Code session
```

## Important Notes

1. **ast-grep's -i flag doesn't work** in Claude Code (requires TTY)
2. **Always verify** with `bun fix && bun run test:fast`
3. **Commit atomically** - related changes together
4. **Check partial matches** - `oldName` might match `myOldNameHelper`
