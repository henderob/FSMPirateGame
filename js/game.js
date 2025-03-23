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
        acceleration: 0.01,
        health: 100,
        canShoot: true,
        shootCooldown: 125  // Reduced from 500 to 125 for 4x faster shooting
    },
    otherPlayers: new Map(), // Map of player IDs to their ship meshes
    keys: {
        up: false,
        down: false,
        left: false,
        right: false,
        space: false
    },
    bullets: [] // Array to store active bullets
};

// Stats display elements
const statsElements = {
    playerCount: document.getElementById('player-count'),
    shipSpeed: document.getElementById('ship-speed'),
    shipHealth: document.getElementById('ship-health')
};

// Function to update the player's health (game state)
function updatePlayerHealth(newHealth, source = 'unknown') {
    const oldHealth = gameState.playerShip.health;
    // Clamp health between 0 and 100
    gameState.playerShip.health = Math.max(0, Math.min(100, Number(newHealth)));
    
    console.log(`Health changed from ${oldHealth} to ${gameState.playerShip.health} (source: ${source})`);
    
    // Update the display whenever health changes
    updateHealthDisplay();
    
    // Return true if health actually changed
    return oldHealth !== gameState.playerShip.health;
}

// Function to update stats display
function updateStatsDisplay() {
    if (!statsElements.playerCount || !statsElements.shipSpeed || !statsElements.shipHealth) {
        console.error('Stats elements not found!');
        return;
    }
    
    // Update player count (including the current player)
    statsElements.playerCount.textContent = gameState.otherPlayers.size + 1;
    
    // Update ship speed (rounded to 2 decimal places)
    statsElements.shipSpeed.textContent = Math.abs(gameState.playerShip.speed).toFixed(2);
    
    // Update health display
    updateHealthDisplay();
}

// Function to update just the health display (UI only)
function updateHealthDisplay() {
    if (!statsElements.shipHealth) {
        console.error('Health display element not found');
        return;
    }
    
    const currentHealth = gameState.playerShip.health;
    statsElements.shipHealth.textContent = currentHealth.toString();
    
    // Add visual feedback for low health
    statsElements.shipHealth.style.color = currentHealth < 30 ? '#ff0000' : '#4CAF50';
}

// Initialize scene, camera, and renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

// Setup renderer
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87CEEB); // This will be replaced by our sky
renderer.shadowMap.enabled = true;

// Get the container and append the renderer
const container = document.getElementById('game-container');
if (!container) {
    console.error('Could not find game container!');
} else {
    container.appendChild(renderer.domElement);
}

// Initialize minimap
const minimapScene = new THREE.Scene();
const minimapCamera = new THREE.OrthographicCamera(
    -400, 400,  // left, right
    400, -400,  // top, bottom
    0.1, 1000     // near, far
);
minimapCamera.position.set(0, 100, 0);
minimapCamera.lookAt(0, 0, 0);

const minimapRenderer = new THREE.WebGLRenderer({ antialias: true });
minimapRenderer.setSize(200, 200);
minimapRenderer.setClearColor(0x001a33); // Darker blue for minimap

const minimapContainer = document.getElementById('minimap-container');
if (minimapContainer) {
    minimapContainer.appendChild(minimapRenderer.domElement);
}

// Function to create a minimap marker
function createMinimapMarker(color, size = 6, isIsland = false, scaleX = 1, scaleZ = 1) {
    if (isIsland) {
        // For islands, create a circle shape
        const markerGeometry = new THREE.CircleGeometry(size/2, 32);
        const markerMaterial = new THREE.MeshBasicMaterial({ 
            color: color,
            side: THREE.DoubleSide
        });
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        marker.rotation.x = -Math.PI / 2; // Align with the minimap view
        marker.scale.set(scaleX, scaleZ, 1);
        return marker;
    } else {
        // For players, keep the simple square shape
        const markerGeometry = new THREE.PlaneGeometry(size, size);
        const markerMaterial = new THREE.MeshBasicMaterial({ 
            color: color,
            side: THREE.DoubleSide
        });
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        marker.rotation.x = -Math.PI / 2;
        return marker;
    }
}

// Create player marker for minimap
const playerMarker = createMinimapMarker(0x00ff00, 30); // Increased size to 30 for better visibility
playerMarker.position.y = 0.1; // Slightly above the ground to prevent z-fighting
minimapScene.add(playerMarker);

