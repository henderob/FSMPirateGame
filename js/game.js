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
        shootCooldown: 125
    },
    otherPlayers: new Map(), // Map<playerId, { ship: THREE.Group, marker: THREE.Mesh }>
    bullets: [], // Array of active bullet meshes { mesh: THREE.Mesh, data: {...} }
    keys: { up: false, down: false, left: false, right: false, space: false },
    islands: [] // Store island meshes for efficient collision checks
};

// --- DOM Elements ---
const statsElements = {
    playerCount: document.getElementById('player-count'),
    shipSpeed: document.getElementById('ship-speed'),
    shipHealth: document.getElementById('ship-health'),
    // Add potentially a connection status indicator
    connectionStatus: document.getElementById('connection-status') // Assumes you add this to HTML
};
const gameContainer = document.getElementById('game-container');
const minimapContainer = document.getElementById('minimap-container');

if (!gameContainer || !minimapContainer) {
    console.error('Essential containers (#game-container, #minimap-container) not found!');
    // Handle this fatal error - maybe display a message and stop execution
    throw new Error("Missing essential DOM elements.");
}

// --- Three.js Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x1a1a2e); // Darker space/night sky color maybe?
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

// --- Lighting ---
scene.add(new THREE.AmbientLight(0x666688)); // More bluish ambient
const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
sunLight.position.set(100, 150, 100);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 50;
sunLight.shadow.camera.far = 500;
sunLight.shadow.camera.left = -200;
sunLight.shadow.camera.right = 200;
sunLight.shadow.camera.top = 200;
sunLight.shadow.camera.bottom = -200;
scene.add(sunLight);
// Optional: Add a helper to visualize the shadow camera
// scene.add(new THREE.CameraHelper(sunLight.shadow.camera));

// --- Ocean ---
const waterTexture = new THREE.TextureLoader().load('https://threejs.org/examples/textures/water.jpg');
waterTexture.wrapS = waterTexture.wrapT = THREE.RepeatWrapping;
const waterNormalMap = new THREE.TextureLoader().load('https://threejs.org/examples/textures/waternormals.jpg');
waterNormalMap.wrapS = waterNormalMap.wrapT = THREE.RepeatWrapping;

