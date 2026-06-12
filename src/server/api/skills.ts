/**
 * Skills REST API
 *
 * GET /api/skills              — List all installed skills (metadata only)
 * GET /api/skills/detail       — Full skill data (tree + files)
 * POST /api/skills/install     — Install an existing skill directory into user or project scope
 *       ?source=user&name=xxx
 */

import { createHash } from 'node:crypto'
import * as path from 'path'
import * as fs from 'fs/promises'
import { clearCommandsCache } from '../../commands.js'
import { getCwd } from '../../utils/cwd.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { parseFrontmatter } from '../../utils/frontmatterParser.js'
import { findCanonicalGitRoot, gitExe } from '../../utils/git.js'
import { getProjectDirsUpToHome } from '../../utils/markdownConfigLoader.js'
import { clearInstalledPluginsCache } from '../../utils/plugins/installedPluginsManager.js'
import { clearPluginCache, loadAllPlugins, loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import { getSkillDirCommands } from '../../skills/loadSkillsDir.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import type { LoadedPlugin } from '../../types/plugin.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

// ─── Types ───────────────────────────────────────────────────────────────────

type SkillMeta = {
  name: string
  displayName?: string
  description: string
  source: 'user' | 'project' | 'plugin'
  userInvocable: boolean
  version?: string
  contentLength: number
  hasDirectory: boolean
  pluginName?: string
  canDelete?: boolean
}

type SkillSource = SkillMeta['source']
type InstallSkillScope = 'user' | 'project'
type InstallSkillMode = 'directory' | 'git'

type CachedGitRepoIndexEntry = {
  id: string
  repoUrl: string
  ref?: string
  cacheDir: string
  addedAt: string
}

type CachedGitSkill = {
  name: string
  displayName?: string
  description: string
  version?: string
  skillPath?: string
  installedInUser: boolean
  installedInProject: boolean
}

type CachedGitRepoRecord = CachedGitRepoIndexEntry & {
  skills: CachedGitSkill[]
}

type FileTreeNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
}

