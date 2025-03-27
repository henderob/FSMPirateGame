import * as THREE from 'three';
import networkManager from './network.js';

// --- Game State ---
const gameState = {
    playerShip: { // Local player specific state
        position: new THREE.Vector3(0, 0, 0), // This is mirrored by the playerShip mesh
        rotation: 0, // This is mirrored by the playerShip mesh
        speed: 0,
        turnSpeed: 0.03,
        maxSpeed: 0.6, // Target max speed
        // --- INCREASED ACCELERATION ---
        acceleration: 0.02, // Increased from 0.01 to overcome new drag
        health: 100, // Single source of truth for local player health
        canShoot: true,
        shootCooldown: 125 // Matches server WEAPON_COOLDOWN
    },
    otherPlayers: new Map(), // Map<playerId, { ship: THREE.Group, marker: THREE.Mesh }>
    bullets: [], // Array<THREE.Mesh> storing bullet meshes
    keys: { up: false, down: false, left: false, right: false, space: false },
    islands: [], // Store island group meshes for efficient collision checks
    islandMarkers: new Map(), // Store minimap markers for islands Map<islandMesh.uuid, markerMesh>
    // UPDATED Wakes Array stores particle meshes directly now
    wakes: [] // Stores active wake particle objects { mesh: THREE.Mesh with userData: {velocity, life, maxLife, baseOpacity} }
};

// --- Constants ---
// --- ADJUSTED WAKE CONSTANTS - MORE VISIBLE ---
const WAKE_SPAWN_THRESHOLD_SPEED = 0.15;
const WAKE_MAX_PARTICLES = 200;         // Allow even more particles
const WAKE_BASE_LIFETIME = 1.5;         // Significantly Increased lifetime (from 1.1)
const WAKE_PARTICLE_SIZE = 0.35;        // Significantly larger (from 0.18)
const WAKE_BASE_OPACITY = 0.8;          // More opaque (from 0.75)
const WAKE_SPAWN_RATE_SCALE = 12;       // Higher spawn rate (from 9)
const WAKE_SIDE_OFFSET = 1.2;           // Slightly further out
const WAKE_VERTICAL_OFFSET = 0.25;      // Slightly higher spawn (from 0.2)
const WAKE_BACK_OFFSET = -0.8;          // Slightly further back
const WAKE_INITIAL_VEL_SIDE = 2.2;      // More outward speed
const WAKE_INITIAL_VEL_UP = 2.0;        // More upward speed
const WAKE_INITIAL_VEL_BACK = -0.6;
const WAKE_GRAVITY = 2.8;               // Gravity (tune this)
const WAKE_DRAG = 0.15;                 // Drag (tune this)
// --- ADJUSTED PHYSICS DRAG ---
const PHYSICS_DRAG_FACTOR = 0.98;       // Reduced drag (closer to 1.0)

// --- DOM Elements ---
const statsElements = {
    playerCount: document.getElementById('player-count'),
    shipSpeed: document.getElementById('ship-speed'),
    shipHealth: document.getElementById('ship-health'),
    connectionStatus: document.getElementById('connection-status'),
    shipPosition: document.getElementById('ship-position') // For displaying coords
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
renderer.setClearColor(0x87CEEB); // Sky Blue
renderer.shadowMap.enabled = true;
// renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Optional: Softer shadows
gameContainer.appendChild(renderer.domElement);

// --- Minimap Setup ---
const minimapSize = 200;
const minimapWorldScale = 400;
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

// --- Lighting ---
const hemiLight = new THREE.HemisphereLight(0xB1E1FF, 0xB97A20, 0.8); // Sky, Ground, Intensity
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.5); // Increased intensity
sunLight.position.set(100, 150, 100);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 50;
sunLight.shadow.camera.far = 500;
sunLight.shadow.camera.left = -250;
sunLight.shadow.camera.right = 250;
sunLight.shadow.camera.top = 250;
sunLight.shadow.camera.bottom = -250;
scene.add(sunLight);
// scene.add(new THREE.CameraHelper(sunLight.shadow.camera)); // Uncomment to debug shadow area

// --- Ocean ---
const waterTexture = new THREE.TextureLoader().load('https://threejs.org/examples/textures/water.jpg');
waterTexture.wrapS = waterTexture.wrapT = THREE.RepeatWrapping;
const waterNormalMap = new THREE.TextureLoader().load('https://threejs.org/examples/textures/waternormals.jpg');
waterNormalMap.wrapS = waterNormalMap.wrapT = THREE.RepeatWrapping;

const oceanGeometry = new THREE.PlaneGeometry(2000, 2000, 100, 100);
const oceanMaterial = new THREE.MeshPhongMaterial({
    color: 0x007799, // Brighter blue/cyan
    shininess: 80,
    specular: 0x00bbdd, // Brighter specular highlights
    map: waterTexture,
    normalMap: waterNormalMap,
    normalScale: new THREE.Vector2(0.15, 0.15),
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

// --- Wake Particle Shared Resources ---
const wakeGeometry = new THREE.PlaneGeometry(WAKE_PARTICLE_SIZE, WAKE_PARTICLE_SIZE); // Uses new constant
const wakeMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: WAKE_BASE_OPACITY, // Uses new constant
    side: THREE.DoubleSide
});

