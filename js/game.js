import * as THREE from 'three';
import networkManager from './network.js';
// Optional: If BufferGeometryUtils is needed
// import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

// --- Game State ---
const gameState = {
    playerShip: { position: new THREE.Vector3(0, 0, 0), rotation: 0, speed: 0, turnSpeed: 0.03, maxSpeed: 0.6, acceleration: 0.02, health: 100, canShoot: true, shootCooldown: 125 },
    otherPlayers: new Map(),
    bullets: [],
    keys: { up: false, down: false, left: false, right: false, space: false },
    islands: [],
    islandMarkers: new Map(),
    splashes: []
};

// --- Constants ---
// SPLASH Constants - Retuned Again
const SPLASH_SPAWN_THRESHOLD_SPEED = 0.1;
const SPLASH_MAX_PARTICLES = 400;         // Allow more particles
const SPLASH_BASE_LIFETIME = 1.2;         // Slightly longer lifetime again
const SPLASH_PARTICLE_SIZE = 0.35;        // Size of icosahedron base
const SPLASH_BASE_OPACITY = 0.75;         // Base opacity
const SPLASH_SPAWN_RATE_SCALE = 30;       // Increase spawn rate
const SPLASH_SIDE_OFFSET = 1.0;
const SPLASH_VERTICAL_OFFSET = 0.25;      // Start slightly higher
const SPLASH_BACK_OFFSET = 0.4;
const SPLASH_INITIAL_VEL_SIDE_MIN = 1.5;  // Base outward
const SPLASH_INITIAL_VEL_SIDE_SCALE = 3.5; // Stronger outward scaling
const SPLASH_INITIAL_VEL_UP_MIN = 2.8;     // Higher base upward
const SPLASH_INITIAL_VEL_UP_SCALE = 2.5;   // Stronger upward scaling
const SPLASH_GRAVITY = 5.0;                // Slightly stronger gravity for arc
const SPLASH_DRAG = 0.2;

const PHYSICS_DRAG_FACTOR = 0.98;
const CLOUD_COUNT = 40; // More clouds
const CLOUD_MIN_Y = 40; const CLOUD_MAX_Y = 75; // Higher range
const CLOUD_AREA_RADIUS = 1000; // Wider area
const LARGE_CLOUD_PROBABILITY = 0.2;
const LARGE_CLOUD_SCALE_MULTIPLIER = 2.5;

// --- DOM Elements ---
const statsElements = { /* ... */ };
const gameContainer = document.getElementById('game-container');
const minimapContainer = document.getElementById('minimap-container');
/* ... Error check ... */

// --- Texture Loader --- (Define once)
const textureLoader = new THREE.TextureLoader();

// --- Three.js Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87CEEB);
renderer.shadowMap.enabled = true;
gameContainer.appendChild(renderer.domElement);

// --- Minimap Setup ---
const minimapSize = 200; const minimapWorldScale = 400; const minimapScene = new THREE.Scene();
const minimapCamera = new THREE.OrthographicCamera(-minimapWorldScale, minimapWorldScale, minimapWorldScale, -minimapWorldScale, 0.1, 1000); minimapCamera.position.set(0, 100, 0); minimapCamera.lookAt(0, 0, 0);
const minimapRenderer = new THREE.WebGLRenderer({ antialias: true }); minimapRenderer.setSize(minimapSize, minimapSize); minimapRenderer.setClearColor(0x001a33, 0.8); minimapContainer.appendChild(minimapRenderer.domElement);

// --- Lighting ---
const hemiLight = new THREE.HemisphereLight(0xB1E1FF, 0xB97A20, 0.8); scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 1.5); sunLight.position.set(100, 150, 100); sunLight.castShadow = true; /* Shadow map settings */ scene.add(sunLight);

