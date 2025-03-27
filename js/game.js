import * as THREE from 'three';
import networkManager from './network.js';

// --- Game State ---
const gameState = {
    playerShip: { // Local player specific state
        position: new THREE.Vector3(0, 0, 0), // This is mirrored by the playerShip mesh
        rotation: 0, // This is mirrored by the playerShip mesh
        speed: 0,
        turnSpeed: 0.03,
        maxSpeed: 0.5,
        acceleration: 0.01,
        health: 100, // Single source of truth for local player health
        canShoot: true,
        shootCooldown: 125 // Matches server WEAPON_COOLDOWN
    },
    otherPlayers: new Map(), // Map<playerId, { ship: THREE.Group, marker: THREE.Mesh }>
    bullets: [], // Array of active bullet meshes { mesh: THREE.Mesh, data: {...} } -> CHANGED: Now just Array<THREE.Mesh>
    keys: { up: false, down: false, left: false, right: false, space: false },
    islands: [], // Store island group meshes for efficient collision checks
    islandMarkers: new Map() // Store minimap markers for islands Map<islandMesh.uuid, markerMesh>
};

// --- DOM Elements ---
const statsElements = {
    playerCount: document.getElementById('player-count'),
    shipSpeed: document.getElementById('ship-speed'),
    shipHealth: document.getElementById('ship-health'),
    connectionStatus: document.getElementById('connection-status') // Assumes you add this to HTML
};
const gameContainer = document.getElementById('game-container');
const minimapContainer = document.getElementById('minimap-container');

if (!gameContainer || !minimapContainer) {
    console.error('Essential containers (#game-container, #minimap-container) not found!');
    throw new Error("Missing essential DOM elements.");
}

// --- Three.js Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
// BRIGHTER: Changed clear color
renderer.setClearColor(0x87CEEB); // Sky Blue
renderer.shadowMap.enabled = true;
gameContainer.appendChild(renderer.domElement);

// --- Minimap Setup ---
const minimapSize = 200;
const minimapWorldScale = 400; // How much world distance the minimap width/height covers
const minimapScene = new THREE.Scene();
const minimapCamera = new THREE.OrthographicCamera(
    -minimapWorldScale, minimapWorldScale, // left, right
    minimapWorldScale, -minimapWorldScale, // top, bottom (inverted y)
    0.1, 1000 // near, far
);
minimapCamera.position.set(0, 100, 0); // Look straight down
minimapCamera.lookAt(0, 0, 0);
const minimapRenderer = new THREE.WebGLRenderer({ antialias: true });
minimapRenderer.setSize(minimapSize, minimapSize);
minimapRenderer.setClearColor(0x001a33, 0.8); // Semi-transparent dark blue
minimapContainer.appendChild(minimapRenderer.domElement);

// --- Lighting --- BRIGHTER
// scene.add(new THREE.AmbientLight(0x666688)); // Removed previous ambient
// Added Hemisphere Light for more natural ambient lighting
const hemiLight = new THREE.HemisphereLight(0xB1E1FF, 0xB97A20, 0.8); // Sky, Ground, Intensity
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.5); // Increased intensity
sunLight.position.set(100, 150, 100);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 50;
sunLight.shadow.camera.far = 500;
sunLight.shadow.camera.left = -250; // Adjusted bounds slightly
sunLight.shadow.camera.right = 250;
sunLight.shadow.camera.top = 250;
sunLight.shadow.camera.bottom = -250;
scene.add(sunLight);
// scene.add(new THREE.CameraHelper(sunLight.shadow.camera)); // Uncomment to debug shadow area

// --- Ocean --- BRIGHTER
const waterTexture = new THREE.TextureLoader().load('https://threejs.org/examples/textures/water.jpg');
waterTexture.wrapS = waterTexture.wrapT = THREE.RepeatWrapping;
const waterNormalMap = new THREE.TextureLoader().load('https://threejs.org/examples/textures/waternormals.jpg');
waterNormalMap.wrapS = waterNormalMap.wrapT = THREE.RepeatWrapping;

const oceanGeometry = new THREE.PlaneGeometry(2000, 2000, 100, 100);
const oceanMaterial = new THREE.MeshPhongMaterial({
    // color: 0x004953, // Previous darker color
    color: 0x007799, // Brighter blue/cyan
    shininess: 80, // Slightly more shine
    specular: 0x00bbdd, // Brighter specular highlights
    map: waterTexture,
    normalMap: waterNormalMap,
    normalScale: new THREE.Vector2(0.15, 0.15), // Adjusted normal scale
    transparent: true,
    opacity: 0.9
});
const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
ocean.rotation.x = -Math.PI / 2;
ocean.receiveShadow = true;
scene.add(ocean);
const oceanAnimation = { time: 0 };

// --- Player Ship ---
const playerShip = createShip(false); // false = not NPC
scene.add(playerShip);

