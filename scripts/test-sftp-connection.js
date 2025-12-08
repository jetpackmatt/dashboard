/**
 * Test SFTP connection and list available files
 */
require('dotenv').config({ path: '.env.local' })
const Client = require('ssh2-sftp-client')

async function main() {
  console.log('='.repeat(60))
  console.log('SFTP CONNECTION TEST')
  console.log('='.repeat(60))

  const sftp = new Client()

  const config = {
    host: process.env.SFTP_HOST,
    port: parseInt(process.env.SFTP_PORT || '22', 10),
    username: process.env.SFTP_USERNAME,
    password: process.env.SFTP_PASSWORD
  }

  console.log('\nConnection config:')
  console.log('  Host:', config.host)
  console.log('  Port:', config.port)
  console.log('  Username:', config.username)
  console.log('  Password:', config.password ? '***' : '(not set)')
  console.log('  Remote path:', process.env.SFTP_REMOTE_PATH)

  try {
    console.log('\nConnecting...')
    await sftp.connect(config)
    console.log('✓ Connected successfully!')

    const remotePath = process.env.SFTP_REMOTE_PATH || '/shipbob-data'
    console.log('\nListing files in:', remotePath)

    const files = await sftp.list(remotePath)
    console.log('\nFound', files.length, 'files:')

    for (const f of files) {
      const size = f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`
      const date = new Date(f.modifyTime).toISOString().split('T')[0]
      console.log(`  ${f.name} (${size}, ${date})`)
    }

    // Look for extras-*.csv files specifically
    const extrasFiles = files.filter(f => f.name.startsWith('extras-') && f.name.endsWith('.csv'))
    console.log('\n' + '='.repeat(60))
    console.log('EXTRAS CSV FILES:', extrasFiles.length)
    console.log('='.repeat(60))

    for (const f of extrasFiles) {
      const dateStr = f.name.replace('extras-', '').replace('.csv', '')
      console.log(`  ${f.name} → Date: ${dateStr}`)
    }

    // If there's a file, try to read first few rows
    if (extrasFiles.length > 0) {
      const testFile = extrasFiles[0]
      console.log('\n' + '='.repeat(60))
      console.log('SAMPLE DATA FROM:', testFile.name)
      console.log('='.repeat(60))

      const buffer = await sftp.get(`${remotePath}/${testFile.name}`)
      const content = buffer.toString('utf-8')
      const lines = content.split('\n').slice(0, 5)

      for (const line of lines) {
        console.log(line)
      }
    }

  } catch (error) {
    console.error('✗ Connection failed:', error.message)
    process.exit(1)
  } finally {
    await sftp.end()
    console.log('\n✓ Disconnected')
  }
}

main()