// --- Utility Functions ---

function createShip(isNPC = false) {
    const shipGroup = new THREE.Group();
    const mainColor = isNPC ? 0xcc0000 : 0x8B4513; // Red for NPC, Brown for player
    const sailColor = isNPC ? 0xaaaaaa : 0xFFFFFF;

    const hullGeo = new THREE.BoxGeometry(2, 1, 4);
    const hullMat = new THREE.MeshPhongMaterial({ color: mainColor });
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.position.y = 0.5;
    hull.castShadow = true;
    hull.receiveShadow = true;
    shipGroup.add(hull);

    const mastGeo = new THREE.CylinderGeometry(0.1, 0.1, 3, 8);
    const mastMat = new THREE.MeshPhongMaterial({ color: 0x5a3a22 });
    const mast = new THREE.Mesh(mastGeo, mastMat);
    mast.position.y = 2;
    mast.castShadow = true;
    shipGroup.add(mast);

    const sailGeo = new THREE.PlaneGeometry(1.5, 2);
    const sailMat = new THREE.MeshPhongMaterial({ color: sailColor, side: THREE.DoubleSide });
    const sail = new THREE.Mesh(sailGeo, sailMat);
    sail.position.set(0, 2.5, -0.1);
    sail.castShadow = true;
    shipGroup.add(sail);

    shipGroup.userData.isShip = true;
    shipGroup.userData.isNPC = isNPC;

    return shipGroup;
}

function createIsland(x, z, size, scaleX = 1, scaleZ = 1, rotation = 0) {
    const islandGroup = new THREE.Group();
    const islandHeight = 1.5;

    const baseGeo = new THREE.CylinderGeometry(size, size * 1.1, islandHeight, 32);
    baseGeo.scale(scaleX, 1, scaleZ);
    const baseMat = new THREE.MeshPhongMaterial({ color: 0xb8860b, flatShading: true });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = islandHeight / 2;
    base.rotation.y = rotation;
    base.castShadow = true;
    base.receiveShadow = true;
    islandGroup.add(base);

    const numDetails = Math.floor(Math.random() * 4) + 2;
    for (let i = 0; i < numDetails; i++) {
        const detailSize = Math.random() * size * 0.2 + size * 0.1;
        const detailGeo = new THREE.DodecahedronGeometry(detailSize, 0);
        const detailMat = new THREE.MeshPhongMaterial({ color: 0x888888, flatShading: true });
        const detail = new THREE.Mesh(detailGeo, detailMat);
        const angle = Math.random() * Math.PI * 2;
        const detailDistX = (Math.random() * size * scaleX * 0.8);
        const detailDistZ = (Math.random() * size * scaleZ * 0.8);
        detail.position.set(
            Math.cos(angle) * detailDistX,
            islandHeight,
            Math.sin(angle) * detailDistZ
        );
        detail.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        detail.castShadow = true;
        detail.position.applyAxisAngle(new THREE.Vector3(0,1,0), rotation);
        islandGroup.add(detail);
    }

    islandGroup.position.set(x, 0, z);

    islandGroup.userData = {
        isIsland: true,
        center: new THREE.Vector3(x, 0, z),
        size: size,
        scaleX: scaleX,
        scaleZ: scaleZ,
        rotation: rotation,
        effectiveRadiusX: size * scaleX,
        effectiveRadiusZ: size * scaleZ
    };

    gameState.islands.push(islandGroup);

    const markerBaseSize = size * 1.5;
    const islandMarker = createMinimapMarker(0xb8860b, markerBaseSize, true, scaleX, scaleZ);
    islandMarker.position.set(x, 0.5, z);
    islandMarker.rotation.y = rotation;
    minimapScene.add(islandMarker);
    gameState.islandMarkers.set(islandGroup.uuid, islandMarker);

    return islandGroup;
}


function createMinimapMarker(color, size = 6, isIsland = false, scaleX = 1, scaleZ = 1) {
    let markerGeometry;
    if (isIsland) {
        markerGeometry = new THREE.CircleGeometry(size / 2, 16);
    } else {
        const shape = new THREE.Shape();
        shape.moveTo(0, size / 2); // Point 'forward' (positive Z in local space before rotation)
        shape.lineTo(-size / 2 * 0.6, -size / 2);
        shape.lineTo(size / 2 * 0.6, -size / 2);
        shape.closePath();
        markerGeometry = new THREE.ShapeGeometry(shape);
    }

    const markerMaterial = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.rotation.x = -Math.PI / 2; // Lay flat on the XZ plane (looking down Y)
    if (isIsland) {
         marker.scale.set(scaleX, scaleZ, 1); // Scale ellipse marker AFTER creation
    }
    marker.position.y = 0.1; // Default height, overridden later
    return marker;
}

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
        damage: 10, // Client doesn't use this for logic, but good to have maybe
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