const oceanGeometry = new THREE.PlaneGeometry(2000, 2000, 100, 100); // Match server world size?
const oceanMaterial = new THREE.MeshPhongMaterial({
    color: 0x004953,
    shininess: 70,
    specular: 0x006f80,
    map: waterTexture,
    normalMap: waterNormalMap,
    normalScale: new THREE.Vector2(0.2, 0.2), // Subtle normals
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
    // sail.rotation.y = Math.PI / 2; // Sails usually align with ship Z
    sail.castShadow = true;
    shipGroup.add(sail);

    // Add userData for easy identification if needed later
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
        const dist = Math.random() * size * 0.8 * Math.min(scaleX, scaleZ);
        detail.position.set(
            Math.cos(angle) * dist,
            islandHeight, // Place on top surface
            Math.sin(angle) * dist
        );
        detail.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        detail.castShadow = true;
        // Apply island rotation to detail positions relative to center
        detail.position.applyAxisAngle(new THREE.Vector3(0,1,0), rotation);
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
    // Pre-calculate effective radii for collision
    islandGroup.userData.effectiveRadiusX = size * scaleX;
    islandGroup.userData.effectiveRadiusZ = size * scaleZ;

    // Add to efficient collision list
    gameState.islands.push(islandGroup);

    // Create and add minimap marker for the island
    const markerSize = size * 3; // Adjust marker size relative to island size
    const islandMarker = createMinimapMarker(0xb8860b, markerSize, true, scaleX, scaleZ);
    islandMarker.position.set(x, 0.5, z); // Slightly above other markers
    islandMarker.rotation.y = rotation; // Match island rotation
    minimapScene.add(islandMarker);

    return islandGroup; // Return the group to be added to the main scene
}


function createMinimapMarker(color, size = 6, isIsland = false, scaleX = 1, scaleZ = 1) {
    let markerGeometry;
    if (isIsland) {
        // Elliptical marker for islands
        markerGeometry = new THREE.CircleGeometry(size / 2, 16); // Use circle as base
    } else {
        // Triangle marker for players, pointing forward
        const shape = new THREE.Shape();
        shape.moveTo(0, size / 2);
        shape.lineTo(-size / 2 * 0.6, -size / 2);
        shape.lineTo(size / 2 * 0.6, -size / 2);
        shape.closePath();
        markerGeometry = new THREE.ShapeGeometry(shape);
    }

    const markerMaterial = new THREE.MeshBasicMaterial({
        color: color,
        side: THREE.DoubleSide
    });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.rotation.x = -Math.PI / 2; // Lay flat on the XZ plane
    if (isIsland) {
         marker.scale.set(scaleX, scaleZ, 1); // Scale ellipse marker
    }
    marker.position.y = 0.1; // Default height
    return marker;
}


function createBullet(shooterPosition, shooterRotation, shooterId) {
    const bulletData = {
        shooterId: shooterId,
        rotation: shooterRotation, // Store direction
        speed: 1.5, // Faster bullets
        distanceTraveled: 0,
        maxDistance: 80, // Shorter range?
        damage: 10, // Store damage potential
        creationTime: Date.now()
    };

    const bulletGeo = new THREE.SphereGeometry(0.25, 8, 6); // Slightly larger
    const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 }); // Yellowish
    const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat);

    // Start slightly in front and higher
    const forwardOffset = 2.5;
    const verticalOffset = 0.7;
    bulletMesh.position.set(
        shooterPosition.x - Math.sin(shooterRotation) * forwardOffset,
        shooterPosition.y + verticalOffset, // Start at cannon height
        shooterPosition.z - Math.cos(shooterRotation) * forwardOffset
    );

    // Attach data to mesh
    bulletMesh.userData = bulletData;

    scene.add(bulletMesh);
    gameState.bullets.push({ mesh: bulletMesh, data: bulletData }); // Store mesh and data separately?
}


function createHitEffect(position) {
    // Ensure position is a Vector3
    if (!position || !(position instanceof THREE.Vector3)) {
        console.error('Invalid position for hit effect:', position);
        position = new THREE.Vector3(0, 0.5, 0); // Default fallback
    }
    const effectPosition = position.clone();
    effectPosition.y = Math.max(0.5, position.y); // Ensure visible above water

    console.log('Creating hit effect at:', effectPosition.toArray());

    // --- Particle System Approach (more advanced, example) ---
    // const particleCount = 50;
    // const particles = new THREE.BufferGeometry();
    // const positions = new Float32Array(particleCount * 3);
    // const velocities = []; // Store velocity vectors
    // const particleMaterial = new THREE.PointsMaterial({ color: 0xff4500, size: 0.5, transparent: true, opacity: 0.9 });
    // for (let i = 0; i < particleCount; i++) {
    //     positions[i * 3] = effectPosition.x;
    //     positions[i * 3 + 1] = effectPosition.y;
    //     positions[i * 3 + 2] = effectPosition.z;
    //     velocities.push(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.5 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(Math.random() * 0.5 + 0.1));
    // }
    // particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // const particleSystem = new THREE.Points(particles, particleMaterial);
    // scene.add(particleSystem);
    // // Animate particles... remove after time


    // --- Simple Sphere + Ring Approach ---
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
            scene.remove(sphereEffect);
            sphereEffect.geometry.dispose();
            sphereEffect.material.dispose();
            scene.remove(ringEffect);
            ringEffect.geometry.dispose();
            ringEffect.material.dispose();
            // scene.remove(particleSystem); // if using particles
            // particleSystem.geometry.dispose();
            // particleSystem.material.dispose();
        }
    }
    animateHit();
}


// --- Collision Detection ---

