/**
 * file-ops.test.ts - Tests for batch file rename operations
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import fs from "fs"
import path from "path"
import {
  applyReplacement,
  findFilesToRename,
  checkFileConflicts,
  createFileRenameProposal,
  verifyFileEditset,
  applyFileRenames,
} from "../../tools/lib/core/file-ops"

// Test fixture directory
const FIXTURE_DIR = path.join(import.meta.dir, "../fixtures/file-ops-test")

function setupFixtures() {
  // Clean up and recreate fixture directory
  if (fs.existsSync(FIXTURE_DIR)) {
    fs.rmSync(FIXTURE_DIR, { recursive: true })
  }
  fs.mkdirSync(FIXTURE_DIR, { recursive: true })

  // Create test files
  fs.writeFileSync(path.join(FIXTURE_DIR, "repo.ts"), 'export const repo = "test"')
  fs.writeFileSync(path.join(FIXTURE_DIR, "repo-loader.ts"), 'import { repo } from "./repo"')
  fs.writeFileSync(path.join(FIXTURE_DIR, "VaultConfig.ts"), "export interface VaultConfig {}")
  fs.mkdirSync(path.join(FIXTURE_DIR, "testing"), { recursive: true })
  fs.writeFileSync(path.join(FIXTURE_DIR, "testing/fake-repo.ts"), "export class FakeVault {}")

  // Create a file that would conflict (repo.ts already exists)
  fs.writeFileSync(path.join(FIXTURE_DIR, "repo.ts"), 'export const repo = "existing"')
}

function cleanupFixtures() {
  if (fs.existsSync(FIXTURE_DIR)) {
    fs.rmSync(FIXTURE_DIR, { recursive: true })
  }
}

describe("applyReplacement", () => {
  test("replaces lowercase", () => {
    expect(applyReplacement("repo-loader.ts", "repo", "repo")).toBe("repo-loader.ts")
  })

  test("preserves PascalCase", () => {
    expect(applyReplacement("VaultConfig.ts", "repo", "repo")).toBe("RepoConfig.ts")
  })

  test("preserves UPPERCASE", () => {
    expect(applyReplacement("VAULT_ROOT.ts", "repo", "repo")).toBe("REPO_ROOT.ts")
  })

  test("handles multiple occurrences", () => {
    expect(applyReplacement("repo-repo.ts", "repo", "repo")).toBe("repo-repo.ts")
  })

  test("handles mixed case in same file", () => {
    expect(applyReplacement("VaultLoader-repo.ts", "repo", "repo")).toBe("RepoLoader-repo.ts")
  })
})

describe("findFilesToRename", () => {
  beforeEach(setupFixtures)
  afterEach(cleanupFixtures)

  test("finds files matching pattern", async () => {
    const ops = await findFilesToRename("repo", "repo", "**/*.ts", FIXTURE_DIR)

    expect(ops.length).toBe(4)
    const paths = ops.map((op) => op.oldPath)
    expect(paths).toContain("repo.ts")
    expect(paths).toContain("repo-loader.ts")
    expect(paths).toContain("VaultConfig.ts")
    expect(paths).toContain("testing/fake-repo.ts")
  })

  test("computes correct new paths", async () => {
    const ops = await findFilesToRename("repo", "repo", "**/*.ts", FIXTURE_DIR)

    const repoOp = ops.find((op) => op.oldPath === "repo.ts")
    expect(repoOp?.newPath).toBe("repo.ts")

    const loaderOp = ops.find((op) => op.oldPath === "repo-loader.ts")
    expect(loaderOp?.newPath).toBe("repo-loader.ts")

    const configOp = ops.find((op) => op.oldPath === "VaultConfig.ts")
    expect(configOp?.newPath).toBe("RepoConfig.ts")
  })

  test("respects glob filter", async () => {
    const ops = await findFilesToRename("repo", "repo", "*.ts", FIXTURE_DIR)

    // Should only find files in root, not in subdirectories
    expect(ops.length).toBe(3)
    const paths = ops.map((op) => op.oldPath)
    expect(paths).not.toContain("testing/fake-repo.ts")
  })
})

