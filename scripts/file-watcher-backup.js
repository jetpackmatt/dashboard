#!/usr/bin/env node
/**
 * Automatic File Backup Watcher
 *
 * Watches source files and creates timestamped backups on every change.
 * This replaces Dropbox's versioning for code safety.
 *
 * Uses POLLING (fs.statSync) instead of fs.watch because fs.watch doesn't
 * detect all file write methods (e.g., atomic writes from some editors/tools).
 *
 * Usage: node scripts/file-watcher-backup.js
 *
 * Backups are stored in .backups/ with structure:
 *   .backups/app/dashboard/care/page.tsx/2025-01-13_10-30-45.tsx
 *
 * To restore: cp .backups/path/to/file/TIMESTAMP.ext path/to/file.ext
 */

const fs = require('fs')
const path = require('path')

const PROJECT_ROOT = path.resolve(__dirname, '..')
const BACKUP_DIR = path.join(PROJECT_ROOT, '.backups')
const MAX_BACKUPS_PER_FILE = 50  // Keep last 50 versions of each file
const POLL_INTERVAL_MS = 1000   // Check for changes every 1 second

// Directories to watch
const WATCH_DIRS = ['app', 'components', 'lib']

// Directories to ignore
const IGNORE_DIRS = [
  'node_modules',
  '.next',
  '.git',
  '.backups',
  'dist',
  'build',
]

// Track file modification times
const fileMtimes = new Map()

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function getTimestamp() {
  const now = new Date()
  return now.toISOString()
    .replace(/T/, '_')
    .replace(/:/g, '-')
    .replace(/\..+/, '')
}

function getBackupPath(filePath) {
  const relativePath = path.relative(PROJECT_ROOT, filePath)
  const ext = path.extname(filePath)
  const timestamp = getTimestamp()
  return path.join(BACKUP_DIR, relativePath, `${timestamp}${ext}`)
}

function backupFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return

    const stats = fs.statSync(filePath)
    if (!stats.isFile()) return

    const content = fs.readFileSync(filePath)
    const backupPath = getBackupPath(filePath)
    const backupDir = path.dirname(backupPath)

    ensureDir(backupDir)
    fs.writeFileSync(backupPath, content)

    // Cleanup old backups
    cleanupOldBackups(backupDir)

    const relativePath = path.relative(PROJECT_ROOT, filePath)
    console.log(`[Backup] ${relativePath} → ${path.basename(backupPath)}`)
  } catch (err) {
    console.error(`[Backup Error] ${filePath}: ${err.message}`)
  }
}

function cleanupOldBackups(backupDir) {
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => !f.startsWith('.'))
      .map(f => ({
        name: f,
        path: path.join(backupDir, f),
        mtime: fs.statSync(path.join(backupDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.mtime - a.mtime)  // Newest first

    // Remove oldest files beyond limit
    if (files.length > MAX_BACKUPS_PER_FILE) {
      const toDelete = files.slice(MAX_BACKUPS_PER_FILE)
      toDelete.forEach(f => {
        fs.unlinkSync(f.path)
      })
    }
  } catch (err) {
    // Ignore cleanup errors
  }
}

function shouldWatch(filePath) {
  const relativePath = path.relative(PROJECT_ROOT, filePath)

  // Check if in ignored directory
  for (const ignoreDir of IGNORE_DIRS) {
    if (relativePath.startsWith(ignoreDir + path.sep) || relativePath === ignoreDir) {
      return false
    }
  }

  // Check if it's a TypeScript/TSX file
  const ext = path.extname(filePath)
  if (ext !== '.ts' && ext !== '.tsx') return false

  // Check if in watched directories
  return WATCH_DIRS.some(dir => relativePath.startsWith(dir + path.sep))
}

function getAllFiles(dir, files = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      // Skip ignored directories
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.includes(entry.name)) {
          getAllFiles(fullPath, files)
        }
      } else if (entry.isFile() && shouldWatch(fullPath)) {
        files.push(fullPath)
      }
    }
  } catch (err) {
    // Ignore read errors
  }

  return files
}

function checkForChanges() {
  // Get all current files
  const currentFiles = []
  for (const dir of WATCH_DIRS) {
    const fullDir = path.join(PROJECT_ROOT, dir)
    if (fs.existsSync(fullDir)) {
      getAllFiles(fullDir, currentFiles)
    }
  }

  // Check each file for changes
  for (const filePath of currentFiles) {
    try {
      const stats = fs.statSync(filePath)
      const mtime = stats.mtimeMs
      const prevMtime = fileMtimes.get(filePath)

      if (prevMtime === undefined) {
        // New file, just record its mtime (don't backup on first discovery)
        fileMtimes.set(filePath, mtime)
      } else if (mtime > prevMtime) {
        // File was modified, backup it
        fileMtimes.set(filePath, mtime)
        backupFile(filePath)
      }
    } catch (err) {
      // File might have been deleted
      fileMtimes.delete(filePath)
    }
  }

  // Clean up deleted files from tracking
  for (const [filePath] of fileMtimes) {
    if (!currentFiles.includes(filePath)) {
      fileMtimes.delete(filePath)
    }
  }
}

// Main
console.log('='.repeat(60))
console.log('File Backup Watcher (Polling Mode)')
console.log('='.repeat(60))
console.log(`Backup directory: ${BACKUP_DIR}`)
console.log(`Max backups per file: ${MAX_BACKUPS_PER_FILE}`)
console.log(`Poll interval: ${POLL_INTERVAL_MS}ms`)
console.log(`Watching: ${WATCH_DIRS.join(', ')}`)
console.log('='.repeat(60))
console.log('')

ensureDir(BACKUP_DIR)

// Initial scan to populate file mtimes
console.log('[Init] Scanning files...')
let fileCount = 0
for (const dir of WATCH_DIRS) {
  const fullDir = path.join(PROJECT_ROOT, dir)
  if (fs.existsSync(fullDir)) {
    const files = getAllFiles(fullDir)
    files.forEach(f => {
      try {
        const stats = fs.statSync(f)
        fileMtimes.set(f, stats.mtimeMs)
        fileCount++
      } catch (err) {
        // Ignore
      }
    })
    console.log(`[Watching] ${dir}/ (${files.length} files)`)
  }
}

console.log(`[Init] Tracking ${fileCount} files`)
console.log('')
console.log('Backup watcher started. Press Ctrl+C to stop.')
console.log('')

// Start polling
const pollInterval = setInterval(checkForChanges, POLL_INTERVAL_MS)

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down backup watcher...')
  clearInterval(pollInterval)
  process.exit(0)
})
