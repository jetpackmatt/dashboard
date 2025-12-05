#!/usr/bin/env node
/**
 * Parallel Sync Runner
 *
 * Splits a large date range into chunks and runs sync-orders-fast.js
 * in parallel for maximum throughput.
 *
 * Usage:
 *   node sync-parallel.js                           # Full 2-year backfill, 4 workers
 *   node sync-parallel.js --workers=8               # Use 8 parallel workers
 *   node sync-parallel.js --chunk=quarterly         # Split by quarters
 *   node sync-parallel.js --chunk=monthly           # Split by months
 *   node sync-parallel.js --client=methyl-life      # Different client
 *   node sync-parallel.js --dry-run                 # Show chunks without running
 */
const { spawn } = require('child_process')
const path = require('path')

function parseArgs() {
  const args = process.argv.slice(2)
  const config = {
    workers: 4,
    chunkSize: 'quarterly',  // 'quarterly', 'monthly', 'bimonthly'
    clientKey: 'henson',
    dryRun: false,
    daysBack: 730  // 2 years default
  }

  for (const arg of args) {
    if (arg === '--dry-run') config.dryRun = true
    else if (arg.startsWith('--workers=')) config.workers = parseInt(arg.split('=')[1], 10)
    else if (arg.startsWith('--chunk=')) config.chunkSize = arg.split('=')[1]
    else if (arg.startsWith('--client=')) config.clientKey = arg.split('=')[1]
    else if (arg.startsWith('--days=')) config.daysBack = parseInt(arg.split('=')[1], 10)
  }

  return config
}

function generateChunks(daysBack, chunkSize) {
  const chunks = []
  const now = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - daysBack)

  // Determine chunk duration in days
  let chunkDays
  switch (chunkSize) {
    case 'monthly':
      chunkDays = 30
      break
    case 'bimonthly':
      chunkDays = 60
      break
    case 'quarterly':
    default:
      chunkDays = 90
      break
  }

  let currentStart = new Date(startDate)
  while (currentStart < now) {
    const currentEnd = new Date(currentStart)
    currentEnd.setDate(currentEnd.getDate() + chunkDays)

    if (currentEnd > now) {
      currentEnd.setTime(now.getTime())
    }

    chunks.push({
      start: currentStart.toISOString().split('T')[0],
      end: currentEnd.toISOString().split('T')[0]
    })

    currentStart = new Date(currentEnd)
    currentStart.setDate(currentStart.getDate() + 1)  // Next day to avoid overlap
  }

  return chunks
}

async function runWorker(chunk, clientKey, workerId) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'sync-orders-fast.js')
    const args = [
      scriptPath,
      `--start=${chunk.start}`,
      `--end=${chunk.end}`,
      `--client=${clientKey}`
    ]

    console.log(`[Worker ${workerId}] Starting: ${chunk.start} to ${chunk.end}`)

    const proc = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let output = ''
    let errorOutput = ''

    proc.stdout.on('data', (data) => {
      output += data.toString()
    })

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString()
    })

    proc.on('close', (code) => {
      // Extract key metrics from output
      const ordersMatch = output.match(/Orders upserted: (\d+)/)
      const shipmentsMatch = output.match(/Shipments upserted: (\d+)/)
      const timeMatch = output.match(/SYNC COMPLETE in ([\d.]+) minutes/)

      const result = {
        workerId,
        chunk,
        exitCode: code,
        orders: ordersMatch ? parseInt(ordersMatch[1]) : 0,
        shipments: shipmentsMatch ? parseInt(shipmentsMatch[1]) : 0,
        time: timeMatch ? parseFloat(timeMatch[1]) : null,
        error: code !== 0 ? errorOutput.slice(0, 500) : null
      }

      if (code === 0) {
        console.log(`[Worker ${workerId}] ✓ Done: ${result.orders} orders, ${result.shipments} shipments in ${result.time}m`)
        resolve(result)
      } else {
        console.log(`[Worker ${workerId}] ✗ Failed: ${chunk.start} to ${chunk.end}`)
        resolve(result)  // Resolve anyway to continue other workers
      }
    })

    proc.on('error', (err) => {
      console.log(`[Worker ${workerId}] Error spawning: ${err.message}`)
      reject(err)
    })
  })
}

async function runParallelSync() {
  const config = parseArgs()

  console.log('=== PARALLEL SYNC RUNNER ===')
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log(`Client: ${config.clientKey}`)
  console.log(`Workers: ${config.workers}`)
  console.log(`Chunk size: ${config.chunkSize}`)
  console.log(`Days back: ${config.daysBack}`)
  console.log()

  // Generate chunks
  const chunks = generateChunks(config.daysBack, config.chunkSize)
  console.log(`Generated ${chunks.length} chunks:`)
  for (const chunk of chunks) {
    console.log(`  ${chunk.start} → ${chunk.end}`)
  }
  console.log()

  if (config.dryRun) {
    console.log('DRY RUN - Commands that would be executed:')
    for (let i = 0; i < chunks.length; i++) {
      console.log(`  node scripts/sync-orders-fast.js --start=${chunks[i].start} --end=${chunks[i].end} --client=${config.clientKey}`)
    }
    return
  }

  const startTime = Date.now()

  // Process chunks with limited concurrency
  const results = []
  let chunkIndex = 0

  async function processNextChunk(workerId) {
    while (chunkIndex < chunks.length) {
      const currentIndex = chunkIndex++
      const chunk = chunks[currentIndex]
      const result = await runWorker(chunk, config.clientKey, workerId)
      results.push(result)
    }
  }

  // Start workers
  const workerPromises = []
  for (let i = 0; i < Math.min(config.workers, chunks.length); i++) {
    workerPromises.push(processNextChunk(i + 1))
  }

  await Promise.all(workerPromises)

  // Summary
  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
  const totalOrders = results.reduce((sum, r) => sum + r.orders, 0)
  const totalShipments = results.reduce((sum, r) => sum + r.shipments, 0)
  const failures = results.filter(r => r.exitCode !== 0)

  console.log('\n========================================')
  console.log('PARALLEL SYNC COMPLETE')
  console.log('========================================\n')
  console.log(`Total time:     ${totalTime} minutes`)
  console.log(`Total orders:   ${totalOrders}`)
  console.log(`Total shipments: ${totalShipments}`)
  console.log(`Successful chunks: ${results.length - failures.length}/${results.length}`)

  if (failures.length > 0) {
    console.log('\nFAILED CHUNKS:')
    for (const f of failures) {
      console.log(`  ${f.chunk.start} → ${f.chunk.end} (exit code: ${f.exitCode})`)
      if (f.error) {
        console.log(`    Error: ${f.error.slice(0, 200)}`)
      }
    }

    console.log('\nTo retry failed chunks:')
    for (const f of failures) {
      console.log(`  node scripts/sync-orders-fast.js --start=${f.chunk.start} --end=${f.chunk.end} --client=${config.clientKey}`)
    }
  }

  // Estimate time savings
  const sequentialTime = results.reduce((sum, r) => sum + (r.time || 0), 0)
  if (sequentialTime > 0) {
    console.log(`\nTime savings: ${(sequentialTime - parseFloat(totalTime)).toFixed(1)} minutes`)
    console.log(`  Sequential would have taken: ~${sequentialTime.toFixed(1)} minutes`)
    console.log(`  Parallel completed in: ${totalTime} minutes`)
    console.log(`  Speedup: ${(sequentialTime / parseFloat(totalTime)).toFixed(1)}x`)
  }
}

runParallelSync().catch(console.error)
