import { Project } from "ts-morph"

let cachedProject: Project | null = null

/**
 * Get or create a ts-morph Project
 */
export function getProject(tsConfigPath = "tsconfig.json"): Project {
  if (!cachedProject) {
    cachedProject = new Project({ tsConfigFilePath: tsConfigPath })
  }
  return cachedProject
}

/**
 * Reset the cached project (useful for tests)
 */
export function resetProject(): void {
  cachedProject = null
}
