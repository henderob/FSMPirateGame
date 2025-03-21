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
    perMessageDeflate: false, // Disable per-message deflate to prevent memory issues
    clientTracking: true // Enable client tracking
});

// Log when server starts
console.log('WebSocket server created');

// Game state
const gameState = {
    players: new Map(), // Map of player IDs to their data
    world: {
        islands: [], // Will be populated with island positions
        oceanSize: 2000
    }
};

// Generate random islands with varying sizes and oval shapes
function generateIslands() {
    const islands = [];
    const baseSize = 5; // Base size A
    const maxSizeMultiplier = 20; // Maximum size will be 20*A

    for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const distance = 100 + Math.random() * 200;
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;
        
        // Generate random size between baseSize and 20*baseSize
        const size = baseSize + Math.random() * (baseSize * maxSizeMultiplier - baseSize);
        
        // Add oval properties
        const scaleX = 0.5 + Math.random(); // Random scale between 0.5 and 1.5
        const scaleZ = 0.5 + Math.random(); // Random scale between 0.5 and 1.5
        const rotation = Math.random() * Math.PI * 2; // Random rotation

        islands.push({ 
            x, 
            z, 
            size,
            scaleX,
            scaleZ,
            rotation
        });
    }
    return islands;
}

// Initialize world
gameState.world.islands = generateIslands();

// Handle new connections
wss.on('connection', (ws, req) => {
    console.log('New client connected from:', req.socket.remoteAddress);
    
    const playerId = Date.now().toString();
    
    // Initialize player data
    const playerData = {
        id: playerId,
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        speed: 0,
        lastUpdate: Date.now()
    };

    // Add player to game state
    gameState.players.set(playerId, playerData);

    // Send initial game state to new player
    const initData = {
        type: 'init',
        playerId: playerId,
        gameState: {
            players: Array.from(gameState.players.values()),
            world: gameState.world
        }
    };
    
    console.log('Sending init data:', initData);
    ws.send(JSON.stringify(initData));

    // Notify other players about new player
    broadcast({
        type: 'playerJoined',
        player: playerData
    }, ws);

    // Handle incoming messages
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch (data.type) {
            case 'updatePosition':
                updatePlayerPosition(playerId, data.position);
                break;
            case 'updateRotation':
                updatePlayerRotation(playerId, data.rotation);
                break;
            case 'updateSpeed':
                updatePlayerSpeed(playerId, data.speed);
                break;
        }
    });

    // Handle player disconnection
    ws.on('close', () => {
        gameState.players.delete(playerId);
        broadcast({
            type: 'playerLeft',
            playerId: playerId
        });
    });
});

// Helper functions
function updatePlayerPosition(playerId, position) {
    const player = gameState.players.get(playerId);
    if (player) {
        player.position = position;
        player.lastUpdate = Date.now();
        // Broadcast without logging
        broadcast({
            type: 'playerMoved',
            playerId: playerId,
            position: position
        });
    }
}

function updatePlayerRotation(playerId, rotation) {
    const player = gameState.players.get(playerId);
    if (player) {
        player.rotation = rotation;
        player.lastUpdate = Date.now();
        console.log(`Player ${playerId} rotated to ${rotation}`);
        broadcast({
            type: 'playerRotated',
            playerId: playerId,
            rotation: rotation
        });
    }
}

function updatePlayerSpeed(playerId, speed) {
    const player = gameState.players.get(playerId);
    if (player) {
        // Only log and broadcast if there's a significant speed change
        if (Math.abs(player.speed - speed) > 0.1) {
            console.log(`Player ${playerId} speed changed to ${speed.toFixed(2)}`);
            player.speed = speed;
            player.lastUpdate = Date.now();
            broadcast({
                type: 'playerSpeedChanged',
                playerId: playerId,
                speed: speed
            });
        } else {
            // Still update the speed but don't log or broadcast
            player.speed = speed;
            player.lastUpdate = Date.now();
        }
    }
}

function broadcast(data, exclude = null) {
    // Only log non-position/speed updates or significant events
    if (data.type !== 'playerMoved' && 
        (data.type !== 'playerSpeedChanged' || Math.abs(data.speed) > 0.1)) {
        console.log('Broadcasting:', data.type);
    }
    
    wss.clients.forEach(client => {
        if (client !== exclude && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Start game loop
setInterval(() => {
    // Update player positions based on their speed and rotation
    gameState.players.forEach((player, playerId) => {
        if (player.speed !== 0) {
            const newPosition = {
                x: player.position.x + Math.sin(player.rotation) * player.speed,
                y: player.position.y,
                z: player.position.z + Math.cos(player.rotation) * player.speed
            };
            updatePlayerPosition(playerId, newPosition);
        }
    });
}, 1000 / 60); // 60 FPS 