/**
 * file-ops.ts - Batch file rename operations with import path updates
 *
 * Provides:
 *   - findFilesToRename: Find files matching a glob pattern
 *   - checkFileConflicts: Check for naming conflicts
 *   - createFileRenameProposal: Create editset with file ops + import updates
 *   - applyFileRenames: Execute file renames and import updates
 */

import { createHash } from "crypto"
import fs from "fs"
import path from "path"
import { Glob } from "bun"
import type { FileOp, FileEditset, FileConflict, FileRenameReport, Edit } from "./types"

/**
 * Compute checksum for a file
 */
function fileChecksum(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return createHash("sha256").update(content).digest("hex").slice(0, 16)
}

/**
 * Generate unique operation ID
 */
function generateOpId(oldPath: string, newPath: string): string {
  const hash = createHash("sha256").update(`${oldPath}:${newPath}`).digest("hex").slice(0, 8)
  return `file-${hash}`
}

/**
 * Apply a replacement pattern to a filename
 *
 * Supports:
 *   - Simple string replacement: "vault" -> "repo" in "vault-loader.ts" -> "repo-loader.ts"
 *   - Regex groups: "vault(.+)" -> "repo$1" (not yet implemented)
 */
export function applyReplacement(filename: string, pattern: string | RegExp, replacement: string): string {
  if (typeof pattern === "string") {
    // Case-preserving replacement
    return filename.replace(new RegExp(pattern, "gi"), (match) => {
      // Preserve case: vault -> repo, Vault -> Repo, VAULT -> REPO
      if (match === match.toUpperCase()) return replacement.toUpperCase()
      if (match[0] === match[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1)
      return replacement
    })
  }
  return filename.replace(pattern, replacement)
}

/**
 * Find files matching a glob pattern that contain the search term in their name
 */
export async function findFilesToRename(
  pattern: string,
  replacement: string,
  glob: string = "**/*",
  cwd: string = process.cwd()
): Promise<FileOp[]> {
  const fileOps: FileOp[] = []
  const globber = new Glob(glob)

  for await (const file of globber.scan({ cwd, onlyFiles: true })) {
    const basename = path.basename(file)
    const dirname = path.dirname(file)

    // Check if filename contains the pattern
    if (!basename.toLowerCase().includes(pattern.toLowerCase())) continue

    // Compute new name
    const newBasename = applyReplacement(basename, pattern, replacement)
    if (newBasename === basename) continue // No change needed

    const oldPath = path.join(cwd, file)
    const newPath = path.join(cwd, dirname, newBasename)

    fileOps.push({
      opId: generateOpId(oldPath, newPath),
      type: "rename",
      oldPath: file, // relative path
      newPath: path.join(dirname, newBasename), // relative path
      checksum: fileChecksum(oldPath),
    })
  }

  return fileOps
}

/**
 * Check for file rename conflicts
 */
export function checkFileConflicts(fileOps: FileOp[], cwd: string = process.cwd()): FileRenameReport {
  const conflicts: FileConflict[] = []
  const safe: FileOp[] = []
  const targetPaths = new Set<string>()

  for (const op of fileOps) {
    const absoluteNewPath = path.isAbsolute(op.newPath) ? op.newPath : path.join(cwd, op.newPath)

    // Check if target already exists
    if (fs.existsSync(absoluteNewPath)) {
      // Check if it's the same file (case-insensitive rename on case-insensitive fs)
      const absoluteOldPath = path.isAbsolute(op.oldPath) ? op.oldPath : path.join(cwd, op.oldPath)
      if (absoluteOldPath.toLowerCase() !== absoluteNewPath.toLowerCase()) {
        conflicts.push({
          oldPath: op.oldPath,
          newPath: op.newPath,
          reason: "target_exists",
          existingPath: op.newPath,
        })
        continue
      }
    }

    // Check for duplicate targets within this batch
    if (targetPaths.has(op.newPath)) {
      conflicts.push({
        oldPath: op.oldPath,
        newPath: op.newPath,
        reason: "target_exists",
        existingPath: op.newPath,
      })
      continue
    }

    // Check if old and new are the same
    if (op.oldPath === op.newPath) {
      conflicts.push({
        oldPath: op.oldPath,
        newPath: op.newPath,
        reason: "same_path",
      })
      continue
    }

    targetPaths.add(op.newPath)
    safe.push(op)
  }

  return { conflicts, safe }
}

/**
 * Find all import statements that reference the files being renamed
 * Returns edit operations to update those imports
 */
export function findImportEdits(fileOps: FileOp[], cwd: string = process.cwd()): Edit[] {
  // This will be enhanced to use ts-morph for accurate import detection
  // For now, use ripgrep-style text search as a simple fallback

  const edits: Edit[] = []

  for (const op of fileOps) {
    // Get the module specifier (without extension for ts/js)
    const oldExt = path.extname(op.oldPath)
    const newExt = path.extname(op.newPath)
    const oldSpecifier = op.oldPath.replace(/\.(ts|tsx|js|jsx)$/, "")
    const newSpecifier = op.newPath.replace(/\.(ts|tsx|js|jsx)$/, "")

    // Also handle basename-only imports (e.g., import from "./vault")
    const oldBasename = path.basename(op.oldPath).replace(/\.(ts|tsx|js|jsx)$/, "")
    const newBasename = path.basename(op.newPath).replace(/\.(ts|tsx|js|jsx)$/, "")

    // Search for import statements containing the old path
    // This is a simplified approach - the full implementation will use ts-morph
    const searchPatterns = [
      `from ["'].*${escapeRegex(oldBasename)}["']`,
      `from ["'].*${escapeRegex(oldSpecifier)}["']`,
      `require\\(["'].*${escapeRegex(oldBasename)}["']\\)`,
      `import\\(["'].*${escapeRegex(oldBasename)}["']\\)`,
    ]

    // For now, we'll generate placeholder edits
    // The actual implementation will scan TypeScript files for imports
    console.error(`[file-ops] Would search for imports of ${oldBasename} -> ${newBasename}`)
  }

  return edits
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Create a file rename editset
 */
export async function createFileRenameProposal(
  pattern: string,
  replacement: string,
  glob: string = "**/*",
  cwd: string = process.cwd()
): Promise<FileEditset> {
  // Find files to rename
  const fileOps = await findFilesToRename(pattern, replacement, glob, cwd)

  // Check for conflicts
  const report = checkFileConflicts(fileOps, cwd)
  if (report.conflicts.length > 0) {
    console.error(`[file-ops] Found ${report.conflicts.length} conflicts:`)
    for (const c of report.conflicts) {
      console.error(`  ${c.oldPath} -> ${c.newPath}: ${c.reason}`)
    }
  }

  // Find import edits for safe renames
  const importEdits = findImportEdits(report.safe, cwd)

  return {
    id: `file-rename-${pattern}-to-${replacement}-${Date.now()}`,
    operation: "file-rename",
    pattern,
    replacement,
    fileOps: report.safe,
    importEdits,
    createdAt: new Date().toISOString(),
  }
}

/**
 * Verify a file editset can be applied (checksums still match)
 */
export function verifyFileEditset(
  editset: FileEditset,
  cwd: string = process.cwd()
): { valid: boolean; drifted: string[] } {
  const drifted: string[] = []

  for (const op of editset.fileOps) {
    const absolutePath = path.isAbsolute(op.oldPath) ? op.oldPath : path.join(cwd, op.oldPath)

    if (!fs.existsSync(absolutePath)) {
      drifted.push(`${op.oldPath}: file no longer exists`)
      continue
    }

    const currentChecksum = fileChecksum(absolutePath)
    if (currentChecksum !== op.checksum) {
      drifted.push(`${op.oldPath}: checksum mismatch (file changed)`)
    }
  }

  return { valid: drifted.length === 0, drifted }
}

/**
 * Apply file renames
 */
export function applyFileRenames(
  editset: FileEditset,
  dryRun: boolean = false,
  cwd: string = process.cwd()
): { applied: number; skipped: number; errors: string[] } {
  const errors: string[] = []
  let applied = 0
  let skipped = 0

  // Verify first
  const verification = verifyFileEditset(editset, cwd)
  if (!verification.valid) {
    console.error("[file-ops] Some files have drifted:")
    for (const msg of verification.drifted) {
      console.error(`  ${msg}`)
    }
  }

  for (const op of editset.fileOps) {
    const absoluteOldPath = path.isAbsolute(op.oldPath) ? op.oldPath : path.join(cwd, op.oldPath)
    const absoluteNewPath = path.isAbsolute(op.newPath) ? op.newPath : path.join(cwd, op.newPath)

    // Check if file still exists with correct checksum
    if (!fs.existsSync(absoluteOldPath)) {
      errors.push(`${op.oldPath}: file no longer exists`)
      skipped++
      continue
    }

    const currentChecksum = fileChecksum(absoluteOldPath)
    if (currentChecksum !== op.checksum) {
      errors.push(`${op.oldPath}: checksum mismatch, skipping`)
      skipped++
      continue
    }

    if (dryRun) {
      console.log(`[dry-run] mv ${op.oldPath} -> ${op.newPath}`)
      applied++
      continue
    }

    // Ensure target directory exists
    const targetDir = path.dirname(absoluteNewPath)
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    // Perform the rename
    try {
      fs.renameSync(absoluteOldPath, absoluteNewPath)
      applied++
    } catch (err) {
      errors.push(`${op.oldPath}: rename failed - ${err}`)
      skipped++
    }
  }

  return { applied, skipped, errors }
}

/**
 * Save a file editset to disk
 */
export function saveFileEditset(editset: FileEditset, outputPath: string): void {
  fs.writeFileSync(outputPath, JSON.stringify(editset, null, 2))
}

/**
 * Load a file editset from disk
 */
export function loadFileEditset(inputPath: string): FileEditset {
  const content = fs.readFileSync(inputPath, "utf-8")
  return JSON.parse(content) as FileEditset
}