// --- Ocean --- (Texture Animation Updated, Waves Disabled)
const waterTexture = textureLoader.load('https://threejs.org/examples/textures/water.jpg'); waterTexture.wrapS = waterTexture.wrapT = THREE.RepeatWrapping;
const waterNormalMap = textureLoader.load('https://threejs.org/examples/textures/waternormals.jpg'); waterNormalMap.wrapS = waterNormalMap.wrapT = THREE.RepeatWrapping;
const oceanGeometry = new THREE.PlaneGeometry(2000, 2000, 1, 1);
const oceanMaterial = new THREE.MeshPhongMaterial({
    color: 0x005577,
    shininess: 100,
    specular: 0x00aaff,
    map: waterTexture,
    normalMap: waterNormalMap,
    // --- INCREASED NORMAL SCALE ---
    normalScale: new THREE.Vector2(0.3, 0.3), // More pronounced bumps/details
    side: THREE.FrontSide
});
const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial); ocean.rotation.x = -Math.PI / 2; ocean.receiveShadow = true; scene.add(ocean);
// --- SLOWER SCROLL SPEED ---
const oceanAnimation = { time: 0, scrollSpeedX: 0.005, scrollSpeedZ: 0.003, normalScrollSpeedX: 0.007, normalScrollSpeedZ: 0.005 };

// --- Clouds --- (Increased Count, Size Variation)
function createCloud() {
    const puffCount = Math.floor(Math.random() * 4) + 4; const cloudGroup = new THREE.Group();
    const puffGeo = new THREE.IcosahedronGeometry(1, 0);
    const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 + Math.random() * 0.2, /* Reduced max opacity */ depthWrite: false }); // Softer clouds
    const isLargeCloud = Math.random() < LARGE_CLOUD_PROBABILITY; const sizeMultiplier = isLargeCloud ? LARGE_CLOUD_SCALE_MULTIPLIER : 1.0;
    for (let i = 0; i < puffCount; i++) { const puff = new THREE.Mesh(puffGeo, puffMat); const baseScale = (6 + Math.random() * 8) * sizeMultiplier; /* Larger base range */ puff.scale.set( baseScale * (0.8 + Math.random()*0.4), baseScale * (0.7 + Math.random()*0.3), baseScale * (0.8 + Math.random()*0.4) ); puff.position.set( (Math.random() - 0.5) * baseScale * 1.5, (Math.random() - 0.5) * baseScale * 0.5, (Math.random() - 0.5) * baseScale * 1.5 ); puff.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI); cloudGroup.add(puff); }
    cloudGroup.position.set((Math.random() - 0.5) * CLOUD_AREA_RADIUS * 2, CLOUD_MIN_Y + Math.random() * (CLOUD_MAX_Y - CLOUD_MIN_Y), (Math.random() - 0.5) * CLOUD_AREA_RADIUS * 2); scene.add(cloudGroup); return cloudGroup;
}
const clouds = []; for (let i = 0; i < CLOUD_COUNT; i++) clouds.push(createCloud()); // Uses increased count

// --- Player Ship ---
const playerShip = createShip(false); scene.add(playerShip);

// --- Minimap Markers ---
const playerMarker = createMinimapMarker(0x00ff00, 30); playerMarker.position.y = 1; minimapScene.add(playerMarker);

// --- Splash Particle Shared Resources --- (CHANGED GEOMETRY)
const splashGeometry = new THREE.IcosahedronGeometry(SPLASH_PARTICLE_SIZE, 0); // Simple low-poly sphere
const splashMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: SPLASH_BASE_OPACITY, side: THREE.DoubleSide, depthWrite: false });

// --- Utility Functions ---
function createShip(isNPC = false) { /* ... */ }

// --- Island Textures (Load Once) ---
// Find a suitable seamless sand/dirt texture URL
const islandTextureUrl = 'https://threejs.org/examples/textures/terrain/grasslight-big.jpg'; // Example grass texture, replace if possible
const islandTexture = textureLoader.load(islandTextureUrl);
islandTexture.wrapS = islandTexture.wrapT = THREE.RepeatWrapping;
islandTexture.repeat.set(4, 4); // Adjust repeat based on island size and texture scale

