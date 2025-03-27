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
const MAX_WEAPON_RANGE = 80; // Matches client bullet maxDistance roughly
const WEAPON_COOLDOWN = 125; // Matches client shootCooldown
const ISLAND_BASE_SIZE = 5; // Increased base size
const ISLAND_MAX_SIZE_MULTIPLIER = 8; // Can adjust further
const RESPAWN_TIME = 5000; // 5 seconds

// Game state
const gameState = {
    players: new Map(), // Map of player IDs to their data
    world: {
        islands: [],
        oceanSize: 2000, // Keep consistent with client-side if necessary
        worldBounds: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 } // Example bounds
    }
};

// Generate random islands
function generateIslands() {
    const islands = [];
    const baseSize = ISLAND_BASE_SIZE; // Use constant
    const maxSizeMultiplier = ISLAND_MAX_SIZE_MULTIPLIER; // Use constant
    const numIslands = 12;
    const worldSize = gameState.world.oceanSize; // Use defined size
    const safeZone = 100;

    console.log(`Generating islands with base size: ${baseSize}`);

    for (let i = 0; i < numIslands; i++) {
        let x, z;
        do {
            x = (Math.random() * (worldSize - 200)) - (worldSize / 2 - 100);
            z = (Math.random() * (worldSize - 200)) - (worldSize / 2 - 100);
        } while (Math.sqrt(x * x + z * z) < safeZone);

        // Calculate size FIRST
        const size = baseSize + Math.random() * (baseSize * maxSizeMultiplier - baseSize);
        // Adjust scales for potentially wider islands (e.g., average scale > 1)
        const scaleX = 0.8 + Math.random() * 0.8; // Range 0.8 to 1.6
        const scaleZ = 0.8 + Math.random() * 0.8; // Range 0.8 to 1.6
        const rotation = Math.random() * Math.PI * 2;

        // Increase minDistance check based on the generated size
        const minDistance = size * Math.max(scaleX, scaleZ) * 1.5; // Safer distance based on larger dimension + buffer

        let overlapping = false;
        for (const existingIsland of islands) {
            const dx = existingIsland.x - x;
            const dz = existingIsland.z - z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            // Consider existing island size too
            const combinedMinDist = minDistance + existingIsland.size * Math.max(existingIsland.scaleX, existingIsland.scaleZ);
            if (distance < combinedMinDist) {
                overlapping = true;
                break;
            }
        }

        if (!overlapping) {
            islands.push({ x, z, size, scaleX, scaleZ, rotation });
        } else {
            i--; // Try again for this island index
        }
    }
    console.log(`Generated ${islands.length} islands.`);
    return islands;
}

gameState.world.islands = generateIslands();

