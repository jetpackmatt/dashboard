// Build script to extract US city coordinates from all-the-cities
// This runs in Node.js to create a static JSON file for browser use
const cities = require('all-the-cities')
const fs = require('fs')
const path = require('path')

// Log first city to see structure
console.log('Sample city:', JSON.stringify(cities[0], null, 2))

// Filter for US cities and map to our format
// We extract population here for analysis but don't include it in the final JSON
const usCities = cities
  .filter(city => city.country === 'US')
  .map(city => ({
    key: `${city.name.toUpperCase()}|${city.adminCode}`,
    lon: city.loc?.coordinates?.[0] ?? city.lon ?? city.lng,
    lat: city.loc?.coordinates?.[1] ?? city.lat,
    population: city.population || 0  // Only used for logging stats below
  }))

// Sort by population descending to see distribution
const sorted = [...usCities].sort((a, b) => b.population - a.population)
console.log(`Extracted ${usCities.length} US cities`)
console.log('Top 10 cities by population:')
sorted.slice(0, 10).forEach(city => {
  console.log(`  ${city.key}: ${city.population.toLocaleString()}`)
})
console.log('\nPopulation tiers:')
const major = usCities.filter(c => c.population >= 100000).length
const medium = usCities.filter(c => c.population >= 10000 && c.population < 100000).length
const small = usCities.filter(c => c.population < 10000).length
console.log(`  Major cities (100K+): ${major}`)
console.log(`  Medium cities (10K-100K): ${medium}`)
console.log(`  Small towns (<10K): ${small}`)

// Write to JSON file (excluding population to reduce bundle size)
const outputPath = path.join(__dirname, 'us-cities-coords.json')
const outputData = usCities.map(({ key, lon, lat }) => ({ key, lon, lat }))
fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2))

console.log(`\nWritten ${outputData.length} cities to ${outputPath} (without population data)`)
const fileSizeKB = (JSON.stringify(outputData).length / 1024).toFixed(2)
console.log(`File size: ${fileSizeKB} KB`)
