const WebSocket = require('ws');
const express = require('express');
const app = express();
const port = process.env.PORT || 8080;

// Serve static files
app.use(express.static('.'));

// Create HTTP server
const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocket.Server({ server });

// Game state
const gameState = {
    players: new Map(), // Map of player IDs to their data
    world: {
        islands: [], // Will be populated with island positions
        oceanSize: 2000
    }
};

// Generate random islands (similar to client-side)
function generateIslands() {
    const islands = [];
    for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const distance = 100 + Math.random() * 200;
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;
        const size = 5 + Math.random() * 10;
        islands.push({ x, z, size });
    }
    return islands;
}

// Initialize world
gameState.world.islands = generateIslands();

// Handle new connections
wss.on('connection', (ws) => {
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
    ws.send(JSON.stringify({
        type: 'init',
        playerId: playerId,
        gameState: {
            players: Array.from(gameState.players.values()),
            world: gameState.world
        }
    }));

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
        player.speed = speed;
        player.lastUpdate = Date.now();
        broadcast({
            type: 'playerSpeedChanged',
            playerId: playerId,
            speed: speed
        });
    }
}

function broadcast(data, exclude = null) {
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