function createIsland(x, z, size, scaleX = 1, scaleZ = 1, rotation = 0, isLarge = false) {
    const islandGroup = new THREE.Group(); const islandHeight = isLarge ? 2.5 : 1.5;
    const baseGeo = new THREE.CylinderGeometry(size, size * 1.1, islandHeight, isLarge ? 48 : 32); baseGeo.scale(scaleX, 1, scaleZ);
    // --- ADDED TEXTURE TO ISLAND MATERIAL ---
    const baseMat = new THREE.MeshPhongMaterial({
        color: 0x8B4513, // Base color if texture fails
        map: islandTexture, // Apply the loaded texture
        flatShading: false, // Disable flat shading if using texture for smoother look
        shininess: 10, // Reduce shininess for dirt/sand
        specular: 0x111111
    });
    // Adjust texture repeat based on effective size
    islandTexture.repeat.set(Math.max(2, size * scaleX * 0.1), Math.max(2, size * scaleZ * 0.1)); // Heuristic repeat

    const base = new THREE.Mesh(baseGeo, baseMat); base.position.y = islandHeight / 2; base.rotation.y = rotation; base.castShadow = true; base.receiveShadow = true; islandGroup.add(base);

    // --- ADJUSTED DETAILS ---
    const numRocks = isLarge ? Math.floor(Math.random() * 4) + 2 : Math.floor(Math.random() * 2) + 1; // FEWER ROCKS
    for (let i = 0; i < numRocks; i++) {
        const rockSize = (0.5 + Math.random() * 1.0) * (isLarge ? 1.5 : 1.0) ; // SMALLER ROCKS, slightly bigger on large islands
        const detailGeo = new THREE.IcosahedronGeometry(rockSize, 0); // Use Icosahedron for rocks too
        const detailMat = new THREE.MeshStandardMaterial({ color: 0x777788, roughness: 0.9, flatShading: true }); // Slightly lighter rocks?
        const detail = new THREE.Mesh(detailGeo, detailMat); const angle = Math.random() * Math.PI * 2; const detailDistX = (Math.random() * size * scaleX * 0.9); const detailDistZ = (Math.random() * size * scaleZ * 0.9); detail.position.set(Math.cos(angle) * detailDistX, islandHeight + rockSize*0.3, Math.sin(angle) * detailDistZ); // Sit slightly on top
        detail.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI); detail.castShadow = true; detail.position.applyAxisAngle(new THREE.Vector3(0,1,0), rotation); islandGroup.add(detail);
    }
    // --- MORE TREES on large islands ---
    if (isLarge) {
        const treeCount = Math.floor(size * 0.8) + 5; // MORE TREES
        for (let i = 0; i < treeCount; i++) { /* ... create and place palm tree ... */ }
        const hutCount = Math.floor(size * 0.1) + 1; for (let i = 0; i < hutCount; i++) { const hut = createHut(); /* ... place hut ... */ }
    }
    islandGroup.position.set(x, 0, z); islandGroup.userData = { isIsland: true, center: new THREE.Vector3(x, 0, z), size: size, scaleX: scaleX, scaleZ: scaleZ, rotation: rotation, effectiveRadiusX: size * scaleX, effectiveRadiusZ: size * scaleZ, isLarge: isLarge }; gameState.islands.push(islandGroup); const markerBaseSize = size * 1.5; const islandMarker = createMinimapMarker(0xb8860b, markerBaseSize, true, scaleX, scaleZ); islandMarker.position.set(x, 0.5, z); islandMarker.rotation.y = rotation; minimapScene.add(islandMarker); gameState.islandMarkers.set(islandGroup.uuid, islandMarker); return islandGroup;
}
function createPalmTree() { /* ... (no changes needed) ... */ }
// --- ADJUSTED HUT SIZE ---
function createHut() {
    const hutGroup = new THREE.Group();
    const baseScale = 1.5 + Math.random() * 0.5; // Overall scale multiplier
    const baseSize = 1.5 * baseScale; // Larger base
    const baseHeight = 1.0 * baseScale;
    const baseGeo = new THREE.BoxGeometry(baseSize, baseHeight, baseSize * (0.8 + Math.random() * 0.4)); const baseMat = new THREE.MeshStandardMaterial({ color: 0xD2B48C, roughness: 0.8, flatShading: true }); const base = new THREE.Mesh(baseGeo, baseMat); base.position.y = baseHeight / 2; base.castShadow = true; hutGroup.add(base);
    const roofHeight = (1.0 + Math.random() * 0.5) * baseScale; // Taller roof
    const roofGeo = new THREE.ConeGeometry(baseSize * 0.8, roofHeight, 4); // Wider roof to overhang slightly
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9, flatShading: true }); const roof = new THREE.Mesh(roofGeo, roofMat); roof.position.y = baseHeight + roofHeight / 2 - 0.1 * baseScale; roof.rotation.y = Math.PI / 4; roof.castShadow = true; hutGroup.add(roof);
    return hutGroup;
}
function createMinimapMarker(color, size = 6, isIsland = false, scaleX = 1, scaleZ = 1) { /* ... */ }
function createBullet(shooterPosition, shooterRotation, shooterId) { /* ... */ }
function createHitEffect(position) { /* ... */ }

