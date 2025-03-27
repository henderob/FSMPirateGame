const WebSocket = require('ws');
const express = require('express');
const app = express();
const port = process.env.PORT || 8080;

// Enable CORS for all routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Serve static files
app.use(express.static('.'));

// Create HTTP server
const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    clientTracking: true
});

console.log('WebSocket server created');

// --- CONSTANTS ---
const MAX_WEAPON_RANGE = 80;
const WEAPON_COOLDOWN = 125;
const ISLAND_BASE_SIZE = 5;
const ISLAND_MAX_SIZE_MULTIPLIER = 8;
const RESPAWN_TIME = 5000;
const SPAWN_RADIUS = 75; // Max distance from center (0,0) for spawning
const ISLAND_SPAWN_BUFFER = 5; // Minimum distance from island edge for spawning
const PING_INTERVAL = 20000; // Send ping every 20 seconds
const CLIENT_TIMEOUT = 45000; // Disconnect client if no message/pong received for 45 seconds

// Game state
const gameState = {
    players: new Map(), // Map of player IDs to their data
    world: {
        islands: [],
        oceanSize: 2000,
        worldBounds: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 }
    }
};

// --- Helper Functions ---

// Function to check if a point is too close to an island
function isPointInsideIsland(x, z, islands) {
    for (const island of islands) {
        const dx = island.x - x;
        const dz = island.z - z;
        const distSq = dx * dx + dz * dz;
        // Check against the largest effective radius + buffer
        const islandRadius = Math.max(island.size * island.scaleX, island.size * island.scaleZ);
        const safeRadius = islandRadius + ISLAND_SPAWN_BUFFER;
        if (distSq < safeRadius * safeRadius) {
            return true; // Point is too close or inside the island buffer zone
        }
    }
    return false;
}

// Generate a random, safe spawn point near the center
function getRandomSpawnPoint() {
    let spawnX, spawnZ;
    let attempts = 0;
    const maxAttempts = 20; // Prevent infinite loops

    do {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * SPAWN_RADIUS; // Random distance within radius
        spawnX = Math.cos(angle) * distance;
        spawnZ = Math.sin(angle) * distance;
        attempts++;
        if (attempts > maxAttempts) {
            console.warn("Could not find safe spawn point after max attempts, defaulting to center.");
            return { x: 0, y: 0, z: 0 }; // Fallback to center
        }
    } while (isPointInsideIsland(spawnX, spawnZ, gameState.world.islands)); // Keep trying if inside an island

    console.log(`Generated spawn point: (${spawnX.toFixed(1)}, ${spawnZ.toFixed(1)}) after ${attempts} attempts.`);
    return { x: spawnX, y: 0, z: spawnZ };
}


// Generate random islands (modified slightly to use helper)
function generateIslands() {
    const islands = [];
    const baseSize = ISLAND_BASE_SIZE;
    const maxSizeMultiplier = ISLAND_MAX_SIZE_MULTIPLIER;
    const numIslands = 12;
    const worldSize = gameState.world.oceanSize;
    const safeZone = SPAWN_RADIUS + 20; // Ensure islands don't crowd the immediate spawn area

    console.log(`Generating islands with base size: ${baseSize}`);

    for (let i = 0; i < numIslands; i++) {
        let x, z;
        let islandAttempts = 0;
        const maxIslandAttempts = 50;
        let validPosition = false;

        while (!validPosition && islandAttempts < maxIslandAttempts) {
             islandAttempts++;
             // Generate position further away from center
            const angle = Math.random() * Math.PI * 2;
            const distance = safeZone + Math.random() * (worldSize / 2 - safeZone - 50); // Place between safeZone and world edge
            x = Math.cos(angle) * distance;
            z = Math.sin(angle) * distance;

             // Check overlap with existing islands
             const size = baseSize + Math.random() * (baseSize * maxSizeMultiplier - baseSize);
             const scaleX = 0.8 + Math.random() * 0.8;
             const scaleZ = 0.8 + Math.random() * 0.8;
             const rotation = Math.random() * Math.PI * 2;
             const minDistance = size * Math.max(scaleX, scaleZ) * 1.5;
             let overlapping = false;
             for (const existingIsland of islands) {
                 const dx = existingIsland.x - x;
                 const dz = existingIsland.z - z;
                 const dist = Math.sqrt(dx * dx + dz * dz);
                 const combinedMinDist = minDistance + existingIsland.size * Math.max(existingIsland.scaleX, existingIsland.scaleZ);
                 if (dist < combinedMinDist) {
                     overlapping = true;
                     break;
                 }
             }
             if (!overlapping) {
                  islands.push({ x, z, size, scaleX, scaleZ, rotation });
                  validPosition = true;
             }
        }
        if (!validPosition) {
            console.warn("Could not place an island after max attempts.");
        }
    }
    console.log(`Generated ${islands.length} islands.`);
    return islands;
}

