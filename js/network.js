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
        this.reconnectAttempts = 0; // For exponential backoff
        this.reconnectTimeoutId = null; // To clear pending reconnects
    }

    connect() {
        // Clear any pending reconnect timeout
        if (this.reconnectTimeoutId) { clearTimeout(this.reconnectTimeoutId); this.reconnectTimeoutId = null; }
        // Prevent multiple connection attempts
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) { console.log("WebSocket connection already open or connecting."); return; }

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
            ? `${window.location.hostname}:${process.env.PORT || 8080}`
            : 'pirate-game-production.up.railway.app'; // Replace if needed

        const wsUrl = `${wsProtocol}//${wsHost}`;
        console.log(`Attempting to connect: ${wsUrl} (Attempt ${this.reconnectAttempts + 1})`);
        this.triggerEvent('connecting'); // Notify UI

        try { this.ws = new WebSocket(wsUrl); } catch (error) { console.error("WebSocket creation failed:", error); this.connected = false; this.scheduleReconnect(); this.triggerEvent('disconnected', { reason: 'WebSocket creation failed' }); return; }

        this.ws.onopen = () => { console.log('WebSocket established'); this.connected = true; this.reconnectAttempts = 0; /* 'init' handles UI now */ };

        this.ws.onclose = (event) => { console.log(`WebSocket disconnected: Code=${event.code}, Reason='${event.reason}'`); const wasConnected = this.connected; this.connected = false; this.clearStateOnDisconnect(); this.triggerEvent('disconnected', { reason: event.reason || 'Connection closed' }); if (wasConnected || this.reconnectAttempts > 0) this.scheduleReconnect(); };

        this.ws.onerror = (error) => { console.error('WebSocket error:', error); if (this.connected) this.triggerEvent('disconnected', { reason: 'WebSocket error' }); this.connected = false; };

        this.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'init') { this.handleInit(data); return; }
                if (data.playerId && data.playerId !== this.playerId && !this.knownPlayers.has(data.playerId)) { if (!this.pendingUpdates.has(data.playerId)) this.pendingUpdates.set(data.playerId, []); this.pendingUpdates.get(data.playerId).push(data); return; }
                this.handleMessage(data);
            } catch (error) { console.error('Error processing message:', event.data, error); }
        };
    }

    scheduleReconnect() {
        if (this.reconnectTimeoutId) return; this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1 ), 30000);
        console.log(`Attempting reconnect in ${delay / 1000}s...`);
        this.reconnectTimeoutId = setTimeout(() => { this.reconnectTimeoutId = null; this.connect(); }, delay);
    }

    triggerEvent(type, detail = {}) { if (this.onMessageCallbacks.has(type)) { this.onMessageCallbacks.get(type).forEach(callback => { try { callback(detail); } catch (error) { console.error(`Error in '${type}' callback:`, error); } }); } }

    clearStateOnDisconnect() { this.playerId = null; this.pendingUpdates.clear(); this.knownPlayers.clear(); }

    handleMessage(data) {
        if (!data || !data.type) return;
        if (data.type === 'playerJoined' && data.player?.id) { if (data.player.id !== this.playerId) { this.knownPlayers.add(data.player.id); this.processPendingUpdates(data.player.id); } }
        else if (data.type === 'playerLeft' && data.playerId) { this.knownPlayers.delete(data.playerId); this.pendingUpdates.delete(data.playerId); }
        this.triggerEvent(data.type, data);
    }

    handleInit(data) {
        console.log('Handling init data:', data); this.playerId = data.playerId; this.pendingUpdates.clear(); this.knownPlayers.clear();
        if (data.gameState?.players) data.gameState.players.forEach(player => { if (player.id !== this.playerId) this.knownPlayers.add(player.id); });
        console.log('Initial known players:', Array.from(this.knownPlayers));
        this.triggerEvent('init', data);
        setTimeout(() => { this.knownPlayers.forEach(playerId => { this.processPendingUpdates(playerId); }); }, 0);
    }

    processPendingUpdates(playerId) { const updates = this.pendingUpdates.get(playerId); if (updates) { /* console.log(`Processing ${updates.length} pending updates for ${playerId}`); */ updates.forEach(update => this.handleMessage(update)); this.pendingUpdates.delete(playerId); } }

    on(type, callback) { if (!this.onMessageCallbacks.has(type)) this.onMessageCallbacks.set(type, new Set()); this.onMessageCallbacks.get(type).add(callback); }
    off(type, callback) { if (this.onMessageCallbacks.has(type)) { this.onMessageCallbacks.get(type).delete(callback); if (this.onMessageCallbacks.get(type).size === 0) this.onMessageCallbacks.delete(type); } }

    send(data) { if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return; if (!data || !data.type) { console.error('Invalid message format to send:', data); return; } try { this.ws.send(JSON.stringify(data)); } catch (error) { console.error('Error sending message:', data.type, error); } }

    updatePosition(position) { const now = Date.now(); if (now - this.lastPositionUpdate > this.updateThrottleTime) { this.send({ type: 'updatePosition', position: { x: position.x, y: position.y, z: position.z } }); this.lastPositionUpdate = now; } }
    updateRotation(rotation) { const now = Date.now(); if (now - this.lastRotationUpdate > this.updateThrottleTime) { this.send({ type: 'updateRotation', rotation: rotation }); this.lastRotationUpdate = now; } }
    updateSpeed(speed) { const now = Date.now(); const throttle = (speed === 0 || Math.abs(speed) < 0.01) ? this.updateThrottleTime : this.updateThrottleTime * 2; if (now - this.lastSpeedUpdate > throttle) { this.send({ type: 'updateSpeed', speed: speed }); this.lastSpeedUpdate = now; } }
    sendPlayerHit(targetId, damage, hitPosition) { if (!this.playerId || !this.connected) return; this.send({ type: 'playerHit', targetId: targetId, damage: damage, position: { x: hitPosition.x, y: hitPosition.y, z: hitPosition.z } }); }
}
const networkManager = new NetworkManager();
export default networkManager;