function createHitEffect(position) {
    // Ensure position is a Vector3
    if (!position || !(position instanceof THREE.Vector3)) {
        console.error('Invalid position for hit effect:', position);
        position = new THREE.Vector3(0, 0.5, 0); // Default fallback
    }
    const effectPosition = position.clone();
    effectPosition.y = Math.max(0.5, position.y); // Ensure visible above water

    // Simple Sphere + Ring Approach
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

    const duration = 500; // Shorter duration
    const startTime = Date.now();

    function animateHit() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / duration);

        if (progress < 1) {
            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            sphereEffect.scale.setScalar(1 + easeOutQuart * 4); // Expand sphere rapidly
            sphereEffect.material.opacity = 0.8 * (1 - progress); // Fade sphere
            ringEffect.scale.setScalar(1 + easeOutQuart * 6); // Expand ring faster
            ringEffect.material.opacity = 0.7 * (1 - progress * progress); // Fade ring slightly slower
            requestAnimationFrame(animateHit);
        } else {
            // Dispose resources when done
            scene.remove(sphereEffect);
            sphereEffect.geometry.dispose();
            sphereEffect.material.dispose();
            scene.remove(ringEffect);
            ringEffect.geometry.dispose();
            ringEffect.material.dispose();
        }
    }
    animateHit();
}


// --- Collision Detection ---

// Check collision between a point (ship center) and an island
function checkIslandCollision(shipPosition, island) {
    const islandData = island.userData;
    const islandPos = islandData.center;
    const localShipPos = shipPosition.clone().sub(islandPos);
    localShipPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), -islandData.rotation);
    const shipRadiusApproximation = 1.5; // Approx radius of the ship base
    const effectiveRadiusX = islandData.effectiveRadiusX + shipRadiusApproximation;
    const effectiveRadiusZ = islandData.effectiveRadiusZ + shipRadiusApproximation;
    const dx = localShipPos.x / effectiveRadiusX;
    const dz = localShipPos.z / effectiveRadiusZ;
    // Using <= 1 for collision check
    return (dx * dx + dz * dz) <= 1;
}

// Check collision for the player ship against all islands
function handlePlayerCollisions(newPosition) {
    for (const island of gameState.islands) {
        if (checkIslandCollision(newPosition, island)) {
            return true; // Collision detected
        }
    }
    return false; // No collision
}

