# File Backup System

This project uses an automatic file backup watcher that creates timestamped snapshots of every file change. This replaces Dropbox versioning.

---

## How It Works

**Watcher script:** `scripts/file-watcher-backup.js`

When running, it:
- Watches `app/`, `components/`, `lib/` directories
- On every file save, creates a timestamped backup
- Keeps last 50 versions per file
- Stores backups in `.backups/` (gitignored)

**Backup structure:**
```
.backups/
├── app/
│   └── dashboard/
│       └── care/
│           └── page.tsx/
│               ├── 2025-01-13_10-30-45.tsx   (oldest)
│               ├── 2025-01-13_10-32-12.tsx
│               ├── 2025-01-13_10-35-00.tsx
│               └── 2025-01-13_10-40-22.tsx   (newest)
```

---

## Auto-Start via Launch Agent

The backup watcher runs automatically on login via macOS Launch Agents:
- `~/Library/LaunchAgents/com.jetpack.file-watcher.plist`
- `~/Library/LaunchAgents/com.venicepress.file-watcher.plist`

**Logs:** `/tmp/jetpack-watcher.log` and `/tmp/venicepress-watcher.log`

**Manual control:**
```bash
# Stop
launchctl unload ~/Library/LaunchAgents/com.jetpack.file-watcher.plist

# Start
launchctl load ~/Library/LaunchAgents/com.jetpack.file-watcher.plist
```

---

## Session-Start Check (Claude Instructions)

**At the start of each session, Claude should verify the watcher is running:**
```bash
pgrep -f "file-watcher-backup" | head -1
```

If no output, warn the user:
> "The backup watcher isn't running. File changes won't be backed up. To start it: `launchctl load ~/Library/LaunchAgents/com.jetpack.file-watcher.plist`"

---

## Restoring Files (Claude Instructions)

When the user asks to restore a file or recover a previous version:

### Step 1: List available backups
```bash
ls -la .backups/path/to/file/ | head -20
```

Example for care page:
```bash
ls -la .backups/app/dashboard/care/page.tsx/
```

### Step 2: Show the user available versions
Report the timestamps in human-readable format (e.g., "10:30 AM", "10:32 AM", etc.)

### Step 3: Let user choose or pick the right one
- If user says "restore to 10 minutes ago" - pick the backup closest to that time
- If user says "show me what changed" - diff the current file against a backup
- If user says "restore the last working version" - start with most recent backup

### Step 4: Restore the file
```bash
cp .backups/path/to/file/TIMESTAMP.ext path/to/file.ext
```

Example:
```bash
cp .backups/app/dashboard/care/page.tsx/2025-01-13_10-30-45.tsx app/dashboard/care/page.tsx
```

### Step 5: Confirm restoration
Read the restored file to verify it looks correct.

---

## Comparing Versions

To show what changed between current and a backup:
```bash
diff .backups/path/to/file/TIMESTAMP.ext path/to/file.ext
```

Or use the Read tool to show both versions side by side.

---

## Common User Requests

| User says | Claude action |
|-----------|---------------|
| "Restore care page to before you broke it" | List backups, find one from before the problematic edit, restore it |
| "Go back 10 minutes on this file" | Find backup closest to 10 min ago, restore it |
| "Show me what the file looked like before" | Read the most recent backup |
| "Undo your last change" | Restore the second-most-recent backup (the one before the current state) |
| "What versions do we have?" | List all backups for that file with timestamps |

---

## Important Notes

1. **Backups only exist if the watcher was running** - If the watcher wasn't running during edits, there won't be backups from that time.

2. **50 version limit** - Only the most recent 50 versions are kept per file. Older ones are auto-deleted.

3. **Backup location** - All backups are in `.backups/` at project root. This directory is gitignored.

4. **File paths** - Backup paths mirror source paths. `app/dashboard/care/page.tsx` backups are in `.backups/app/dashboard/care/page.tsx/`

---

## Troubleshooting

**No backups found:**
- Was the watcher running? Check with `ps aux | grep file-watcher`
- Start it: `node scripts/file-watcher-backup.js`

**Backup is corrupted or empty:**
- Try the next older backup
- List all: `ls -la .backups/path/to/file/`