// --- Collision Detection ---
function checkIslandCollision(shipPosition, island) { /* ... */ }
function handlePlayerCollisions(newPosition) { /* ... */ }
function handleBulletCollisions(bulletMesh) { /* ... */ }

// --- Player Management ---
function addOtherPlayer(playerData) { /* ... */ }
function removeOtherPlayer(playerId) { /* ... */ }
function updateOtherPlayer(playerData) { /* ... */ }

// --- Stats & UI Updates ---
function updateStatsDisplay() { /* ... */ }
function updateHealthDisplay(newHealth, oldHealth, damage) { /* ... */ }
function shakeScreen(intensity = 0.5, duration = 200) { /* ... */ }

// --- Input Handling ---
function handleKeyDown(event) { /* ... */ }
function handleKeyUp(event) { /* ... */ }
window.addEventListener('keydown', handleKeyDown); window.addEventListener('keyup', handleKeyUp);

// --- Network Event Handlers ---
networkManager.on('init', (data) => { /* Reads isLarge flag, clears splashes */ });
networkManager.on('playerJoined', (data) => { /* ... */ });
networkManager.on('playerLeft', (data) => { /* ... */ });
networkManager.on('playerMoved', (data) => { /* ... */ });
networkManager.on('playerRotated', (data) => { /* ... */ });
networkManager.on('playerSpeedChanged', (data) => { /* ... */ });
networkManager.on('playerHitEffect', (data) => { if (data.position) createHitEffect(new THREE.Vector3(data.position.x, data.position.y, data.position.z)); });
networkManager.on('updateHealth', (data) => { /* ... */ });
networkManager.on('playerDefeated', (data) => { /* ... */ });
networkManager.on('playerRespawned', (data) => { /* ... */ });
networkManager.on('disconnected', (data) => { /* ... */ });

// --- Game Loop ---
let animationFrameId = null;

