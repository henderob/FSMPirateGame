class NetworkManager {
    constructor() {
        this.ws = null;
        this.playerId = null;
        this.connected = false;
        this.onMessageCallbacks = new Map();
        this.lastPositionUpdate = 0;
        this.lastRotationUpdate = 0;
        this.lastSpeedUpdate = 0;
        this.updateThrottleTime = 30; // ms (~33 updates/sec max)
        this.pendingUpdates = new Map();
        this.knownPlayers = new Set();
        // Removed: this.initialPlayers (not strictly needed with current logic)
        this.reconnectAttempts = 0; // For exponential backoff
        this.reconnectTimeoutId = null; // To clear pending reconnects
    }

    connect() {
        // Clear any pending reconnect timeout
        if (this.reconnectTimeoutId) {
            clearTimeout(this.reconnectTimeoutId);
            this.reconnectTimeoutId = null;
        }

        // Prevent multiple connection attempts simultaneously
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            console.log("WebSocket connection already open or connecting.");
            return;
        }

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? `${window.location.hostname}:${process.env.PORT || 8080}`
            : 'pirate-game-production.up.railway.app'; // Replace with your production host if different

        const wsUrl = `${wsProtocol}//${wsHost}`;
        console.log(`Attempting to connect to WebSocket server: ${wsUrl} (Attempt ${this.reconnectAttempts + 1})`);
        this.triggerEvent('connecting'); // Notify UI we are attempting

        try {
             this.ws = new WebSocket(wsUrl);
        } catch (error) {
            console.error("WebSocket creation failed:", error);
            this.connected = false; // Ensure state is correct
            this.scheduleReconnect(); // Attempt to reconnect after error
            this.triggerEvent('disconnected', { reason: 'WebSocket creation failed' });
            return;
        }

        this.ws.onopen = () => {
            console.log('WebSocket connection established');
            this.connected = true;
            this.reconnectAttempts = 0; // Reset attempts on successful connection
            // 'init' message from server will handle the 'connected' state update in game.js now
            // this.triggerEvent('connected'); // Not strictly needed if 'init' handles it
        };

        this.ws.onclose = (event) => {
            console.log(`WebSocket disconnected: Code=${event.code}, Reason='${event.reason}'`);
            const wasConnected = this.connected; // Check if we were previously connected
            this.connected = false;
            this.clearStateOnDisconnect(); // Clear player IDs etc.

            // Trigger disconnected event for the UI
            this.triggerEvent('disconnected', { reason: event.reason || 'Connection closed' });

            // Schedule reconnection only if not intentionally closed (check codes later if needed)
            // Avoid reconnecting immediately if it was just open
             if (wasConnected || this.reconnectAttempts > 0) { // Reconnect if we were connected or retrying
                 this.scheduleReconnect();
             }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error occurred:', error);
            // Error often precedes close, onclose usually provides more details.
            // We can trigger disconnected here too, but onclose will also fire.
             if (this.connected) { // Only trigger if we thought we were connected
                 this.triggerEvent('disconnected', { reason: 'WebSocket error' });
             }
             // Ensure connected state is false, though onclose should handle it
             this.connected = false;
        };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (!['playerMoved', 'playerRotated', 'playerSpeedChanged'].includes(data.type)) {
                    // console.log('Received message:', data.type, data); // Less noise
                }

                if (data.type === 'init') {
                    this.handleInit(data);
                    return; // Process init fully first
                }

                // Basic check: Is the message from a known player (or self)?
                if (data.playerId && data.playerId !== this.playerId && !this.knownPlayers.has(data.playerId)) {
                     // Queue message if player isn't known yet (might arrive before playerJoined)
                    // console.log(`Queueing update for unknown player ${data.playerId}.`);
                    if (!this.pendingUpdates.has(data.playerId)) {
                        this.pendingUpdates.set(data.playerId, []);
                    }
                    this.pendingUpdates.get(data.playerId).push(data);
                    return;
                }

                // Handle other message types
                this.handleMessage(data);

            } catch (error) {
                console.error('Error processing message:', event.data, error);
            }
        };
    }

    // Exponential backoff for reconnection
    scheduleReconnect() {
        if (this.reconnectTimeoutId) return; // Already scheduled

        this.reconnectAttempts++;
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts -1 ), 30000);
        console.log(`Attempting to reconnect in ${delay / 1000} seconds...`);
        this.reconnectTimeoutId = setTimeout(() => {
             this.reconnectTimeoutId = null;
             this.connect();
        }, delay);
    }

    triggerEvent(type, detail = {}) { // Add default empty object for detail
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

    clearStateOnDisconnect() {
        // Decide if playerId should be kept. If server uses sessions, maybe keep it.
        // For now, we get a new ID on reconnect, so clearing seems okay.
        this.playerId = null;
        this.pendingUpdates.clear();
        this.knownPlayers.clear();
        // Don't reset reconnectAttempts here, needed for backoff calculation
    }

     handleMessage(data) {
        if (!data || !data.type) return;

        // Add player to known list when they join
        if (data.type === 'playerJoined' && data.player?.id) {
             if (data.player.id !== this.playerId) {
                this.knownPlayers.add(data.player.id);
                // Process any pending updates for this player immediately
                this.processPendingUpdates(data.player.id);
             }
        }
        // Remove from known list when they leave
        else if (data.type === 'playerLeft' && data.playerId) {
            this.knownPlayers.delete(data.playerId);
            this.pendingUpdates.delete(data.playerId); // Clear pending messages too
        }

        this.triggerEvent(data.type, data);
    }

    handleInit(data) {
        console.log('Handling init data:', data);
        this.playerId = data.playerId;
        // Clear previous state *before* applying new one
        this.pendingUpdates.clear();
        this.knownPlayers.clear();

        // Mark all players from init data as known
        if (data.gameState?.players) {
            data.gameState.players.forEach(player => {
                if (player.id !== this.playerId) {
                    this.knownPlayers.add(player.id);
                }
            });
        }
        console.log('Initial known players:', Array.from(this.knownPlayers));

        // Trigger the 'init' event for game.js AFTER setting known players
        this.triggerEvent('init', data);

        // Process any updates that might have been queued *during* init processing elsewhere
        setTimeout(() => {
            // console.log('Processing any remaining pending updates after init...');
            this.knownPlayers.forEach(playerId => {
                this.processPendingUpdates(playerId);
            });
            // console.log('Finished post-init pending updates.');
        }, 0);
    }

    // Helper to process queued updates for a specific player
    processPendingUpdates(playerId) {
         const updates = this.pendingUpdates.get(playerId);
         if (updates) {
             // console.log(`Processing ${updates.length} pending updates for ${playerId}`);
             updates.forEach(update => this.handleMessage(update)); // Route normally
             this.pendingUpdates.delete(playerId); // Clear processed updates
         }
    }

    on(type, callback) {
        if (!this.onMessageCallbacks.has(type)) {
            this.onMessageCallbacks.set(type, new Set());
        }
        this.onMessageCallbacks.get(type).add(callback);
    }

    off(type, callback) {
        if (this.onMessageCallbacks.has(type)) {
            this.onMessageCallbacks.get(type).delete(callback);
            if (this.onMessageCallbacks.get(type).size === 0) {
                this.onMessageCallbacks.delete(type);
            }
        }
    }

    send(data) {
        if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            // console.warn('Cannot send, WebSocket not connected:', data.type); // Too noisy
            return;
        }
        if (!data || !data.type) {
            console.error('Invalid message format to send:', data);
            return;
        }
        // if (!['updatePosition', 'updateRotation', 'updateSpeed'].includes(data.type)) {
        //      console.log('Sending:', data.type); // Reduce noise
        // }
        try {
            this.ws.send(JSON.stringify(data));
        } catch (error) {
            console.error('Error sending message:', data.type, error);
        }
    }

    // Throttled updates remain the same
    updatePosition(position) {
        const now = Date.now();
        if (now - this.lastPositionUpdate > this.updateThrottleTime) {
            this.send({
                type: 'updatePosition',
                position: { x: position.x, y: position.y, z: position.z }
            });
            this.lastPositionUpdate = now;
        }
    }
    updateRotation(rotation) {
        const now = Date.now();
        if (now - this.lastRotationUpdate > this.updateThrottleTime) {
            this.send({ type: 'updateRotation', rotation: rotation });
            this.lastRotationUpdate = now;
        }
    }
    updateSpeed(speed) {
        const now = Date.now();
         const throttle = (speed === 0 || Math.abs(speed) < 0.01) ? this.updateThrottleTime : this.updateThrottleTime * 2;
        if (now - this.lastSpeedUpdate > throttle) {
            this.send({ type: 'updateSpeed', speed: speed });
            this.lastSpeedUpdate = now;
        }
    }

     sendPlayerHit(targetId, damage, hitPosition) {
         if (!this.playerId || !this.connected) return; // Check connection too
         this.send({
             type: 'playerHit',
             targetId: targetId,
             // shooterId is added by server implicitly, but sending here is fine if server ignores it
             // shooterId: this.playerId,
             damage: damage, // Client suggests damage, server verifies/uses own value
             position: { x: hitPosition.x, y: hitPosition.y, z: hitPosition.z }
         });
     }
}

const networkManager = new NetworkManager();
export default networkManager;