// --- WebSocket Connection Handling ---
wss.on('connection', (ws, req) => {
    const remoteAddr = req.socket.remoteAddress || req.headers['x-forwarded-for']; // Handle proxy
    console.log('New client connected from:', remoteAddr);

    const playerId = Date.now().toString() + Math.random().toString(36).substring(2, 7); // More unique ID
    ws.playerId = playerId; // Associate playerId with the WebSocket connection

    // Initialize player data - Added health, lastUpdate, lastShotTime
    const playerData = {
        id: playerId,
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        speed: 0,
        health: 100, // Server tracks health
        lastUpdate: Date.now(),
        lastShotTime: 0 // Initialize last shot time
    };

    gameState.players.set(playerId, playerData);
    console.log(`Player ${playerId} joined. Total players: ${gameState.players.size}`);

    // Send initial game state to new player
    const initData = {
        type: 'init',
        playerId: playerId,
        gameState: {
            players: Array.from(gameState.players.values()),
            world: gameState.world // Includes updated islands
        }
    };
    safeSend(ws, initData);
    console.log(`Sent init data to ${playerId}`);

    // Notify other players about new player
    broadcast({
        type: 'playerJoined',
        player: playerData
    }, ws); // Exclude the new player

    // --- Handle incoming messages ---
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const player = gameState.players.get(playerId); // Get player data

            if (!player) {
                console.warn(`Message received from unknown or disconnected player ${playerId}`);
                return; // Ignore if player somehow doesn't exist
            }

            switch (data.type) {
                case 'updatePosition':
                    if (isValidPosition(data.position)) {
                         updatePlayerPosition(playerId, data.position, player); // Pass player ref
                    } else {
                        console.warn(`Player ${playerId} sent invalid position:`, data.position);
                    }
                    break;
                case 'updateRotation':
                     updatePlayerRotation(playerId, data.rotation, player); // Pass player ref
                    break;
                case 'updateSpeed':
                     updatePlayerSpeed(playerId, data.speed, player); // Pass player ref
                    break;
                case 'playerHit':
                    // Pass the shooter's player object for validation
                    handlePlayerHit(player, data);
                    break;
                default:
                    console.log(`Unknown message type from ${playerId}: ${data.type}`);
            }
        } catch (error) {
            console.error(`Failed to process message from ${playerId}:`, error);
        }
    });

    // --- Handle player disconnection ---
    ws.on('close', (code, reason) => {
        console.log(`Player ${playerId} disconnected. Code: ${code}, Reason: ${reason}`);
        gameState.players.delete(playerId);
        broadcast({
            type: 'playerLeft',
            playerId: playerId
        }); // Notify everyone
        console.log(`Player ${playerId} removed. Total players: ${gameState.players.size}`);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for player ${playerId}:`, error);
        if (gameState.players.has(playerId)) {
            gameState.players.delete(playerId);
            broadcast({
                type: 'playerLeft',
                playerId: playerId
            });
            console.log(`Player ${playerId} removed due to error. Total players: ${gameState.players.size}`);
        }
    });
});

// --- Helper Functions ---

function safeSend(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    } else {
        console.warn(`Attempted to send to closed socket for player ${ws.playerId}`);
    }
}

function isValidPosition(position) {
    if (!position || typeof position.x !== 'number' || typeof position.z !== 'number') {
        return false;
    }
    const bounds = gameState.world.worldBounds;
    // Add a small buffer to bounds checks if needed
    return position.x >= bounds.minX && position.x <= bounds.maxX &&
           position.z >= bounds.minZ && position.z <= bounds.maxZ;
}

// Updated functions to accept player object directly
function updatePlayerPosition(playerId, position, player) {
    if (player) {
        // --- LOGGING ---
        console.log(`[Server] updatePlayerPosition: Player ${playerId} reported moving to X:${position.x.toFixed(1)}, Z:${position.z.toFixed(1)}`);
        player.position = position;
        player.lastUpdate = Date.now();
        broadcast({
            type: 'playerMoved',
            playerId: playerId,
            position: position
        }, null, true); // isFrequent = true
    }
}

function updatePlayerRotation(playerId, rotation, player) {
    if (player && typeof rotation === 'number') {
        // --- LOGGING (Optional) ---
        // console.log(`[Server] updatePlayerRotation: Player ${playerId} reported rotating to ${rotation.toFixed(2)}`);
        player.rotation = rotation;
        player.lastUpdate = Date.now();
        broadcast({
            type: 'playerRotated',
            playerId: playerId,
            rotation: rotation
        }, null, true); // isFrequent = true
    }
}

function updatePlayerSpeed(playerId, speed, player) {
     if (player && typeof speed === 'number') {
         // Only broadcast significant changes or stops to reduce noise
         if (Math.abs(player.speed - speed) > 0.05 || speed === 0 || player.speed === 0) {
            // --- LOGGING (Optional) ---
            // console.log(`[Server] updatePlayerSpeed: Player ${playerId} speed changed to ${speed.toFixed(2)}`);
             player.speed = speed;
             player.lastUpdate = Date.now();
             broadcast({
                 type: 'playerSpeedChanged',
                 playerId: playerId,
                 speed: speed
             }, null, true); // isFrequent = true
         } else {
              // Update silently if change is minor and non-zero
              player.speed = speed;
              player.lastUpdate = Date.now();
         }
     }
 }

// SERVER HIT HANDLING LOGIC - **UPDATED WITH VALIDATION**
function handlePlayerHit(shooterPlayer, data) { // Pass shooterPlayer object
    const { targetId, damage = 10, position } = data;
    const shooterId = shooterPlayer.id; // Get ID from player object

    if (!targetId || !position) {
        console.warn(`[Validation] Invalid hit data from ${shooterId}:`, data);
        return;
    }

    const targetPlayer = gameState.players.get(targetId);

    if (!targetPlayer) {
        // Don't log every time, could be spammy if client sends bad data
        // console.log(`[Validation] Hit reported by ${shooterId} on non-existent target ${targetId}`);
        return;
    }

    if (targetPlayer.health <= 0) {
        // console.log(`[Validation] Hit reported on already defeated player ${targetId}`);
        return; // Ignore hits on players already at 0 health
    }

    if (shooterId === targetId) {
         console.log(`[Validation] Player ${shooterId} tried to hit themselves.`);
         return; // Prevent self-hits
    }

    // --- VALIDATION ---
    const now = Date.now();

    // 1. Cooldown Check:
    if (now - shooterPlayer.lastShotTime < WEAPON_COOLDOWN) {
        console.log(`[Validation] Player ${shooterId} failed cooldown check.`);
        return; // Fired too soon
    }

    // 2. Range Check:
    const dx = shooterPlayer.position.x - targetPlayer.position.x;
    const dz = shooterPlayer.position.z - targetPlayer.position.z;
    const distanceSq = dx * dx + dz * dz; // Use squared distance for efficiency
    const rangeSq = MAX_WEAPON_RANGE * MAX_WEAPON_RANGE;

    if (distanceSq > rangeSq) {
        console.log(`[Validation] Player ${shooterId} failed range check to ${targetId}. DistSq: ${distanceSq.toFixed(0)}, RangeSq: ${rangeSq}`);
        return; // Target out of range
    }

    // 3. Line of Sight (Skipped as requested)

    // --- Validation Passed ---
    console.log(`Processing VALID hit: ${shooterId} -> ${targetId} for ${damage} damage.`);

    // Update shooter's last shot time *after* validation passes
    shooterPlayer.lastShotTime = now;

    // Reduce health
    const oldHealth = targetPlayer.health;
    targetPlayer.health = Math.max(0, oldHealth - damage);
    targetPlayer.lastUpdate = Date.now(); // Update timestamp

    console.log(`Player ${targetId} health changed: ${oldHealth} -> ${targetPlayer.health}`);

    // Find the target's WebSocket connection
    let targetWs = null;
    for (const client of wss.clients) {
        if (client.playerId === targetId) {
            targetWs = client;
            break;
        }
    }

    // Send authoritative health update ONLY to the target
    if (targetWs) {
        safeSend(targetWs, {
            type: 'updateHealth',
            health: targetPlayer.health,
            oldHealth: oldHealth,
            damage: damage,
            source: 'hit'
        });
        // console.log(`Sent health update to ${targetId}`); // Less noise
    } else {
        console.warn(`Could not find WebSocket for target ${targetId} to send health update.`);
    }

    // Broadcast a message for VISUAL effects to ALL players
    broadcast({
        type: 'playerHitEffect',
        targetId: targetId,
        shooterId: shooterId,
        position: position // Position where the hit effect should occur (client-reported, consider verifying?)
    });

     // Check for player defeat
    if (targetPlayer.health <= 0 && oldHealth > 0) { // Only trigger once
        console.log(`Player ${targetId} has been defeated by ${shooterId}!`);
        broadcast({
            type: 'playerDefeated',
            playerId: targetId,
            killerId: shooterId
        });

        // Simple Respawn Logic: Reset health and position after a delay
        setTimeout(() => {
           const playerToRespawn = gameState.players.get(targetId); // Re-fetch in case they disconnected
           if (playerToRespawn) {
               playerToRespawn.health = 100;
               playerToRespawn.position = { x: 0, y: 0, z: 0 }; // Back to spawn
               playerToRespawn.lastShotTime = 0; // Reset shot timer
               console.log(`Player ${targetId} respawned.`);
               // Notify everyone about the respawn (includes new state)
               broadcast({ type: 'playerRespawned', player: playerToRespawn });

               // Also send a specific health update to the respawned player
               let respawnedWs = null;
               for (const client of wss.clients) {
                   if (client.playerId === targetId) {
                       respawnedWs = client;
                       break;
                   }
               }
               if (respawnedWs) {
                   safeSend(respawnedWs, {
                       type: 'updateHealth',
                       health: playerToRespawn.health,
                       oldHealth: 0, // From 0
                       damage: 0,
                       source: 'respawn'
                   });
               }
           }
        }, RESPAWN_TIME);
    }
}


// Broadcast data to all connected clients, optionally excluding one
function broadcast(data, excludeWs = null, isFrequent = false) {
    // --- LOGGING --- (Log playerMoved specifically for debugging)
    if (!isFrequent || data.type === 'playerMoved') {
        const pos = data.position;
        const posStr = pos ? `to X:${pos.x.toFixed(1)}, Z:${pos.z.toFixed(1)}` : '';
        const targetStr = data.playerId ? `for ${data.playerId} ` : '';
        console.log(`[Server] Broadcasting ${data.type} ${targetStr}${posStr}`);
    }

    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

console.log('Server setup complete. Waiting for connections...');