function updateGame(deltaTime) { // Handles LOCAL player logic + network sending
    const shipState = gameState.playerShip; const keys = gameState.keys; const currentSpeed = Math.abs(shipState.speed); const speedRatio = Math.min(1, currentSpeed / shipState.maxSpeed); let speedChanged = false; let rotationChanged = false; let positionChanged = false;
    /* Physics & Input */ if (currentSpeed > 0.001) { shipState.speed *= Math.pow(PHYSICS_DRAG_FACTOR, deltaTime * 60); if (Math.abs(shipState.speed) < 0.001) shipState.speed = 0; speedChanged = true; } else if (shipState.speed !== 0) { shipState.speed = 0; speedChanged = true;} if (keys.up) { const newSpeed = Math.min(shipState.speed + shipState.acceleration * deltaTime * 60, shipState.maxSpeed); if(newSpeed !== shipState.speed) {shipState.speed = newSpeed; speedChanged = true;} } else if (keys.down) { const newSpeed = Math.max(shipState.speed - shipState.acceleration * deltaTime * 60 * 0.7, -shipState.maxSpeed / 2); if(newSpeed !== shipState.speed) { shipState.speed = newSpeed; speedChanged = true;} } if (keys.left) { shipState.rotation += shipState.turnSpeed * deltaTime * 60; rotationChanged = true; } if (keys.right) { shipState.rotation -= shipState.turnSpeed * deltaTime * 60; rotationChanged = true; }
    /* Movement & Collision */ let deltaX = 0; let deltaZ = 0; if (currentSpeed > 0) { const moveDistance = shipState.speed * deltaTime * 60; deltaX = -Math.sin(shipState.rotation) * moveDistance; deltaZ = -Math.cos(shipState.rotation) * moveDistance; } if (deltaX !== 0 || deltaZ !== 0) { const currentPosition = gameState.playerShip.position; const tentativePosition = currentPosition.clone().add(new THREE.Vector3(deltaX, 0, deltaZ)); const collision = handlePlayerCollisions(tentativePosition); if (!collision) { gameState.playerShip.position.copy(tentativePosition); playerShip.position.copy(gameState.playerShip.position); positionChanged = true; } else { if (shipState.speed !== 0) { shipState.speed = 0; speedChanged = true; }} } playerShip.rotation.y = shipState.rotation;
    /* Send Network Updates */ if (positionChanged) networkManager.updatePosition(gameState.playerShip.position); if (rotationChanged) networkManager.updateRotation(shipState.rotation); if (speedChanged) { networkManager.updateSpeed(shipState.speed); updateStatsDisplay(); }
    /* Camera */ const cameraDistance = 15; const cameraHeight = 10; const targetCameraPos = new THREE.Vector3( playerShip.position.x + Math.sin(shipState.rotation) * cameraDistance, playerShip.position.y + cameraHeight, playerShip.position.z + Math.cos(shipState.rotation) * cameraDistance ); camera.position.lerp(targetCameraPos, 0.05); camera.lookAt(playerShip.position.x, playerShip.position.y + 1.0, playerShip.position.z);
    /* Shooting */ if (keys.space && shipState.canShoot && networkManager.playerId && gameState.playerShip.health > 0) { createBullet(playerShip.position, shipState.rotation, networkManager.playerId); shipState.canShoot = false; setTimeout(() => { shipState.canShoot = true; }, shipState.shootCooldown); }
    /* Update Bullets */ for (let i = gameState.bullets.length - 1; i >= 0; i--) { const bulletMesh = gameState.bullets[i]; const bulletData = bulletMesh.userData; const moveStep = bulletData.speed * deltaTime * 60; bulletMesh.position.x -= Math.sin(bulletData.rotation) * moveStep; bulletMesh.position.z -= Math.cos(bulletData.rotation) * moveStep; bulletData.distanceTraveled += moveStep; let hit = false; if (moveStep > 0) hit = handleBulletCollisions(bulletMesh); if (hit || bulletData.distanceTraveled >= bulletData.maxDistance) { scene.remove(bulletMesh); bulletMesh.geometry?.dispose(); bulletMesh.material?.dispose(); gameState.bullets.splice(i, 1); } }
    /* GENERATE SPLASHES */ if (currentSpeed > SPLASH_SPAWN_THRESHOLD_SPEED && gameState.splashes.length < SPLASH_MAX_PARTICLES) { const spawnProbability = speedRatio * deltaTime * SPLASH_SPAWN_RATE_SCALE; const numToSpawn = Math.floor(spawnProbability) + (Math.random() < (spawnProbability % 1) ? 1 : 0); for (let j = 0; j < numToSpawn; j++) { if (gameState.splashes.length >= SPLASH_MAX_PARTICLES) break; const side = (gameState.splashes.length % 2 === 0) ? 1 : -1; const shipForward = new THREE.Vector3(); playerShip.getWorldDirection(shipForward); shipForward.y = 0; shipForward.normalize(); const shipRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), shipForward).normalize(); const spawnPos = playerShip.position.clone().addScaledVector(shipRight, side * SPLASH_SIDE_OFFSET).addScaledVector(shipForward, SPLASH_BACK_OFFSET).add(new THREE.Vector3(0, SPLASH_VERTICAL_OFFSET, 0)); const baseVelSide = SPLASH_INITIAL_VEL_SIDE_MIN + speedRatio * SPLASH_INITIAL_VEL_SIDE_SCALE; const baseVelUp = SPLASH_INITIAL_VEL_UP_MIN + speedRatio * SPLASH_INITIAL_VEL_UP_SCALE; const randX = (Math.random() - 0.5) * 1.0; /* More side random */ const randY = (Math.random() - 0.5) * 1.0; const randZ = (Math.random() - 0.5) * 1.0; const initialVelocity = shipRight.clone().multiplyScalar(side * baseVelSide).add(new THREE.Vector3(0, baseVelUp, 0)).add(new THREE.Vector3(randX, randY, randZ));
            // --- Use Icosahedron for splash particles ---
            const particle = new THREE.Mesh(splashGeometry, splashMaterial.clone()); // Use splashGeometry
            particle.position.copy(spawnPos); const lifetime = SPLASH_BASE_LIFETIME * (0.7 + Math.random() * 0.6); particle.userData = { velocity: initialVelocity, life: 0, maxLife: lifetime, baseOpacity: splashMaterial.opacity * (0.6 + speedRatio * 0.4) }; scene.add(particle); gameState.splashes.push(particle); } }
    /* Update Minimap */ minimapCamera.position.x = gameState.playerShip.position.x; minimapCamera.position.z = gameState.playerShip.position.z; minimapCamera.lookAt(gameState.playerShip.position.x, 0, gameState.playerShip.position.z); playerMarker.position.set(gameState.playerShip.position.x, playerMarker.position.y, gameState.playerShip.position.z); playerMarker.rotation.y = shipState.rotation;
}