// --- Minimap Markers ---
const playerMarker = createMinimapMarker(0x00ff00, 30); // Green for player
playerMarker.position.y = 1; // Slightly above others
minimapScene.add(playerMarker);

// --- Utility Functions ---

function createShip(isNPC = false) {
    // ... (createShip function remains the same)
    const shipGroup = new THREE.Group();
    const mainColor = isNPC ? 0xcc0000 : 0x8B4513; // Red for NPC, Brown for player
    const sailColor = isNPC ? 0xaaaaaa : 0xFFFFFF;

    const hullGeo = new THREE.BoxGeometry(2, 1, 4);
    const hullMat = new THREE.MeshPhongMaterial({ color: mainColor });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 0.5;
    hull.castShadow = true;
    hull.receiveShadow = true; // Hull can receive shadows too
    shipGroup.add(hull);

    const mastGeo = new THREE.CylinderGeometry(0.1, 0.1, 3, 8);
    const mastMat = new THREE.MeshPhongMaterial({ color: 0x5a3a22 });
    const mast = new THREE.Mesh(mastGeo, mastMat);
    mast.position.y = 2; // Base at 0.5 (top of hull) + 1.5 (half height)
    mast.castShadow = true;
    shipGroup.add(mast);

    const sailGeo = new THREE.PlaneGeometry(1.5, 2);
    const sailMat = new THREE.MeshPhongMaterial({ color: sailColor, side: THREE.DoubleSide });
    const sail = new THREE.Mesh(sailGeo, sailMat);
    sail.position.set(0, 2.5, -0.1); // Position relative to mast center
    sail.castShadow = true;
    shipGroup.add(sail);

    shipGroup.userData.isShip = true;
    shipGroup.userData.isNPC = isNPC;

    return shipGroup;
}

function createIsland(x, z, size, scaleX = 1, scaleZ = 1, rotation = 0) {
    const islandGroup = new THREE.Group();
    const islandHeight = 1.5; // Slightly higher for better visibility

    // Base geometry using Cylinder for rounded look
    const baseGeo = new THREE.CylinderGeometry(size, size * 1.1, islandHeight, 32);
    baseGeo.scale(scaleX, 1, scaleZ); // Apply scaling
    const baseMat = new THREE.MeshPhongMaterial({ color: 0xb8860b, flatShading: true }); // DarkGoldenRod, flat shaded
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = islandHeight / 2; // Position base top at y=islandHeight
    base.rotation.y = rotation; // Apply rotation
    base.castShadow = true;
    base.receiveShadow = true;
    islandGroup.add(base);

    // Add some simple rocks/details (optional)
    const numDetails = Math.floor(Math.random() * 4) + 2;
    for (let i = 0; i < numDetails; i++) {
        const detailSize = Math.random() * size * 0.2 + size * 0.1;
        const detailGeo = new THREE.DodecahedronGeometry(detailSize, 0); // Simple rock shape
        const detailMat = new THREE.MeshPhongMaterial({ color: 0x888888, flatShading: true });
        const detail = new THREE.Mesh(detailGeo, detailMat);
        const angle = Math.random() * Math.PI * 2;
        // Distribute details over scaled radius
        const detailDistX = (Math.random() * size * scaleX * 0.8);
        const detailDistZ = (Math.random() * size * scaleZ * 0.8);
        detail.position.set(
            Math.cos(angle) * detailDistX,
            islandHeight, // Place on top surface
            Math.sin(angle) * detailDistZ
        );
        detail.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        detail.castShadow = true;
        detail.position.applyAxisAngle(new THREE.Vector3(0,1,0), rotation); // Apply island rotation
        islandGroup.add(detail);
    }

    islandGroup.position.set(x, 0, z); // Group position remains at water level

    // Add collision data to the group itself
    islandGroup.userData.isIsland = true;
    islandGroup.userData.center = new THREE.Vector3(x, 0, z); // Store world center
    islandGroup.userData.size = size; // Store base radius before scaling
    islandGroup.userData.scaleX = scaleX;
    islandGroup.userData.scaleZ = scaleZ;
    islandGroup.userData.rotation = rotation;
    islandGroup.userData.effectiveRadiusX = size * scaleX;
    islandGroup.userData.effectiveRadiusZ = size * scaleZ;

    // Add to efficient collision list
    gameState.islands.push(islandGroup);

    // Create and add minimap marker for the island
    const markerBaseSize = size * 1.5; // Base marker size on island size
    const islandMarker = createMinimapMarker(0xb8860b, markerBaseSize, true, scaleX, scaleZ); // Pass scales
    islandMarker.position.set(x, 0.5, z); // Slightly above other markers
    islandMarker.rotation.y = rotation; // Match island rotation
    minimapScene.add(islandMarker);
    // Store marker for later removal
    gameState.islandMarkers.set(islandGroup.uuid, islandMarker);

    return islandGroup; // Return the group to be added to the main scene
}