type SkillFile = {
  path: string
  content: string
  language: string
  frontmatter?: Record<string, unknown>
  body?: string
  isEntry?: boolean
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_FILES = 50
const MAX_FILE_SIZE = 100 * 1024 // 100 KB
const GIT_OPERATION_TIMEOUT_MS = 120_000
const SKIP_ENTRIES = new Set(['node_modules', '.git', '__pycache__', '.DS_Store'])

const LANG_MAP: Record<string, string> = {
  md: 'markdown', ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', json: 'json',
  yaml: 'yaml', yml: 'yaml', sh: 'bash', bash: 'bash',
  py: 'python', toml: 'toml', css: 'css', html: 'html',
  txt: 'text', xml: 'xml', sql: 'sql', rs: 'rust', go: 'go',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return LANG_MAP[ext] || 'text'
}

function normalizeFrontmatter(content: string, sourcePath?: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  const parsed = parseFrontmatter(content, sourcePath)
  return {
    frontmatter: parsed.frontmatter as Record<string, unknown>,
    body: parsed.content,
  }
}

function getUserSkillsDir(): string {
  return path.join(getClaudeConfigHomeDir(), 'skills')
}

function getRequestedCwd(url: URL): string {
  return url.searchParams.get('cwd') || getCwd()
}

function getProjectSkillsDirs(cwd: string): string[] {
  return getProjectDirsUpToHome('skills', cwd)
}

function getProjectInstallRoot(cwd: string): string {
  const projectRoot = findCanonicalGitRoot(cwd) || cwd
  return path.join(projectRoot, '.cc-tools', 'skills')
}

function getSkillRepoCacheRoot(): string {
  return path.join(getClaudeConfigHomeDir(), 'cache', 'skills', 'repos')
}

function getSkillRepoRegistryPath(): string {
  return path.join(getSkillRepoCacheRoot(), 'registry.json')
}

function resolveSkillSourcePath(sourcePath: string, cwd: string): string {
  if (path.isAbsolute(sourcePath)) {
    return path.normalize(sourcePath)
  }

  return path.resolve(cwd, sourcePath)
}

function buildCachedRepoId(repoUrl: string, ref?: string): string {
  const suffix = ref ? `${repoUrl}#${ref}` : repoUrl
  return createHash('sha256').update(suffix).digest('hex').slice(0, 16)
}

function getCachedRepoDirectory(repoUrl: string, ref?: string): string {
  const hash = buildCachedRepoId(repoUrl, ref)
  const repoName = path
    .basename(repoUrl.replace(/[\\/]+$/, ''))
    .replace(/\.git$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
  const safeRepoName = repoName.length > 0 ? repoName : 'repo'
  return path.join(getSkillRepoCacheRoot(), `${safeRepoName}-${hash}`)
}

async function runGitCommand(
  cwd: string,
  args: string[],
  failureLabel: string,
): Promise<void> {
  const result = await execFileNoThrowWithCwd(gitExe(), args, {
    cwd,
    timeout: GIT_OPERATION_TIMEOUT_MS,
    preserveOutputOnError: true,
  })
  if (result.code !== 0) {
    const details = result.stderr || result.stdout || result.error || 'unknown git error'
    throw ApiError.badRequest(`${failureLabel}: ${details.trim()}`)
  }
}

async function readCachedGitRepoIndex(): Promise<CachedGitRepoIndexEntry[]> {
  const registryPath = getSkillRepoRegistryPath()
  try {
    const raw = await fs.readFile(registryPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((entry): entry is CachedGitRepoIndexEntry =>
      Boolean(
        entry &&
          typeof entry === 'object' &&
          typeof entry.id === 'string' &&
          typeof entry.repoUrl === 'string' &&
          typeof entry.cacheDir === 'string' &&
          typeof entry.addedAt === 'string',
      ),
    )
  } catch {
    return []
  }
}

async function writeCachedGitRepoIndex(
  entries: CachedGitRepoIndexEntry[],
): Promise<void> {
  const registryPath = getSkillRepoRegistryPath()
  await fs.mkdir(path.dirname(registryPath), { recursive: true })
  await fs.writeFile(
    registryPath,
    `${JSON.stringify(entries, null, 2)}\n`,
    'utf-8',
  )
}

async function upsertCachedGitRepoIndexEntry(
  repoUrl: string,
  ref: string | undefined,
  cacheDir: string,
): Promise<CachedGitRepoIndexEntry> {
  const id = buildCachedRepoId(repoUrl, ref)
  const entries = await readCachedGitRepoIndex()
  const nextEntry: CachedGitRepoIndexEntry = {
    id,
    repoUrl,
    ...(ref ? { ref } : {}),
    cacheDir,
    addedAt:
      entries.find((entry) => entry.id === id)?.addedAt ?? new Date().toISOString(),
  }
  const remainingEntries = entries.filter((entry) => entry.id !== id)
  await writeCachedGitRepoIndex([...remainingEntries, nextEntry])
  return nextEntry
}

async function ensureCachedGitRepo(repoUrl: string, ref?: string): Promise<string> {
  const cacheDir = getCachedRepoDirectory(repoUrl, ref)
  const gitDir = path.join(cacheDir, '.git')

  let hasExistingClone = false
  try {
    const gitDirStat = await fs.stat(gitDir)
    hasExistingClone = gitDirStat.isDirectory()
  } catch {
    hasExistingClone = false
  }

  if (!hasExistingClone) {
    await fs.rm(cacheDir, { recursive: true, force: true })
    await fs.mkdir(path.dirname(cacheDir), { recursive: true })
    const cloneResult = await execFileNoThrowWithCwd(gitExe(), ['clone', repoUrl, cacheDir], {
      cwd: path.dirname(cacheDir),
      timeout: GIT_OPERATION_TIMEOUT_MS,
      preserveOutputOnError: true,
    })
    if (cloneResult.code !== 0) {
      await fs.rm(cacheDir, { recursive: true, force: true })
      const details =
        cloneResult.stderr ||
        cloneResult.stdout ||
        cloneResult.error ||
        'unknown git clone error'
      throw ApiError.badRequest(`Failed to clone skill repository: ${details.trim()}`)
    }
  } else {
    await runGitCommand(cacheDir, ['fetch', '--all', '--tags', '--prune'], 'Failed to refresh skill repository cache')
  }

  if (ref) {
    await runGitCommand(cacheDir, ['checkout', ref], `Failed to checkout ref "${ref}"`)
  } else if (hasExistingClone) {
    const pullResult = await execFileNoThrowWithCwd(gitExe(), ['pull', '--ff-only'], {
      cwd: cacheDir,
      timeout: GIT_OPERATION_TIMEOUT_MS,
      preserveOutputOnError: true,
    })
    if (pullResult.code !== 0) {
      const details = pullResult.stderr || pullResult.stdout || pullResult.error || ''
      if (!details.includes('There is no tracking information for the current branch')) {
        throw ApiError.badRequest(`Failed to update skill repository cache: ${details.trim()}`)
      }
    }
  }

  await upsertCachedGitRepoIndexEntry(repoUrl, ref, cacheDir)
  return cacheDir
}

async function resolveGitSkillDirectory(
  repoUrl: string,
  ref?: string,
  skillPath?: string,
): Promise<{ skillDir: string; skillName: string }> {
  const cacheDir = await ensureCachedGitRepo(repoUrl, ref)
  const repoName = path
    .basename(repoUrl.replace(/[\\/]+$/, ''))
    .replace(/\.git$/i, '')

  if (skillPath) {
    const resolvedSkillPath = resolveSkillSourcePath(skillPath, cacheDir)
    const relativeToRepo = path.relative(cacheDir, resolvedSkillPath)
    if (
      relativeToRepo.startsWith('..') ||
      path.isAbsolute(relativeToRepo)
    ) {
      throw ApiError.badRequest('skillPath must stay within the cloned repository')
    }
    return {
      skillDir: resolvedSkillPath,
      skillName: path.basename(resolvedSkillPath),
    }
  }

  const rootSkillFile = path.join(cacheDir, 'SKILL.md')
  try {
    const rootSkillStat = await fs.stat(rootSkillFile)
    if (rootSkillStat.isFile()) {
      return {
        skillDir: cacheDir,
        skillName: repoName || 'repo-skill',
      }
    }
  } catch {
    // fall through
  }

  const nestedSkillsRoot = path.join(cacheDir, 'skills')
  try {
    const entries = await fs.readdir(nestedSkillsRoot, { withFileTypes: true })
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map(async (entry) => {
          const candidateDir = path.join(nestedSkillsRoot, entry.name)
          try {
            const skillFileStat = await fs.stat(path.join(candidateDir, 'SKILL.md'))
            return skillFileStat.isFile()
              ? { skillDir: candidateDir, skillName: path.basename(candidateDir) }
              : null
          } catch {
            return null
          }
        }),
    )
    const validCandidates = candidates.filter(
      (candidate): candidate is { skillDir: string; skillName: string } =>
        candidate !== null,
    )
    if (validCandidates.length === 1) {
      return validCandidates[0]
    }
  } catch {
    // fall through
  }

  throw ApiError.badRequest(
    'Repository does not expose a single installable skill automatically. Provide skillPath or use a repo whose root contains SKILL.md.',
  )
}

async function collectCachedGitRepoSkills(
  entry: CachedGitRepoIndexEntry,
  cwd: string,
): Promise<CachedGitSkill[]> {
  const repoName = path
    .basename(entry.repoUrl.replace(/[\\/]+$/, ''))
    .replace(/\.git$/i, '')
  const skills: CachedGitSkill[] = []

  const rootSkillFile = path.join(entry.cacheDir, 'SKILL.md')
  try {
    const rootSkillStat = await fs.stat(rootSkillFile)
    if (rootSkillStat.isFile()) {
      const rootMeta = await loadSkillMeta(entry.cacheDir, repoName || 'repo-skill', 'user')
      if (rootMeta) {
        skills.push({
          name: rootMeta.name,
          displayName: rootMeta.displayName,
          description: rootMeta.description,
          version: rootMeta.version,
          installedInUser: (await resolveSkillDir('user', rootMeta.name, cwd)) !== null,
          installedInProject: (await resolveSkillDir('project', rootMeta.name, cwd)) !== null,
        })
      }
    }
  } catch {
    // ignore missing root skill
  }

  const nestedSkillsRoot = path.join(entry.cacheDir, 'skills')
  try {
    const entries = await fs.readdir(nestedSkillsRoot, { withFileTypes: true })
    for (const candidate of entries) {
      if (!candidate.isDirectory() && !candidate.isSymbolicLink()) continue
      const candidateDir = path.join(nestedSkillsRoot, candidate.name)
      const candidateMeta = await loadSkillMeta(candidateDir, candidate.name, 'user')
      if (!candidateMeta) continue
      skills.push({
        name: candidateMeta.name,
        displayName: candidateMeta.displayName,
        description: candidateMeta.description,
        version: candidateMeta.version,
        skillPath: path.relative(entry.cacheDir, candidateDir).replaceAll('\\', '/'),
        installedInUser: (await resolveSkillDir('user', candidateMeta.name, cwd)) !== null,
        installedInProject: (await resolveSkillDir('project', candidateMeta.name, cwd)) !== null,
      })
    }
  } catch {
    // ignore missing nested skills
  }

  return skills.sort((a, b) => {
    const pathA = a.skillPath ?? ''
    const pathB = b.skillPath ?? ''
    return pathA.localeCompare(pathB) || a.name.localeCompare(b.name)
  })
}

async function listCachedGitRepoRecords(cwd: string): Promise<CachedGitRepoRecord[]> {
  const entries = await readCachedGitRepoIndex()
  const records = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      skills: await collectCachedGitRepoSkills(entry, cwd),
    })),
  )

  return records.sort((a, b) => b.addedAt.localeCompare(a.addedAt))
}

