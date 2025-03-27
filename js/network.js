class NetworkManager {
    constructor() {
        this.ws = null;
        this.playerId = null;
        this.connected = false;
        this.onMessageCallbacks = new Map();
        this.lastPositionUpdate = 0;
        this.lastRotationUpdate = 0;
        this.lastSpeedUpdate = 0;
        // Keep throttling reasonable, 30ms (~33fps) is often a good balance
        this.updateThrottleTime = 30;
        this.pendingUpdates = new Map();
        this.knownPlayers = new Set();
        this.initialPlayers = new Set(); // Track players received in initial 'init'
        // REMOVED: this.health - Game state (health) is managed in game.js
    }

    connect() {
        // Connect to Railway WebSocket server (or fallback for local dev)
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Smart detection for local vs production
        const wsHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? `${window.location.hostname}:${process.env.PORT || 8080}` // Use local server port
            : 'pirate-game-production.up.railway.app'; // Your production host

        const wsUrl = `${wsProtocol}//${wsHost}`;

        console.log('Attempting to connect to WebSocket server:', wsUrl);

        try {
             this.ws = new WebSocket(wsUrl);
        } catch (error) {
            console.error("WebSocket creation failed:", error);
            // Maybe show an error message to the user here
            return; // Stop connection attempt
        }


        this.ws.onopen = () => {
            console.log('WebSocket connection established');
            this.connected = true;
        };

        this.ws.onclose = (event) => {
            console.log(`WebSocket disconnected: Code=${event.code}, Reason='${event.reason}'`);
            this.connected = false;
            this.clearState(); // Clear player IDs etc.

             // Trigger a disconnected event for the UI if needed
             this.triggerEvent('disconnected', { reason: event.reason });


            // Implement smarter reconnection logic (e.g., exponential backoff)
            // Avoid infinite loops if the server is truly down
            console.log('Attempting to reconnect in 5 seconds...');
            setTimeout(() => {
                this.connect();
            }, 5000);
        };

        this.ws.onerror = (error) => {
            // Browser WebSocket API often just gives a generic Event on error,
            // closing the connection shortly after. The 'close' event gives more info.
            console.error('WebSocket error occurred:', error);
             // You might trigger the disconnected event here too
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                // Only log non-frequent messages for clarity
                if (!['playerMoved', 'playerRotated', 'playerSpeedChanged'].includes(data.type)) {
                    console.log('Received message:', data.type, data);
                }

                // Handle initialization first
                if (data.type === 'init') {
                    this.handleInit(data);
                    // Don't immediately handle other message types, wait for init callback
                    return;
                }

                // Ensure player is known before processing updates for them
                // Allow processing messages related to the *current* player even before 'init' is fully processed in game.js
                if (data.playerId && data.playerId !== this.playerId && !this.knownPlayers.has(data.playerId)) {
                     console.log(`Received update for unknown or pending player ${data.playerId}. Queueing.`);
                    if (!this.pendingUpdates.has(data.playerId)) {
                        this.pendingUpdates.set(data.playerId, []);
                    }
                    this.pendingUpdates.get(data.playerId).push(data);
                    return;
                }

                // Route message to appropriate handler and trigger callbacks
                this.handleMessage(data);

            } catch (error) {
                console.error('Error processing message:', event.data, error);
            }
        };
    }

    // Trigger custom events (like 'disconnected')
    triggerEvent(type, detail) {
         if (this.onMessageCallbacks.has(type)) {
            this.onMessageCallbacks.get(type).forEach(callback => {
                try {
                    callback(detail);
                } catch (error) {
                    console.error(`Error in '${type}' callback:`, error);
                }
            });
        }
    }


    clearState() {
        // Keep playerId if we might reconnect with the same ID (depends on server)
        // this.playerId = null;
        this.pendingUpdates.clear();
        this.knownPlayers.clear();
        this.initialPlayers.clear();
    }

    // Routes message types and triggers external callbacks
     handleMessage(data) {
        if (!data || !data.type) return;

        // Internal handling logic (can be added if NetworkManager needs its own state)
        // switch (data.type) {
        //     case 'playerJoined':
        //         this.knownPlayers.add(data.player.id);
        //         break;
        //     // ... other internal state updates
        // }

         // Always trigger the external callbacks registered via .on()
        this.triggerEvent(data.type, data);
    }

    // Specific handler for Init
    handleInit(data) {
        console.log('Handling init data:', data);
        this.playerId = data.playerId;
        this.clearState(); // Clear previous state before applying new one

        // Mark all players from init data as known *and* initial
        if (data.gameState?.players) {
            data.gameState.players.forEach(player => {
                if (player.id !== this.playerId) { // Don't add self to knownPlayers list
                    this.knownPlayers.add(player.id);
                    this.initialPlayers.add(player.id); // Mark as existing at init time
                }
            });
        }
        console.log('Initial known players:', Array.from(this.knownPlayers));

        // Trigger the 'init' event for game.js to process
        this.triggerEvent('init', data);


        // Process queued updates *after* game.js has had a chance to process 'init'
        // Use a microtask (like setTimeout 0) to defer this slightly
        setTimeout(() => {
            console.log('Processing pending updates after init...');
            this.knownPlayers.forEach(playerId => {
                const updates = this.pendingUpdates.get(playerId);
                if (updates) {
                    console.log(`Processing ${updates.length} updates for ${playerId}`);
                    updates.forEach(update => this.handleMessage(update)); // Route normally
                    this.pendingUpdates.delete(playerId);
                }
            });
            console.log('Finished processing pending updates.');
        }, 0);
    }


    // Register callback for specific message type
    on(type, callback) {
        if (!this.onMessageCallbacks.has(type)) {
            this.onMessageCallbacks.set(type, new Set());
        }
        this.onMessageCallbacks.get(type).add(callback);
    }

    // Remove callback
    off(type, callback) {
        if (this.onMessageCallbacks.has(type)) {
            this.onMessageCallbacks.get(type).delete(callback);
            if (this.onMessageCallbacks.get(type).size === 0) {
                this.onMessageCallbacks.delete(type);
            }
        }
    }

    // Send message to server
    send(data) {
        if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            console.warn('Cannot send, WebSocket not connected:', data.type);
            return;
        }

        if (!data || !data.type) {
            console.error('Invalid message format to send:', data);
            return;
        }

        // Log sends for non-frequent types
        if (!['updatePosition', 'updateRotation', 'updateSpeed'].includes(data.type)) {
             console.log('Sending:', data.type, data);
        }

        try {
            this.ws.send(JSON.stringify(data));
        } catch (error) {
            console.error('Error sending message:', data.type, error);
        }
    }

    // Update throttled sending methods
    updatePosition(position) {
        const now = Date.now();
        if (now - this.lastPositionUpdate > this.updateThrottleTime) {
            this.send({
                type: 'updatePosition',
                position: { x: position.x, y: position.y, z: position.z } // Ensure plain object
            });
            this.lastPositionUpdate = now;
        }
    }

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

    updateSpeed(speed) {
        const now = Date.now();
         // Send speed updates slightly less frequently unless stopping/starting
         const throttle = (speed === 0 || Math.abs(speed) < 0.01) ? this.updateThrottleTime : this.updateThrottleTime * 2;
        if (now - this.lastSpeedUpdate > throttle) {
            this.send({
                type: 'updateSpeed',
                speed: speed
            });
            this.lastSpeedUpdate = now;
        }
    }

     // --- Add specific methods for game actions ---
     sendPlayerHit(targetId, damage, hitPosition) {
         if (!this.playerId) return; // Can't shoot if we don't have our ID
         this.send({
             type: 'playerHit',
             targetId: targetId,
             shooterId: this.playerId, // Server needs to know who shot
             damage: damage,
             position: { x: hitPosition.x, y: hitPosition.y, z: hitPosition.z } // Send precise location
         });
     }
}

// Create and export a singleton instance
const networkManager = new NetworkManager();
export default networkManager;