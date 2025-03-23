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
        this.pendingUpdates = new Map(); // Store updates for players not yet added
        this.knownPlayers = new Set(); // Track all known player IDs
        this.lastHitTime = 0; // Track last hit time to prevent duplicates
        this.hitCooldown = 100; // 100ms cooldown between hits
        this.health = 100; // Track local health
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
            this.clearState();
            
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
                
                // Handle initialization first
                if (data.type === 'init') {
                    this.handleInit(data);
                    return;
                }

                // For all other messages, ensure we know about the player
                if (data.playerId && !this.knownPlayers.has(data.playerId)) {
                    console.log('Received update for unknown player:', data.playerId);
                    if (!this.pendingUpdates.has(data.playerId)) {
                        this.pendingUpdates.set(data.playerId, []);
                    }
                    this.pendingUpdates.get(data.playerId).push(data);
                    return;
                }

                this.handleMessage(data);
            } catch (error) {
                console.error('Error processing message:', error);
            }
        };
    }

    clearState() {
        this.pendingUpdates.clear();
        this.knownPlayers.clear();
        this.initialPlayers = new Set();
        this.lastHitTime = 0;
        this.health = 100;
    }

    handleMessage(data) {
        if (!data || !data.type) {
            console.error('Invalid message received:', data);
            return;
        }

        console.log('Network handling message:', data.type, data);

        switch (data.type) {
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
            case 'playerHit':
            case 'hit':
                console.log('Processing hit event:', data);
                this.handlePlayerHit(data);
                break;
            case 'updateHealth':
            case 'healthUpdate':
                console.log('Processing health update:', data);
                this.handleHealthUpdate(data);
                break;
            case 'damageReport':
            case 'damage':
                console.log('Processing damage report:', data);
                this.handleDamageReport(data);
                break;
            default:
                console.log('Unknown message type:', data.type, data);
        }

        // Call registered callbacks after internal handling
        if (this.onMessageCallbacks.has(data.type)) {
            this.onMessageCallbacks.get(data.type).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error('Error in callback for', data.type, ':', error);
                }
            });
        }
    }

    handleInit(data) {
        console.log('Handling init with data:', data);
        this.playerId = data.playerId;
        this.knownPlayers.clear();
        this.initialPlayers = new Set();

        // Add all initial players to known players
        if (data.gameState?.players) {
            data.gameState.players.forEach(player => {
                this.knownPlayers.add(player.id);
                this.initialPlayers.add(player.id);
            });
        }

        // Process any pending updates for known players
        this.knownPlayers.forEach(playerId => {
            const updates = this.pendingUpdates.get(playerId);
            if (updates) {
                updates.forEach(update => this.handleMessage(update));
                this.pendingUpdates.delete(playerId);
            }
        });

        if (this.onMessageCallbacks.has('init')) {
            this.onMessageCallbacks.get('init').forEach(callback => callback(data));
        }
    }

    handlePlayerJoined(data) {
        if (!data.player?.id) return;
        
        this.knownPlayers.add(data.player.id);
        
        // Process any pending updates for this player
        const updates = this.pendingUpdates.get(data.player.id);
        if (updates) {
            updates.forEach(update => this.handleMessage(update));
            this.pendingUpdates.delete(data.player.id);
        }

        if (!this.initialPlayers?.has(data.player.id)) {
            if (this.onMessageCallbacks.has('playerJoined')) {
                this.onMessageCallbacks.get('playerJoined').forEach(callback => callback(data));
            }
        }
    }

    handlePlayerLeft(data) {
        if (!data.playerId) return;
        
        this.knownPlayers.delete(data.playerId);
        this.pendingUpdates.delete(data.playerId);
        
        if (this.onMessageCallbacks.has('playerLeft')) {
            this.onMessageCallbacks.get('playerLeft').forEach(callback => callback(data));
        }
    }

    handlePlayerMoved(data) {
        if (!data.playerId || !this.knownPlayers.has(data.playerId)) return;
        
        if (this.onMessageCallbacks.has('playerMoved')) {
            this.onMessageCallbacks.get('playerMoved').forEach(callback => callback(data));
        }
    }

    handlePlayerRotated(data) {
        if (!data.playerId || !this.knownPlayers.has(data.playerId)) return;
        
        if (this.onMessageCallbacks.has('playerRotated')) {
            this.onMessageCallbacks.get('playerRotated').forEach(callback => callback(data));
        }
    }

    handlePlayerSpeedChanged(data) {
        if (!data.playerId || !this.knownPlayers.has(data.playerId)) return;
        
        if (this.onMessageCallbacks.has('playerSpeedChanged')) {
            this.onMessageCallbacks.get('playerSpeedChanged').forEach(callback => callback(data));
        }
    }

    handlePlayerHit(data) {
        if (!data.targetId || !this.knownPlayers.has(data.targetId)) {
            console.error('Invalid hit data or unknown target:', data);
            return;
        }

        const now = Date.now();
        if (now - this.lastHitTime < this.hitCooldown) {
            console.log('Hit ignored due to cooldown');
            return;
        }
        this.lastHitTime = now;

        console.log('Processing hit for target:', data.targetId, 'current player:', this.playerId);
        
        // If we're the target, handle the hit
        if (data.targetId === this.playerId) {
            console.log('We were hit, current health:', this.health);
            
            // Send damage report to server using 'damage' type
            this.send({
                type: 'damage',  // Changed from 'reportDamage' to match server expectation
                damage: data.damage || 10,
                shooterId: data.shooterId,
                targetId: this.playerId,
                position: data.position
            });

            // Update local health immediately for responsiveness
            const damage = data.damage || 10;
            const oldHealth = this.health;
            const newHealth = Math.max(0, oldHealth - damage);
            
            console.log('Health changing from', oldHealth, 'to', newHealth);
            
            if (newHealth !== oldHealth) {
                this.health = newHealth;
                // Notify game of health change
                if (this.onMessageCallbacks.has('updateHealth')) {
                    console.log('Notifying game of health update');
                    this.onMessageCallbacks.get('updateHealth').forEach(callback => 
                        callback({ 
                            type: 'updateHealth', 
                            health: this.health,
                            oldHealth: oldHealth,
                            damage: damage,
                            source: 'hit'
                        }));
                }
            }
        }
    }

    handleHealthUpdate(data) {
        if (typeof data.health !== 'number') {
            console.error('Invalid health update:', data);
            return;
        }

        console.log('Processing health update. Current:', this.health, 'New:', data.health);
        
        const oldHealth = this.health;
        this.health = Math.max(0, Math.min(100, data.health));

        if (oldHealth !== this.health) {
            console.log('Health changed from server update:', oldHealth, '->', this.health);
            if (this.onMessageCallbacks.has('updateHealth')) {
                this.onMessageCallbacks.get('updateHealth').forEach(callback => 
                    callback({ 
                        type: 'updateHealth', 
                        health: this.health,
                        oldHealth: oldHealth,
                        source: 'server'
                    }));
            }
        }
    }

    handleDamageReport(data) {
        if (!data.targetId || !data.damage) {
            console.error('Invalid damage report:', data);
            return;
        }

        console.log('Processing damage report:', data);
        
        // If we're the target, update our health
        if (data.targetId === this.playerId) {
            const oldHealth = this.health;
            const newHealth = Math.max(0, oldHealth - data.damage);
            
            console.log('Damage report health change:', oldHealth, '->', newHealth);
            
            if (newHealth !== oldHealth) {
                this.health = newHealth;
                if (this.onMessageCallbacks.has('updateHealth')) {
                    this.onMessageCallbacks.get('updateHealth').forEach(callback => 
                        callback({ 
                            type: 'updateHealth', 
                            health: this.health,
                            oldHealth: oldHealth,
                            damage: data.damage,
                            source: 'damageReport'
                        }));
                }
            }
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
        if (!this.connected || !this.ws) return;
        
        // Validate message before sending
        if (!data || !data.type) {
            console.error('Invalid message to send:', data);
            return;
        }

        // Only log non-movement messages
        if (!['updatePosition', 'updateRotation', 'updateSpeed'].includes(data.type) || 
            (data.type === 'updateSpeed' && Math.abs(data.speed) > 0.1)) {
            console.log('Sending:', data);
        }

        try {
            this.ws.send(JSON.stringify(data));
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }

    // Update player position with reduced throttling for better hit detection
    updatePosition(position) {
        const now = Date.now();
        if (now - this.lastPositionUpdate > 16) { // ~60fps
            this.send({
                type: 'updatePosition',
                position: position
            });
            this.lastPositionUpdate = now;
        }
    }

    // Update player rotation with reduced throttling
    updateRotation(rotation) {
        const now = Date.now();
        if (now - this.lastRotationUpdate > 16) { // ~60fps
            this.send({
                type: 'updateRotation',
                rotation: rotation
            });
            this.lastRotationUpdate = now;
        }
    }

    // Update player speed with reduced throttling
    updateSpeed(speed) {
        const now = Date.now();
        if (now - this.lastSpeedUpdate > 16) { // ~60fps
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