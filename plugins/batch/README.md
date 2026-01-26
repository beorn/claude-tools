# Batch Refactoring Plugin for Claude Code

Intelligent batch refactoring with confidence-based auto-apply. Claude reviews all matches, auto-applies high-confidence changes, and asks about uncertain ones.

## Installation

```bash
# From Claude Code
/plugin install beorn/batch

# Or manually
claude --plugin-dir ./vendor/beorn-claude/plugins/batch
```

## Usage

```bash
/batch rename "oldName" "newName" --glob "packages/**/*.ts"
```

### Workflow

1. **SEARCH**: Find all matches using ast-grep (code) or ripgrep (text)
2. **ANALYZE**: Claude reviews each match and scores confidence
3. **AUTO-CATEGORIZE**:
   - HIGH confidence → auto-apply
   - MEDIUM confidence → ask user
   - LOW confidence → skip with explanation
4. **REVIEW**: Present uncertain matches via AskUserQuestion
5. **APPLY**: Execute approved changes
6. **VERIFY**: Run `bun fix && bun run test:fast`

### Confidence Scoring

| Confidence | Criteria | Action |
|------------|----------|--------|
| **HIGH** | Exact match in code context (function call, import, type) | Auto-apply |
| **MEDIUM** | Match in string, comment, or ambiguous context | Ask user |
| **LOW** | False positive, different semantic meaning, or risky | Skip |

## Commands

| Command | Description |
|---------|-------------|
| `/batch rename "old" "new"` | Rename with confidence-based apply |
| `/batch search "pattern"` | Preview matches without changes |
| `/batch apply --all` | Force apply all matches |

## Requirements

- **ast-grep**: `nix profile install nixpkgs#ast-grep`
- **mcp-refactor-typescript**: Bundled via MCP (optional, for type-safe renames)

## Scope

Works on **all text files**:
- Code (`.ts`, `.tsx`, `.js`) - AST-aware with ast-grep
- Markdown (`.md`) - Text-based with ripgrep
- Comments and notes - Full support

## License

MIT
