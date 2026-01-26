import { execFileSync } from "child_process"
import { readFileSync, existsSync } from "fs"
import type { Reference, Editset, Edit } from "../../core/types"
import { computeChecksum, computeRefId } from "../../core/apply"

/**
 * Find text patterns using ripgrep
 *
 * @param pattern - Regex pattern to search for
 * @param glob - Optional file glob filter (e.g., "*.md")
 */
export function findPatterns(pattern: string, glob?: string): Reference[] {
  const args = ["--json", "--line-number", "--column", pattern]
  if (glob) {
    args.push("--glob", glob)
  }
  args.push(".") // Search current directory

  const result = runRg(args)
  if (!result) return []

  return parseMatches(result, pattern)
}

/**
 * Create an editset for text-based search and replace
 *
 * @param pattern - Regex pattern to match
 * @param replacement - Replacement string (supports $1, $2, etc. for capture groups)
 * @param glob - Optional file glob filter
 */
export function createPatternReplaceProposal(
  pattern: string,
  replacement: string,
  glob?: string
): Editset {
  const refs = findPatterns(pattern, glob)

  const id = `text-replace-${Date.now()}`

  // Generate edits with proper replacements
  const edits = generateEdits(refs, pattern, replacement)

  return {
    id,
    operation: "rename",
    pattern,
    from: pattern,
    to: replacement,
    refs,
    edits,
    createdAt: new Date().toISOString(),
  }
}

// Internal helpers

interface RgMatch {
  type: "match"
  data: {
    path: { text: string }
    lines: { text: string }
    line_number: number
    absolute_offset: number
    submatches: Array<{
      match: { text: string }
      start: number
      end: number
    }>
  }
}

interface RgLine {
  type: string
  data?: unknown
}

function runRg(args: string[]): RgMatch[] | null {
  try {
    const output = execFileSync("rg", args, {
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
      stdio: ["pipe", "pipe", "pipe"],
    })

    // Parse NDJSON output (one JSON object per line)
    const matches: RgMatch[] = []
    for (const line of output.split("\n")) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as RgLine
        if (parsed.type === "match") {
          matches.push(parsed as RgMatch)
        }
      } catch {
        // Skip malformed lines
      }
    }
    return matches
  } catch (error: unknown) {
    // ripgrep returns exit code 1 when no matches found
    const execError = error as { status?: number }
    if (execError.status === 1) {
      return []
    }
    // Check if rg is installed
    if (
      error instanceof Error &&
      (error.message.includes("ENOENT") || error.message.includes("not found"))
    ) {
      throw new Error("ripgrep (rg) not found. Install via: brew install ripgrep")
    }
    throw error
  }
}

function parseMatches(matches: RgMatch[], pattern: string): Reference[] {
  const refs: Reference[] = []
  const fileContents = new Map<string, string>()

  for (const match of matches) {
    const filePath = match.data.path.text
    const lineNumber = match.data.line_number

    // Get file content for checksum
    let content = fileContents.get(filePath)
    if (!content) {
      if (!existsSync(filePath)) continue
      content = readFileSync(filePath, "utf-8")
      fileContents.set(filePath, content)
    }

    const checksum = computeChecksum(content)

    // Process each submatch on this line
    for (const submatch of match.data.submatches) {
      const startCol = submatch.start + 1 // Convert to 1-indexed
      const endCol = submatch.end + 1

      const refId = computeRefId(filePath, lineNumber, startCol, lineNumber, endCol)

      // Use the line text as preview
      const preview = match.data.lines.text.trim()

      refs.push({
        refId,
        file: filePath,
        range: [lineNumber, startCol, lineNumber, endCol],
        preview: `${preview} // "${submatch.match.text}" → "${pattern}"`,
        checksum,
        selected: true,
      })
    }
  }

  return refs
}

function generateEdits(refs: Reference[], pattern: string, replacement: string): Edit[] {
  const edits: Edit[] = []
  const fileContents = new Map<string, string>()
  const regex = new RegExp(pattern, "g")

  for (const ref of refs) {
    if (!ref.selected) continue

    // Get file content
    let content = fileContents.get(ref.file)
    if (!content) {
      if (!existsSync(ref.file)) continue
      content = readFileSync(ref.file, "utf-8")
      fileContents.set(ref.file, content)
    }

    // Calculate byte offset from line/col
    const lines = content.split("\n")
    let offset = 0
    for (let i = 0; i < ref.range[0] - 1; i++) {
      offset += lines[i].length + 1 // +1 for newline
    }
    offset += ref.range[1] - 1 // column offset (0-indexed)

    const matchLength = ref.range[3] - ref.range[1]

    // Get the actual matched text to compute proper replacement
    const matchedText = content.slice(offset, offset + matchLength)
    const actualReplacement = matchedText.replace(regex, replacement)

    edits.push({
      file: ref.file,
      offset,
      length: matchLength,
      replacement: actualReplacement,
    })
  }

  // Sort by file then by offset descending
  return edits.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    return b.offset - a.offset
  })
}