function createMinimapMarker(color, size = 6, isIsland = false, scaleX = 1, scaleZ = 1) {
    let markerGeometry;
    if (isIsland) {
        // Elliptical marker for islands
        markerGeometry = new THREE.CircleGeometry(size / 2, 16); // Use circle as base
        // Scaling is applied AFTER creation now
    } else {
        // Triangle marker for players, pointing forward
        const shape = new THREE.Shape();
        shape.moveTo(0, size / 2); // Point 'forward' (positive Z in local space before rotation)
        shape.lineTo(-size / 2 * 0.6, -size / 2);
        shape.lineTo(size / 2 * 0.6, -size / 2);
        shape.closePath();
        markerGeometry = new THREE.ShapeGeometry(shape);
    }

    const markerMaterial = new THREE.MeshBasicMaterial({
        color: color,
        side: THREE.DoubleSide // Ensure visible if camera angle changes slightly
    });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.rotation.x = -Math.PI / 2; // Lay flat on the XZ plane (looking down Y)
    if (isIsland) {
         marker.scale.set(scaleX, scaleZ, 1); // Scale ellipse marker AFTER creation
    }
    marker.position.y = 0.1; // Default height, overridden later
    return marker;
}

// Modified createBullet to store data in userData
function createBullet(shooterPosition, shooterRotation, shooterId) {
    const bulletGeo = new THREE.SphereGeometry(0.25, 8, 6);
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });
    const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);

    // Store data directly in userData
    bulletMesh.userData = {
        shooterId: shooterId,
        rotation: shooterRotation, // Direction
        speed: 1.5,
        distanceTraveled: 0,
        maxDistance: 80, // Matches server range roughly
        damage: 10,
        creationTime: Date.now()
    };

    // Calculate starting position
    const forwardOffset = 2.5;
    const verticalOffset = 0.7;
    bulletMesh.position.set(
        shooterPosition.x - Math.sin(shooterRotation) * forwardOffset,
        shooterPosition.y + verticalOffset,
        shooterPosition.z - Math.cos(shooterRotation) * forwardOffset
    );

    scene.add(bulletMesh);
    gameState.bullets.push(bulletMesh); // Store only the mesh
}

// ... (createHitEffect remains the same) ...
function createHitEffect(position) {
    if (!position || !(position instanceof THREE.Vector3)) {
        console.error('Invalid position for hit effect:', position);
        position = new THREE.Vector3(0, 0.5, 0); // Default fallback
    }
    const effectPosition = position.clone();
    effectPosition.y = Math.max(0.5, position.y);

    const sphereGeo = new THREE.SphereGeometry(0.5, 16, 8);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff4500, transparent: true, opacity: 0.8 });
    const sphereEffect = new THREE.Mesh(sphereGeo, sphereMat);
    sphereEffect.position.copy(effectPosition);
    scene.add(sphereEffect);

    const ringGeo = new THREE.RingGeometry(0.1, 0.5, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
    const ringEffect = new THREE.Mesh(ringGeo, ringMat);
    ringEffect.position.copy(effectPosition);
    ringEffect.rotation.x = -Math.PI / 2;
    scene.add(ringEffect);

    const duration = 500;
    const startTime = Date.now();

    function animateHit() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / duration);

        if (progress < 1) {
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            sphereEffect.scale.setScalar(1 + easeOutQuart * 4);
            sphereEffect.material.opacity = 0.8 * (1 - progress);
            ringEffect.scale.setScalar(1 + easeOutQuart * 6);
            ringEffect.material.opacity = 0.7 * (1 - progress * progress);
            requestAnimationFrame(animateHit);
        } else {
            scene.remove(sphereEffect);
            sphereEffect.geometry.dispose(); // Dispose geo
            sphereEffect.material.dispose(); // Dispose mat
            scene.remove(ringEffect);
            ringEffect.geometry.dispose(); // Dispose geo
            ringEffect.material.dispose(); // Dispose mat
        }
    }
    animateHit();
}

// --- Collision Detection ---
// ... (checkIslandCollision remains the same) ...
function checkIslandCollision(shipPosition, island) {
    const islandData = island.userData;
    const islandPos = islandData.center;
    const localShipPos = shipPosition.clone().sub(islandPos);
    localShipPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), -islandData.rotation);
    const shipRadiusApproximation = 1.5;
    const effectiveRadiusX = islandData.effectiveRadiusX + shipRadiusApproximation;
    const effectiveRadiusZ = islandData.effectiveRadiusZ + shipRadiusApproximation;
    const dx = localShipPos.x / effectiveRadiusX;
    const dz = localShipPos.z / effectiveRadiusZ;
    return (dx * dx + dz * dz) <= 1;
}