async function assertInstallableSkillDirectory(skillDir: string): Promise<string> {
  let stat: import('fs').Stats
  try {
    stat = await fs.stat(skillDir)
  } catch {
    throw ApiError.badRequest(`Skill directory not found: ${skillDir}`)
  }

  if (!stat.isDirectory()) {
    throw ApiError.badRequest(`Skill path is not a directory: ${skillDir}`)
  }

  const skillName = path.basename(skillDir)
  if (!skillName || skillName.startsWith('.')) {
    throw ApiError.badRequest('Skill directory name is invalid')
  }

  const skillFile = path.join(skillDir, 'SKILL.md')
  try {
    const skillFileStat = await fs.stat(skillFile)
    if (!skillFileStat.isFile()) {
      throw new Error('not a file')
    }
  } catch {
    throw ApiError.badRequest(`Skill directory is missing SKILL.md: ${skillDir}`)
  }

  return skillName
}

async function loadSkillMetaForInstall(
  skillDir: string,
  source: InstallSkillScope,
): Promise<SkillMeta> {
  const skillName = await assertInstallableSkillDirectory(skillDir)
  const meta = await loadSkillMeta(skillDir, skillName, source)
  if (!meta) {
    throw ApiError.badRequest(`Failed to load skill metadata from: ${skillDir}`)
  }
  return meta
}

