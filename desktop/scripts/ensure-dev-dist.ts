#!/usr/bin/env bun

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFilePath = fileURLToPath(import.meta.url)
const desktopDir = path.resolve(path.dirname(currentFilePath), '..')
const distDir = path.join(desktopDir, 'dist')
const indexPath = path.join(distDir, 'index.html')

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true })
}

if (!existsSync(indexPath)) {
  writeFileSync(
    indexPath,
    '<!doctype html><html><head><meta charset="utf-8"><title>CC-Tools Desktop Dev Placeholder</title></head><body></body></html>',
  )
}