// ... (handlePlayerCollisions remains the same) ...
function handlePlayerCollisions(newPosition) {
    for (const island of gameState.islands) {
        if (checkIslandCollision(newPosition, island)) {
            return true; // Collision detected
        }
    }
    return false; // No collision
}


// Modified handleBulletCollisions to use userData and remove damage calculation
function handleBulletCollisions(bulletMesh) { // Takes mesh directly
    const bulletData = bulletMesh.userData;

    // 1. Check against Islands
    for (const island of gameState.islands) {
        const islandData = island.userData;
        const distSq = bulletMesh.position.distanceToSquared(islandData.center);
        const maxIslandRadiusSq = Math.pow(Math.max(islandData.effectiveRadiusX, islandData.effectiveRadiusZ) + 0.5, 2);
        if (distSq < maxIslandRadiusSq) {
            if (checkIslandCollision(bulletMesh.position, island)) {
                console.log('Bullet hit island');
                createHitEffect(bulletMesh.position.clone());
                return true; // Collision detected
            }
        }
    }

    // 2. Check against Other Players
    const approxShipRadius = 2.0;
    for (const [playerId, playerData] of gameState.otherPlayers) {
        if (playerId === bulletData.shooterId) continue;
        const ship = playerData.ship;
        if (!ship) continue;
        const distance = bulletMesh.position.distanceTo(ship.position);
        if (distance < approxShipRadius) {
            console.log(`Bullet from ${bulletData.shooterId} potentially hit player ${playerId}`);
            // REPORT hit to server, server determines damage/effect
            networkManager.sendPlayerHit(playerId, bulletData.damage, bulletMesh.position.clone());
            // Optional immediate client effect (server also broadcasts one)
            // createHitEffect(bulletMesh.position.clone());
            return true; // Collision detected
        }
    }

     // 3. Check against the Local Player Ship
     if (networkManager.playerId && bulletData.shooterId !== networkManager.playerId) {
         const distance = bulletMesh.position.distanceTo(playerShip.position);
         if (distance < approxShipRadius) {
             console.log(`Bullet from ${bulletData.shooterId} potentially hit LOCAL player ${networkManager.playerId}`);
             networkManager.sendPlayerHit(networkManager.playerId, bulletData.damage, bulletMesh.position.clone());
             // Optional immediate client effect
             // createHitEffect(bulletMesh.position.clone());
             return true; // Collision detected
         }
     }

    return false; // No collision
}

// --- Player Management ---

function addOtherPlayer(playerData) {
    if (!playerData || !playerData.id) {
        console.error('Invalid player data for addOtherPlayer:', playerData);
        return;
    }
    if (playerData.id === networkManager.playerId) return; // Don't add self
    if (gameState.otherPlayers.has(playerData.id)) {
        console.warn(`Player ${playerData.id} already exists. Updating instead.`);
        updateOtherPlayer(playerData);
        return;
    }

    console.log('Adding other player:', playerData.id);
    const ship = createShip(true); // true = is NPC/Other
    const position = playerData.position || { x: 0, y: 0, z: 0 };
    const rotation = playerData.rotation || 0;
    ship.position.set(position.x, position.y, position.z);
    ship.rotation.y = rotation;
    scene.add(ship);

    const marker = createMinimapMarker(0xff0000, 30); // Red for others
    marker.position.set(position.x, 0.6, position.z); // Use world coords
    marker.rotation.y = rotation; // Initial rotation
    minimapScene.add(marker);

    gameState.otherPlayers.set(playerData.id, { ship, marker });
    updateStatsDisplay();
}

// Modified removeOtherPlayer to include resource disposal
function removeOtherPlayer(playerId) {
    if (playerId === networkManager.playerId) return;

    const playerData = gameState.otherPlayers.get(playerId);
    if (playerData) {
        console.log('Removing other player:', playerId);

        // Dispose Ship Resources
        if (playerData.ship) {
            scene.remove(playerData.ship);
            playerData.ship.traverse(child => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    if (child.material) {
                         if (Array.isArray(child.material)) {
                              child.material.forEach(mat => mat?.dispose());
                         } else {
                              child.material?.dispose();
                         }
                    }
                }
            });
        }

        // Dispose Marker Resources
        if (playerData.marker) {
            minimapScene.remove(playerData.marker);
            playerData.marker.geometry?.dispose();
            playerData.marker.material?.dispose();
        }

        gameState.otherPlayers.delete(playerId);
        updateStatsDisplay();
    } else {
        console.warn('Attempted to remove non-existent player:', playerId);
    }
}