// Create markers map for other players
const playerMarkers = new Map();

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
const oceanGeometry = new THREE.PlaneGeometry(800, 800, 100, 100);
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

// Ocean animation parameters
const oceanAnimation = {
    textureOffsetSpeed: 0.00005,
    normalMapOffsetSpeed: 0.0001,
    time: 0
};

// Create island function
function createIsland(x, z, size, scaleX = 1, scaleZ = 1, rotation = 0) {
    const islandGroup = new THREE.Group();
    
    // Island base (sand) - now with uniform height of 1 unit
    const segments = 32;
    const islandHeight = 1; // Uniform height for all islands
    const baseGeometry = new THREE.CylinderGeometry(size, size * 1.2, islandHeight, segments);
    baseGeometry.scale(scaleX, 1, scaleZ);
    const baseMaterial = new THREE.MeshPhongMaterial({ color: 0xf4a460 });
    const base = new THREE.Mesh(baseGeometry, baseMaterial);
    base.receiveShadow = true;
    base.castShadow = true;
    base.rotation.y = rotation;
    
    // Position the base so its top surface is at y=0
    base.position.y = islandHeight/2;
    islandGroup.add(base);

    // Add some palm trees (smaller size)
    const numTrees = Math.floor(Math.random() * 5) + 3;
    for (let i = 0; i < numTrees; i++) {
        const angle = (i / numTrees) * Math.PI * 2;
        const treeDistance = (size * 0.6) * Math.min(scaleX, scaleZ);
        const treeX = Math.cos(angle + rotation) * treeDistance * (0.4 + Math.random() * 0.6);
        const treeZ = Math.sin(angle + rotation) * treeDistance * (0.4 + Math.random() * 0.6);
        
        // Reduced tree sizes with fixed base height
        const trunkHeight = Math.min(2, size * 0.15);
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.15, trunkHeight, 6),
            new THREE.MeshPhongMaterial({ color: 0x8B4513 })
        );
        trunk.position.set(treeX, islandHeight + trunkHeight/2, treeZ);
        trunk.castShadow = true;
        islandGroup.add(trunk);

        const leavesSize = Math.min(1, size * 0.08);
        const leaves = new THREE.Mesh(
            new THREE.ConeGeometry(leavesSize, leavesSize, 8),
            new THREE.MeshPhongMaterial({ color: 0x228B22 })
        );
        leaves.position.set(treeX, islandHeight + trunkHeight + leavesSize/2, treeZ);
        leaves.castShadow = true;
        islandGroup.add(leaves);
    }

    islandGroup.position.set(x, 0, z);
    
    // Add collision data to the island group
    islandGroup.userData.isIsland = true;
    islandGroup.userData.size = size;
    islandGroup.userData.scaleX = scaleX;
    islandGroup.userData.scaleZ = scaleZ;
    islandGroup.userData.rotation = rotation;

    // Create and add minimap marker for the island
    const markerSize = size * 4; // Increased base size for better visibility
    const islandMarker = createMinimapMarker(0xf4a460, markerSize, true, scaleX, scaleZ); // Sandy color for islands
    islandMarker.position.set(x, 0, z); // Remove height offset for minimap markers
    minimapScene.add(islandMarker);

    return islandGroup;
}

// Function to check collision between ship and island
function checkIslandCollision(shipPosition, island) {
    // Get island world position
    const islandPos = new THREE.Vector3();
    island.getWorldPosition(islandPos);

    // Transform ship position to island's local space (accounting for rotation)
    const localShipPos = shipPosition.clone().sub(islandPos);
    localShipPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), -island.userData.rotation);

    // Calculate scaled distances with expanded boundary (adding 2 units for ship size)
    const shipSize = 2; // Approximate ship radius
    const expandedSizeX = (island.userData.size * island.userData.scaleX) + shipSize;
    const expandedSizeZ = (island.userData.size * island.userData.scaleZ) + shipSize;
    
    const dx = localShipPos.x / expandedSizeX;
    const dz = localShipPos.z / expandedSizeZ;

    // Check if point is inside the expanded ellipse
    return (dx * dx + dz * dz) <= 1;
}

