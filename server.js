const WebSocket = require('ws');
const express = require('express');
const app = express();
const port = process.env.PORT || 8080;

// Enable CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Serve static files
app.use(express.static('.'));

// Create HTTP server
const server = app.listen(port, () => console.log(`Server running on port ${port}`));

// Create WebSocket server
const wss = new WebSocket.Server({ server, perMessageDeflate: false, clientTracking: true });
console.log('WebSocket server created');

// --- CONSTANTS ---
const MAX_WEAPON_RANGE = 80; const WEAPON_COOLDOWN = 125;
const ISLAND_BASE_SIZE = 5; const ISLAND_MAX_SIZE_MULTIPLIER = 8;
const RESPAWN_TIME = 5000; const SPAWN_RADIUS = 75; const ISLAND_SPAWN_BUFFER = 5;
const PING_INTERVAL = 20000; const CLIENT_TIMEOUT = 45000;
const LARGE_ISLAND_PROBABILITY = 0.15; // 15% chance for an island to be large
const LARGE_ISLAND_SIZE_MULTIPLIER = 8; // How much bigger large islands are

// Game state
const gameState = { players: new Map(), world: { islands: [], oceanSize: 2000, worldBounds: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 } } };

// --- Helper Functions ---
function isPointInsideIsland(x, z, islands) {
    for (const island of islands) { const dx = island.x - x; const dz = island.z - z; const distSq = dx * dx + dz * dz; const islandRadius = Math.max(island.size * island.scaleX, island.size * island.scaleZ); const safeRadius = islandRadius + ISLAND_SPAWN_BUFFER; if (distSq < safeRadius * safeRadius) return true; } return false;
}
function getRandomSpawnPoint() {
    let spawnX, spawnZ, attempts = 0; const maxAttempts = 20; do { const angle = Math.random() * Math.PI * 2; const distance = Math.random() * SPAWN_RADIUS; spawnX = Math.cos(angle) * distance; spawnZ = Math.sin(angle) * distance; attempts++; if (attempts > maxAttempts) { console.warn("Could not find safe spawn point, defaulting to center."); return { x: 0, y: 0, z: 0 }; } } while (isPointInsideIsland(spawnX, spawnZ, gameState.world.islands)); console.log(`Generated spawn point: (${spawnX.toFixed(1)}, ${spawnZ.toFixed(1)}) after ${attempts} attempts.`); return { x: spawnX, y: 0, z: spawnZ };
}

// Generate random islands (MODIFIED for large islands)
function generateIslands() {
    const islands = []; const baseSize = ISLAND_BASE_SIZE; const numIslands = 15; const worldSize = gameState.world.oceanSize; const safeZone = SPAWN_RADIUS + 20; console.log(`Generating islands...`);
    for (let i = 0; i < numIslands; i++) {
        let x, z, size, scaleX, scaleZ, rotation, isLarge; let islandAttempts = 0; const maxIslandAttempts = 50; let validPosition = false;
        while (!validPosition && islandAttempts < maxIslandAttempts) {
             islandAttempts++; const angle = Math.random() * Math.PI * 2; const distance = safeZone + Math.random() * (worldSize / 2 - safeZone - 50); x = Math.cos(angle) * distance; z = Math.sin(angle) * distance; isLarge = Math.random() < LARGE_ISLAND_PROBABILITY;
             if (isLarge) { size = (baseSize * LARGE_ISLAND_SIZE_MULTIPLIER * 0.8) + (Math.random() * baseSize * LARGE_ISLAND_SIZE_MULTIPLIER * 0.4); console.log(` -> Generating LARGE island, size: ${size.toFixed(1)}`); } else { size = baseSize + Math.random() * (baseSize * (ISLAND_MAX_SIZE_MULTIPLIER * 0.8) - baseSize); }
             scaleX = 0.8 + Math.random() * 0.8; scaleZ = 0.8 + Math.random() * 0.8; rotation = Math.random() * Math.PI * 2; const checkRadius = size * Math.max(scaleX, scaleZ); const minDistance = checkRadius * 1.5; let overlapping = false;
             for (const existingIsland of islands) { const dx = existingIsland.x - x; const dz = existingIsland.z - z; const dist = Math.sqrt(dx * dx + dz * dz); const existingCheckRadius = existingIsland.size * Math.max(existingIsland.scaleX, existingIsland.scaleZ); const combinedMinDist = minDistance + existingCheckRadius * 1.5; if (dist < combinedMinDist) { overlapping = true; break; } }
             if (!overlapping) { islands.push({ x, z, size, scaleX, scaleZ, rotation, isLarge }); validPosition = true; }
        } if (!validPosition) { console.warn("Could not place an island after max attempts."); }
    } console.log(`Generated ${islands.length} islands.`); return islands;
}
gameState.world.islands = generateIslands();