// Generate islands *before* players can connect
gameState.world.islands = generateIslands();


// --- Refactored Player Cleanup Logic ---
function handlePlayerCleanup(playerId, reason = 'Unknown') {
    const player = gameState.players.get(playerId);
    if (!player) return; // Already cleaned up

    console.log(`[Cleanup] Removing player ${playerId}. Reason: ${reason}.`);
    const deleted = gameState.players.delete(playerId);

    if (deleted) {
        console.log(`[Cleanup] Player ${playerId} removed from gameState. Total players: ${gameState.players.size}`);
        // Notify remaining players
        broadcast({
            type: 'playerLeft',
            playerId: playerId
        });
    } else {
        console.warn(`[Cleanup] Attempted to remove player ${playerId}, but they were not found in the map.`);
    }
}


// --- WebSocket Connection Handling ---
wss.on('connection', (ws, req) => {
    const remoteAddr = req.socket.remoteAddress || req.headers['x-forwarded-for'];
    console.log('New client connected from:', remoteAddr);

    const playerId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
    ws.playerId = playerId; // Associate playerId with the WebSocket connection

    // --- MODIFIED: Use random spawn point ---
    const initialPosition = getRandomSpawnPoint();

    const playerData = {
        id: playerId,
        position: initialPosition, // Use generated spawn point
        rotation: 0,
        speed: 0,
        health: 100,
        lastUpdate: Date.now(), // Initialize lastUpdate time
        lastShotTime: 0
    };
    gameState.players.set(playerId, playerData);
    console.log(`Player ${playerId} joined. Spawned at (${initialPosition.x.toFixed(1)}, ${initialPosition.z.toFixed(1)}). Total players: ${gameState.players.size}`);

    // Send initial game state to new player
    const initData = {
        type: 'init',
        playerId: playerId,
        gameState: {
            players: Array.from(gameState.players.values()),
            world: gameState.world
        }
    };
    // Log players being sent in init data for debugging spawn issues
    console.log(`[Server Init] Sending init data to ${playerId}. Players included: ${initData.gameState.players.map(p => p.id)}`);
    safeSend(ws, initData);

    // Notify other players about new player
    broadcast({
        type: 'playerJoined',
        player: playerData
    }, ws); // Exclude the new player

    // --- Handle incoming messages ---
    ws.on('message', (message) => {
        // Update lastUpdate time whenever any valid message is received
        const player = gameState.players.get(playerId);
        if (player) {
            player.lastUpdate = Date.now(); // Keep player alive
        } else {
             console.warn(`Message received from player ${playerId}, but player not found in gameState.`);
             // Optionally terminate connection if state is inconsistent
             // ws.terminate();
             return;
        }

        try {
            const data = JSON.parse(message);

            // No need to update lastUpdate again here, done above

            switch (data.type) {
                case 'updatePosition':
                    if (isValidPosition(data.position)) {
                         updatePlayerPosition(playerId, data.position, player);
                    } else { console.warn(`Player ${playerId} sent invalid position:`, data.position); }
                    break;
                case 'updateRotation':
                     updatePlayerRotation(playerId, data.rotation, player);
                    break;
                case 'updateSpeed':
                     updatePlayerSpeed(playerId, data.speed, player);
                    break;
                case 'playerHit':
                    handlePlayerHit(player, data);
                    break;
                // Note: The 'ws' library automatically handles pong responses to server pings.
                // We just need the 'pong' handler below to update our 'lastUpdate' timestamp.
                default:
                    console.log(`Unknown message type from ${playerId}: ${data.type}`);
            }
        } catch (error) {
            console.error(`Failed to process message from ${playerId}:`, message.toString(), error);
        }
    });

    // --- Handle Pong Responses (for Heartbeat) ---
    ws.on('pong', () => {
        // console.log(`Pong received from ${playerId}`); // Can be noisy, enable for debugging
        const player = gameState.players.get(playerId);
        if (player) {
            player.lastUpdate = Date.now(); // Update timestamp to keep alive
        }
    });

    // --- Handle player disconnection (Graceful) ---
    ws.on('close', (code, reason) => {
        // Call the refactored cleanup function
        handlePlayerCleanup(playerId, `WebSocket closed (Code: ${code}, Reason: ${reason || 'None'})`);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for player ${playerId}:`, error);
        // Also trigger cleanup on error, as the connection is likely unusable/closed
        handlePlayerCleanup(playerId, `WebSocket error (${error.message})`);
        // Ensure the connection is terminated if the error didn't close it
        ws.terminate();
    });
});

// --- Heartbeat and Timeout Interval ---
const interval = setInterval(() => {
    const now = Date.now();
    // console.log("[Interval] Checking client responsiveness..."); // Noisy

    wss.clients.forEach(client => {
        // Check if player associated with this client still exists in game state
        const player = gameState.players.get(client.playerId);

        if (!player) {
            // Player doesn't exist in game state, but connection is open? Terminate.
            console.warn(`[Interval] Client ${client.playerId} connected but not in gameState. Terminating.`);
            client.terminate();
            return; // Move to the next client
        }

        // Check for timeout based on last update time
        if (now - player.lastUpdate > CLIENT_TIMEOUT) {
            console.log(`[Interval] Player ${client.playerId} timed out (Last update: ${((now - player.lastUpdate)/1000).toFixed(1)}s ago). Terminating.`);
            client.terminate(); // Force close the connection
            // Cleanup is handled automatically because terminate() will eventually trigger the 'close' event
            // which calls handlePlayerCleanup. Or we can call it manually:
            // handlePlayerCleanup(client.playerId, 'Client Activity Timeout'); // Call cleanup immediately
            // Calling cleanup immediately is often better for faster state sync.
            handlePlayerCleanup(client.playerId, 'Client Activity Timeout');
        } else {
            // Client is responsive, send a ping to ensure connection stays alive
            // and to trigger pong response for idle clients
            if (client.readyState === WebSocket.OPEN) {
                 // console.log(`[Interval] Pinging client ${client.playerId}`); // Noisy
                 client.ping(); // Browser/ws library should auto-reply with pong
            }
        }
    });
}, PING_INTERVAL); // Run check every PING_INTERVAL milliseconds

wss.on('close', () => { // Cleanup interval on server shutdown
    clearInterval(interval);
    console.log("WebSocket server closed, heartbeat interval stopped.");
});


// --- Helper Functions (Existing) ---

function safeSend(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    } else {
        // console.warn(`Attempted to send to closed socket for player ${ws.playerId}`); // Reduce noise
    }
}

function isValidPosition(position) {
    if (!position || typeof position.x !== 'number' || typeof position.z !== 'number') return false;
    const bounds = gameState.world.worldBounds;
    return position.x >= bounds.minX && position.x <= bounds.maxX &&
           position.z >= bounds.minZ && position.z <= bounds.maxZ;
}

function updatePlayerPosition(playerId, position, player) {
    if (player) {
        // --- LOGGING ---
        // console.log(`[Server] updatePlayerPosition: Player ${playerId} reported moving to X:${position.x.toFixed(1)}, Z:${position.z.toFixed(1)}`); // Reduce noise
        player.position = position;
        // lastUpdate is set in the main message handler now
        // player.lastUpdate = Date.now();
        broadcast({ type: 'playerMoved', playerId: playerId, position: position }, null, true);
    }
}

function updatePlayerRotation(playerId, rotation, player) {
    if (player && typeof rotation === 'number') {
        player.rotation = rotation;
        broadcast({ type: 'playerRotated', playerId: playerId, rotation: rotation }, null, true);
    }
}

function updatePlayerSpeed(playerId, speed, player) {
     if (player && typeof speed === 'number') {
         if (Math.abs(player.speed - speed) > 0.05 || speed === 0 || player.speed === 0) {
             player.speed = speed;
             broadcast({ type: 'playerSpeedChanged', playerId: playerId, speed: speed }, null, true);
         } else {
              player.speed = speed;
         }
     }
 }


// SERVER HIT HANDLING LOGIC - MODIFIED RESPAWN
function handlePlayerHit(shooterPlayer, data) {
    const { targetId, damage = 10, position } = data;
    const shooterId = shooterPlayer.id;

    if (!targetId || !position) { console.warn(`[Validation] Invalid hit data from ${shooterId}:`, data); return; }
    const targetPlayer = gameState.players.get(targetId);
    if (!targetPlayer) { return; } // Target not found
    if (targetPlayer.health <= 0) { return; } // Already dead
    if (shooterId === targetId) { console.log(`[Validation] Player ${shooterId} tried to hit themselves.`); return; }

    // --- VALIDATION ---
    const now = Date.now();
    if (now - shooterPlayer.lastShotTime < WEAPON_COOLDOWN) { console.log(`[Validation] Player ${shooterId} failed cooldown check.`); return; }
    const dx = shooterPlayer.position.x - targetPlayer.position.x; const dz = shooterPlayer.position.z - targetPlayer.position.z;
    const distanceSq = dx * dx + dz * dz; const rangeSq = MAX_WEAPON_RANGE * MAX_WEAPON_RANGE;
    if (distanceSq > rangeSq) { console.log(`[Validation] Player ${shooterId} failed range check to ${targetId}.`); return; }

    // --- Validation Passed ---
    // console.log(`Processing VALID hit: ${shooterId} -> ${targetId} for ${damage} damage.`);
    shooterPlayer.lastShotTime = now; // Update shot time *now*

    const oldHealth = targetPlayer.health;
    targetPlayer.health = Math.max(0, oldHealth - damage);
    targetPlayer.lastUpdate = Date.now(); // Also update target's activity time

    // console.log(`Player ${targetId} health changed: ${oldHealth} -> ${targetPlayer.health}`);

    // Find target WS and send health update
    let targetWs = null;
    for (const client of wss.clients) { if (client.playerId === targetId) { targetWs = client; break; } }
    if (targetWs) { safeSend(targetWs, { type: 'updateHealth', health: targetPlayer.health, oldHealth: oldHealth, damage: damage, source: 'hit' }); }
    else { console.warn(`Could not find WebSocket for target ${targetId} to send health update.`); }

    // Broadcast visual effect
    broadcast({ type: 'playerHitEffect', targetId: targetId, shooterId: shooterId, position: position });

     // Check for player defeat
    if (targetPlayer.health <= 0 && oldHealth > 0) {
        console.log(`Player ${targetId} has been defeated by ${shooterId}!`);
        broadcast({ type: 'playerDefeated', playerId: targetId, killerId: shooterId });

        // Simple Respawn Logic: Reset health and position after a delay
        setTimeout(() => {
           const playerToRespawn = gameState.players.get(targetId);
           if (playerToRespawn) { // Check if player still exists (didn't disconnect during timeout)
               playerToRespawn.health = 100;
               // --- MODIFIED: Use random spawn point for respawn ---
               playerToRespawn.position = getRandomSpawnPoint();
               playerToRespawn.rotation = 0; // Reset rotation on respawn
               playerToRespawn.speed = 0; // Reset speed
               playerToRespawn.lastShotTime = 0;
               playerToRespawn.lastUpdate = Date.now(); // Update time on respawn
               console.log(`Player ${targetId} respawned at (${playerToRespawn.position.x.toFixed(1)}, ${playerToRespawn.position.z.toFixed(1)}).`);

               broadcast({ type: 'playerRespawned', player: playerToRespawn }); // Notify about respawn state

               // Send specific health update to the respawned player
               let respawnedWs = null;
               for (const client of wss.clients) { if (client.playerId === targetId) { respawnedWs = client; break; } }
               if (respawnedWs) { safeSend(respawnedWs, { type: 'updateHealth', health: playerToRespawn.health, oldHealth: 0, damage: 0, source: 'respawn' }); }
           }
        }, RESPAWN_TIME);
    }
}


// Broadcast data to all connected clients, optionally excluding one
function broadcast(data, excludeWs = null, isFrequent = false) {
    // Reduce logging noise
    if (!isFrequent /*|| data.type === 'playerMoved'*/) { // Commented out playerMoved logging for less noise
        const pos = data.position;
        const posStr = pos ? `to X:${pos.x.toFixed(1)}, Z:${pos.z.toFixed(1)}` : '';
        const targetStr = data.playerId ? `for ${data.playerId} ` : '';
        // console.log(`[Server] Broadcasting ${data.type} ${targetStr}${posStr}`);
    }

    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        // Check if client has the playerID property; might not if connection failed early
        if (client !== excludeWs && client.playerId && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

console.log('Server setup complete. Waiting for connections...');