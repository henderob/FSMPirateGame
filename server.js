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

// Game state
const gameState = {
    players: new Map(), // Map of player IDs to their data
    world: {
        islands: [],
        oceanSize: 2000, // Keep consistent with client-side if necessary
        worldBounds: { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 } // Example bounds
    }
};

// Generate random islands (keeping your existing function)
function generateIslands() {
    const islands = [];
    const baseSize = 3;
    const maxSizeMultiplier = 8;
    const numIslands = 12;
    const worldSize = gameState.world.oceanSize; // Use defined size
    const safeZone = 100;

    for (let i = 0; i < numIslands; i++) {
        let x, z;
        do {
            x = (Math.random() * (worldSize - 200)) - (worldSize / 2 - 100);
            z = (Math.random() * (worldSize - 200)) - (worldSize / 2 - 100);
        } while (Math.sqrt(x * x + z * z) < safeZone);

        const size = baseSize + Math.random() * (baseSize * maxSizeMultiplier - baseSize);
        const scaleX = 0.7 + Math.random() * 0.6;
        const scaleZ = 0.7 + Math.random() * 0.6;
        const rotation = Math.random() * Math.PI * 2;
        const minDistance = size * 2.5;
        let overlapping = false;
        for (const existingIsland of islands) {
            const dx = existingIsland.x - x;
            const dz = existingIsland.z - z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            if (distance < minDistance + existingIsland.size) {
                overlapping = true;
                break;
            }
        }

        if (!overlapping) {
            islands.push({ x, z, size, scaleX, scaleZ, rotation });
        } else {
            i--;
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

    // Initialize player data - NOW INCLUDES HEALTH
    const playerData = {
        id: playerId,
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        speed: 0,
        health: 100, // Server tracks health
        lastUpdate: Date.now()
    };

    gameState.players.set(playerId, playerData);
    console.log(`Player ${playerId} joined. Total players: ${gameState.players.size}`);

    // Send initial game state to new player
    const initData = {
        type: 'init',
        playerId: playerId,
        gameState: {
            players: Array.from(gameState.players.values()),
            world: gameState.world
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

            // Don't log frequent updates unless debugging
            // if (!['updatePosition', 'updateRotation', 'updateSpeed'].includes(data.type)) {
            //     console.log(`Received from ${playerId}:`, data.type, data);
            // }

            switch (data.type) {
                case 'updatePosition':
                    // Basic validation - is position within world bounds?
                    if (isValidPosition(data.position)) {
                         updatePlayerPosition(playerId, data.position);
                    } else {
                        console.warn(`Player ${playerId} sent invalid position:`, data.position);
                        // Optional: Snap player back or handle differently
                    }
                    break;
                case 'updateRotation':
                     updatePlayerRotation(playerId, data.rotation);
                    break;
                case 'updateSpeed':
                     updatePlayerSpeed(playerId, data.speed);
                    break;

                // SERVER HANDLES HITS NOW
                case 'playerHit':
                    handlePlayerHit(playerId, data); // Pass originating playerId (shooter)
                    break;

                // Other message types...
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
        // Consider removing the player on error as well
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
    return position.x >= bounds.minX && position.x <= bounds.maxX &&
           position.z >= bounds.minZ && position.z <= bounds.maxZ;
}

function updatePlayerPosition(playerId, position) {
    const player = gameState.players.get(playerId);
    if (player) {
        player.position = position;
        player.lastUpdate = Date.now();
        // Broadcast validated position
        broadcast({
            type: 'playerMoved',
            playerId: playerId,
            position: position
        }, null, true); // Exclude nobody, is frequent update
    }
}

function updatePlayerRotation(playerId, rotation) {
    const player = gameState.players.get(playerId);
    if (player && typeof rotation === 'number') {
        player.rotation = rotation;
        player.lastUpdate = Date.now();
        // console.log(`Player ${playerId} rotated to ${rotation.toFixed(2)}`); // Less noise
        broadcast({
            type: 'playerRotated',
            playerId: playerId,
            rotation: rotation
        }, null, true); // Exclude nobody, is frequent update
    }
}

function updatePlayerSpeed(playerId, speed) {
    const player = gameState.players.get(playerId);
    if (player && typeof speed === 'number') {
        // Only broadcast significant changes or stops to reduce noise
        if (Math.abs(player.speed - speed) > 0.05 || speed === 0 || player.speed === 0) {
            // console.log(`Player ${playerId} speed changed to ${speed.toFixed(2)}`); // Less noise
            player.speed = speed;
            player.lastUpdate = Date.now();
            broadcast({
                type: 'playerSpeedChanged',
                playerId: playerId,
                speed: speed
            }, null, true); // Exclude nobody, is frequent update
        } else {
             // Update silently if change is minor and non-zero
             player.speed = speed;
             player.lastUpdate = Date.now();
        }
    }
}

// SERVER HIT HANDLING LOGIC
function handlePlayerHit(shooterId, data) {
    const { targetId, damage = 10, position } = data; // Default damage if not provided

    if (!targetId || !position) {
        console.warn(`Invalid hit data from ${shooterId}:`, data);
        return;
    }

    const targetPlayer = gameState.players.get(targetId);
    const shooterPlayer = gameState.players.get(shooterId);

    if (!targetPlayer) {
        console.log(`Hit reported by ${shooterId} on non-existent target ${targetId}`);
        return;
    }

    if (!shooterPlayer) {
        console.warn(`Hit reported by non-existent shooter ${shooterId}`);
        // Maybe ignore? Depends on desired strictness
        return;
    }

     if (targetPlayer.health <= 0) {
        // console.log(`Hit reported on already defeated player ${targetId}`);
        return; // Ignore hits on players already at 0 health
    }


    // --- !! VALIDATION !! ---
    // This is where you'd add more checks:
    // 1. Distance check: Is shooterPlayer close enough to targetPlayer?
    //    const dist = Math.sqrt(Math.pow(shooterPlayer.position.x - targetPlayer.position.x, 2) + ...);
    //    if (dist > MAX_WEAPON_RANGE) return;
    // 2. Line of Sight: Is there an island between them? (More complex raycasting)
    // 3. Cooldowns: Has the shooter fired too recently? (Need to track lastShotTime on server playerData)
    // 4. Teams: Are they on the same team?
    console.log(`Processing hit: ${shooterId} -> ${targetId} for ${damage} damage.`);

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
            oldHealth: oldHealth, // Send old health for comparison
            damage: damage,
            source: 'hit' // Indicate source
        });
        console.log(`Sent health update to ${targetId}`);
    } else {
        console.warn(`Could not find WebSocket for target ${targetId} to send health update.`);
    }

    // Broadcast a message for VISUAL effects to ALL players
    broadcast({
        type: 'playerHitEffect', // Use a distinct type for effects
        targetId: targetId,
        shooterId: shooterId,
        position: position // Position where the hit effect should occur
    });

     // Check for player defeat
    if (targetPlayer.health <= 0) {
        console.log(`Player ${targetId} has been defeated!`);
        // TODO: Implement respawn logic or game over handling
        // Example: Send a 'playerDefeated' message, maybe reset health after a delay, etc.
        broadcast({
            type: 'playerDefeated',
            playerId: targetId,
            killerId: shooterId
        });
        // Reset health for now (simple respawn)
        // setTimeout(() => {
        //    if (gameState.players.has(targetId)) {
        //        const respawnedPlayer = gameState.players.get(targetId);
        //        respawnedPlayer.health = 100;
        //        respawnedPlayer.position = { x: 0, y: 0, z: 0 }; // Back to spawn
        //        console.log(`Player ${targetId} respawned.`);
        //        broadcast({ type: 'playerRespawned', player: respawnedPlayer });
        //    }
        // }, 5000); // 5 second respawn timer
    }
}


// Broadcast data to all connected clients, optionally excluding one
// Added 'isFrequent' flag to suppress logging for noisy messages
function broadcast(data, excludeWs = null, isFrequent = false) {
    if (!isFrequent) {
        console.log('Broadcasting:', data.type);
    }
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Remove server-side physics loop - Client is authoritative for its own position now
// setInterval(() => { ... }, 1000 / 60); // DELETE THIS BLOCK

console.log('Server setup complete. Waiting for connections...');