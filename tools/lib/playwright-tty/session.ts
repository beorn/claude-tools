/**
 * TtySession - wraps ttyd + Playwright browser/page for a single session
 */

import type { Browser, Page } from "playwright"
import { createTTY, type TtydServer } from "./ttyd-server.js"
import { waitForContent, waitForText, waitForStable } from "./wait-helpers.js"
import type { Viewport } from "./types.js"

export interface TtySessionOptions {
  command: string[]
  env?: Record<string, string>
  viewport?: Viewport
  waitFor?: "content" | "stable" | string
  timeout?: number
  cwd?: string
}

export interface TtySession {
  id: string
  url: string
  command: string[]
  createdAt: Date
  page: Page
  browser: Browser
  readonly alive: boolean

  reset(options?: {
    command?: string[]
    env?: Record<string, string>
  }): Promise<string>
  close(): Promise<void>
}

/**
 * Create a new TTY session with the given browser and options
 */
export async function createSession(
  id: string,
  browser: Browser,
  options: TtySessionOptions,
): Promise<TtySession> {
  const {
    command,
    env,
    viewport = { width: 1000, height: 700 },
    waitFor = "content",
    timeout = 5000,
    cwd,
  } = options

  let ttyd: TtydServer = createTTY({ command, env, cwd })
  await ttyd.ready

  const context = await browser.newContext()
  const page = await context.newPage()
  await page.setViewportSize(viewport)
  await page.goto(ttyd.url, { timeout: 10_000 })

  // Wait for initial content
  await performWait(page, waitFor, timeout)

  const createdAt = new Date()
  let currentCommand = command

  async function reset(resetOptions?: {
    command?: string[]
    env?: Record<string, string>
  }): Promise<string> {
    // Close old ttyd
    await ttyd.close()

    // Start new ttyd with same or new command
    const newCommand = resetOptions?.command ?? currentCommand
    const newEnv = resetOptions?.env ?? env

    ttyd = createTTY({ command: newCommand, env: newEnv, cwd })
    await ttyd.ready

    // Navigate to new URL
    await page.goto(ttyd.url, { timeout: 10_000 })
    await performWait(page, waitFor, timeout)

    currentCommand = newCommand
    return ttyd.url
  }

  async function close(): Promise<void> {
    await context.close()
    await ttyd.close()
  }

  return {
    id,
    get url() {
      return ttyd.url
    },
    get command() {
      return currentCommand
    },
    get alive() {
      return !page.isClosed() && ttyd.isRunning
    },
    createdAt,
    page,
    browser,
    reset,
    close,
  }
}

async function performWait(
  page: Page,
  waitFor: "content" | "stable" | string,
  timeout: number,
): Promise<void> {
  const opts = { timeout }
  if (waitFor === "content") {
    await waitForContent(page, opts)
  } else if (waitFor === "stable") {
    await waitForStable(page, 500, opts)
  } else {
    // Wait for specific text
    await waitForText(page, waitFor, opts)
  }
}