// Function to handle collision response
function handleCollisions(newPosition) {
    let collisionDetected = false;
    
    // Check collision with each island
    scene.children.forEach(child => {
        if (child.userData.isIsland) {
            if (checkIslandCollision(newPosition, child)) {
                collisionDetected = true;
            }
        }
    });

    return !collisionDetected;
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
        case ' ': // Spacebar
            gameState.keys.space = true;
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
        case ' ': // Spacebar
            gameState.keys.space = false;
            break;
    }
}

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);

// Network event handlers
networkManager.on('init', (data) => {
    console.log('Received init data:', data);
    console.log('My player ID:', networkManager.playerId);
    
    // Add islands from server data
    if (data.gameState && data.gameState.world && data.gameState.world.islands) {
        console.log('Adding islands:', data.gameState.world.islands);
        data.gameState.world.islands.forEach(island => {
            // Only scale the position to fit within 800x800 world, keep original size
            const scaledX = (island.x / 2000) * 800;
            const scaledZ = (island.z / 2000) * 800;
            const islandMesh = createIsland(
                scaledX, 
                scaledZ, 
                island.size,  // Keep original size
                island.scaleX,
                island.scaleZ,
                island.rotation
            );
            scene.add(islandMesh);
        });
    } else {
        console.warn('No islands data received in init');
    }

    // Add other players
    if (data.gameState && data.gameState.players) {
        console.log('Current players in gameState:', Array.from(gameState.otherPlayers.keys()));
        console.log('Adding players from init:', data.gameState.players); // Debug log
        data.gameState.players.forEach(player => {
            console.log('Checking player:', player.id, 'against my ID:', networkManager.playerId);
            if (player.id !== networkManager.playerId) {
                console.log('Adding other player:', player.id);
                if (!gameState.otherPlayers.has(player.id)) {
                    addOtherPlayer(player);
                } else {
                    console.log('Player already exists:', player.id);
                }
            } else {
                console.log('Skipping self:', player.id);
            }
        });
    } else {
        console.warn('No players data received in init'); // Debug log
    }
    
    // Update stats display
    updateStatsDisplay();
});

networkManager.on('playerJoined', (data) => {
    console.log('Player joined event:', data);
    console.log('Current players:', Array.from(gameState.otherPlayers.keys()));
    if (data.player.id !== networkManager.playerId) {
        if (!gameState.otherPlayers.has(data.player.id)) {
            console.log('Adding new player:', data.player.id);
            addOtherPlayer(data.player);
        } else {
            console.log('Player already exists (join event):', data.player.id);
        }
    } else {
        console.log('Ignoring join event for self:', data.player.id);
    }
    updateStatsDisplay();
});

