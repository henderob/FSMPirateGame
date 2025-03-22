class NetworkManager {
    constructor() {
        this.ws = null;
        this.playerId = null;
        this.connected = false;
        this.onMessageCallbacks = new Map();
        this.lastPositionUpdate = 0;
        this.lastRotationUpdate = 0;
        this.lastSpeedUpdate = 0;
        this.updateThrottleTime = 50; // Minimum time between updates in ms
    }

    connect() {
        // Connect to Railway WebSocket server
        const wsUrl = window.location.protocol === 'https:' 
            ? 'wss://pirate-game-production.up.railway.app'
            : 'ws://pirate-game-production.up.railway.app';
            
        console.log('Connecting to WebSocket server:', wsUrl);
        
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('Connected to game server');
            this.connected = true;
        };

        this.ws.onclose = (event) => {
            console.log('Disconnected from game server:', event.code, event.reason);
            this.connected = false;
            
            // Attempt to reconnect after 5 seconds
            setTimeout(() => {
                console.log('Attempting to reconnect...');
                this.connect();
            }, 5000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Only log non-movement messages
                if (!['playerMoved', 'playerRotated', 'playerSpeedChanged'].includes(data.type)) {
                    console.log('Received message:', data);
                }
                
                // Handle different message types
                switch (data.type) {
                    case 'init':
                        this.handleInit(data);
                        break;
                    case 'playerJoined':
                        this.handlePlayerJoined(data);
                        break;
                    case 'playerLeft':
                        this.handlePlayerLeft(data);
                        break;
                    case 'playerMoved':
                        this.handlePlayerMoved(data);
                        break;
                    case 'playerRotated':
                        this.handlePlayerRotated(data);
                        break;
                    case 'playerSpeedChanged':
                        this.handlePlayerSpeedChanged(data);
                        break;
                    case 'updateHit':
                    case 'playerHit':
                        console.log('Hit event received:', data);
                        this.handlePlayerHit(data);
                        break;
                }

                // Call any registered callbacks for this message type
                if (this.onMessageCallbacks.has(data.type)) {
                    this.onMessageCallbacks.get(data.type).forEach(callback => callback(data));
                }
            } catch (error) {
                console.error('Error processing message:', error);
            }
        };
    }

    handleInit(data) {
        this.playerId = data.playerId;
        // Store the initial player list to prevent duplicates
        this.initialPlayers = new Set(data.gameState?.players?.map(p => p.id) || []);
        // Trigger init callback
        if (this.onMessageCallbacks.has('init')) {
            this.onMessageCallbacks.get('init').forEach(callback => callback(data));
        }
    }

    handlePlayerJoined(data) {
        // Only trigger playerJoined if this player wasn't in the initial list
        if (!this.initialPlayers?.has(data.player.id)) {
            if (this.onMessageCallbacks.has('playerJoined')) {
                this.onMessageCallbacks.get('playerJoined').forEach(callback => callback(data));
            }
        }
    }

    handlePlayerLeft(data) {
        // Trigger playerLeft callback
        if (this.onMessageCallbacks.has('playerLeft')) {
            this.onMessageCallbacks.get('playerLeft').forEach(callback => callback(data));
        }
    }

    handlePlayerMoved(data) {
        // Trigger playerMoved callback
        if (this.onMessageCallbacks.has('playerMoved')) {
            this.onMessageCallbacks.get('playerMoved').forEach(callback => callback(data));
        }
    }

    handlePlayerRotated(data) {
        // Trigger playerRotated callback
        if (this.onMessageCallbacks.has('playerRotated')) {
            this.onMessageCallbacks.get('playerRotated').forEach(callback => callback(data));
        }
    }

    handlePlayerSpeedChanged(data) {
        // Trigger playerSpeedChanged callback
        if (this.onMessageCallbacks.has('playerSpeedChanged')) {
            this.onMessageCallbacks.get('playerSpeedChanged').forEach(callback => callback(data));
        }
    }

    handlePlayerHit(data) {
        // Call only playerHit callbacks
        if (this.onMessageCallbacks.has('playerHit')) {
            this.onMessageCallbacks.get('playerHit').forEach(callback => callback(data));
        }
    }

    // Register callback for specific message type
    on(type, callback) {
        if (!this.onMessageCallbacks.has(type)) {
            this.onMessageCallbacks.set(type, new Set());
        }
        this.onMessageCallbacks.get(type).add(callback);
    }

    // Remove callback for specific message type
    off(type, callback) {
        if (this.onMessageCallbacks.has(type)) {
            this.onMessageCallbacks.get(type).delete(callback);
        }
    }

    // Send message to server
    send(data) {
        if (this.connected && this.ws) {
            // Only log non-position updates and significant speed changes
            if (data.type !== 'updatePosition' && 
                (data.type !== 'updateSpeed' || Math.abs(data.speed) > 0.1)) {
                console.log('Sending:', data.type);
            }
            this.ws.send(JSON.stringify(data));
        }
    }

    // Update player position with timestamp check
    updatePosition(position) {
        const now = Date.now();
        if (now - this.lastPositionUpdate > this.updateThrottleTime) {
            this.send({
                type: 'updatePosition',
                position: position
            });
            this.lastPositionUpdate = now;
        }
    }

    // Update player rotation
    updateRotation(rotation) {
        const now = Date.now();
        if (now - this.lastRotationUpdate > this.updateThrottleTime) {
            this.send({
                type: 'updateRotation',
                rotation: rotation
            });
            this.lastRotationUpdate = now;
        }
    }

    // Update player speed
    updateSpeed(speed) {
        const now = Date.now();
        // Only send speed updates if the change is significant and enough time has passed
        if (Math.abs(speed) > 0.01 && now - this.lastSpeedUpdate > this.updateThrottleTime) {
            this.send({
                type: 'updateSpeed',
                speed: speed
            });
            this.lastSpeedUpdate = now;
        }
    }
}

// Create and export a singleton instance
const networkManager = new NetworkManager();
export default networkManager; 