import { Project, Node } from "ts-morph"
import { writeFileSync, readFileSync, existsSync } from "fs"
import type { Editset, Reference, Edit, SymbolMatch } from "./types"
import { getReferences, findSymbols, computeNewName, computeChecksum, computeRefId, getProject } from "./symbols"

/**
 * Create an editset for renaming a single symbol
 */
export function createRenameProposal(
  project: Project,
  symbolKey: string,
  newName: string
): Editset {
  const [filePath, lineStr, colStr, oldName] = symbolKey.split(":")
  const refs = getReferences(project, symbolKey)

  const id = `rename-${oldName}-to-${newName}-${Date.now()}`

  // Generate edits from references
  const edits = generateEditsFromRefs(project, refs, oldName, newName)

  return {
    id,
    operation: "rename",
    symbolKey,
    from: oldName,
    to: newName,
    refs,
    edits,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Create an editset for batch renaming all symbols matching a pattern
 */
export function createBatchRenameProposal(
  project: Project,
  pattern: RegExp,
  replacement: string
): Editset {
  const symbols = findSymbols(project, pattern)
  const allRefs: Reference[] = []
  const seenRefIds = new Set<string>()

  for (const sym of symbols) {
    const newName = computeNewName(sym.name, pattern, replacement)
    if (newName === sym.name) continue // Skip if no change

    const refs = getReferences(project, sym.symbolKey)
    for (const ref of refs) {
      // Deduplicate refs (same location might be found from different symbols)
      if (!seenRefIds.has(ref.refId)) {
        seenRefIds.add(ref.refId)
        // Update ref with the specific rename for this symbol
        allRefs.push({
          ...ref,
          preview: `${ref.preview} // ${sym.name} → ${newName}`,
        })
      }
    }
  }

  const id = `rename-batch-${pattern.source}-to-${replacement}-${Date.now()}`

  // Generate edits - we'll apply them per-symbol during apply phase
  const edits = generateBatchEdits(project, symbols, pattern, replacement)

  return {
    id,
    operation: "rename",
    pattern: pattern.source,
    from: pattern.source,
    to: replacement,
    refs: allRefs,
    edits,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Filter an editset to include/exclude specific refs
 */
export function filterEditset(
  editset: Editset,
  include?: string[],
  exclude?: string[]
): Editset {
  let refs = editset.refs

  if (include && include.length > 0) {
    const includeSet = new Set(include)
    refs = refs.map((ref) => ({
      ...ref,
      selected: includeSet.has(ref.refId),
    }))
  }

  if (exclude && exclude.length > 0) {
    const excludeSet = new Set(exclude)
    refs = refs.map((ref) => ({
      ...ref,
      selected: ref.selected && !excludeSet.has(ref.refId),
    }))
  }

  // Regenerate edits for selected refs only
  const selectedFiles = new Set(refs.filter((r) => r.selected).map((r) => r.file))
  const edits = editset.edits.filter((e) => selectedFiles.has(e.file))

  return {
    ...editset,
    refs,
    edits,
  }
}

/**
 * Save editset to file
 */
export function saveEditset(editset: Editset, outputPath: string): void {
  writeFileSync(outputPath, JSON.stringify(editset, null, 2))
}

/**
 * Load editset from file
 */
export function loadEditset(inputPath: string): Editset {
  if (!existsSync(inputPath)) {
    throw new Error(`Editset file not found: ${inputPath}`)
  }
  const content = readFileSync(inputPath, "utf-8")
  return JSON.parse(content) as Editset
}

// Internal helpers

function generateEditsFromRefs(
  project: Project,
  refs: Reference[],
  oldName: string,
  newName: string
): Edit[] {
  const edits: Edit[] = []
  const fileContents = new Map<string, string>()

  for (const ref of refs) {
    // Get file content
    let content = fileContents.get(ref.file)
    if (!content) {
      const sf = project.getSourceFile(ref.file)
      if (!sf) continue
      content = sf.getFullText()
      fileContents.set(ref.file, content)
    }

    // Calculate byte offset from line/col
    const lines = content.split("\n")
    let offset = 0
    for (let i = 0; i < ref.range[0] - 1; i++) {
      offset += lines[i].length + 1 // +1 for newline
    }
    offset += ref.range[1] - 1 // column offset

    edits.push({
      file: ref.file,
      offset,
      length: oldName.length,
      replacement: newName,
    })
  }

  // Sort edits by file then by offset (descending for safe application)
  return edits.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    return b.offset - a.offset // Descending for reverse application
  })
}

function generateBatchEdits(
  project: Project,
  symbols: SymbolMatch[],
  pattern: RegExp,
  replacement: string
): Edit[] {
  const allEdits: Edit[] = []
  const seenLocations = new Set<string>()

  for (const sym of symbols) {
    const newName = computeNewName(sym.name, pattern, replacement)
    if (newName === sym.name) continue

    const refs = getReferences(project, sym.symbolKey)
    const edits = generateEditsFromRefs(project, refs, sym.name, newName)

    for (const edit of edits) {
      // Deduplicate by exact location
      const key = `${edit.file}:${edit.offset}:${edit.length}`
      if (!seenLocations.has(key)) {
        seenLocations.add(key)
        allEdits.push(edit)
      }
    }
  }

  // Sort by file then by offset descending
  return allEdits.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file)
    return b.offset - a.offset
  })
}