// --- Refactored Player Cleanup Logic ---
function handlePlayerCleanup(playerId, reason = 'Unknown') {
    const player = gameState.players.get(playerId); if (!player) return; console.log(`[Cleanup] Removing player ${playerId}. Reason: ${reason}.`); const deleted = gameState.players.delete(playerId); if (deleted) { console.log(`[Cleanup] Player ${playerId} removed from gameState. Total players: ${gameState.players.size}`); broadcast({ type: 'playerLeft', playerId: playerId }); } else { console.warn(`[Cleanup] Attempted to remove player ${playerId}, but they were not found in the map.`); }
}

// --- WebSocket Connection Handling ---
wss.on('connection', (ws, req) => {
    const remoteAddr = req.socket.remoteAddress || req.headers['x-forwarded-for']; console.log('New client connected from:', remoteAddr); const playerId = Date.now().toString() + Math.random().toString(36).substring(2, 7); ws.playerId = playerId; const initialPosition = getRandomSpawnPoint();
    const playerData = { id: playerId, position: initialPosition, rotation: 0, speed: 0, health: 100, lastUpdate: Date.now(), lastShotTime: 0 }; gameState.players.set(playerId, playerData); console.log(`Player ${playerId} joined. Spawned at (${initialPosition.x.toFixed(1)}, ${initialPosition.z.toFixed(1)}). Total players: ${gameState.players.size}`);
    const initData = { type: 'init', playerId: playerId, gameState: { players: Array.from(gameState.players.values()), world: gameState.world } }; console.log(`[Server Init] Sending init data to ${playerId}. Players included: ${initData.gameState.players.map(p => p.id)}`); safeSend(ws, initData);
    broadcast({ type: 'playerJoined', player: playerData }, ws);

    ws.on('message', (message) => {
        const player = gameState.players.get(playerId); if (!player) return; player.lastUpdate = Date.now();
        try { const data = JSON.parse(message); switch (data.type) { case 'updatePosition': if (isValidPosition(data.position)) updatePlayerPosition(playerId, data.position, player); else console.warn(`Invalid position from ${playerId}`); break; case 'updateRotation': updatePlayerRotation(playerId, data.rotation, player); break; case 'updateSpeed': updatePlayerSpeed(playerId, data.speed, player); break; case 'playerHit': handlePlayerHit(player, data); break; default: console.log(`Unknown message type from ${playerId}: ${data.type}`); } } catch (error) { console.error(`Failed to process message from ${playerId}:`, message.toString(), error); }
    });
    ws.on('pong', () => { const player = gameState.players.get(playerId); if (player) player.lastUpdate = Date.now(); });
    ws.on('close', (code, reason) => { handlePlayerCleanup(playerId, `WebSocket closed (Code: ${code}, Reason: ${reason || 'None'})`); });
    ws.on('error', (error) => { handlePlayerCleanup(playerId, `WebSocket error (${error.message})`); ws.terminate(); });
});

// --- Heartbeat and Timeout Interval ---
const interval = setInterval(() => {
    const now = Date.now(); wss.clients.forEach(client => { const player = gameState.players.get(client.playerId); if (!player) { console.warn(`[Interval] Client ${client.playerId} connected but not in gameState. Terminating.`); client.terminate(); return; } if (now - player.lastUpdate > CLIENT_TIMEOUT) { console.log(`[Interval] Player ${client.playerId} timed out. Terminating.`); client.terminate(); handlePlayerCleanup(client.playerId, 'Client Activity Timeout'); } else { if (client.readyState === WebSocket.OPEN) client.ping(); } });
}, PING_INTERVAL);
wss.on('close', () => clearInterval(interval));