describe("checkFileConflicts", () => {
  beforeEach(setupFixtures)
  afterEach(cleanupFixtures)

  test("detects target exists conflict", async () => {
    const ops = await findFilesToRename("repo", "repo", "**/*.ts", FIXTURE_DIR)
    const report = checkFileConflicts(ops, FIXTURE_DIR)

    // repo.ts -> repo.ts should conflict because repo.ts exists
    expect(report.conflicts.length).toBeGreaterThan(0)
    const repoConflict = report.conflicts.find((c) => c.oldPath === "repo.ts")
    expect(repoConflict).toBeDefined()
    expect(repoConflict?.reason).toBe("target_exists")
  })

  test("identifies safe renames", async () => {
    const ops = await findFilesToRename("repo", "repo", "**/*.ts", FIXTURE_DIR)
    const report = checkFileConflicts(ops, FIXTURE_DIR)

    // repo-loader.ts -> repo-loader.ts should be safe
    const loaderOp = report.safe.find((op) => op.oldPath === "repo-loader.ts")
    expect(loaderOp).toBeDefined()
  })
})

describe("createFileRenameProposal", () => {
  beforeEach(setupFixtures)
  afterEach(cleanupFixtures)

  test("creates editset with file ops", async () => {
    const editset = await createFileRenameProposal("repo", "repo", "**/*.ts", FIXTURE_DIR)

    expect(editset.operation).toBe("file-rename")
    expect(editset.pattern).toBe("repo")
    expect(editset.replacement).toBe("repo")
    // Should exclude conflicting repo.ts -> repo.ts
    expect(editset.fileOps.length).toBe(3)
  })

  test("includes checksums", async () => {
    const editset = await createFileRenameProposal("repo", "repo", "**/*.ts", FIXTURE_DIR)

    for (const op of editset.fileOps) {
      expect(op.checksum).toBeDefined()
      expect(op.checksum.length).toBe(16) // SHA256 truncated to 16 chars
    }
  })
})

describe("verifyFileEditset", () => {
  beforeEach(setupFixtures)
  afterEach(cleanupFixtures)

  test("valid when files unchanged", async () => {
    const editset = await createFileRenameProposal("repo", "repo", "**/*.ts", FIXTURE_DIR)
    const result = verifyFileEditset(editset, FIXTURE_DIR)

    expect(result.valid).toBe(true)
    expect(result.drifted.length).toBe(0)
  })

  test("detects file changes", async () => {
    const editset = await createFileRenameProposal("repo", "repo", "**/*.ts", FIXTURE_DIR)

    // Modify a file after creating the editset
    fs.writeFileSync(path.join(FIXTURE_DIR, "repo-loader.ts"), "// modified content")

    const result = verifyFileEditset(editset, FIXTURE_DIR)
    expect(result.valid).toBe(false)
    expect(result.drifted.some((d) => d.includes("repo-loader.ts"))).toBe(true)
  })
})

describe("applyFileRenames", () => {
  beforeEach(setupFixtures)
  afterEach(cleanupFixtures)

  test("dry run does not rename files", async () => {
    const editset = await createFileRenameProposal("repo", "repo", "**/*.ts", FIXTURE_DIR)
    const result = applyFileRenames(editset, true, FIXTURE_DIR)

    expect(result.applied).toBe(3)
    expect(result.skipped).toBe(0)

    // Files should still have old names
    expect(fs.existsSync(path.join(FIXTURE_DIR, "repo-loader.ts"))).toBe(true)
    expect(fs.existsSync(path.join(FIXTURE_DIR, "repo-loader.ts"))).toBe(false)
  })

  test("applies renames", async () => {
    const editset = await createFileRenameProposal("repo", "repo", "**/*.ts", FIXTURE_DIR)
    const result = applyFileRenames(editset, false, FIXTURE_DIR)

    expect(result.applied).toBe(3)
    expect(result.errors.length).toBe(0)

    // Files should have new names
    expect(fs.existsSync(path.join(FIXTURE_DIR, "repo-loader.ts"))).toBe(false)
    expect(fs.existsSync(path.join(FIXTURE_DIR, "repo-loader.ts"))).toBe(true)
    expect(fs.existsSync(path.join(FIXTURE_DIR, "RepoConfig.ts"))).toBe(true)
    expect(fs.existsSync(path.join(FIXTURE_DIR, "testing/fake-repo.ts"))).toBe(true)
  })

  test("skips drifted files", async () => {
    const editset = await createFileRenameProposal("repo", "repo", "**/*.ts", FIXTURE_DIR)

    // Modify a file
    fs.writeFileSync(path.join(FIXTURE_DIR, "repo-loader.ts"), "// modified")

    const result = applyFileRenames(editset, false, FIXTURE_DIR)

    expect(result.skipped).toBe(1)
    expect(result.errors.some((e) => e.includes("repo-loader.ts"))).toBe(true)

    // Modified file should not be renamed
    expect(fs.existsSync(path.join(FIXTURE_DIR, "repo-loader.ts"))).toBe(true)
  })
})