function updateOtherPlayer(playerData) {
     if (!playerData || !playerData.id || playerData.id === networkManager.playerId) return;
     const existingPlayerData = gameState.otherPlayers.get(playerData.id);
     if (existingPlayerData) {
         if (existingPlayerData.ship) { // Check ship exists
             if (playerData.position) {
                 existingPlayerData.ship.position.set(playerData.position.x, playerData.position.y, playerData.position.z);
             }
             if (typeof playerData.rotation === 'number') {
                 existingPlayerData.ship.rotation.y = playerData.rotation;
             }
             // We don't visually use speed for other players directly
         } else {
             console.warn(`Ship missing for player ${playerData.id} during update.`);
             // Attempt to re-add if ship is missing but player data exists
             removeOtherPlayer(playerData.id); // Clean up marker if it exists
             addOtherPlayer(playerData);
             return; // Exit after re-adding
         }

         // Update Marker - ENSURE marker exists
         if (existingPlayerData.marker) {
             if (playerData.position) {
                 // Update marker world position
                 existingPlayerData.marker.position.set(playerData.position.x, existingPlayerData.marker.position.y, playerData.position.z);
             }
             if (typeof playerData.rotation === 'number') {
                 // Sync marker rotation with ship rotation
                 existingPlayerData.marker.rotation.y = playerData.rotation;
             }
         } else {
              console.warn(`Marker missing for player ${playerData.id} during update.`);
              // Marker should have been created in addOtherPlayer, potential issue if add failed partially?
         }

     } else {
          // Player doesn't exist in our map yet, add them.
          // This handles cases where updates might arrive slightly before playerJoined.
          // console.log(`Update called for non-existent player ${playerData.id}, adding.`);
          addOtherPlayer(playerData);
     }
}


// --- Stats & UI Updates ---
// ... (updateStatsDisplay remains the same) ...
function updateStatsDisplay() {
    if (statsElements.playerCount) {
        statsElements.playerCount.textContent = gameState.otherPlayers.size + 1;
    }
    if (statsElements.shipSpeed) {
        statsElements.shipSpeed.textContent = Math.abs(gameState.playerShip.speed).toFixed(2);
    }
}
// ... (updateHealthDisplay remains the same) ...
function updateHealthDisplay(newHealth, oldHealth, damage) {
    const currentHealth = Math.max(0, Math.min(100, Math.round(newHealth)));
    gameState.playerShip.health = currentHealth;

    if (!statsElements.shipHealth) return;
    const healthElement = statsElements.shipHealth;
    healthElement.textContent = currentHealth.toString();
    let healthColor = '#4CAF50'; // Green
    if (currentHealth <= 30) healthColor = '#ff0000'; // Red
    else if (currentHealth <= 60) healthColor = '#ffa500'; // Orange
    healthElement.style.color = healthColor;
    healthElement.style.fontWeight = currentHealth <= 30 ? 'bold' : 'normal';

    if (damage && damage > 0 && oldHealth !== null && currentHealth < oldHealth) {
        // Floating Damage Text
        const damageText = document.createElement('div');
        damageText.textContent = `-${damage}`;
        /* ... styles ... */
        damageText.style.position = 'absolute';
        damageText.style.color = '#ff0000';
        damageText.style.fontWeight = 'bold';
        damageText.style.fontSize = '20px';
        damageText.style.left = '50%';
        damageText.style.top = '-10px';
        damageText.style.transform = 'translateX(-50%)';
        damageText.style.pointerEvents = 'none';
        damageText.style.transition = 'transform 1s ease-out, opacity 1s ease-out';
        healthElement.parentElement.style.position = 'relative'; // Ensure parent allows absolute positioning
        healthElement.parentElement.appendChild(damageText);
        requestAnimationFrame(() => {
             damageText.style.transform = 'translate(-50%, -40px)';
             damageText.style.opacity = '0';
        });
        setTimeout(() => {
            damageText.parentNode?.removeChild(damageText);
        }, 1000);
        // Screen Shake
        shakeScreen(0.4, 150);
    }
}
// ... (shakeScreen remains the same) ...
function shakeScreen(intensity = 0.5, duration = 200) {
    const startTime = Date.now();
    const baseCameraY = camera.position.y;
    function animateShake() {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / duration;
        if (progress < 1) {
            const shakeAmount = intensity * Math.sin(progress * Math.PI * 4) * (1 - progress);
            camera.position.y = baseCameraY + shakeAmount;
            requestAnimationFrame(animateShake);
        } else {
            camera.position.y = baseCameraY;
        }
    }
    animateShake();
}

// --- Input Handling ---
// ... (handleKeyDown/Up remain the same) ...
function handleKeyDown(event) {
    switch (event.key) {
        case 'ArrowUp': case 'w': gameState.keys.up = true; break;
        case 'ArrowDown': case 's': gameState.keys.down = true; break;
        case 'ArrowLeft': case 'a': gameState.keys.left = true; break;
        case 'ArrowRight': case 'd': gameState.keys.right = true; break;
        case ' ': gameState.keys.space = true; break; // Spacebar
    }
}
function handleKeyUp(event) {
    switch (event.key) {
        case 'ArrowUp': case 'w': gameState.keys.up = false; break;
        case 'ArrowDown': case 's': gameState.keys.down = false; break;
        case 'ArrowLeft': case 'a': gameState.keys.left = false; break;
        case 'ArrowRight': case 'd': gameState.keys.right = false; break;
        case ' ': gameState.keys.space = false; break; // Spacebar
    }
}