function annotateSkillMeta(meta: SkillMeta): SkillMeta {
  if (meta.source !== 'user' && meta.source !== 'project') {
    return {
      ...meta,
      canDelete: false,
    }
  }

  return {
    ...meta,
    canDelete: true,
  }
}

async function loadSkillMeta(
  skillDir: string,
  skillName: string,
  source: SkillSource,
  pluginName?: string,
): Promise<SkillMeta | null> {
  const skillFile = path.join(skillDir, 'SKILL.md')
  try {
    const raw = await fs.readFile(skillFile, 'utf-8')
    const { frontmatter, body } = normalizeFrontmatter(raw, skillFile)

    const description =
      (frontmatter.description as string) ||
      body
        .split('\n')
        .find((l) => l.trim().length > 0)
        ?.trim() ||
      'No description'

    return {
      name: skillName,
      displayName: (frontmatter.name as string) || undefined,
      description,
      source,
      userInvocable: frontmatter['user-invocable'] !== false,
      version: frontmatter.version != null ? String(frontmatter.version) : undefined,
      contentLength: raw.length,
      hasDirectory: true,
      pluginName,
    }
  } catch {
    return null
  }
}

async function buildFileTree(
  dirPath: string,
): Promise<{ tree: FileTreeNode[]; files: SkillFile[] }> {
  const tree: FileTreeNode[] = []
  const files: SkillFile[] = []
  let fileCount = 0

  async function walk(currentPath: string, nodes: FileTreeNode[]) {
    if (fileCount >= MAX_FILES) return

    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true })
    } catch {
      return
    }

    // directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (fileCount >= MAX_FILES) break
      if (SKIP_ENTRIES.has(entry.name) || entry.name.startsWith('.')) continue

      const fullPath = path.join(currentPath, entry.name)
      const relPath = path.relative(dirPath, fullPath)

      if (entry.isDirectory()) {
        const node: FileTreeNode = {
          name: entry.name,
          path: relPath,
          type: 'directory',
          children: [],
        }
        nodes.push(node)
        await walk(fullPath, node.children!)
        if (node.children!.length === 0) delete node.children
      } else if (entry.isFile()) {
        nodes.push({ name: entry.name, path: relPath, type: 'file' })

        try {
          const stat = await fs.stat(fullPath)
          if (stat.size <= MAX_FILE_SIZE) {
            const content = await fs.readFile(fullPath, 'utf-8')
            const language = detectLanguage(entry.name)
            const isEntry = relPath === 'SKILL.md'

            if (isEntry && language === 'markdown') {
              const { frontmatter, body } = normalizeFrontmatter(content, fullPath)
              files.push({
                path: relPath,
                content: body,
                body,
                frontmatter,
                language,
                isEntry: true,
              })
            } else {
              files.push({
                path: relPath,
                content,
                language,
                isEntry: false,
              })
            }
            fileCount++
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await walk(dirPath, tree)
  return { tree, files }
}

async function collectSkillsFromRoots(
  skillRoots: string[],
  source: SkillSource,
  cwd: string,
): Promise<SkillMeta[]> {
  const skills: SkillMeta[] = []
  const seenNames = new Set<string>()

  for (const root of skillRoots) {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (
        (!entry.isDirectory() && !entry.isSymbolicLink()) ||
        entry.name.startsWith('.') ||
        seenNames.has(entry.name)
      ) {
        continue
      }

      const meta = await loadSkillMeta(path.join(root, entry.name), entry.name, source)
      if (!meta) continue

      seenNames.add(entry.name)
      skills.push(annotateSkillMeta(meta))
    }
  }

  return skills
}

async function resolveSkillDir(
  source: SkillSource,
  name: string,
  cwd: string,
): Promise<string | null> {
  const skillRoots =
    source === 'user'
      ? [getUserSkillsDir()]
      : source === 'project'
        ? getProjectSkillsDirs(cwd)
        : []

  for (const root of skillRoots) {
    const skillDir = path.join(root, name)
    try {
      const stat = await fs.stat(skillDir)
      if (stat.isDirectory()) {
        return skillDir
      }
    } catch {
      // Try the next candidate root.
    }
  }

  return null
}

type PluginSkillLocation = {
  skillDir: string
  pluginName: string
}

export type SkillSlashCommand = {
  name: string
  description: string
  argumentHint?: string
}

async function collectLegacySlashCommands(cwd: string): Promise<SkillSlashCommand[]> {
  const commands = await getSkillDirCommands(cwd)
  return commands
    .filter((command) =>
      command.type === 'prompt' &&
      command.loadedFrom === 'commands_DEPRECATED' &&
      command.userInvocable !== false &&
      !command.isHidden)
    .map((command) => ({
      name: command.name,
      description: command.description || '',
      ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
    }))
}

function buildPluginSkillName(pluginName: string, skillDir: string): string {
  return `${pluginName}:${path.basename(skillDir)}`
}

async function collectPluginSkillDirectories(): Promise<Map<string, PluginSkillLocation>> {
  const locations = new Map<string, PluginSkillLocation>()

  let enabledPlugins: LoadedPlugin[]
  try {
    resetSettingsCache()
    clearInstalledPluginsCache()
    clearPluginCache('skills-api-external-plugin-state')

    const result = await loadAllPluginsCacheOnly()
    if (result.errors.some((error) => error.type === 'plugin-cache-miss')) {
      enabledPlugins = (await loadAllPlugins()).enabled
    } else {
      enabledPlugins = result.enabled
    }
  } catch {
    return locations
  }

  for (const plugin of enabledPlugins) {
    const candidateRoots = [plugin.skillsPath, ...(plugin.skillsPaths ?? [])]

    for (const root of candidateRoots) {
      if (!root) continue

      const directSkillFile = path.join(root, 'SKILL.md')
      try {
        const stat = await fs.stat(directSkillFile)
        if (stat.isFile()) {
          const name = buildPluginSkillName(plugin.name, root)
          if (!locations.has(name)) {
            locations.set(name, { skillDir: root, pluginName: plugin.name })
          }
          continue
        }
      } catch {
        // Fall through and inspect as a skills root.
      }

      let entries: import('fs').Dirent[]
      try {
        entries = await fs.readdir(root, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue

        const skillDir = path.join(root, entry.name)
        const skillFile = path.join(skillDir, 'SKILL.md')
        try {
          const stat = await fs.stat(skillFile)
          if (!stat.isFile()) continue
        } catch {
          continue
        }

        const name = buildPluginSkillName(plugin.name, skillDir)
        if (!locations.has(name)) {
          locations.set(name, { skillDir, pluginName: plugin.name })
        }
      }
    }
  }

  return locations
}

async function collectPluginSkills(cwd: string): Promise<SkillMeta[]> {
  const locations = await collectPluginSkillDirectories()
  const skills: SkillMeta[] = []

  for (const [name, location] of locations) {
    const meta = await loadSkillMeta(
      location.skillDir,
      name,
      'plugin',
      location.pluginName,
    )
    if (meta) {
      skills.push(annotateSkillMeta(meta))
    }
  }

  return skills
}

async function collectAllSkills(cwd?: string): Promise<SkillMeta[]> {
  const requestedCwd = cwd || getCwd()
  const [userSkills, projectSkills, pluginSkills] = await Promise.all([
    collectSkillsFromRoots([getUserSkillsDir()], 'user', requestedCwd),
    collectSkillsFromRoots(getProjectSkillsDirs(requestedCwd), 'project', requestedCwd),
    collectPluginSkills(requestedCwd),
  ])

  const skills = [...userSkills, ...projectSkills, ...pluginSkills]
  skills.sort((a, b) => a.name.localeCompare(b.name))
  return skills
}

export async function listSkillSlashCommands(cwd?: string): Promise<SkillSlashCommand[]> {
  const requestedCwd = cwd || getCwd()
  const [skills, legacyCommands] = await Promise.all([
    collectAllSkills(requestedCwd),
    collectLegacySlashCommands(requestedCwd),
  ])

  const byName = new Map<string, SkillSlashCommand>()

  for (const skill of skills) {
    if (!skill.userInvocable) continue
    byName.set(skill.name, {
      name: skill.name,
      description: skill.description || '',
    })
  }

  for (const command of legacyCommands) {
    if (!byName.has(command.name)) {
      byName.set(command.name, command)
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ─── Router ──────────────────────────────────────────────────────────────────

export async function handleSkillsApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const sub = segments[2]

    if (req.method === 'GET') {
      switch (sub) {
        case undefined:
          return await listSkills(url)
        case 'detail':
          return await getSkillDetail(url)
        case 'git-cache':
          return await getCachedGitRepos(url)
        default:
          throw ApiError.notFound(`Unknown skills endpoint: ${sub}`)
      }
    }

    if (req.method === 'POST') {
      switch (sub) {
        case 'install':
          return await installSkill(req, url)
        case 'git-cache':
          return await addCachedGitRepo(req, url)
        default:
          throw ApiError.notFound(`Unknown skills endpoint: ${sub}`)
      }
    }

    if (req.method === 'DELETE') {
      switch (sub) {
        case undefined:
          return await deleteSkill(url)
        default:
          throw ApiError.notFound(`Unknown skills endpoint: ${sub}`)
      }
    }

    throw new ApiError(405, `Method ${req.method} not allowed`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    return errorResponse(error)
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function coerceInstallMode(value: unknown): InstallSkillMode {
  if (value === undefined || value === 'directory') {
    return 'directory'
  }
  if (value === 'git') {
    return 'git'
  }

  throw ApiError.badRequest('Invalid "mode". Expected one of: directory, git')
}

function coerceInstallScope(value: unknown): InstallSkillScope {
  if (value === 'user' || value === 'project') {
    return value
  }

  throw ApiError.badRequest('Invalid "scope". Expected one of: user, project')
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function listSkills(url: URL): Promise<Response> {
  const cwd = getRequestedCwd(url)
  const skills = await collectAllSkills(cwd)
  return Response.json({ skills })
}

async function getCachedGitRepos(url: URL): Promise<Response> {
  const cwd = getRequestedCwd(url)
  const records = await listCachedGitRepoRecords(cwd)
  return Response.json({ records })
}

async function addCachedGitRepo(req: Request, url: URL): Promise<Response> {
  const body = await parseJsonBody(req)
  const repoUrl = asString(body.repoUrl)
  if (!repoUrl) {
    throw ApiError.badRequest('Missing or invalid "repoUrl" in request body')
  }

  const ref = asString(body.ref)
  const cwd = asString(body.cwd) || getRequestedCwd(url)
  const cacheDir = await ensureCachedGitRepo(repoUrl, ref)
  const entry = await upsertCachedGitRepoIndexEntry(repoUrl, ref, cacheDir)
  const record: CachedGitRepoRecord = {
    ...entry,
    skills: await collectCachedGitRepoSkills(entry, cwd),
  }

  return Response.json({
    ok: true,
    message: `Cached ${repoUrl}`,
    record,
  })
}

async function installSkill(req: Request, url: URL): Promise<Response> {
  const body = await parseJsonBody(req)
  const mode = coerceInstallMode(body.mode)
  const scope = coerceInstallScope(body.scope)
  const cwd = asString(body.cwd) || getRequestedCwd(url)

  let resolvedSourcePath: string
  let sourceSkillName: string | null = null
  if (mode === 'git') {
    const repoUrl = asString(body.repoUrl)
    if (!repoUrl) {
      throw ApiError.badRequest('Missing or invalid "repoUrl" in request body')
    }
    const gitSkill = await resolveGitSkillDirectory(
      repoUrl,
      asString(body.ref),
      asString(body.skillPath),
    )
    resolvedSourcePath = gitSkill.skillDir
    sourceSkillName = gitSkill.skillName
  } else {
    const sourcePath = asString(body.path)
    if (!sourcePath) {
      throw ApiError.badRequest('Missing or invalid "path" in request body')
    }
    resolvedSourcePath = resolveSkillSourcePath(sourcePath, cwd)
  }

  await assertInstallableSkillDirectory(resolvedSourcePath)
  const finalSkillName = sourceSkillName ?? path.basename(resolvedSourcePath)
  const installRoot = scope === 'user' ? getUserSkillsDir() : getProjectInstallRoot(cwd)
  const targetDir = path.join(installRoot, finalSkillName)

  try {
    await fs.lstat(targetDir)
    throw ApiError.badRequest(`Skill already exists at target: ${targetDir}`)
  } catch (error) {
    if (!(error instanceof ApiError)) {
      const errno = error as NodeJS.ErrnoException
      if (errno.code !== 'ENOENT') {
        throw error
      }
    } else {
      throw error
    }
  }

  const resolvedTargetParent = path.dirname(targetDir)
  await fs.mkdir(resolvedTargetParent, { recursive: true })

  try {
    await fs.symlink(
      resolvedSourcePath,
      targetDir,
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  } catch (error) {
    throw ApiError.internal(
      `Failed to install skill into ${scope} scope: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  clearCommandsCache()

  const skill = await loadSkillMetaForInstall(targetDir, scope)
  return Response.json({
    ok: true,
    message:
      scope === 'user'
        ? `Installed ${skill.name} to user skills`
        : `Installed ${skill.name} to project skills`,
    skill: annotateSkillMeta(skill),
  })
}

async function deleteSkill(url: URL): Promise<Response> {
  const sourceParam = url.searchParams.get('source')
  const source = sourceParam === 'user' || sourceParam === 'project'
    ? sourceParam
    : (() => {
        throw ApiError.badRequest('Invalid "source". Expected one of: user, project')
      })()
  const name = asString(url.searchParams.get('name'))
  const cwd = getRequestedCwd(url)

  if (!name) {
    throw ApiError.badRequest('Missing required query parameter: name')
  }

  const skillDir = await resolveSkillDir(source, name, cwd)
  if (!skillDir) {
    throw ApiError.notFound(`Skill not found: ${name}`)
  }

  let stat: import('fs').Stats
  try {
    stat = await fs.lstat(skillDir)
  } catch {
    throw ApiError.notFound(`Skill not found: ${name}`)
  }

  if (stat.isSymbolicLink()) {
    await fs.unlink(skillDir)
  } else {
    await fs.rm(skillDir, { recursive: true, force: true })
  }

  clearCommandsCache()

  return Response.json({
    ok: true,
    message:
      source === 'user'
        ? `Deleted ${name} from user skills`
        : `Deleted ${name} from project skills`,
  })
}

async function getSkillDetail(url: URL): Promise<Response> {
  const source = url.searchParams.get('source')
  const name = url.searchParams.get('name')

  if (!source || !name) {
    throw ApiError.badRequest('Missing required query parameters: source, name')
  }

  // Prevent path traversal
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw ApiError.badRequest('Invalid skill name')
  }

  if (source !== 'user' && source !== 'project' && source !== 'plugin') {
    throw ApiError.badRequest(`Unsupported source: ${source}`)
  }

  const cwd = getRequestedCwd(url)
  const pluginLocations =
    source === 'plugin' ? await collectPluginSkillDirectories() : null

  const pluginLocation = pluginLocations?.get(name)
  const skillDir =
    source === 'plugin'
      ? pluginLocation?.skillDir ?? null
      : await resolveSkillDir(source, name, cwd)

  if (!skillDir) {
    throw ApiError.notFound(`Skill not found: ${name}`)
  }

  const meta = await loadSkillMeta(
    skillDir,
    name,
    source,
    pluginLocation?.pluginName,
  )
  if (!meta) {
    throw ApiError.notFound(`Skill missing SKILL.md: ${name}`)
  }

  const { tree, files } = await buildFileTree(skillDir)

  return Response.json({
    detail: { meta: annotateSkillMeta(meta), tree, files, skillRoot: skillDir },
  })
}
