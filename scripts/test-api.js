/**
 * API Test Script
 * 
 * Quick test of all API endpoints
 * 
 * Usage: node scripts/test-api.js
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

async function testAPI() {
    console.log('═══════════════════════════════════════════════════');
    console.log('  AI-PBX Gateway - API Test');
    console.log('═══════════════════════════════════════════════════');
    console.log(`  Base URL: ${BASE_URL}`);
    console.log('');

    const tests = [
        { name: 'Health Check', endpoint: '/health' },
        { name: 'Service Status', endpoint: '/status' },
        { name: 'Call History', endpoint: '/calls' },
        { name: 'Call History (with filters)', endpoint: '/calls?limit=10&callState=ended' },
        { name: 'Transcription Stats', endpoint: '/transcriptions/stats' },
    ];

    for (const test of tests) {
        await runTest(test.name, test.endpoint);
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('  Tests Complete');
    console.log('═══════════════════════════════════════════════════');
}

async function runTest(name, endpoint) {
    const url = `${BASE_URL}${endpoint}`;
    
    try {
        console.log(`\n📍 ${name}`);
        console.log(`   GET ${endpoint}`);
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (response.ok) {
            console.log(`   ✅ Status: ${response.status}`);
            console.log(`   📦 Response:`);
            console.log(JSON.stringify(data, null, 2).split('\n').map(l => '      ' + l).join('\n'));
        } else {
            console.log(`   ❌ Status: ${response.status}`);
            console.log(`   Error: ${data.error || 'Unknown error'}`);
        }
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        console.log(`   (Is the server running?)`);
    }
}

// Run tests
testAPI().catch(console.error);