window.addEventListener('keydown', handleKeyDown);
window.addEventListener('keyup', handleKeyUp);

// --- Network Event Handlers ---

// UPDATED: 'init' handler to clear island markers and update connection status
networkManager.on('init', (data) => {
    console.log('Network Init:', data);
    if (!data.playerId || !data.gameState) {
        console.error("Invalid init data received!");
        return;
    }

    // --- Clear previous state ---
    // Remove other players + dispose resources
    gameState.otherPlayers.forEach((playerData, playerId) => {
        removeOtherPlayer(playerId); // Use the function which handles disposal
    });
    gameState.otherPlayers.clear(); // Should be empty now but clear just in case

    // Remove islands + dispose resources + remove markers
    gameState.islands.forEach(islandMesh => {
        scene.remove(islandMesh);
        // Dispose island resources (similar to player ship disposal)
        islandMesh.traverse(child => {
             if (child.isMesh) {
                 child.geometry?.dispose();
                 if (child.material) {
                     if (Array.isArray(child.material)) {
                          child.material.forEach(mat => mat?.dispose());
                     } else {
                          child.material?.dispose();
                     }
                 }
             }
        });
        // Remove corresponding marker
        const marker = gameState.islandMarkers.get(islandMesh.uuid);
        if (marker) {
            minimapScene.remove(marker);
            marker.geometry?.dispose();
            marker.material?.dispose();
        }
    });
    gameState.islands = []; // Clear the main list
    gameState.islandMarkers.clear(); // Clear the marker map

    // Clear remaining bullets if any
     gameState.bullets.forEach(bulletMesh => {
         scene.remove(bulletMesh);
         bulletMesh.geometry?.dispose();
         bulletMesh.material?.dispose();
     });
     gameState.bullets = [];

    // --- Set new state ---
    // networkManager.playerId is already set internally

    // Add initial islands from server data
    if (data.gameState.world?.islands) {
        data.gameState.world.islands.forEach(islandData => {
            const islandMesh = createIsland(
                islandData.x, islandData.z,
                islandData.size, islandData.scaleX, islandData.scaleZ, islandData.rotation
            );
            scene.add(islandMesh); // createIsland handles adding to lists/minimap
        });
    } else {
        console.warn("No island data in init message.");
    }

    // Add initial other players
    if (data.gameState.players) {
        data.gameState.players.forEach(playerData => {
            addOtherPlayer(playerData);
        });
    }

    // Set initial player state
    const selfData = data.gameState.players?.find(p => p.id === networkManager.playerId);
    if (selfData) {
        gameState.playerShip.health = selfData.health ?? 100; // Use ?? for nullish coalescing
        // Set initial position/rotation IF provided and different from default
        if (selfData.position && (selfData.position.x !== 0 || selfData.position.z !== 0)) {
             playerShip.position.set(selfData.position.x, selfData.position.y, selfData.position.z);
             console.log("Set initial player position from server:", playerShip.position);
        }
         if (typeof selfData.rotation === 'number' && selfData.rotation !== 0) {
            gameState.playerShip.rotation = selfData.rotation;
            playerShip.rotation.y = selfData.rotation; // Sync mesh immediately
            console.log("Set initial player rotation from server:", selfData.rotation);
         }
    }
    updateHealthDisplay(gameState.playerShip.health, null, 0);
    updateStatsDisplay();

    // Update Connection Status UI
    if (statsElements.connectionStatus) {
        statsElements.connectionStatus.textContent = "Connected";
        statsElements.connectionStatus.style.color = "#4CAF50"; // Green
    }
});

networkManager.on('playerJoined', (data) => {
    // console.log('Network Player Joined:', data); // Less noise
    if (data.player) {
        addOtherPlayer(data.player);
    }
});

networkManager.on('playerLeft', (data) => {
    // console.log('Network Player Left:', data); // Less noise
    if (data.playerId) {
        removeOtherPlayer(data.playerId); // Handles disposal
    }
});

networkManager.on('playerMoved', (data) => {
    updateOtherPlayer(data);
});

networkManager.on('playerRotated', (data) => {
     updateOtherPlayer(data);
});

networkManager.on('playerSpeedChanged', (data) => {
     // We don't really use speed visually for others, but update internal state if needed
     const existing = gameState.otherPlayers.get(data.playerId);
     if (existing && typeof data.speed === 'number') {
         // existing.speed = data.speed; // If we stored speed on the client object
     }
});

networkManager.on('playerHitEffect', (data) => {
    // console.log('Network Player Hit Effect:', data); // Less noise
    if (data.position) {
        const hitPos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
        createHitEffect(hitPos);
    }
});