networkManager.on('playerLeft', (data) => {
    console.log('Player left:', data.playerId);
    removeOtherPlayer(data.playerId);
    updateStatsDisplay();
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

// Update the health update handler
networkManager.on('updateHealth', (data) => {
    console.log('Health update received:', data);
    updatePlayerHealth(data.health, 'server');
});

// Helper functions for managing other players
function addOtherPlayer(playerData) {
    console.log('Adding player with full data:', playerData);
    const ship = createShip(true);
    
    // Verify position data
    if (!playerData.position || typeof playerData.position.x !== 'number') {
        console.error('Invalid position data:', playerData.position);
        playerData.position = { x: 0, y: 0, z: 0 };
    }
    
    // Set position and log for verification
    ship.position.set(
        playerData.position.x,
        playerData.position.y,
        playerData.position.z
    );
    console.log('Ship created at position:', ship.position.clone());
    
    scene.add(ship);
    gameState.otherPlayers.set(playerData.id, ship);

    // Add minimap marker
    const marker = createMinimapMarker(0xff0000, 30);
    marker.position.set(ship.position.x, 0.1, ship.position.z);
    marker.rotation.x = -Math.PI / 2;
    minimapScene.add(marker);
    playerMarkers.set(playerData.id, marker);
}

function removeOtherPlayer(playerId) {
    const ship = gameState.otherPlayers.get(playerId);
    if (ship) {
        scene.remove(ship);
        gameState.otherPlayers.delete(playerId);
    }

    const marker = playerMarkers.get(playerId);
    if (marker) {
        minimapScene.remove(marker);
        playerMarkers.delete(playerId);
    }
}

function updateOtherPlayerPosition(playerId, position) {
    const ship = gameState.otherPlayers.get(playerId);
    if (ship) {
        console.log('Updating player position:', playerId);
        console.log('Old position:', ship.position.clone());
        console.log('New position:', position);
        
        // Always update position immediately
        ship.position.set(position.x, position.y, position.z);
        
        // Update minimap marker
        const marker = playerMarkers.get(playerId);
        if (marker) {
            marker.position.set(position.x, 0.1, position.z);
            marker.rotation.x = -Math.PI / 2;
        }
    } else {
        console.error('Could not find ship for player:', playerId);
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

// Function to create bullet
function createBullet(position, rotation, isPlayerBullet = true) {
    const bulletGeometry = new THREE.SphereGeometry(0.2, 8, 8);
    const bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const bullet = new THREE.Mesh(bulletGeometry, bulletMaterial);
    
    // Set initial position slightly in front of the ship
    const offset = 2;
    bullet.position.set(
        position.x - Math.sin(rotation) * offset,
        0.5,
        position.z - Math.cos(rotation) * offset
    );
    
    bullet.userData.rotation = rotation;
    bullet.userData.distanceTraveled = 0;
    bullet.userData.maxDistance = 30 * 4;
    bullet.userData.speed = 1;
    bullet.userData.isPlayerBullet = isPlayerBullet;
    
    scene.add(bullet);
    gameState.bullets.push(bullet);
}

// Function to create hit effect
function createHitEffect(position) {
    console.log('Creating hit effect at position:', position);
    
    // Create explosion sphere
    const hitGeometry = new THREE.SphereGeometry(3, 32, 32);
    const hitMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xff0000,
        transparent: true,
        opacity: 1
    });
    const hitEffect = new THREE.Mesh(hitGeometry, hitMaterial);
    
    // Ensure position is properly set
    hitEffect.position.set(
        position.x,
        2,  // Raised higher for better visibility
        position.z
    );
    scene.add(hitEffect);

    // Create particle effect
    const particleCount = 30;
    const particles = new THREE.Group();
    
    for (let i = 0; i < particleCount; i++) {
        const particle = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 8, 8),
            new THREE.MeshBasicMaterial({ 
                color: 0xff4400,
                transparent: true,
                opacity: 1
            })
        );
        
        // Random initial position within the explosion radius
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 2;
        const radius = Math.random() * 3;
        
        particle.position.set(
            Math.sin(theta) * Math.cos(phi) * radius,
            Math.sin(theta) * Math.sin(phi) * radius,
            Math.cos(theta) * radius
        );
        
        particle.userData.velocity = particle.position.clone().normalize().multiplyScalar(0.3);
        particles.add(particle);
    }
    
    particles.position.copy(hitEffect.position);
    scene.add(particles);

    // Create shockwave ring
    const ringGeometry = new THREE.RingGeometry(0.1, 0.5, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xff0000,
        transparent: true,
        opacity: 1,
        side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.copy(hitEffect.position);
    ring.rotation.x = -Math.PI / 2; // Lay flat
    scene.add(ring);

    // Animate the hit effect
    const startTime = Date.now();
    const duration = 1000; // milliseconds
    
    function animateHit() {
        const elapsed = Date.now() - startTime;
        if (elapsed < duration) {
            const progress = elapsed / duration;
            
            // Expand and fade main explosion
            const scale = 1 + progress * 4;
            hitEffect.scale.set(scale, scale, scale);
            hitEffect.material.opacity = 1 - progress;
            
            // Animate particles
            particles.children.forEach((particle, i) => {
                particle.position.add(particle.userData.velocity);
                particle.material.opacity = 1 - progress;
                particle.scale.multiplyScalar(0.98);
            });
            
            // Animate shockwave ring
            const ringScale = 1 + progress * 8;
            ring.scale.set(ringScale, ringScale, ringScale);
            ring.material.opacity = 1 - progress;
            
            requestAnimationFrame(animateHit);
        } else {
            scene.remove(hitEffect);
            scene.remove(particles);
            scene.remove(ring);
        }
    }
    
    animateHit();
}

// Function to handle bullet collisions
function handleBulletCollisions(bullet) {
    if (!bullet || !bullet.userData) {
        console.error('Invalid bullet object:', bullet);
        return true; // Remove invalid bullets
    }

    if (bullet.userData.isPlayerBullet) {
        // Check collisions with other players
        for (const [playerId, ship] of gameState.otherPlayers) {
            if (!ship || !ship.position) {
                console.error('Invalid ship object for player:', playerId);
                continue;
            }

            const distance = bullet.position.distanceTo(ship.position);
            if (distance < 3) {
                console.log('Bullet hit player:', playerId, 'at distance:', distance);
                
                // Remove bullet first to prevent double hits
                scene.remove(bullet);
                const bulletIndex = gameState.bullets.indexOf(bullet);
                if (bulletIndex > -1) {
                    gameState.bullets.splice(bulletIndex, 1);
                }
                
                // Create hit effect immediately for responsive feedback
                createHitEffect(ship.position.clone());
                
                // Send hit event to server with precise position
                networkManager.send({
                    type: 'playerHit',
                    targetId: playerId,
                    shooterId: networkManager.playerId,
                    position: {
                        x: ship.position.x,
                        y: ship.position.y,
                        z: ship.position.z
                    },
                    damage: 10
                });
                
                return true;
            }
        }
    } else {
        // Check collision with player ship
        if (!playerShip || !playerShip.position) {
            console.error('Invalid player ship object');
            return true;
        }

        const distanceToPlayer = bullet.position.distanceTo(playerShip.position);
        if (distanceToPlayer < 3) {
            console.log('Player was hit! Distance:', distanceToPlayer);
            
            // Remove bullet first
            scene.remove(bullet);
            const bulletIndex = gameState.bullets.indexOf(bullet);
            if (bulletIndex > -1) {
                gameState.bullets.splice(bulletIndex, 1);
            }
            
            // Create hit effect immediately for responsive feedback
            createHitEffect(playerShip.position.clone());
            
            return true;
        }
    }
    return false;
}

// Update the hit handler
networkManager.on('playerHit', (data) => {
    console.log('Hit event received:', data);
    
    const hitShip = data.targetId === networkManager.playerId ? 
        playerShip : 
        gameState.otherPlayers.get(data.targetId);

    if (hitShip) {
        console.log('Processing hit on ship:', data.targetId);
        
        // Only update health if we're the target
        if (data.targetId === networkManager.playerId) {
            const newHealth = gameState.playerShip.health - (data.damage || 10);
            if (updatePlayerHealth(newHealth, 'hit')) {
                // Only send update if health actually changed
                networkManager.send({
                    type: 'updateHealth',
                    health: gameState.playerShip.health
                });
            }
        }
        
        // Create hit effect at the correct position
        createHitEffect(hitShip.position.clone());
    } else {
        console.error('Could not find ship for hit:', data.targetId);
    }
});

// Update game state
function updateGame() {
    // Handle forward/backward movement
    if (gameState.keys.up) {
        const oldSpeed = gameState.playerShip.speed;
        gameState.playerShip.speed = Math.min(
            gameState.playerShip.speed + gameState.playerShip.acceleration,
            gameState.playerShip.maxSpeed
        );
        if (oldSpeed !== gameState.playerShip.speed) {
            console.log('Speed increased:', gameState.playerShip.speed);
            networkManager.updateSpeed(gameState.playerShip.speed);
        }
    } else if (gameState.keys.down) {
        const oldSpeed = gameState.playerShip.speed;
        gameState.playerShip.speed = Math.max(
            gameState.playerShip.speed - gameState.playerShip.acceleration,
            -gameState.playerShip.maxSpeed / 2
        );
        if (oldSpeed !== gameState.playerShip.speed) {
            console.log('Speed decreased:', gameState.playerShip.speed);
            networkManager.updateSpeed(gameState.playerShip.speed);
        }
    } else if (Math.abs(gameState.playerShip.speed) > 0.01) {
        // Apply drag when no movement keys are pressed
        const oldSpeed = gameState.playerShip.speed;
        gameState.playerShip.speed *= 0.95;
        if (Math.abs(gameState.playerShip.speed) < 0.01) {
            gameState.playerShip.speed = 0;
        }
        if (oldSpeed !== gameState.playerShip.speed) {
            console.log('Speed changed due to drag:', gameState.playerShip.speed);
            networkManager.updateSpeed(gameState.playerShip.speed);
        }
    }

    // Handle rotation
    if (gameState.keys.left) {
        const oldRotation = gameState.playerShip.rotation;
        gameState.playerShip.rotation += gameState.playerShip.turnSpeed;
        if (oldRotation !== gameState.playerShip.rotation) {
            console.log('Rotation changed (left):', gameState.playerShip.rotation);
            networkManager.updateRotation(gameState.playerShip.rotation);
        }
    }
    if (gameState.keys.right) {
        const oldRotation = gameState.playerShip.rotation;
        gameState.playerShip.rotation -= gameState.playerShip.turnSpeed;
        if (oldRotation !== gameState.playerShip.rotation) {
            console.log('Rotation changed (right):', gameState.playerShip.rotation);
            networkManager.updateRotation(gameState.playerShip.rotation);
        }
    }

    // Update ship position based on speed and rotation
    if (Math.abs(gameState.playerShip.speed) > 0) {  // No threshold check
        const oldPosition = playerShip.position.clone();
        const newPosition = new THREE.Vector3(
            playerShip.position.x - Math.sin(gameState.playerShip.rotation) * gameState.playerShip.speed,
            playerShip.position.y,
            playerShip.position.z - Math.cos(gameState.playerShip.rotation) * gameState.playerShip.speed
        );

        // Check for collisions before updating position
        if (handleCollisions(newPosition)) {
            console.log('Moving from', oldPosition, 'to', newPosition);
            playerShip.position.copy(newPosition);
            networkManager.updatePosition(playerShip.position);  // Always send position updates
        } else {
            console.log('Collision detected, stopping ship');
            gameState.playerShip.speed = 0;
            networkManager.updateSpeed(0);
        }
    }

    // Update ship visual rotation
    playerShip.rotation.y = gameState.playerShip.rotation;

    // Update camera position
    const cameraDistance = 15;
    const cameraHeight = 10;
    camera.position.x = playerShip.position.x + Math.sin(gameState.playerShip.rotation) * cameraDistance;
    camera.position.z = playerShip.position.z + Math.cos(gameState.playerShip.rotation) * cameraDistance;
    camera.position.y = cameraHeight;
    camera.lookAt(playerShip.position);

    // Handle shooting
    if (gameState.keys.space && gameState.playerShip.canShoot) {
        createBullet(playerShip.position, gameState.playerShip.rotation);
        gameState.playerShip.canShoot = false;
        setTimeout(() => {
            gameState.playerShip.canShoot = true;
        }, gameState.playerShip.shootCooldown);
    }

    // Update bullets
    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        const bullet = gameState.bullets[i];
        
        // Move bullet forward
        bullet.position.x -= Math.sin(bullet.userData.rotation) * bullet.userData.speed;
        bullet.position.z -= Math.cos(bullet.userData.rotation) * bullet.userData.speed;
        
        // Update distance traveled
        bullet.userData.distanceTraveled += bullet.userData.speed;
        
        // Check for collisions
        if (handleBulletCollisions(bullet)) {
            continue;
        }
        
        // Remove bullet if it has traveled its maximum distance
        if (bullet.userData.distanceTraveled >= bullet.userData.maxDistance) {
            scene.remove(bullet);
            gameState.bullets.splice(i, 1);
        }
    }

    // Update stats display
    updateStatsDisplay();
}

// Update the animation loop
function animate() {
    requestAnimationFrame(animate);
    
    // Update ocean textures
    oceanAnimation.time += 0.005;
    
    // Move main water texture in a back-and-forth pattern
    waterTexture.offset.x = Math.sin(oceanAnimation.time * 0.2) * 0.1;
    waterTexture.offset.y = Math.cos(oceanAnimation.time * 0.15) * 0.1;
    
    // Move normal map texture in a slightly different pattern
    waterNormalMap.offset.x = Math.sin(oceanAnimation.time * 0.15) * 0.08;
    waterNormalMap.offset.y = Math.cos(oceanAnimation.time * 0.1) * 0.08;
    
    updateGame();

    // Update player marker position on minimap with slight height offset
    playerMarker.position.set(playerShip.position.x, 0.1, playerShip.position.z);
    playerMarker.rotation.x = -Math.PI / 2; // Ensure marker stays flat
    
    // Render both main view and minimap
    renderer.render(scene, camera);
    minimapRenderer.render(minimapScene, minimapCamera);
}

// Connect to server and start game
networkManager.connect();
animate();

// Handle window resize for both renderers
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}); 