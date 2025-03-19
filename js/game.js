import * as THREE from 'three';
import networkManager from './network.js';

// Game state
const gameState = {
    playerShip: {
        position: new THREE.Vector3(0, 0, 0),
        rotation: 0,
        speed: 0,
        turnSpeed: 0.03,
        maxSpeed: 0.5,
        acceleration: 0.01
    },
    otherPlayers: new Map(), // Map of player IDs to their ship meshes
    keys: {
        up: false,
        down: false,
        left: false,
        right: false
    }
};

// Initialize scene, camera, and renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

// Setup renderer
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87CEEB); // Sky blue color
renderer.shadowMap.enabled = true;

// Get the container and append the renderer
const container = document.getElementById('game-container');
if (!container) {
    console.error('Could not find game container!');
} else {
    container.appendChild(renderer.domElement);
}

// Create water texture
const waterTexture = new THREE.TextureLoader().load('https://threejs.org/examples/textures/water.jpg', (texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(10, 10);
    texture.offset.y = 0;
});

// Create normal map for water
const waterNormalMap = new THREE.TextureLoader().load('https://threejs.org/examples/textures/waternormals.jpg', (texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(5, 5);
});

// Create ocean
const oceanGeometry = new THREE.PlaneGeometry(2000, 2000, 100, 100);
const oceanMaterial = new THREE.MeshPhongMaterial({
    color: 0x006994,
    shininess: 60,
    specular: 0x004C6D,
    map: waterTexture,
    normalMap: waterNormalMap,
    normalScale: new THREE.Vector2(0.3, 0.3),
    transparent: true,
    opacity: 0.8
});
const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
ocean.rotation.x = -Math.PI / 2;
ocean.receiveShadow = true;
scene.add(ocean);

// Create island function
function createIsland(x, z, size) {
    const islandGroup = new THREE.Group();
    
    // Island base (sand)
    const baseGeometry = new THREE.CylinderGeometry(size, size * 1.2, size * 0.3, 8);
    const baseMaterial = new THREE.MeshPhongMaterial({ color: 0xf4a460 });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.receiveShadow = true;
    base.castShadow = true;
    islandGroup.add(base);

    // Add some palm trees
    const numTrees = Math.floor(Math.random() * 3) + 2;
    for (let i = 0; i < numTrees; i++) {
        const angle = (i / numTrees) * Math.PI * 2;
        const radius = size * 0.6;
        const treeX = Math.cos(angle) * radius * Math.random();
        const treeZ = Math.sin(angle) * radius * Math.random();
        
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.2, 0.3, 3, 6),
            new THREE.MeshPhongMaterial({ color: 0x8B4513 })
        );
        trunk.position.set(treeX, 1.5, treeZ);
        trunk.castShadow = true;
        islandGroup.add(trunk);

        const leaves = new THREE.Mesh(
            new THREE.ConeGeometry(1.5, 1.5, 8),
            new THREE.MeshPhongMaterial({ color: 0x228B22 })
        );
        leaves.position.set(treeX, 3, treeZ);
        leaves.castShadow = true;
        islandGroup.add(leaves);
    }

    islandGroup.position.set(x, 0, z);
    return islandGroup;
}

// Create simple ship (temporary placeholder)
function createShip(isNPC = false) {
    const shipGroup = new THREE.Group();
    
    // Ship hull
    const hullGeometry = new THREE.BoxGeometry(2, 1, 4);
    const hullMaterial = new THREE.MeshPhongMaterial({ 
        color: isNPC ? 0x8B0000 : 0x8B4513 
    });
    const hull = new THREE.Mesh(hullGeometry, hullMaterial);
    hull.position.y = 0.5;
    hull.castShadow = true;
    shipGroup.add(hull);

    // Simple mast
    const mastGeometry = new THREE.CylinderGeometry(0.1, 0.1, 3);
    const mastMaterial = new THREE.MeshPhongMaterial({ color: 0x8B4513 });
    const mast = new THREE.Mesh(mastGeometry, mastMaterial);
    mast.position.y = 2;
    mast.castShadow = true;
    shipGroup.add(mast);

    // Add sail
    const sailGeometry = new THREE.PlaneGeometry(1.5, 2);
    const sailMaterial = new THREE.MeshPhongMaterial({ 
        color: 0xFFFFFF,
        side: THREE.DoubleSide
    });
    const sail = new THREE.Mesh(sailGeometry, sailMaterial);
    sail.position.set(0, 2, 0);
    sail.rotation.y = Math.PI / 2;
    sail.castShadow = true;
    shipGroup.add(sail);

    return shipGroup;
}

// Create and add player ship
const playerShip = createShip();
scene.add(playerShip);

// Add lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
sunLight.position.set(100, 100, 50);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
scene.add(sunLight);

// Position camera
camera.position.set(0, 10, 15);
camera.lookAt(playerShip.position);