networkManager.on('updateHealth', (data) => {
    console.log('Network Update Health:', data);
    if (typeof data.health === 'number') {
        updateHealthDisplay(data.health, data.oldHealth, data.damage);
    } else {
        console.warn("Received invalid health update data:", data);
    }
});

// Added handler for playerRespawned
networkManager.on('playerRespawned', (data) => {
     console.log('Network Player Respawned:', data);
     if (data.player) {
         if (data.player.id === networkManager.playerId) {
             // Local player respawned
             console.log("Local player respawned!");
             gameState.playerShip.health = data.player.health;
             // Force position/rotation update
             playerShip.position.set(data.player.position.x, data.player.position.y, data.player.position.z);
             gameState.playerShip.rotation = data.player.rotation;
             playerShip.rotation.y = data.player.rotation;
             gameState.playerShip.speed = 0; // Reset speed
             gameState.keys = { up: false, down: false, left: false, right: false, space: false }; // Reset keys
             updateHealthDisplay(gameState.playerShip.health, 0, 0); // Update UI from 0 health
             updateStatsDisplay();
             // Maybe flash screen white briefly?
         } else {
             // Other player respawned, update their state
             updateOtherPlayer(data.player);
             // You might want to update their health display if you show health bars over players
         }
     }
});


// UPDATED: 'disconnected' handler to update UI
networkManager.on('disconnected', (data) => {
    console.error(`Disconnected from server: ${data.reason}.`);
    // TODO: Show a more prominent disconnected message overlay?
    // cancelAnimationFrame(animationFrameId); // Optional: Pause game loop
    if (statsElements.connectionStatus) {
        statsElements.connectionStatus.textContent = "Disconnected";
        statsElements.connectionStatus.style.color = "#ff4500"; // OrangeRed
    }
    // Reset player count? Or leave it as is until reconnect/refresh?
    // if (statsElements.playerCount) statsElements.playerCount.textContent = '1';
});

// --- Game Loop ---
let animationFrameId = null;