// Check collision between a point (ship center) and an island
function checkIslandCollision(shipPosition, island) {
    const islandData = island.userData;
    const islandPos = islandData.center;

    // Transform ship position to island's local space (relative position, adjusted for rotation)
    const localShipPos = shipPosition.clone().sub(islandPos);
    localShipPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), -islandData.rotation);

    // Elliptical collision check
    const shipRadiusApproximation = 1.5; // Approx radius of the ship base
    const effectiveRadiusX = islandData.effectiveRadiusX + shipRadiusApproximation;
    const effectiveRadiusZ = islandData.effectiveRadiusZ + shipRadiusApproximation;

    // Check if point is inside the expanded collision ellipse
    // (x/a)^2 + (z/b)^2 <= 1
    const dx = localShipPos.x / effectiveRadiusX;
    const dz = localShipPos.z / effectiveRadiusZ;

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
function handleBulletCollisions(bullet) {
    const bulletMesh = bullet.mesh;
    const bulletData = bullet.data;

    // 1. Check against Islands
    for (const island of gameState.islands) {
        // Use a simpler check for bullets - just check distance to island center vs effective radius
         const islandData = island.userData;
         const distSq = bulletMesh.position.distanceToSquared(islandData.center);
         const maxIslandRadiusSq = Math.pow(Math.max(islandData.effectiveRadiusX, islandData.effectiveRadiusZ) + 0.5, 2); // Add buffer
         if (distSq < maxIslandRadiusSq) {
              // More precise check if close:
              if (checkIslandCollision(bulletMesh.position, island)) {
                 console.log('Bullet hit island');
                 createHitEffect(bulletMesh.position.clone()); // Show effect on island
                 return true; // Collision detected
              }
         }
    }

    // 2. Check against Other Players (only if bullet wasn't shot by this player)
    const approxShipRadius = 2.0; // Collision radius for ships
    for (const [playerId, playerData] of gameState.otherPlayers) {
         // Don't hit the shooter (or check team later)
         if (playerId === bulletData.shooterId) continue;

        const ship = playerData.ship;
        if (!ship) continue;

        const distance = bulletMesh.position.distanceTo(ship.position);
        if (distance < approxShipRadius) {
            console.log(`Bullet from ${bulletData.shooterId} potentially hit player ${playerId}`);

            // IMPORTANT: Client does NOT determine damage anymore. It just reports the hit.
            networkManager.sendPlayerHit(playerId, bulletData.damage, bulletMesh.position.clone());

             // Client can optionally create an immediate visual effect for responsiveness
             // createHitEffect(bulletMesh.position.clone()); // Duplicate effect? Server also broadcasts one. Decide if needed.

            return true; // Collision detected, bullet is consumed
        }
    }

     // 3. Check against the Local Player Ship (if bullet wasn't shot by local player)
     if (networkManager.playerId && bulletData.shooterId !== networkManager.playerId) {
         const distance = bulletMesh.position.distanceTo(playerShip.position);
         if (distance < approxShipRadius) {
             console.log(`Bullet from ${bulletData.shooterId} potentially hit LOCAL player ${networkManager.playerId}`);
             networkManager.sendPlayerHit(networkManager.playerId, bulletData.damage, bulletMesh.position.clone());
             // createHitEffect(bulletMesh.position.clone()); // Optional immediate effect
             return true;
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
    if (playerData.id === networkManager.playerId) {
        console.warn("Attempted to add local player as other player.");
        return;
    }
    if (gameState.otherPlayers.has(playerData.id)) {
        console.warn(`Player ${playerData.id} already exists. Updating instead.`);
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
    marker.position.set(position.x, 0.6, position.z); // Slightly lower than player marker
    marker.rotation.y = rotation; // Match ship rotation
    minimapScene.add(marker);

    gameState.otherPlayers.set(playerData.id, { ship, marker });
    updateStatsDisplay(); // Update player count
}

function removeOtherPlayer(playerId) {
    if (playerId === networkManager.playerId) return;

    const playerData = gameState.otherPlayers.get(playerId);
    if (playerData) {
        console.log('Removing other player:', playerId);
        if (playerData.ship) scene.remove(playerData.ship);
        if (playerData.marker) minimapScene.remove(playerData.marker);
        // TODO: Dispose geometries/materials if needed?
        gameState.otherPlayers.delete(playerId);
        updateStatsDisplay(); // Update player count
    } else {
        console.warn('Attempted to remove non-existent player:', playerId);
    }
}

function updateOtherPlayer(playerData) {
     if (!playerData || !playerData.id || playerData.id === networkManager.playerId) return;
     const existingPlayerData = gameState.otherPlayers.get(playerData.id);
     if (existingPlayerData && existingPlayerData.ship) {
         if (playerData.position) {
             existingPlayerData.ship.position.set(playerData.position.x, playerData.position.y, playerData.position.z);
             if (existingPlayerData.marker) {
                 existingPlayerData.marker.position.set(playerData.position.x, existingPlayerData.marker.position.y, playerData.position.z);
             }
         }
         if (typeof playerData.rotation === 'number') {
             existingPlayerData.ship.rotation.y = playerData.rotation;
              if (existingPlayerData.marker) {
                 existingPlayerData.marker.rotation.y = playerData.rotation; // Update marker rotation too
             }
         }
         // We don't really use speed visually for other players directly, server handles movement
     } else {
          // If player data exists but ship doesn't, or player doesn't exist, try adding them
          console.warn(`Update called for missing player ${playerData.id}, attempting to add.`);
          addOtherPlayer(playerData);
     }
}


// --- Stats & UI Updates ---

// Update the stats display panel
function updateStatsDisplay() {
    if (statsElements.playerCount) {
        statsElements.playerCount.textContent = gameState.otherPlayers.size + 1; // +1 for local player
    }
    if (statsElements.shipSpeed) {
        statsElements.shipSpeed.textContent = Math.abs(gameState.playerShip.speed).toFixed(2);
    }
    // Health is updated separately by updateHealthDisplay when it changes
}

// Update health display and trigger effects (Called by network 'updateHealth' event)
function updateHealthDisplay(newHealth, oldHealth, damage) {
    // Ensure health is within bounds
    const currentHealth = Math.max(0, Math.min(100, Math.round(newHealth))); // Round for display
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
        console.log(`Health changed: ${oldHealth} -> ${currentHealth}, Damage: ${damage}`);

        // 1. Floating Damage Text
        const damageText = document.createElement('div');
        damageText.textContent = `-${damage}`;
        damageText.style.position = 'absolute';
        damageText.style.color = '#ff0000';
        damageText.style.fontWeight = 'bold';
        damageText.style.fontSize = '20px'; // Adjust size
        damageText.style.left = '50%';
        damageText.style.top = '-10px'; // Start above the number
        damageText.style.transform = 'translateX(-50%)';
        damageText.style.pointerEvents = 'none';
        damageText.style.transition = 'transform 1s ease-out, opacity 1s ease-out'; // CSS transitions
        healthElement.parentElement.style.position = 'relative'; // Ensure parent allows absolute positioning
        healthElement.parentElement.appendChild(damageText);

        // Animate using CSS transitions
        requestAnimationFrame(() => { // Allow element to be added to DOM first
             damageText.style.transform = 'translate(-50%, -40px)'; // Move up
             damageText.style.opacity = '0';
        });

        setTimeout(() => {
            if (damageText.parentNode) {
                damageText.parentNode.removeChild(damageText);
            }
        }, 1000); // Remove after animation

        // 2. Screen Shake
        shakeScreen(0.4, 150); // Intensity, Duration

        // 3. Health Bar Flash (Optional)
        healthElement.style.transition = 'background-color 0.1s ease-in-out';
        healthElement.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
        setTimeout(() => {
            healthElement.style.backgroundColor = 'transparent';
        }, 100);

    } else if (oldHealth !== null && currentHealth > oldHealth) {
         // Optional: Handle health gain effects (e.g., green flash)
         console.log(`Health gained: ${oldHealth} -> ${currentHealth}`);
    }
}


function shakeScreen(intensity = 0.5, duration = 200) {
    const startTime = Date.now();
    const baseCameraY = camera.position.y; // Store original Y

    function animateShake() {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / duration;

        if (progress < 1) {
            // Use a decaying sine wave for shaking
            const shakeAmount = intensity * Math.sin(progress * Math.PI * 4) * (1 - progress); // 4 shakes total
            camera.position.y = baseCameraY + shakeAmount;
            // Could also add small X/Z shake:
            // camera.position.x += (Math.random() - 0.5) * intensity * (1 - progress) * 0.5;
            requestAnimationFrame(animateShake);
        } else {
            camera.position.y = baseCameraY; // Reset firmly
        }
    }
    animateShake();
}


// --- Input Handling ---
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

networkManager.on('init', (data) => {
    console.log('Network Init:', data);
    if (!data.playerId || !data.gameState) {
        console.error("Invalid init data received!");
        return;
    }

    // Clear previous state
    gameState.otherPlayers.forEach(playerData => {
        if (playerData.ship) scene.remove(playerData.ship);
        if (playerData.marker) minimapScene.remove(playerData.marker);
    });
    gameState.otherPlayers.clear();
    gameState.islands.forEach(island => scene.remove(island)); // Assumes islands aren't dynamically removed otherwise
    gameState.islands = [];
    // Clear minimap markers for islands? Need to manage them separately if so.

    // Set local player ID
    // networkManager.playerId is already set internally

    // Add initial islands from server data
    if (data.gameState.world?.islands) {
        data.gameState.world.islands.forEach(islandData => {
            // Server sends world coordinates, use them directly
            const islandMesh = createIsland(
                islandData.x, islandData.z,
                islandData.size, islandData.scaleX, islandData.scaleZ, islandData.rotation
            );
            scene.add(islandMesh); // createIsland adds to gameState.islands and minimap
        });
    } else {
        console.warn("No island data in init message.");
    }

    // Add initial other players
    if (data.gameState.players) {
        data.gameState.players.forEach(playerData => {
            addOtherPlayer(playerData); // Handles skipping self and duplicates
        });
    }

    // Set initial player state (e.g., health if server sends it at init)
    const selfData = data.gameState.players?.find(p => p.id === networkManager.playerId);
    if (selfData) {
        gameState.playerShip.health = selfData.health || 100;
         // Set initial position/rotation from server? Or assume 0,0?
         // playerShip.position.set(selfData.position.x, selfData.position.y, selfData.position.z);
         // gameState.playerShip.rotation = selfData.rotation;
    }
    updateHealthDisplay(gameState.playerShip.health, null, 0); // Initial display based on state
    updateStatsDisplay();
});

networkManager.on('playerJoined', (data) => {
    console.log('Network Player Joined:', data);
    if (data.player) {
        addOtherPlayer(data.player);
    }
});

networkManager.on('playerLeft', (data) => {
    console.log('Network Player Left:', data);
    if (data.playerId) {
        removeOtherPlayer(data.playerId);
    }
});

networkManager.on('playerMoved', (data) => {
    // console.log('Network Player Moved:', data.playerId); // Too noisy
    updateOtherPlayer(data); // Use generic update function
});

networkManager.on('playerRotated', (data) => {
    // console.log('Network Player Rotated:', data.playerId); // Too noisy
     updateOtherPlayer(data);
});

networkManager.on('playerSpeedChanged', (data) => {
    // console.log('Network Player Speed Changed:', data.playerId, data.speed); // Too noisy
     updateOtherPlayer(data); // Update player data (though we don't use speed visually)
});


// This event is broadcast by the server for VISUALS
networkManager.on('playerHitEffect', (data) => {
    console.log('Network Player Hit Effect:', data);
    if (data.position) {
        // Make sure position is a Vector3
        const hitPos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
        createHitEffect(hitPos);

         // Optional: If the *local player* was the target, trigger shake/flash here *as well*
         // This provides immediate feedback even before the health update arrives.
         // if (data.targetId === networkManager.playerId) {
         //    shakeScreen(0.3, 100);
             // Flash health bar briefly red
         // }
    }
});

// This event comes ONLY to the player whose health changed
networkManager.on('updateHealth', (data) => {
    console.log('Network Update Health:', data);
    if (typeof data.health === 'number') {
        // Pass all relevant info to the display function
        updateHealthDisplay(data.health, data.oldHealth, data.damage);
    } else {
        console.warn("Received invalid health update data:", data);
    }
});

networkManager.on('disconnected', (data) => {
    console.error(`Disconnected from server: ${data.reason}. Game paused.`);
    // TODO: Show a disconnected message overlay
    // Optionally pause the game loop: cancelAnimationFrame(animationFrameId);
    if (statsElements.connectionStatus) {
        statsElements.connectionStatus.textContent = "Disconnected";
        statsElements.connectionStatus.style.color = "red";
    }
});

// --- Game Loop ---
let animationFrameId = null;

function updateGame(deltaTime) {
    const shipState = gameState.playerShip;
    const keys = gameState.keys;

    // --- Player Input & Movement ---
    let speedChanged = false;
    let rotationChanged = false;

    // Acceleration/Deceleration
    if (keys.up) {
        const newSpeed = Math.min(shipState.speed + shipState.acceleration * deltaTime * 60, shipState.maxSpeed); // Scale accel by dt
        if (newSpeed !== shipState.speed) { shipState.speed = newSpeed; speedChanged = true; }
    } else if (keys.down) {
        const newSpeed = Math.max(shipState.speed - shipState.acceleration * deltaTime * 60, -shipState.maxSpeed / 2);
        if (newSpeed !== shipState.speed) { shipState.speed = newSpeed; speedChanged = true; }
    } else {
        // Apply drag
        if (Math.abs(shipState.speed) > 0.001) {
            const drag = 0.95; // Adjust drag factor
            shipState.speed *= Math.pow(drag, deltaTime * 60); // Apply drag scaled by dt
             if (Math.abs(shipState.speed) < 0.001) shipState.speed = 0;
            speedChanged = true; // Always potentially changing due to drag
        } else if (shipState.speed !== 0) {
             shipState.speed = 0; // Snap to zero if very slow
             speedChanged = true;
        }
    }

    // Rotation
    if (keys.left) {
        shipState.rotation += shipState.turnSpeed * deltaTime * 60; // Scale turn by dt
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
        const moveDistance = shipState.speed * deltaTime * 60; // Scale movement by dt
        deltaX = -Math.sin(shipState.rotation) * moveDistance;
        deltaZ = -Math.cos(shipState.rotation) * moveDistance;
    }
    const tentativePosition = playerShip.position.clone().add(new THREE.Vector3(deltaX, 0, deltaZ));

    // Collision Detection
    let collision = false;
    if (deltaX !== 0 || deltaZ !== 0) { // Only check collision if moving
        collision = handlePlayerCollisions(tentativePosition);
    }

    // Update Position & Send Network Update
    if (!collision && (deltaX !== 0 || deltaZ !== 0)) {
        playerShip.position.copy(tentativePosition);
        networkManager.updatePosition(playerShip.position); // Send validated position
    } else if (collision) {
        // Handle collision response - stop movement
        if (shipState.speed !== 0) {
            shipState.speed = 0;
            speedChanged = true;
             console.log("Collision! Stopping ship.");
        }
    }

    // Update Rotation & Send Network Update
    playerShip.rotation.y = shipState.rotation;
    if (rotationChanged) {
        networkManager.updateRotation(shipState.rotation);
    }
    if (speedChanged) {
        networkManager.updateSpeed(shipState.speed);
        updateStatsDisplay(); // Update speed in UI
    }

    // --- Camera ---
    const cameraDistance = 15;
    const cameraHeight = 10;
    // Smooth camera follow (Lerp)
    const targetCameraPos = new THREE.Vector3(
        playerShip.position.x + Math.sin(shipState.rotation) * cameraDistance,
        playerShip.position.y + cameraHeight,
        playerShip.position.z + Math.cos(shipState.rotation) * cameraDistance
    );
    camera.position.lerp(targetCameraPos, 0.1); // Adjust lerp factor for smoothness
    camera.lookAt(playerShip.position); // Always look at the ship


    // --- Shooting ---
    if (keys.space && shipState.canShoot && networkManager.playerId) {
        createBullet(playerShip.position, shipState.rotation, networkManager.playerId);
        shipState.canShoot = false;
        setTimeout(() => {
            shipState.canShoot = true;
        }, shipState.shootCooldown);
    }

    // --- Update Bullets ---
    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        const bullet = gameState.bullets[i];
        const bulletMesh = bullet.mesh;
        const bulletData = bullet.data;

        // Move bullet
        const moveStep = bulletData.speed * deltaTime * 60; // Scale by dt
        bulletMesh.position.x -= Math.sin(bulletData.rotation) * moveStep;
        bulletMesh.position.z -= Math.cos(bulletData.rotation) * moveStep;
        bulletData.distanceTraveled += moveStep;

        // Check collisions (Islands, Other Players, Self)
        if (handleBulletCollisions(bullet)) {
            scene.remove(bulletMesh);
            // TODO: Dispose geometry/material?
            gameState.bullets.splice(i, 1);
            continue; // Bullet was consumed
        }

        // Check max distance
        if (bulletData.distanceTraveled >= bulletData.maxDistance) {
            scene.remove(bulletMesh);
            // TODO: Dispose geometry/material?
            gameState.bullets.splice(i, 1);
        }
    }

    // --- Update Ocean Animation ---
    oceanAnimation.time += deltaTime * 0.5; // Slower animation
    waterTexture.offset.x = Math.sin(oceanAnimation.time * 0.2) * 0.02;
    waterTexture.offset.y = Math.cos(oceanAnimation.time * 0.15) * 0.02;
    waterNormalMap.offset.x = Math.sin(oceanAnimation.time * 0.15) * 0.03;
    waterNormalMap.offset.y = Math.cos(oceanAnimation.time * 0.1) * 0.03;
    // To make waves move, you might need to displace vertices in a shader or geometry update

    // --- Update Minimap ---
    // Center minimap camera on player
    minimapCamera.position.x = playerShip.position.x;
    minimapCamera.position.z = playerShip.position.z;
    minimapCamera.updateProjectionMatrix(); // Needed if bounds change, not needed here?

    // Update player marker position and rotation
    playerMarker.position.set(playerShip.position.x, playerMarker.position.y, playerShip.position.z);
    playerMarker.rotation.y = shipState.rotation; // Rotate player marker

}

let lastTimestamp = 0;
function animate(timestamp) {
    animationFrameId = requestAnimationFrame(animate); // Store frame ID

    const deltaTime = (timestamp - lastTimestamp) / 1000; // Time delta in seconds
    lastTimestamp = timestamp;

    if (deltaTime > 0.1) { // Avoid large jumps if tab was inactive
        console.warn("Large deltaTime detected, skipping frame:", deltaTime);
        return;
    }

    if (networkManager.connected) { // Only update game logic if connected
        updateGame(deltaTime);
    } else {
        // Maybe show a "Disconnected" overlay or pause screen
    }

    // Render main scene
    renderer.render(scene, camera);

    // Render minimap
    minimapRenderer.render(minimapScene, minimapCamera);
}

// --- Initialization ---
console.log("Game script loaded. Connecting to network...");
networkManager.connect(); // Start network connection
lastTimestamp = performance.now(); // Initialize timestamp
animate(); // Start the game loop

// Handle window resize
window.addEventListener('resize', () => {
    // Main camera
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Minimap (keep it square, maybe adjust position if needed)
    // Minimap renderer size is fixed, no need to resize it?
    // If minimap container size changes, update minimapRenderer.setSize()
});

// --- Add cleanup on page unload ---
window.addEventListener('beforeunload', () => {
    if (networkManager.connected) {
        networkManager.ws.close(); // Gracefully close WebSocket
    }
    cancelAnimationFrame(animationFrameId); // Stop game loop
});


// Note on React Project: Files in /projects/javascript/ seem unrelated
// to this Three.js game. They belong to a separate React application.