# Batch Plugin for Claude Code

Batch operations across files with confidence-based auto-apply. Claude automatically uses this skill when you ask to rename, replace, refactor, or migrate terminology.

## What it does

- **Code refactoring**: rename functions, variables, types across TypeScript/JavaScript/Python
- **Text/markdown updates**: change terminology, update documentation
- **Terminology migrations**: vault→repo, old API→new API
- **File renaming**: batch rename files (future)

## Installation

```bash
# Add the beorn-claude-tools marketplace (one-time)
claude plugin marketplace add github:beorn/beorn-claude-tools

# Install the plugin
claude plugin install batch@beorn-claude-tools
```

## Usage

Just ask naturally - Claude uses the skill automatically:

```
"rename createVault to createRepo across the codebase"
"change all vault mentions to repo in packages/"
"update the terminology from X to Y in the docs"
"refactor oldFunction to newFunction everywhere"
"migrate from old API to new API"
```

No slash command needed - the skill triggers on natural language.

## How It Works

1. **SEARCH**: Find all matches using ast-grep (code) or ripgrep (text)
2. **ANALYZE**: Claude reviews each match and scores confidence
3. **AUTO-APPLY**: HIGH confidence changes applied automatically
4. **REVIEW**: MEDIUM confidence matches presented for user approval
5. **SKIP**: LOW confidence matches skipped with explanation
6. **VERIFY**: Run your project's test/lint commands

### Confidence Scoring

| Confidence | Context | Action |
|------------|---------|--------|
| **HIGH** | Function call, import, type reference, variable declaration | Auto-apply |
| **MEDIUM** | String literal, comment, documentation, markdown | Ask user |
| **LOW** | Partial match (substring), archive/vendor dirs | Skip |

## Requirements

- **ast-grep** (for AST-aware code refactoring):
  ```bash
  # macOS/Linux with Nix
  nix profile install nixpkgs#ast-grep

  # Or via npm
  npm install -g @ast-grep/cli
  ```

- **mcp-refactor-typescript** (optional, bundled via MCP for type-safe renames)

## Supported Operations

| Operation | Tool | File types |
|-----------|------|------------|
| Code refactoring | ast-grep | .ts, .tsx, .js, .py |
| Text search-replace | ripgrep + Edit | .md, .txt, any text |
| Type-safe renames | mcp-refactor-typescript | TypeScript |
| File renaming | Bash mv | Any (future) |

## Plugin Structure

```
batch/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── batch-refactor/
│       └── SKILL.md      # Model-invoked skill
└── README.md
```

This plugin uses a **skill** (model-invoked) rather than a command (user-invoked), so Claude automatically uses it when the task matches.

## License

MIT
