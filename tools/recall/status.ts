/**
 * Status dashboard — unified view of index health, activity, hooks, and recommendations.
 * Replaces: review, now, hour, day, stats commands.
 */

import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import {
  getDb,
  closeDb,
  DB_PATH,
  getActiveSessionsInWindow,
  getActivitySummary,
  getIndexMeta,
  getAllSessionTitles,
} from "../lib/history/db"
import { reviewMemorySystem, type ReviewResult } from "../lib/history/recall"
import {
  BOLD,
  RESET,
  DIM,
  CYAN,
  YELLOW,
  GREEN,
  RED,
  CHECK,
  WARN,
  CROSS,
  FIVE_MINUTES_MS,
  ONE_HOUR_MS,
  ONE_DAY_MS,
  formatBytes,
  formatRelativeTime,
  displayProjectPath,
  formatSessionId,
} from "./format"

/**
 * Resolve the project root directory.
 * The recall.ts script lives at vendor/beorn-tools/tools/recall.ts
 * So project root is 4 levels up from __dirname (tools/recall/ → tools/ → beorn-tools/ → vendor/ → root)
 */
function getProjectRoot(): string {
  let dir = path.resolve(import.meta.dir)
  for (let i = 0; i < 4; i++) {
    dir = path.dirname(dir)
  }
  return dir
}