// Handle keyboard input
function handleKeyDown(event) {
    switch(event.key) {
        case 'ArrowUp':
            gameState.keys.up = true;
            break;
        case 'ArrowDown':
            gameState.keys.down = true;
            break;
        case 'ArrowLeft':
            gameState.keys.left = true;
            break;
        case 'ArrowRight':
            gameState.keys.right = true;
            break;
    }
}

function handleKeyUp(event) {
    switch(event.key) {
        case 'ArrowUp':
            gameState.keys.up = false;
            break;
        case 'ArrowDown':
            gameState.keys.down = false;
            break;
        case 'ArrowLeft':
            gameState.keys.left = false;
            break;
        case 'ArrowRight':
            gameState.keys.right = false;
            break;
    }
}

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);

// Network event handlers
networkManager.on('init', (data) => {
    // Add islands from server data
    data.gameState.world.islands.forEach(island => {
        const islandMesh = createIsland(island.x, island.z, island.size);
        scene.add(islandMesh);
    });

    // Add other players
    data.gameState.players.forEach(player => {
        if (player.id !== networkManager.playerId) {
            addOtherPlayer(player);
        }
    });
});

networkManager.on('playerJoined', (data) => {
    addOtherPlayer(data.player);
});

networkManager.on('playerLeft', (data) => {
    removeOtherPlayer(data.playerId);
});

networkManager.on('playerMoved', (data) => {
    updateOtherPlayerPosition(data.playerId, data.position);
});

networkManager.on('playerRotated', (data) => {
    updateOtherPlayerRotation(data.playerId, data.rotation);
});

networkManager.on('playerSpeedChanged', (data) => {
    updateOtherPlayerSpeed(data.playerId, data.speed);
});

// Helper functions for managing other players
function addOtherPlayer(playerData) {
    const ship = createShip(true);
    ship.position.set(playerData.position.x, playerData.position.y, playerData.position.z);
    ship.rotation.y = playerData.rotation;
    scene.add(ship);
    gameState.otherPlayers.set(playerData.id, ship);
}

function removeOtherPlayer(playerId) {
    const ship = gameState.otherPlayers.get(playerId);
    if (ship) {
        scene.remove(ship);
        gameState.otherPlayers.delete(playerId);
    }
}

function updateOtherPlayerPosition(playerId, position) {
    const ship = gameState.otherPlayers.get(playerId);
    if (ship) {
        ship.position.set(position.x, position.y, position.z);
    }
}

function updateOtherPlayerRotation(playerId, rotation) {
    const ship = gameState.otherPlayers.get(playerId);
    if (ship) {
        ship.rotation.y = rotation;
    }
}

function updateOtherPlayerSpeed(playerId, speed) {
    // Speed updates are handled by the server
    // We just need to update the visual representation if needed
}

// Update game state
function updateGame() {
    // Handle forward/backward movement
    if (gameState.keys.up) {
        gameState.playerShip.speed = Math.min(
            gameState.playerShip.speed + gameState.playerShip.acceleration,
            gameState.playerShip.maxSpeed
        );
        networkManager.updateSpeed(gameState.playerShip.speed);
    } else if (gameState.keys.down) {
        gameState.playerShip.speed = Math.max(
            gameState.playerShip.speed - gameState.playerShip.acceleration,
            -gameState.playerShip.maxSpeed / 2
        );
        networkManager.updateSpeed(gameState.playerShip.speed);
    } else {
        gameState.playerShip.speed *= 0.95;
        if (Math.abs(gameState.playerShip.speed) < 0.001) {
            gameState.playerShip.speed = 0;
        }
        networkManager.updateSpeed(gameState.playerShip.speed);
    }

    // Handle rotation
    if (gameState.keys.left) {
        gameState.playerShip.rotation += gameState.playerShip.turnSpeed;
        networkManager.updateRotation(gameState.playerShip.rotation);
    }
    if (gameState.keys.right) {
        gameState.playerShip.rotation -= gameState.playerShip.turnSpeed;
        networkManager.updateRotation(gameState.playerShip.rotation);
    }

    // Update position based on speed and rotation
    if (gameState.playerShip.speed !== 0) {
        const newPosition = {
            x: playerShip.position.x + Math.sin(gameState.playerShip.rotation) * gameState.playerShip.speed,
            y: playerShip.position.y,
            z: playerShip.position.z + Math.cos(gameState.playerShip.rotation) * gameState.playerShip.speed
        };
        playerShip.position.set(newPosition.x, newPosition.y, newPosition.z);
        networkManager.updatePosition(newPosition);
    }

    // Update camera position
    camera.position.x = playerShip.position.x;
    camera.position.z = playerShip.position.z + 15;
    camera.position.y = 10;
    camera.lookAt(playerShip.position);
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);
    updateGame();
    renderer.render(scene, camera);
}

// Connect to server and start game
networkManager.connect();
animate();

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}); 