// Check collision for a bullet against islands and other players
function handleBulletCollisions(bulletMesh) { // Takes mesh directly
    const bulletData = bulletMesh.userData;

    // 1. Check against Islands
    for (const island of gameState.islands) {
        const islandData = island.userData;
        const distSq = bulletMesh.position.distanceToSquared(islandData.center);
        const maxIslandRadiusSq = Math.pow(Math.max(islandData.effectiveRadiusX, islandData.effectiveRadiusZ) + 0.5, 2); // Add buffer
        if (distSq < maxIslandRadiusSq) {
            // More precise check if close:
            if (checkIslandCollision(bulletMesh.position, island)) {
                // console.log('Bullet hit island'); // Less noise
                createHitEffect(bulletMesh.position.clone()); // Show effect on island
                return true; // Collision detected
            }
        }
    }

    // 2. Check against Other Players
    const approxShipRadius = 2.0; // Collision radius for ships
    for (const [playerId, playerData] of gameState.otherPlayers) {
        // Don't hit the shooter
        if (playerId === bulletData.shooterId) continue;
        const ship = playerData.ship;
        if (!ship) continue; // Skip if ship mesh doesn't exist for some reason
        const distance = bulletMesh.position.distanceTo(ship.position);
        if (distance < approxShipRadius) {
            // console.log(`Bullet from ${bulletData.shooterId} potentially hit player ${playerId}`); // Less noise
            // REPORT hit to server, server determines damage/effect
            networkManager.sendPlayerHit(playerId, bulletData.damage, bulletMesh.position.clone());
            // Optional immediate client effect (server also broadcasts one)
            // createHitEffect(bulletMesh.position.clone());
            return true; // Collision detected, bullet is consumed
        }
    }

     // 3. Check against the Local Player Ship
     if (networkManager.playerId && bulletData.shooterId !== networkManager.playerId) {
         const distance = bulletMesh.position.distanceTo(playerShip.position);
         if (distance < approxShipRadius) {
            //  console.log(`Bullet from ${bulletData.shooterId} potentially hit LOCAL player ${networkManager.playerId}`); // Less noise
             // REPORT hit to server
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
        // console.warn(`Player ${playerData.id} already exists. Updating instead.`); // Reduce noise
        updateOtherPlayer(playerData); // Update position/rotation if they already exist
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
    updateStatsDisplay(); // Update player count
}

function removeOtherPlayer(playerId) {
    if (playerId === networkManager.playerId) return;

    const playerData = gameState.otherPlayers.get(playerId);
    if (playerData) {
        console.log('Removing other player:', playerId);

        // Dispose Ship Resources
        if (playerData.ship) {
            scene.remove(playerData.ship);
            // Recursively dispose children geometries/materials
            playerData.ship.traverse(child => {
                if (child.isMesh) {
                    child.geometry?.dispose();
                    // Check material type (Array, single) before disposing
                    if (Array.isArray(child.material)) {
                         child.material.forEach(mat => mat?.dispose());
                    } else {
                        child.material?.dispose();
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
        updateStatsDisplay(); // Update player count
    } else {
        console.warn('Attempted to remove non-existent player:', playerId);
    }
}

// Includes logging added previously
function updateOtherPlayer(playerData) {
     if (!playerData || !playerData.id || playerData.id === networkManager.playerId) return;
     // LOGGING (Reduced noise)
     const clientIdStr = networkManager.playerId?.substring(0,4) ?? '???';
     const rcvdIdStr = playerData.id.substring(0,4);
     const posStr = playerData.position ? `(${playerData.position.x.toFixed(1)}, ${playerData.position.z.toFixed(1)})` : 'N/A';
     const rotStr = typeof playerData.rotation === 'number' ? playerData.rotation.toFixed(2) : 'N/A';
     // console.log(`[Client ${clientIdStr}] Received update for Player ${rcvdIdStr}: Pos=${posStr}, Rot=${rotStr}`);

     const existingPlayerData = gameState.otherPlayers.get(playerData.id);
     if (existingPlayerData) {
         if (existingPlayerData.ship) { // Check ship exists
             if (playerData.position) {
                 // console.log(`   -> Applying Pos to Ship ${rcvdIdStr}`); // LOGGING
                 existingPlayerData.ship.position.set(playerData.position.x, playerData.position.y, playerData.position.z);
             }
             if (typeof playerData.rotation === 'number') {
                 existingPlayerData.ship.rotation.y = playerData.rotation;
             }
         } else {
             console.warn(`Ship missing for player ${playerData.id} during update.`);
             removeOtherPlayer(playerData.id); // Clean up marker if it exists
             addOtherPlayer(playerData); // Attempt re-add
             return; // Exit after re-adding
         }

         // Update Marker - ENSURE marker exists
         if (existingPlayerData.marker) {
             if (playerData.position) {
                 // console.log(`   -> Applying Pos to Marker ${rcvdIdStr}`); // LOGGING
                 existingPlayerData.marker.position.set(playerData.position.x, existingPlayerData.marker.position.y, playerData.position.z);
             }
             if (typeof playerData.rotation === 'number') {
                 existingPlayerData.marker.rotation.y = playerData.rotation;
             }
         } else {
              console.warn(`Marker missing for player ${playerData.id} during update.`);
         }

     } else {
          // Player doesn't exist in our map yet, add them.
          // console.log(`[Client ${clientIdStr}] Update called for non-existent player ${rcvdIdStr}, adding.`); // LOGGING
          addOtherPlayer(playerData);
     }
}


// --- Stats & UI Updates ---

function updateStatsDisplay() {
    if (statsElements.playerCount) {
        statsElements.playerCount.textContent = gameState.otherPlayers.size + 1; // +1 for local player
    }
    if (statsElements.shipSpeed) {
        // Update speed from local state (updated in updateGame or updateOfflineEffects)
        statsElements.shipSpeed.textContent = Math.abs(gameState.playerShip.speed).toFixed(2);
    }
    // Position display updated separately
}

function updateHealthDisplay(newHealth, oldHealth, damage) {
    // Ensure health is within bounds
    const currentHealth = Math.max(0, Math.min(100, Math.round(newHealth)));
    gameState.playerShip.health = currentHealth; // Update the single source of truth

    if (!statsElements.shipHealth) return;

    const healthElement = statsElements.shipHealth;
    healthElement.textContent = currentHealth.toString();

    // Update color
    let healthColor = '#4CAF50'; // Green
    if (currentHealth <= 30) healthColor = '#ff0000'; // Red
    else if (currentHealth <= 60) healthColor = '#ffa500'; // Orange
    healthElement.style.color = healthColor;
    healthElement.style.fontWeight = currentHealth <= 30 ? 'bold' : 'normal';

    // Only show effects if damage was taken
    if (damage && damage > 0 && oldHealth !== null && currentHealth < oldHealth) {
        // console.log(`Health changed: ${oldHealth} -> ${currentHealth}, Damage: ${damage}`);

        // 1. Floating Damage Text
        const damageText = document.createElement('div');
        damageText.textContent = `-${damage}`;
        damageText.style.position = 'absolute'; damageText.style.color = '#ff0000'; damageText.style.fontWeight = 'bold'; damageText.style.fontSize = '20px'; damageText.style.left = '50%'; damageText.style.top = '-10px'; damageText.style.transform = 'translateX(-50%)'; damageText.style.pointerEvents = 'none'; damageText.style.transition = 'transform 1s ease-out, opacity 1s ease-out';
        healthElement.parentElement.style.position = 'relative'; // Ensure parent allows absolute positioning
        healthElement.parentElement.appendChild(damageText);
        requestAnimationFrame(() => { damageText.style.transform = 'translate(-50%, -40px)'; damageText.style.opacity = '0'; });
        setTimeout(() => { damageText.parentNode?.removeChild(damageText); }, 1000);

        // 2. Screen Shake
        shakeScreen(0.4, 150); // Intensity, Duration
    } else if (oldHealth !== null && currentHealth > oldHealth) {
         // Optional: Handle health gain effects (e.g., green flash)
         // console.log(`Health gained: ${oldHealth} -> ${currentHealth}`);
    }
}


function shakeScreen(intensity = 0.5, duration = 200) {
    const startTime = Date.now();
    const baseCameraY = camera.position.y; // Store original Y
    function animateShake() {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / duration;
        if (progress < 1) {
            const shakeAmount = intensity * Math.sin(progress * Math.PI * 4) * (1 - progress); // 4 shakes total
            camera.position.y = baseCameraY + shakeAmount;
            requestAnimationFrame(animateShake);
        } else {
            camera.position.y = baseCameraY; // Reset firmly
        }
    }
    animateShake();
}


// --- Input Handling ---
function handleKeyDown(event) {
    // console.log('KeyDown:', event.key); // UNCOMMENT THIS LINE TO TEST INPUT ISSUE
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

networkManager.on('init', (data) => {
    console.log('Network Init:', data);
    if (!data.playerId || !data.gameState) {
        console.error("Invalid init data received!"); return;
    }

    // --- Clear previous state (including wakes) ---
    gameState.otherPlayers.forEach((_, playerId) => removeOtherPlayer(playerId));
    gameState.otherPlayers.clear();
    gameState.islands.forEach(islandMesh => {
        scene.remove(islandMesh);
        islandMesh.traverse(child => { if (child.isMesh) { child.geometry?.dispose(); if (child.material) { if (Array.isArray(child.material)) child.material.forEach(mat => mat?.dispose()); else child.material?.dispose(); }}});
        const marker = gameState.islandMarkers.get(islandMesh.uuid);
        if (marker) { minimapScene.remove(marker); marker.geometry?.dispose(); marker.material?.dispose(); }
    });
    gameState.islands = [];
    gameState.islandMarkers.clear();
    gameState.bullets.forEach(bulletMesh => { scene.remove(bulletMesh); bulletMesh.geometry?.dispose(); bulletMesh.material?.dispose(); });
    gameState.bullets = [];
    gameState.wakes.forEach(particle => { scene.remove(particle); particle.material?.dispose(); /* Shared geo */ });
    gameState.wakes = [];

    // --- Set new state ---
    // networkManager.playerId is set internally

    // Add islands
    if (data.gameState.world?.islands) {
        data.gameState.world.islands.forEach(islandData => { scene.add(createIsland(islandData.x, islandData.z, islandData.size, islandData.scaleX, islandData.scaleZ, islandData.rotation)); });
    } else { console.warn("No island data in init message."); }

    // Add other players
    if (data.gameState.players) { data.gameState.players.forEach(playerData => addOtherPlayer(playerData)); }

    // Set initial state for local player
    const selfData = data.gameState.players?.find(p => p.id === networkManager.playerId);
    if (selfData) {
        gameState.playerShip.health = selfData.health ?? 100;
        // Set initial position only if server provides non-zero coords (respecting random spawn)
        // Otherwise, keep the default (0,0,0) defined in gameState.playerShip.position
        if (selfData.position && (selfData.position.x !== 0 || selfData.position.z !== 0)) {
             // Set both the state variable AND the mesh position
             gameState.playerShip.position.set(selfData.position.x, selfData.position.y, selfData.position.z);
             playerShip.position.copy(gameState.playerShip.position); // Sync mesh
             console.log("Set initial player position from server:", gameState.playerShip.position.toArray());
        } else {
             // Ensure ship mesh matches default state if server sent 0,0,0 (or no position)
             playerShip.position.copy(gameState.playerShip.position);
        }
         // Set initial rotation
         if (typeof selfData.rotation === 'number') {
            gameState.playerShip.rotation = selfData.rotation;
            playerShip.rotation.y = selfData.rotation; // Sync mesh
             if (selfData.rotation !== 0) console.log("Set initial player rotation from server:", selfData.rotation);
         } else {
             playerShip.rotation.y = gameState.playerShip.rotation; // Ensure mesh matches state
         }
    } else {
        // Ensure mesh matches default state if selfData not found
         playerShip.position.copy(gameState.playerShip.position);
         playerShip.rotation.y = gameState.playerShip.rotation;
         console.warn("Server did not provide initial state for local player.");
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
    if (data.player) addOtherPlayer(data.player);
});

networkManager.on('playerLeft', (data) => {
    if (data.playerId) removeOtherPlayer(data.playerId);
});

networkManager.on('playerMoved', (data) => {
    updateOtherPlayer(data);
});

networkManager.on('playerRotated', (data) => {
     updateOtherPlayer(data);
});

networkManager.on('playerSpeedChanged', (data) => {
     // Update internal state for other players if we start using it visually
     // const existing = gameState.otherPlayers.get(data.playerId);
     // if (existing && typeof data.speed === 'number') { /* existing.speed = data.speed; */ }
});

networkManager.on('playerHitEffect', (data) => {
    if (data.position) createHitEffect(new THREE.Vector3(data.position.x, data.position.y, data.position.z));
});

networkManager.on('updateHealth', (data) => {
    // console.log('Network Update Health:', data); // Reduce noise
    if (typeof data.health === 'number') updateHealthDisplay(data.health, data.oldHealth, data.damage);
    else console.warn("Received invalid health update:", data);
});

networkManager.on('playerDefeated', (data) => {
     console.log(`Player ${data.playerId} defeated by ${data.killerId}`);
     // Could add visual effect here (e.g., explosion on the defeated player's ship)
     const defeatedPlayer = gameState.otherPlayers.get(data.playerId);
     if(defeatedPlayer && defeatedPlayer.ship) {
         // Example: createExplosionEffect(defeatedPlayer.ship.position);
     } else if (data.playerId === networkManager.playerId) {
         console.log("You were defeated!");
         // Example: Show "You Died" message, maybe fade screen red
         // Could temporarily disable controls here until respawn
     }
});

networkManager.on('playerRespawned', (data) => {
     console.log('Network Player Respawned:', data);
     if (data.player) {
         if (data.player.id === networkManager.playerId) {
             console.log("Local player respawned!");
             // Update local state fully from server data on respawn
             gameState.playerShip.health = data.player.health;
             gameState.playerShip.position.set(data.player.position.x, data.player.position.y, data.player.position.z);
             playerShip.position.copy(gameState.playerShip.position); // Sync mesh
             gameState.playerShip.rotation = data.player.rotation;
             playerShip.rotation.y = data.player.rotation; // Sync mesh
             gameState.playerShip.speed = 0; // Reset speed state
             gameState.keys = { up: false, down: false, left: false, right: false, space: false }; // Reset keys
             updateHealthDisplay(gameState.playerShip.health, 0, 0); // Update UI from 0 health
             updateStatsDisplay(); // Update speed display etc.
             // Maybe flash screen white briefly? camera effect?
         } else {
             // Other player respawned, update their state
             updateOtherPlayer(data.player);
             // Update health bars over players if implemented
         }
     }
});

networkManager.on('disconnected', (data) => {
    console.error(`Disconnected from server: ${data.reason}.`);
    if (statsElements.connectionStatus) {
        statsElements.connectionStatus.textContent = "Disconnected";
        statsElements.connectionStatus.style.color = "#ff4500"; // OrangeRed
    }
});

// --- Game Loop ---
let animationFrameId = null;

function updateGame(deltaTime) {
    // This function handles LOCAL player logic and network sending

    const shipState = gameState.playerShip;
    const keys = gameState.keys;
    const currentSpeed = Math.abs(shipState.speed); // Use abs for calculations
    const speedRatio = Math.min(1, currentSpeed / shipState.maxSpeed); // Clamp ratio to 1

    // --- Physics & Input ---
    let speedChanged = false;
    let rotationChanged = false;
    let positionChanged = false;
    // Drag - USE PHYSICS_DRAG_FACTOR CONSTANT
    if (currentSpeed > 0.001) {
        // Apply drag based on the drag factor
        shipState.speed *= Math.pow(PHYSICS_DRAG_FACTOR, deltaTime * 60);
        if (Math.abs(shipState.speed) < 0.001) shipState.speed = 0; // Snap to zero if slow enough
        speedChanged = true;
    } else if (shipState.speed !== 0) {
         // Ensure speed is exactly zero if it wasn't already snapped
         shipState.speed = 0;
         speedChanged = true;
    }
    // Accel/Decel - USE INCREASED ACCELERATION
    if (keys.up) {
        const newSpeed = Math.min(shipState.speed + shipState.acceleration * deltaTime * 60, shipState.maxSpeed);
        if(newSpeed !== shipState.speed) {shipState.speed = newSpeed; speedChanged = true;}
    } else if (keys.down) {
        // Apply reverse acceleration
        const newSpeed = Math.max(shipState.speed - shipState.acceleration * deltaTime * 60 * 0.7, -shipState.maxSpeed / 2); // Slower reverse accel
        if(newSpeed !== shipState.speed) { shipState.speed = newSpeed; speedChanged = true;}
    }
    // Rotation
    if (keys.left) { shipState.rotation += shipState.turnSpeed * deltaTime * 60; rotationChanged = true; }
    if (keys.right) { shipState.rotation -= shipState.turnSpeed * deltaTime * 60; rotationChanged = true; }

    // Movement & Collision
    let deltaX = 0; let deltaZ = 0;
    // Calculate movement based on current (potentially dragged/accelerated) speed
    if (Math.abs(shipState.speed) > 0) { // Use Math.abs here too
        const moveDistance = shipState.speed * deltaTime * 60;
        deltaX = -Math.sin(shipState.rotation) * moveDistance;
        deltaZ = -Math.cos(shipState.rotation) * moveDistance;
    }
    if (deltaX !== 0 || deltaZ !== 0) {
        const currentPosition = gameState.playerShip.position;
        const tentativePosition = currentPosition.clone().add(new THREE.Vector3(deltaX, 0, deltaZ));
        const collision = handlePlayerCollisions(tentativePosition);
        if (!collision) {
            // Update state position FIRST
            gameState.playerShip.position.copy(tentativePosition);
            // THEN update mesh position
            playerShip.position.copy(gameState.playerShip.position);
            positionChanged = true; // Position actually changed
        } else {
            // Collision response - stop movement
            if (shipState.speed !== 0) {
                shipState.speed = 0;
                speedChanged = true;
                // console.log("Collision! Stopping ship."); // Less noise
            }
        }
    }
    // Sync mesh rotation with state
    playerShip.rotation.y = shipState.rotation;

    // --- Send Network Updates ---
    if (positionChanged) {
        networkManager.updatePosition(gameState.playerShip.position); // Send state position
    }
    if (rotationChanged) {
        networkManager.updateRotation(shipState.rotation);
    }
    if (speedChanged) {
        networkManager.updateSpeed(shipState.speed);
        updateStatsDisplay(); // Update speed UI immediately
    }

    // --- Camera ---
    const cameraDistance = 15; const cameraHeight = 10;
    // Follow the mesh position
    const targetCameraPos = new THREE.Vector3( playerShip.position.x + Math.sin(shipState.rotation) * cameraDistance, playerShip.position.y + cameraHeight, playerShip.position.z + Math.cos(shipState.rotation) * cameraDistance );
    camera.position.lerp(targetCameraPos, 0.05); // Smoother follow
    camera.lookAt(playerShip.position.x, playerShip.position.y + 1.0, playerShip.position.z); // Look slightly above ship center

    // --- Shooting ---
    if (keys.space && shipState.canShoot && networkManager.playerId && gameState.playerShip.health > 0) { // Don't shoot if dead
        createBullet(playerShip.position, shipState.rotation, networkManager.playerId); // Use mesh position for bullet origin
        shipState.canShoot = false;
        setTimeout(() => { shipState.canShoot = true; }, shipState.shootCooldown);
    }

    // --- Update Bullets ---
    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        const bulletMesh = gameState.bullets[i];
        const bulletData = bulletMesh.userData;
        const moveStep = bulletData.speed * deltaTime * 60;
        bulletMesh.position.x -= Math.sin(bulletData.rotation) * moveStep;
        bulletMesh.position.z -= Math.cos(bulletData.rotation) * moveStep;
        bulletData.distanceTraveled += moveStep;
        let hit = false;
        if (moveStep > 0) { // Avoid collision check if not moving
             hit = handleBulletCollisions(bulletMesh);
        }
        if (hit || bulletData.distanceTraveled >= bulletData.maxDistance) {
            scene.remove(bulletMesh);
            bulletMesh.geometry?.dispose();
            bulletMesh.material?.dispose();
            gameState.bullets.splice(i, 1);
        }
    }

    // --- GENERATE WAKES (SIDE SPRAY) --- (Uses UPDATED Constants)
    if (currentSpeed > WAKE_SPAWN_THRESHOLD_SPEED && gameState.wakes.length < WAKE_MAX_PARTICLES) {
        const spawnProbability = speedRatio * deltaTime * WAKE_SPAWN_RATE_SCALE;
        // Spawn potentially multiple particles per frame based on probability
        const numToSpawn = Math.floor(spawnProbability) + (Math.random() < (spawnProbability % 1) ? 1 : 0);

        for (let j = 0; j < numToSpawn; j++) {
            if (gameState.wakes.length >= WAKE_MAX_PARTICLES) break; // Check limit again inside loop

            const side = (gameState.wakes.length % 2 === 0) ? 1 : -1; // Alternate sides

            // Use current mesh position and rotation for accurate spawn point
            const shipForward = new THREE.Vector3();
            playerShip.getWorldDirection(shipForward); // Get current forward vector
            shipForward.y = 0; // Ignore vertical component for sideways calc
            shipForward.normalize();
            const shipRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), shipForward).normalize(); // Calculate right vector

            const spawnPos = playerShip.position.clone()
                .addScaledVector(shipRight, side * WAKE_SIDE_OFFSET) // Use new offset
                .addScaledVector(shipForward, WAKE_BACK_OFFSET)    // Use new offset
                .add(new THREE.Vector3(0, WAKE_VERTICAL_OFFSET, 0)); // Use new offset

            const baseVelSide = WAKE_INITIAL_VEL_SIDE * (1 + speedRatio * 0.5); // Use new velocity
            const baseVelUp = WAKE_INITIAL_VEL_UP * (1 + speedRatio * 0.3); // Use new velocity
            const baseVelBack = WAKE_INITIAL_VEL_BACK * speedRatio; // Use new velocity
            const randX = (Math.random() - 0.5) * 0.5; const randY = (Math.random() - 0.5) * 0.5; const randZ = (Math.random() - 0.5) * 0.5;

            const initialVelocity = shipRight.clone().multiplyScalar(side * baseVelSide) // Outward component
                .add(new THREE.Vector3(0, baseVelUp, 0))                 // Upward component
                .addScaledVector(shipForward, baseVelBack)              // Backward component relative to ship's current forward
                .add(new THREE.Vector3(randX, randY, randZ));           // Add randomness

            const particle = new THREE.Mesh(wakeGeometry, wakeMaterial.clone()); // Clone material for unique opacity/etc.
            particle.position.copy(spawnPos);
            particle.rotation.x = -Math.PI / 2; // Lay flat initially

            const lifetime = WAKE_BASE_LIFETIME * (0.8 + Math.random() * 0.4); // Use new lifetime

            // Store data needed for animation in userData
            particle.userData = {
                velocity: initialVelocity,
                life: 0,
                maxLife: lifetime,
                baseOpacity: wakeMaterial.opacity * (0.7 + speedRatio * 0.3) // Use new opacity
             };

            scene.add(particle);
            gameState.wakes.push(particle); // Store mesh directly
        }
    }

    // --- Update Minimap --- (Local player marker depends on local state)
    minimapCamera.position.x = gameState.playerShip.position.x; // Follow state position
    minimapCamera.position.z = gameState.playerShip.position.z;
    minimapCamera.lookAt(gameState.playerShip.position.x, 0, gameState.playerShip.position.z);
    playerMarker.position.set(gameState.playerShip.position.x, playerMarker.position.y, gameState.playerShip.position.z); // Use state position
    playerMarker.rotation.y = shipState.rotation; // Use state rotation
}

// Separate function for effects that can run offline (like wake animation, ocean, UI)
function updateOfflineEffects(deltaTime) {
     // --- Update Wakes --- (Uses UPDATED Constants)
     for (let i = gameState.wakes.length - 1; i >= 0; i--) {
        const particle = gameState.wakes[i]; // Particle is the Mesh
        const data = particle.userData; // Get physics/life data

        data.life += deltaTime;

        if (data.life >= data.maxLife) {
            scene.remove(particle);
            particle.material.dispose(); // Dispose CLONED material
            // Geometry is shared, do not dispose
            gameState.wakes.splice(i, 1);
        } else {
            // Apply physics
            data.velocity.y -= WAKE_GRAVITY * deltaTime; // Use adjusted gravity
            data.velocity.multiplyScalar(1 - WAKE_DRAG * deltaTime); // Use adjusted drag
            particle.position.addScaledVector(data.velocity, deltaTime); // Update position using velocity

            // Ensure particles don't go below water much
            if (particle.position.y < 0.05) { // Adjusted water level check
                 particle.position.y = 0.05;
                 data.velocity.y *= 0.1; // Dampen on "hit"
            }

            // Fade out based on life
            const lifeRatio = data.life / data.maxLife;
            particle.material.opacity = data.baseOpacity * (1 - lifeRatio); // Use baseOpacity from userData
        }
    }

    // --- Update Ocean ---
    oceanAnimation.time += deltaTime * 0.5;
    waterTexture.offset.x = Math.sin(oceanAnimation.time * 0.2) * 0.02;
    waterTexture.offset.y = Math.cos(oceanAnimation.time * 0.15) * 0.02;
    waterNormalMap.offset.x = Math.sin(oceanAnimation.time * 0.15) * 0.03;
    waterNormalMap.offset.y = Math.cos(oceanAnimation.time * 0.1) * 0.03;

    // --- Update UI ---
     if (statsElements.shipPosition) {
        statsElements.shipPosition.textContent = `Pos: (${gameState.playerShip.position.x.toFixed(1)}, ${gameState.playerShip.position.y.toFixed(1)}, ${gameState.playerShip.position.z.toFixed(1)})`;
    }
    if (statsElements.shipSpeed) {
        // Reflect speed even if disconnected (might be drifting to 0)
         statsElements.shipSpeed.textContent = Math.abs(gameState.playerShip.speed).toFixed(2);
    }
}

// --- Animation Loop ---
let lastTimestamp = 0;
function animate(timestamp) {
    animationFrameId = requestAnimationFrame(animate);
    const delta = timestamp - lastTimestamp;
    // Clamp delta time to prevent huge jumps and ensure positive value
    const deltaTime = Math.max(0, Math.min(delta / 1000, 0.1));
    lastTimestamp = timestamp;

    if (deltaTime > 0) {
        // Update local player logic only if connected
        if (networkManager.connected) {
             updateGame(deltaTime);
        }
        // Update animations/UI regardless of connection status
        updateOfflineEffects(deltaTime);
    }

    // Render main scene
    renderer.render(scene, camera);

    // Render minimap
    minimapRenderer.render(minimapScene, minimapCamera);
}

// --- Initialization ---
console.log("Game script loaded. Connecting...");
if (statsElements.connectionStatus) {
    statsElements.connectionStatus.textContent = "Connecting...";
    statsElements.connectionStatus.style.color = "orange";
}
networkManager.connect(); // Start network connection
lastTimestamp = performance.now(); // Initialize timestamp
animate(); // Start the game loop

// --- Event Listeners & Cleanup ---
// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Minimap size is fixed, no resize needed unless container changes
});

// Add cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (networkManager.connected) {
        networkManager.ws?.close(); // Gracefully close WebSocket if it exists
    }
    cancelAnimationFrame(animationFrameId); // Stop game loop
    // Clean up wakes on unload
    gameState.wakes.forEach(particle => {
         scene.remove(particle);
         particle.material?.dispose(); // Dispose cloned materials
    });
    // Geometry is shared, no dispose needed
    console.log("Game cleanup on unload.");
});