export async function cmdStatus(opts: { json?: boolean }): Promise<void> {
  const projectRoot = getProjectRoot()

  if (opts.json) {
    const review = await reviewMemorySystem(projectRoot)
    console.log(JSON.stringify(review, null, 2))
    return
  }

  console.log()
  console.log(`${BOLD}Recall Status${RESET}`)
  console.log("\u2550".repeat(40))
  console.log()

  // ── Index Health ──────────────────────────────────────────────────────
  let db
  try {
    db = getDb()
  } catch {
    console.log(`${CROSS} No index found. Run \`recall index\` to build.`)
    return
  }

  try {
    const sessions =
      (db.prepare("SELECT COUNT(*) as n FROM sessions").get() as { n: number })
        .n ?? 0
    const messages =
      (db.prepare("SELECT COUNT(*) as n FROM messages").get() as { n: number })
        .n ?? 0
    const totalWrites = (
      db.prepare("SELECT COUNT(*) as count FROM writes").get() as {
        count: number
      }
    ).count

    let dbSizeBytes = 0
    try {
      dbSizeBytes = fs.statSync(DB_PATH).size
    } catch {
      // ignore
    }

    const lastRebuild = getIndexMeta(db, "last_rebuild") ?? null
    const isStale = lastRebuild
      ? Date.now() - new Date(lastRebuild).getTime() > ONE_HOUR_MS
      : true

    // Content table counts by type
    const contentCounts = db
      .prepare(
        "SELECT content_type, COUNT(*) as n FROM content GROUP BY content_type",
      )
      .all() as { content_type: string; n: number }[]
    const countByType = new Map(contentCounts.map((r) => [r.content_type, r.n]))

    console.log(`${BOLD}Index Health${RESET}`)
    console.log(
      `  ${sessions.toLocaleString()} sessions  ${messages.toLocaleString()} messages  ${totalWrites.toLocaleString()} file writes`,
    )

    // Show content type counts
    const contentParts: string[] = []
    for (const [type, count] of countByType) {
      if (count > 0) contentParts.push(`${count} ${type}s`)
    }
    if (contentParts.length > 0) {
      console.log(`  Content: ${contentParts.join(", ")}`)
    }

    console.log(
      `  DB: ${formatBytes(dbSizeBytes)}  Last rebuild: ${lastRebuild ? formatRelativeTime(new Date(lastRebuild).getTime()) : `${RED}never${RESET}`}${isStale ? ` ${YELLOW}(stale)${RESET}` : ""}`,
    )
    console.log()

    // ── Active Now ────────────────────────────────────────────────────────
    const active = getActiveSessionsInWindow(db, FIVE_MINUTES_MS)
    const sessionTitles = getAllSessionTitles()

    if (active.length > 0) {
      console.log(`${BOLD}Active Now${RESET}`)
      for (const s of active) {
        const project = displayProjectPath(s.project_path)
        const relTime = formatRelativeTime(s.last_activity)
        console.log(
          `  ${project} ${DIM}(${s.message_count} msgs, ${relTime})${RESET}`,
        )
      }
      console.log()
    }

    // ── Today's Activity ──────────────────────────────────────────────────
    const summary = getActivitySummary(db, ONE_DAY_MS)

    if (summary.length > 0) {
      console.log(`${BOLD}Today's Activity${RESET}`)
      for (const project of summary) {
        const displayProject = displayProjectPath(project.project_path)
        console.log(
          `  ${displayProject.padEnd(20)} ${project.message_count} msgs across ${project.session_count} session${project.session_count !== 1 ? "s" : ""}`,
        )
      }
      console.log()
    }

    // ── Stats ─────────────────────────────────────────────────────────────
    const userMessages = (
      db
        .prepare("SELECT COUNT(*) as count FROM messages WHERE type = 'user'")
        .get() as {
        count: number
      }
    ).count
    const assistantMessages = (
      db
        .prepare(
          "SELECT COUNT(*) as count FROM messages WHERE type = 'assistant'",
        )
        .get() as {
        count: number
      }
    ).count
    const uniqueFiles = (
      db
        .prepare("SELECT COUNT(DISTINCT file_path) as count FROM writes")
        .get() as { count: number }
    ).count

    console.log(`${BOLD}Message Breakdown${RESET}`)
    console.log(
      `  User: ${userMessages.toLocaleString()}  Assistant: ${assistantMessages.toLocaleString()}  Files written: ${uniqueFiles.toLocaleString()}`,
    )
    console.log()

    // ── Top written files ─────────────────────────────────────────────────
    const topFiles = db
      .prepare(`
      SELECT file_path, COUNT(*) as count FROM writes
      GROUP BY file_path ORDER BY count DESC LIMIT 5
    `)
      .all() as { file_path: string; count: number }[]

    if (topFiles.length > 0) {
      console.log(`${BOLD}Most Written Files${RESET}`)
      for (const f of topFiles) {
        const shortPath = f.file_path.replace(os.homedir(), "~")
        console.log(`  ${f.count.toString().padStart(4)}x  ${shortPath}`)
      }
      console.log()
    }
  } finally {
    closeDb()
  }

  // ── Hook Configuration ──────────────────────────────────────────────
  const review = await reviewMemorySystem(projectRoot)
  const hk = review.hookConfig

  console.log(`${BOLD}Hook Configuration${RESET}`)
  console.log(
    `  ${hk.userPromptSubmitConfigured ? CHECK : CROSS} UserPromptSubmit hook configured`,
  )
  console.log(
    `  ${hk.sessionEndConfigured ? CHECK : CROSS} SessionEnd hook configured`,
  )
  console.log(
    `  ${hk.recallHookConfigured ? CHECK : CROSS} recall.ts hook command`,
  )
  console.log(
    `  ${hk.rememberHookConfigured ? CHECK : CROSS} recall.ts remember command`,
  )
  console.log(
    `  ${hk.sessionMemoryFiles > 0 ? CHECK : WARN} ${hk.sessionMemoryFiles} session memory file${hk.sessionMemoryFiles !== 1 ? "s" : ""}`,
  )
  console.log()

  // ── Recommendations ───────────────────────────────────────────────────
  if (review.recommendations.length > 0) {
    console.log(`${BOLD}Recommendations${RESET}`)
    for (const rec of review.recommendations) {
      const marker =
        rec.includes("good") || rec.includes("working")
          ? CHECK
          : rec.includes("stale") ||
              rec.includes("not found") ||
              rec.includes("failed") ||
              rec.includes("No ") ||
              rec.includes("not configured") ||
              rec.includes("NOT executable") ||
              rec.includes("error") ||
              rec.includes("empty") ||
              rec.includes("corrupt")
            ? CROSS
            : WARN
      console.log(`  ${marker} ${rec}`)
    }
    console.log()
  }
}