function updateOfflineEffects(deltaTime) { // Handles animations/UI updates
    /* Update Splashes */ for (let i = gameState.splashes.length - 1; i >= 0; i--) { const particle = gameState.splashes[i]; const data = particle.userData; data.life += deltaTime; if (data.life >= data.maxLife) { scene.remove(particle); particle.material.dispose(); gameState.splashes.splice(i, 1); } else { data.velocity.y -= SPLASH_GRAVITY * deltaTime; data.velocity.multiplyScalar(1 - SPLASH_DRAG * deltaTime); particle.position.addScaledVector(data.velocity, deltaTime); particle.rotation.x += (Math.random()-0.5)*0.3; particle.rotation.y += (Math.random()-0.5)*0.3; particle.rotation.z += (Math.random()-0.5)*0.3; /* Random rotation */ if (particle.position.y < 0.05) { particle.position.y = 0.05; data.velocity.y *= -0.2; data.velocity.x *= 0.3; data.velocity.z *= 0.3; } /* Dampen more */ const lifeRatio = data.life / data.maxLife; particle.material.opacity = data.baseOpacity * (1 - lifeRatio * lifeRatio); } }

    /* Update Ocean Texture Scroll */
    oceanAnimation.time += deltaTime;
    waterTexture.offset.x = (waterTexture.offset.x + oceanAnimation.scrollSpeedX * deltaTime) % 1; waterTexture.offset.y = (waterTexture.offset.y + oceanAnimation.scrollSpeedZ * deltaTime) % 1;
    waterNormalMap.offset.x = (waterNormalMap.offset.x + oceanAnimation.normalScrollSpeedX * deltaTime) % 1; waterNormalMap.offset.y = (waterNormalMap.offset.y + oceanAnimation.normalScrollSpeedZ * deltaTime) % 1;

    /* Update UI */ if (statsElements.shipPosition) statsElements.shipPosition.textContent = `Pos: (${gameState.playerShip.position.x.toFixed(1)}, ${gameState.playerShip.position.y.toFixed(1)}, ${gameState.playerShip.position.z.toFixed(1)})`; if (statsElements.shipSpeed) statsElements.shipSpeed.textContent = Math.abs(gameState.playerShip.speed).toFixed(2);
}

// --- Animation Loop ---
let lastTimestamp = 0;
function animate(timestamp) {
    animationFrameId = requestAnimationFrame(animate); const delta = timestamp - lastTimestamp; const deltaTime = Math.max(0, Math.min(delta / 1000, 0.1)); lastTimestamp = timestamp;
    if (deltaTime > 0) { if (networkManager.connected) updateGame(deltaTime); updateOfflineEffects(deltaTime); }
    renderer.render(scene, camera); minimapRenderer.render(minimapScene, minimapCamera);
}

// --- Initialization ---
console.log("Game script loaded. Connecting..."); if (statsElements.connectionStatus) { /* Set connecting */ }
networkManager.connect(); lastTimestamp = performance.now(); animate();

// --- Event Listeners & Cleanup ---
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
window.addEventListener('beforeunload', () => { if (networkManager.connected) networkManager.ws?.close(); cancelAnimationFrame(animationFrameId); gameState.splashes.forEach(particle => { scene.remove(particle); particle.material?.dispose(); }); console.log("Game cleanup on unload."); });