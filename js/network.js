class NetworkManager {
    constructor() {
        this.ws = null;
        this.playerId = null;
        this.connected = false;
        this.onMessageCallbacks = new Map();
    }

    connect() {
        // Use secure WebSocket if the page is served over HTTPS
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('Connected to game server');
            this.connected = true;
        };

        this.ws.onclose = () => {
            console.log('Disconnected from game server');
            this.connected = false;
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
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
            }

            // Call any registered callbacks for this message type
            if (this.onMessageCallbacks.has(data.type)) {
                this.onMessageCallbacks.get(data.type).forEach(callback => callback(data));
            }
        };
    }

    handleInit(data) {
        this.playerId = data.playerId;
        // Trigger init callback
        if (this.onMessageCallbacks.has('init')) {
            this.onMessageCallbacks.get('init').forEach(callback => callback(data));
        }
    }

    handlePlayerJoined(data) {
        // Trigger playerJoined callback
        if (this.onMessageCallbacks.has('playerJoined')) {
            this.onMessageCallbacks.get('playerJoined').forEach(callback => callback(data));
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
            this.ws.send(JSON.stringify(data));
        }
    }

    // Update player position
    updatePosition(position) {
        this.send({
            type: 'updatePosition',
            position: position
        });
    }

    // Update player rotation
    updateRotation(rotation) {
        this.send({
            type: 'updateRotation',
            rotation: rotation
        });
    }

    // Update player speed
    updateSpeed(speed) {
        this.send({
            type: 'updateSpeed',
            speed: speed
        });
    }
}

// Create and export a singleton instance
const networkManager = new NetworkManager();
export default networkManager; 