function updateGame(deltaTime) {
    // Skip update if delta time is too large (e.g., tab inactive)
    if (deltaTime > 0.1) {
        // console.warn("Large deltaTime detected, skipping frame:", deltaTime);
        return;
    }

    const shipState = gameState.playerShip;
    const keys = gameState.keys;

    // --- Player Input & Movement ---
    let speedChanged = false;
    let rotationChanged = false;
    let positionChanged = false; // Track if position actually changes

    // Apply drag first
    if (Math.abs(shipState.speed) > 0.001) {
        const drag = 0.97; // Slightly less drag?
        shipState.speed *= Math.pow(drag, deltaTime * 60);
        if (Math.abs(shipState.speed) < 0.001) shipState.speed = 0;
        speedChanged = true;
    } else if (shipState.speed !== 0) {
         shipState.speed = 0;
         speedChanged = true;
    }

    // Acceleration/Deceleration based on input
    if (keys.up) {
        const newSpeed = Math.min(shipState.speed + shipState.acceleration * deltaTime * 60, shipState.maxSpeed);
        if (newSpeed !== shipState.speed) { shipState.speed = newSpeed; speedChanged = true; }
    } else if (keys.down) {
        const newSpeed = Math.max(shipState.speed - shipState.acceleration * deltaTime * 60 * 0.7, -shipState.maxSpeed / 2); // Slower reverse accel
        if (newSpeed !== shipState.speed) { shipState.speed = newSpeed; speedChanged = true; }
    }

    // Rotation
    if (keys.left) {
        shipState.rotation += shipState.turnSpeed * deltaTime * 60;
        rotationChanged = true;
    }
    if (keys.right) {
        shipState.rotation -= shipState.turnSpeed * deltaTime * 60;
        rotationChanged = true;
    }

    // Calculate potential new position
    let deltaX = 0;
    let deltaZ = 0;
    if (Math.abs(shipState.speed) > 0) {
        const moveDistance = shipState.speed * deltaTime * 60;
        deltaX = -Math.sin(shipState.rotation) * moveDistance;
        deltaZ = -Math.cos(shipState.rotation) * moveDistance;
    }

    // Apply movement if not colliding
    if (deltaX !== 0 || deltaZ !== 0) {
        const tentativePosition = playerShip.position.clone().add(new THREE.Vector3(deltaX, 0, deltaZ));
        const collision = handlePlayerCollisions(tentativePosition);

        if (!collision) {
            playerShip.position.copy(tentativePosition);
            positionChanged = true; // Position actually changed
        } else {
            // Collision response - stop movement
            if (shipState.speed !== 0) {
                shipState.speed = 0;
                speedChanged = true;
                console.log("Collision! Stopping ship.");
                // Optional: Push back slightly?
            }
        }
    }

    // Sync mesh rotation
    playerShip.rotation.y = shipState.rotation;

    // Send Network Updates (throttled by networkManager)
    if (positionChanged) {
        networkManager.updatePosition(playerShip.position);
    }
    if (rotationChanged) {
        networkManager.updateRotation(shipState.rotation);
    }
    if (speedChanged) {
        networkManager.updateSpeed(shipState.speed);
        updateStatsDisplay(); // Update UI immediately for local speed change
    }

    // --- Camera ---
    const cameraDistance = 15;
    const cameraHeight = 10;
    const targetCameraPos = new THREE.Vector3(
        playerShip.position.x + Math.sin(shipState.rotation) * cameraDistance,
        playerShip.position.y + cameraHeight,
        playerShip.position.z + Math.cos(shipState.rotation) * cameraDistance
    );
    // Smoother camera with lower lerp factor
    camera.position.lerp(targetCameraPos, 0.05); // Lower value = smoother/slower follow
    camera.lookAt(playerShip.position.x, playerShip.position.y + 1.0, playerShip.position.z); // Look slightly above ship center


    // --- Shooting ---
    if (keys.space && shipState.canShoot && networkManager.playerId && gameState.playerShip.health > 0) { // Don't shoot if dead
        createBullet(playerShip.position, shipState.rotation, networkManager.playerId);
        shipState.canShoot = false;
        // Use arrow function for correct `this` context if needed, though not strictly necessary here
        setTimeout(() => {
            shipState.canShoot = true;
        }, shipState.shootCooldown);
    }

    // --- Update Bullets --- (MODIFIED for userData and disposal)
    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        const bulletMesh = gameState.bullets[i];
        const bulletData = bulletMesh.userData;

        const moveStep = bulletData.speed * deltaTime * 60;
        bulletMesh.position.x -= Math.sin(bulletData.rotation) * moveStep;
        bulletMesh.position.z -= Math.cos(bulletData.rotation) * moveStep;
        bulletData.distanceTraveled += moveStep;

        let hit = false;
        // Check collisions only if bullet moved significantly or is new? Optimization possible.
        if (moveStep > 0) {
             hit = handleBulletCollisions(bulletMesh);
        }

        if (hit || bulletData.distanceTraveled >= bulletData.maxDistance) {
            scene.remove(bulletMesh);
            // Dispose resources
            bulletMesh.geometry?.dispose();
            bulletMesh.material?.dispose();
            // Remove from array
            gameState.bullets.splice(i, 1);
        }
    }

    // --- Update Ocean Animation ---
    oceanAnimation.time += deltaTime * 0.5;
    waterTexture.offset.x = Math.sin(oceanAnimation.time * 0.2) * 0.02;
    waterTexture.offset.y = Math.cos(oceanAnimation.time * 0.15) * 0.02;
    waterNormalMap.offset.x = Math.sin(oceanAnimation.time * 0.15) * 0.03;
    waterNormalMap.offset.y = Math.cos(oceanAnimation.time * 0.1) * 0.03;

    // --- Update Minimap ---
    // Center minimap camera on player
    minimapCamera.position.x = playerShip.position.x;
    minimapCamera.position.z = playerShip.position.z;
    // Update lookAt to keep it centered if camera moves off 0,0
    minimapCamera.lookAt(playerShip.position.x, 0, playerShip.position.z);
    // No need to update projection matrix unless bounds change

    // Update player marker position and rotation
    playerMarker.position.set(playerShip.position.x, playerMarker.position.y, playerShip.position.z);
    playerMarker.rotation.y = shipState.rotation;
}

let lastTimestamp = 0;
function animate(timestamp) {
    animationFrameId = requestAnimationFrame(animate);

    const delta = timestamp - lastTimestamp;
    // Clamp delta time to prevent huge jumps
    const deltaTime = Math.min(delta / 1000, 0.1); // Max delta of 0.1 seconds (10 FPS min)
    lastTimestamp = timestamp;

    if (deltaTime > 0 && networkManager.connected) { // Only update if connected and time has passed
        updateGame(deltaTime);
    }

    renderer.render(scene, camera);
    minimapRenderer.render(minimapScene, minimapCamera);
}

// --- Initialization ---
console.log("Game script loaded. Connecting to network...");
if (statsElements.connectionStatus) { // Set initial status
    statsElements.connectionStatus.textContent = "Connecting...";
    statsElements.connectionStatus.style.color = "orange";
}
networkManager.connect(); // Start network connection
lastTimestamp = performance.now();
animate(); // Start the game loop

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Minimap size is fixed, no resize needed unless container changes
});

// --- Add cleanup on page unload ---
window.addEventListener('beforeunload', () => {
    if (networkManager.connected) {
        networkManager.ws?.close(); // Gracefully close WebSocket if it exists
    }
    cancelAnimationFrame(animationFrameId); // Stop game loop
});