import { api } from './client'
import type { SkillMeta, SkillDetail, SkillListRoots } from '../types/skill'

type SkillInstallScope = 'user' | 'project'

type ToggleableSkillSource = 'user' | 'project'

export type CachedGitSkill = {
  name: string
  displayName?: string
  description: string
  version?: string
  skillPath?: string
  installedInUser: boolean
  installedInProject: boolean
}

export type CachedGitRepoRecord = {
  id: string
  repoUrl: string
  ref?: string
  cacheDir: string
  addedAt: string
  skills: CachedGitSkill[]
}

export type SkillInstallPayload =
  | {
      mode?: 'directory'
      path: string
      scope: SkillInstallScope
      cwd?: string
    }
  | {
      mode: 'git'
      repoUrl: string
      ref?: string
      skillPath?: string
      scope: SkillInstallScope
      cwd?: string
    }

export type AddCachedGitRepoPayload = {
  repoUrl: string
  ref?: string
  cwd?: string
}

export const skillsApi = {
  list: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<{ skills: SkillMeta[]; roots: SkillListRoots }>(`/api/skills${query}`, { timeout: 120_000 })
  },

  detail: (source: string, name: string, cwd?: string) => {
    const query = new URLSearchParams({
      source,
      name,
    })
    if (cwd) query.set('cwd', cwd)

    return api.get<{ detail: SkillDetail }>(
      `/api/skills/detail?${query.toString()}`,
      { timeout: 120_000 },
    )
  },

  install: (payload: SkillInstallPayload) =>
    api.post<{ ok: true; message: string; skill: SkillMeta }>('/api/skills/install', payload, {
      timeout: 120_000,
    }),

  listCachedGitRepos: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<{ records: CachedGitRepoRecord[] }>(
      `/api/skills/git-cache${query}`,
      { timeout: 120_000 },
    )
  },

  addCachedGitRepo: (payload: AddCachedGitRepoPayload) =>
    api.post<{ ok: true; message: string; record: CachedGitRepoRecord }>(
      '/api/skills/git-cache',
      payload,
      { timeout: 120_000 },
    ),

  remove: (source: ToggleableSkillSource, name: string, cwd?: string) => {
    const query = new URLSearchParams({ source, name })
    if (cwd) query.set('cwd', cwd)
    return api.delete<{ ok: true; message: string }>(`/api/skills?${query.toString()}`)
  },
}