// --- Helper Functions (Existing) ---
function safeSend(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function isValidPosition(position) { if (!position || typeof position.x !== 'number' || typeof position.z !== 'number') return false; const bounds = gameState.world.worldBounds; return position.x >= bounds.minX && position.x <= bounds.maxX && position.z >= bounds.minZ && position.z <= bounds.maxZ; }
function updatePlayerPosition(playerId, position, player) { if (player) { player.position = position; broadcast({ type: 'playerMoved', playerId: playerId, position: position }, null, true); } }
function updatePlayerRotation(playerId, rotation, player) { if (player && typeof rotation === 'number') { player.rotation = rotation; broadcast({ type: 'playerRotated', playerId: playerId, rotation: rotation }, null, true); } }
function updatePlayerSpeed(playerId, speed, player) { if (player && typeof speed === 'number') { if (Math.abs(player.speed - speed) > 0.05 || speed === 0 || player.speed === 0) { player.speed = speed; broadcast({ type: 'playerSpeedChanged', playerId: playerId, speed: speed }, null, true); } else { player.speed = speed; } } }

// SERVER HIT HANDLING LOGIC (Audio Flag Removed)
function handlePlayerHit(shooterPlayer, data) {
    const { targetId, damage = 10, position } = data; const shooterId = shooterPlayer.id; if (!targetId || !position) return; const targetPlayer = gameState.players.get(targetId); if (!targetPlayer || targetPlayer.health <= 0 || shooterId === targetId) return;
    const now = Date.now(); if (now - shooterPlayer.lastShotTime < WEAPON_COOLDOWN) return; const dx = shooterPlayer.position.x - targetPlayer.position.x; const dz = shooterPlayer.position.z - targetPlayer.position.z; const distanceSq = dx * dx + dz * dz; const rangeSq = MAX_WEAPON_RANGE * MAX_WEAPON_RANGE; if (distanceSq > rangeSq) return;
    shooterPlayer.lastShotTime = now; const oldHealth = targetPlayer.health; targetPlayer.health = Math.max(0, oldHealth - damage); targetPlayer.lastUpdate = Date.now(); console.log(`Player ${targetId} health changed: ${oldHealth} -> ${targetPlayer.health}`);
    let targetWs = null; for (const client of wss.clients) { if (client.playerId === targetId) { targetWs = client; break; } } if (targetWs) safeSend(targetWs, { type: 'updateHealth', health: targetPlayer.health, oldHealth: oldHealth, damage: damage, source: 'hit' }); else console.warn(`Could not find WebSocket for target ${targetId} to send health update.`);
    // Broadcast visual effect ONLY
    broadcast({
        type: 'playerHitEffect',
        targetId: targetId,
        shooterId: shooterId,
        position: position
    });
     // Check defeat & respawn
    if (targetPlayer.health <= 0 && oldHealth > 0) {
        console.log(`Player ${targetId} defeated by ${shooterId}!`); broadcast({ type: 'playerDefeated', playerId: targetId, killerId: shooterId });
        setTimeout(() => { const playerToRespawn = gameState.players.get(targetId); if (playerToRespawn) { playerToRespawn.health = 100; playerToRespawn.position = getRandomSpawnPoint(); playerToRespawn.rotation = 0; playerToRespawn.speed = 0; playerToRespawn.lastShotTime = 0; playerToRespawn.lastUpdate = Date.now(); console.log(`Player ${targetId} respawned.`); broadcast({ type: 'playerRespawned', player: playerToRespawn }); let respawnedWs = null; for (const client of wss.clients) { if (client.playerId === targetId) { respawnedWs = client; break; } } if (respawnedWs) safeSend(respawnedWs, { type: 'updateHealth', health: playerToRespawn.health, oldHealth: 0, damage: 0, source: 'respawn' }); } }, RESPAWN_TIME);
    }
}

// Broadcast data
function broadcast(data, excludeWs = null, isFrequent = false) {
    // Optional reduced logging
    // if (!isFrequent) { console.log(`Broadcasting: ${data.type}`) }
    const message = JSON.stringify(data);
    wss.clients.forEach(client => { if (client !== excludeWs && client.playerId && client.readyState === WebSocket.OPEN) client.send(message); });
}

console.log('Server setup complete. Waiting for connections...');