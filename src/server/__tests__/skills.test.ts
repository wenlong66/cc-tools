import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { getCwdState, setCwdState } from '../../bootstrap/state.js'
import { clearInstalledPluginsCache } from '../../utils/plugins/installedPluginsManager.js'
import { clearPluginCache } from '../../utils/plugins/pluginLoader.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { handlePluginsApi } from '../api/plugins.js'
import { handleSkillsApi } from '../api/skills.js'

let tmpHome: string
let originalHome: string | undefined
let originalUserProfile: string | undefined
let originalClaudeConfigDir: string | undefined
let originalCwdState: string

function makeRequest(urlStr: string): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const req = new Request(url.toString(), { method: 'GET' })
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

function makePluginReloadRequest(): { req: Request; url: URL; segments: string[] } {
  const url = new URL('/api/plugins/reload', 'http://localhost:3456')
  const req = new Request(url.toString(), { method: 'POST' })
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

type SkillInstallRequestBody =
  | {
      mode?: 'directory'
      path: string
      scope: 'user' | 'project'
      cwd?: string
    }
  | {
      mode: 'git'
      repoUrl: string
      ref?: string
      skillPath?: string
      scope: 'user' | 'project'
      cwd?: string
    }

function makeSkillInstallRequest(body: SkillInstallRequestBody): {
  req: Request
  url: URL
  segments: string[]
} {
  const url = new URL('/api/skills/install', 'http://localhost:3456')
  const req = new Request(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

function makeSkillDeleteRequest(query: {
  source: 'user' | 'project'
  name: string
  cwd?: string
}): { req: Request; url: URL; segments: string[] } {
  const url = new URL('/api/skills', 'http://localhost:3456')
  url.searchParams.set('source', query.source)
  url.searchParams.set('name', query.name)
  if (query.cwd) {
    url.searchParams.set('cwd', query.cwd)
  }
  const req = new Request(url.toString(), { method: 'DELETE' })
  return {
    req,
    url,
    segments: url.pathname.split('/').filter(Boolean),
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
  })
}

async function writeSkill(root: string, skillName: string, content: string): Promise<void> {
  const skillDir = path.join(root, skillName)
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8')
}

async function createSkillRepo(baseDir: string, repoName: string): Promise<string> {
  const repoDir = path.join(baseDir, repoName)
  await fs.mkdir(repoDir, { recursive: true })
  git(repoDir, 'init')
  git(repoDir, 'config', 'user.email', 'skills@example.com')
  git(repoDir, 'config', 'user.name', 'Skills Test')
  return repoDir
}

describe('Skills API', () => {
  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-skills-test-'))
    originalHome = process.env.HOME
    originalUserProfile = process.env.USERPROFILE
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalCwdState = getCwdState()

    process.env.HOME = tmpHome
    process.env.USERPROFILE = tmpHome
    process.env.CLAUDE_CONFIG_DIR = path.join(tmpHome, '.cc-tools')
    setCwdState(tmpHome)
    clearInstalledPluginsCache()
    clearPluginCache('skills-api-test-setup')
    resetSettingsCache()
  })

  afterEach(async () => {
    clearInstalledPluginsCache()
    clearPluginCache('skills-api-test-teardown')
    resetSettingsCache()
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = originalUserProfile
    }

    if (originalClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
    }

    setCwdState(originalCwdState)
    await fs.rm(tmpHome, { recursive: true, force: true })
  })

  it('lists user and project skills for the requested cwd', async () => {
    const userSkillsRoot = path.join(tmpHome, '.cc-tools', 'skills')
    const projectRoot = path.join(tmpHome, 'workspace')
    const cwd = path.join(projectRoot, 'packages', 'app')

    await writeSkill(
      userSkillsRoot,
      'user-skill',
      ['---', 'description: User scope', '---', '', '# User skill'].join('\n'),
    )
    await writeSkill(
      path.join(projectRoot, '.cc-tools', 'skills'),
      'project-skill',
      ['---', 'description: Project scope', '---', '', '# Project skill'].join('\n'),
    )

    const { req, url, segments } = makeRequest(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
    const res = await handleSkillsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as { skills: Array<{ name: string; source: string }> }
    expect(body.skills).toContainEqual(expect.objectContaining({ name: 'user-skill', source: 'user' }))
    expect(body.skills).toContainEqual(expect.objectContaining({ name: 'project-skill', source: 'project' }))
  })

  it('lists user skills installed through a directory symlink or junction', async () => {
    const linkedSkillsRoot = path.join(tmpHome, '.agents', 'skills')
    const userSkillsRoot = path.join(tmpHome, '.cc-tools', 'skills')
    const projectRoot = path.join(tmpHome, 'workspace')
    const cwd = path.join(projectRoot, 'packages', 'app')

    await writeSkill(
      linkedSkillsRoot,
      'linked-skill',
      ['---', 'description: Linked skill', '---', '', '# Linked skill'].join('\n'),
    )
    await fs.mkdir(userSkillsRoot, { recursive: true })
    await fs.symlink(
      path.join(linkedSkillsRoot, 'linked-skill'),
      path.join(userSkillsRoot, 'linked-skill'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    const { req, url, segments } = makeRequest(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
    const res = await handleSkillsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as { skills: Array<{ name: string; source: string }> }
    expect(body.skills).toContainEqual(expect.objectContaining({ name: 'linked-skill', source: 'user' }))
  })

  it('resolves project skill details from the nearest project skills directory', async () => {
    const projectRoot = path.join(tmpHome, 'workspace')
    const nestedRoot = path.join(projectRoot, 'packages', 'app')
    const nestedSkillsRoot = path.join(nestedRoot, '.cc-tools', 'skills')
    const parentSkillsRoot = path.join(projectRoot, '.cc-tools', 'skills')

    await writeSkill(
      parentSkillsRoot,
      'shared-skill',
      ['---', 'description: Parent version', '---', '', 'parent body'].join('\n'),
    )
    await writeSkill(
      nestedSkillsRoot,
      'shared-skill',
      ['---', 'description: Child version', '---', '', 'child body'].join('\n'),
    )

    const { req, url, segments } = makeRequest(
      `/api/skills/detail?source=project&name=shared-skill&cwd=${encodeURIComponent(nestedRoot)}`,
    )
    const res = await handleSkillsApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = await res.json() as {
      detail: { meta: { description: string }; skillRoot: string; files: Array<{ path: string; body?: string }> }
    }

    expect(body.detail.meta.description).toBe('Child version')
    expect(body.detail.skillRoot).toBe(path.join(nestedSkillsRoot, 'shared-skill'))
    expect(body.detail.files).toContainEqual(
      expect.objectContaining({ path: 'SKILL.md', body: 'child body' }),
    )
  })

  it('installs an existing skill directory into user scope', async () => {
    const importRoot = path.join(tmpHome, 'imports')
    const projectRoot = path.join(tmpHome, 'workspace')
    const cwd = path.join(projectRoot, 'packages', 'app')

    await writeSkill(
      importRoot,
      'alpha-skill',
      ['---', 'description: Imported into user scope', '---', '', '# Alpha'].join('\n'),
    )

    const install = makeSkillInstallRequest({
      path: path.join(importRoot, 'alpha-skill'),
      scope: 'user',
      cwd,
    })
    const installRes = await handleSkillsApi(install.req, install.url, install.segments)

    expect(installRes.status).toBe(200)
    const installedDir = path.join(tmpHome, '.cc-tools', 'skills', 'alpha-skill')
    const installedStat = await fs.lstat(installedDir)
    expect(installedStat.isSymbolicLink()).toBe(true)

    const after = makeRequest(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
    const afterRes = await handleSkillsApi(after.req, after.url, after.segments)
    const afterBody = await afterRes.json() as {
      skills: Array<{ name: string; source: string; description: string }>
    }

    expect(afterBody.skills).toContainEqual(
      expect.objectContaining({
        name: 'alpha-skill',
        source: 'user',
        description: 'Imported into user scope',
      }),
    )
  })

  it('installs an existing skill directory into the project root for the requested cwd', async () => {
    const importRoot = path.join(tmpHome, 'imports')
    const projectRoot = path.join(tmpHome, 'workspace')
    const cwd = path.join(projectRoot, 'packages', 'app')

    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })
    await writeSkill(
      importRoot,
      'project-only-skill',
      ['---', 'description: Imported into project scope', '---', '', '# Project only'].join('\n'),
    )

    const install = makeSkillInstallRequest({
      path: path.join(importRoot, 'project-only-skill'),
      scope: 'project',
      cwd,
    })
    const installRes = await handleSkillsApi(install.req, install.url, install.segments)

    expect(installRes.status).toBe(200)
    const installedDir = path.join(
      projectRoot,
      '.cc-tools',
      'skills',
      'project-only-skill',
    )
    const installedStat = await fs.lstat(installedDir)
    expect(installedStat.isSymbolicLink()).toBe(true)

    const after = makeRequest(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
    const afterRes = await handleSkillsApi(after.req, after.url, after.segments)
    const afterBody = await afterRes.json() as {
      skills: Array<{ name: string; source: string; description: string }>
    }

    expect(afterBody.skills).toContainEqual(
      expect.objectContaining({
        name: 'project-only-skill',
        source: 'project',
        description: 'Imported into project scope',
      }),
    )
  })

  it('caches a git repo and lists its installable skills', async () => {
    const reposRoot = path.join(tmpHome, 'repos')
    const cwd = path.join(tmpHome, 'workspace')
    const repoDir = await createSkillRepo(reposRoot, 'git-root-skill')

    await fs.writeFile(
      path.join(repoDir, 'SKILL.md'),
      ['---', 'description: Git root skill', '---', '', '# Git root'].join('\n'),
      'utf-8',
    )
    git(repoDir, 'add', 'SKILL.md')
    git(repoDir, 'commit', '-m', 'root skill')

    const cacheUrl = new URL('/api/skills/git-cache', 'http://localhost:3456')
    const cacheReq = new Request(cacheUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: repoDir, cwd }),
    })
    const cacheRes = await handleSkillsApi(
      cacheReq,
      cacheUrl,
      cacheUrl.pathname.split('/').filter(Boolean),
    )
    expect(cacheRes.status).toBe(200)

    const list = makeRequest(`/api/skills/git-cache?cwd=${encodeURIComponent(cwd)}`)
    const listRes = await handleSkillsApi(list.req, list.url, list.segments)
    expect(listRes.status).toBe(200)
    const listBody = await listRes.json() as {
      records: Array<{ repoUrl: string; skills: Array<{ name: string; description: string }> }>
    }
    expect(listBody.records).toContainEqual(
      expect.objectContaining({
        repoUrl: repoDir,
        skills: expect.arrayContaining([
          expect.objectContaining({
            name: 'git-root-skill',
            description: 'Git root skill',
          }),
        ]),
      }),
    )
  })

  it('clones a git skill repo into cache and installs the root skill into user scope', async () => {
    const reposRoot = path.join(tmpHome, 'repos')
    const projectRoot = path.join(tmpHome, 'workspace')
    const cwd = path.join(projectRoot, 'packages', 'app')
    const repoDir = await createSkillRepo(reposRoot, 'git-root-skill')

    await fs.writeFile(
      path.join(repoDir, 'SKILL.md'),
      ['---', 'description: Git root skill', '---', '', '# Git root'].join('\n'),
      'utf-8',
    )
    git(repoDir, 'add', 'SKILL.md')
    git(repoDir, 'commit', '-m', 'root skill')

    const install = makeSkillInstallRequest({
      mode: 'git',
      repoUrl: repoDir,
      scope: 'user',
      cwd,
    })
    const installRes = await handleSkillsApi(install.req, install.url, install.segments)

    expect(installRes.status).toBe(200)
    const installBody = await installRes.json() as {
      ok: true
      skill: { name: string }
    }
    expect(installBody.skill.name).toBe('git-root-skill')

    const cachedReposDir = path.join(tmpHome, '.cc-tools', 'cache', 'skills', 'repos')
    const cachedEntries = await fs.readdir(cachedReposDir)
    expect(cachedEntries.length).toBeGreaterThan(0)

    const installedDir = path.join(tmpHome, '.cc-tools', 'skills', 'git-root-skill')
    const installedStat = await fs.lstat(installedDir)
    expect(installedStat.isSymbolicLink()).toBe(true)
  })

  it('installs from an existing cached git repo without refreshing it first', async () => {
    const reposRoot = path.join(tmpHome, 'repos')
    const projectRoot = path.join(tmpHome, 'workspace')
    const cwd = path.join(projectRoot, 'packages', 'app')
    const repoDir = await createSkillRepo(reposRoot, 'cached-root-skill')

    await fs.writeFile(
      path.join(repoDir, 'SKILL.md'),
      ['---', 'description: Cached Git root skill', '---', '', '# Cached Git root'].join('\n'),
      'utf-8',
    )
    git(repoDir, 'add', 'SKILL.md')
    git(repoDir, 'commit', '-m', 'root skill')

    const cacheUrl = new URL('/api/skills/git-cache', 'http://localhost:3456')
    const cacheReq = new Request(cacheUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: repoDir, cwd }),
    })
    const cacheRes = await handleSkillsApi(
      cacheReq,
      cacheUrl,
      cacheUrl.pathname.split('/').filter(Boolean),
    )
    expect(cacheRes.status).toBe(200)

    await fs.rm(repoDir, { recursive: true, force: true })

    const install = makeSkillInstallRequest({
      mode: 'git',
      repoUrl: repoDir,
      scope: 'user',
      cwd,
    })
    const installRes = await handleSkillsApi(install.req, install.url, install.segments)

    expect(installRes.status).toBe(200)
    const installBody = await installRes.json() as {
      ok: true
      skill: { name: string }
    }
    expect(installBody.skill.name).toBe('cached-root-skill')

    const installedDir = path.join(tmpHome, '.cc-tools', 'skills', 'cached-root-skill')
    const installedStat = await fs.lstat(installedDir)
    expect(installedStat.isSymbolicLink()).toBe(true)
  })

  it('clones a git repo and installs a nested skill path into project scope', async () => {
    const reposRoot = path.join(tmpHome, 'repos')
    const projectRoot = path.join(tmpHome, 'workspace')
    const cwd = path.join(projectRoot, 'packages', 'app')
    const repoDir = await createSkillRepo(reposRoot, 'git-nested-skills')

    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })
    await fs.mkdir(path.join(repoDir, 'skills', 'release-helper'), { recursive: true })
    await fs.writeFile(
      path.join(repoDir, 'skills', 'release-helper', 'SKILL.md'),
      ['---', 'description: Nested git skill', '---', '', '# Release helper'].join('\n'),
      'utf-8',
    )
    git(repoDir, 'add', 'skills/release-helper/SKILL.md')
    git(repoDir, 'commit', '-m', 'nested skill')

    const install = makeSkillInstallRequest({
      mode: 'git',
      repoUrl: repoDir,
      skillPath: 'skills/release-helper',
      scope: 'project',
      cwd,
    })
    const installRes = await handleSkillsApi(install.req, install.url, install.segments)

    expect(installRes.status).toBe(200)
    const installedDir = path.join(
      projectRoot,
      '.cc-tools',
      'skills',
      'release-helper',
    )
    const installedStat = await fs.lstat(installedDir)
    expect(installedStat.isSymbolicLink()).toBe(true)

    const after = makeRequest(`/api/skills?cwd=${encodeURIComponent(cwd)}`)
    const afterRes = await handleSkillsApi(after.req, after.url, after.segments)
    const afterBody = await afterRes.json() as {
      skills: Array<{ name: string; source: string; description: string }>
    }

    expect(afterBody.skills).toContainEqual(
      expect.objectContaining({
        name: 'release-helper',
        source: 'project',
        description: 'Nested git skill',
      }),
    )
  })

  it('deletes a project skill from the nearest project skills directory', async () => {
    const projectRoot = path.join(tmpHome, 'workspace')
    const cwd = path.join(projectRoot, 'packages', 'app')
    const projectSkillsRoot = path.join(projectRoot, '.cc-tools', 'skills')

    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true })
    await fs.mkdir(cwd, { recursive: true })
    await writeSkill(
      projectSkillsRoot,
      'delete-me',
      ['---', 'description: Delete me', '---', '', '# Delete me'].join('\n'),
    )

    const deleteRequest = makeSkillDeleteRequest({
      source: 'project',
      name: 'delete-me',
      cwd,
    })
    const deleteRes = await handleSkillsApi(
      deleteRequest.req,
      deleteRequest.url,
      deleteRequest.segments,
    )
    expect(deleteRes.status).toBe(200)

    await expect(
      fs.lstat(path.join(projectSkillsRoot, 'delete-me')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('lists plugin skills after reload rereads an external enable toggle', async () => {
    const marketplaceRoot = path.join(tmpHome, 'marketplace-root')
    const pluginRoot = path.join(marketplaceRoot, 'plugins', 'draw')
    const pluginsDir = path.join(tmpHome, '.cc-tools', 'plugins')
    const marketplaceFile = path.join(
      marketplaceRoot,
      '.cc-tools-plugin',
      'marketplace.json',
    )

    await fs.mkdir(path.join(pluginRoot, '.cc-tools-plugin'), { recursive: true })
    await fs.mkdir(path.join(pluginRoot, 'skills', 'render'), { recursive: true })
    await fs.mkdir(path.dirname(marketplaceFile), { recursive: true })
    await fs.mkdir(pluginsDir, { recursive: true })

    await fs.writeFile(
      path.join(pluginRoot, '.cc-tools-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'draw',
        version: '1.0.0',
        description: 'Drawing plugin',
      }),
      'utf-8',
    )
    await fs.writeFile(
      path.join(pluginRoot, 'skills', 'render', 'SKILL.md'),
      [
        '---',
        'description: Render with the drawing plugin.',
        '---',
        '',
        '# Render',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      marketplaceFile,
      JSON.stringify({
        name: 'test-market',
        owner: { name: 'Test' },
        plugins: [
          {
            name: 'draw',
            source: './plugins/draw',
            version: '1.0.0',
          },
        ],
      }),
      'utf-8',
    )
    await fs.writeFile(
      path.join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({
        'test-market': {
          source: { source: 'directory', path: marketplaceRoot },
          installLocation: marketplaceRoot,
          lastUpdated: new Date(0).toISOString(),
        },
      }),
      'utf-8',
    )

    const settingsPath = path.join(tmpHome, '.cc-tools', 'settings.json')
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        enabledPlugins: {
          'draw@test-market': false,
        },
      }),
      'utf-8',
    )

    const initial = makeRequest('/api/skills')
    const initialRes = await handleSkillsApi(initial.req, initial.url, initial.segments)
    const initialBody = await initialRes.json() as {
      skills: Array<{ name: string; source: string }>
    }
    expect(initialBody.skills).not.toContainEqual(
      expect.objectContaining({ name: 'draw:render', source: 'plugin' }),
    )

    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        enabledPlugins: {
          'draw@test-market': true,
        },
      }),
      'utf-8',
    )

    const reload = makePluginReloadRequest()
    const reloadRes = await handlePluginsApi(reload.req, reload.url, reload.segments)
    expect(reloadRes.status).toBe(200)

    const after = makeRequest('/api/skills')
    const afterRes = await handleSkillsApi(after.req, after.url, after.segments)
    const afterBody = await afterRes.json() as {
      skills: Array<{ name: string; source: string; description: string }>
    }

    expect(afterBody.skills).toContainEqual(
      expect.objectContaining({
        name: 'draw:render',
        source: 'plugin',
        description: 'Render with the drawing plugin.',
      }),
    )
  })

  it('lists plugin skills after an external CLI install updates portable config on disk', async () => {
    const marketplaceRoot = path.join(tmpHome, 'marketplace-root')
    const pluginRoot = path.join(marketplaceRoot, 'plugins', 'draw')
    const pluginsDir = path.join(tmpHome, '.cc-tools', 'plugins')
    const marketplaceFile = path.join(
      marketplaceRoot,
      '.cc-tools-plugin',
      'marketplace.json',
    )

    await fs.mkdir(path.join(pluginRoot, '.cc-tools-plugin'), { recursive: true })
    await fs.mkdir(path.dirname(marketplaceFile), { recursive: true })
    await fs.mkdir(pluginsDir, { recursive: true })
    await writeSkill(
      path.join(pluginRoot, 'skills'),
      'render',
      ['---', 'description: Render with the drawing plugin.', '---', '', '# Render'].join('\n'),
    )
    await fs.writeFile(
      path.join(pluginRoot, '.cc-tools-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'draw',
        version: '1.0.0',
        description: 'Drawing plugin',
      }),
      'utf-8',
    )
    await fs.writeFile(
      marketplaceFile,
      JSON.stringify({
        name: 'test-market',
        owner: { name: 'Test' },
        plugins: [
          {
            name: 'draw',
            source: './plugins/draw',
            version: '1.0.0',
          },
        ],
      }),
      'utf-8',
    )
    await fs.writeFile(
      path.join(pluginsDir, 'known_marketplaces.json'),
      JSON.stringify({
        'test-market': {
          source: { source: 'directory', path: marketplaceRoot },
          installLocation: marketplaceRoot,
          lastUpdated: new Date(0).toISOString(),
        },
      }),
      'utf-8',
    )

    const settingsPath = path.join(tmpHome, '.cc-tools', 'settings.json')
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        enabledPlugins: {
          'draw@test-market': false,
        },
      }),
      'utf-8',
    )

    const initial = makeRequest('/api/skills')
    const initialRes = await handleSkillsApi(initial.req, initial.url, initial.segments)
    const initialBody = await initialRes.json() as {
      skills: Array<{ name: string; source: string }>
    }
    expect(initialBody.skills).not.toContainEqual(
      expect.objectContaining({ name: 'draw:render', source: 'plugin' }),
    )

    // Simulates the embedded terminal running the CLI against the same
    // CLAUDE_CONFIG_DIR while the desktop server process stays alive.
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        enabledPlugins: {
          'draw@test-market': true,
        },
      }),
      'utf-8',
    )

    const after = makeRequest('/api/skills')
    const afterRes = await handleSkillsApi(after.req, after.url, after.segments)
    const afterBody = await afterRes.json() as {
      skills: Array<{ name: string; source: string; description: string }>
    }

    expect(afterBody.skills).toContainEqual(
      expect.objectContaining({
        name: 'draw:render',
        source: 'plugin',
        description: 'Render with the drawing plugin.',
      }),
    )
  })
})
