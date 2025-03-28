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
// SPLASH Constants - Adjusted for size animation & lifetime
const SPLASH_SPAWN_THRESHOLD_SPEED = 0.08;
const SPLASH_MAX_PARTICLES = 350;
const SPLASH_BASE_LIFETIME = 2.8;         // DOUBLED Lifetime
const SPLASH_PARTICLE_START_SIZE = 0.25;  // Smaller starting size
const SPLASH_PARTICLE_END_SCALE = 2.0;    // Scale factor at end of life (2x bigger)
const SPLASH_BASE_OPACITY = 0.75;         // Adjusted opacity
const SPLASH_SPAWN_RATE_SCALE = 25;
const SPLASH_SIDE_OFFSET = 1.1;
const SPLASH_VERTICAL_OFFSET = 0.3;
const SPLASH_BACK_OFFSET = 0.3;
const SPLASH_INITIAL_VEL_SIDE_MIN = 1.2;
const SPLASH_INITIAL_VEL_SIDE_SCALE = 3.0;
const SPLASH_INITIAL_VEL_UP_MIN = 2.5;
const SPLASH_INITIAL_VEL_UP_SCALE = 2.5;
const SPLASH_GRAVITY = 4.5;
const SPLASH_DRAG = 0.25;

const PHYSICS_DRAG_FACTOR = 0.98;
const CLOUD_COUNT = 30; const CLOUD_MIN_Y = 40; const CLOUD_MAX_Y = 70; const CLOUD_AREA_RADIUS = 900; const LARGE_CLOUD_PROBABILITY = 0.2; const LARGE_CLOUD_SCALE_MULTIPLIER = 2.5;
const SHALLOW_WATER_DEPTH = 0.1; // How far below island base the shallow plane sits
const SHALLOW_WATER_COLOR = 0x66ccaa; // Light greenish-blue
const SHALLOW_WATER_OPACITY = 0.4;

// --- DOM Elements ---
const statsElements = { playerCount: document.getElementById('player-count'), shipSpeed: document.getElementById('ship-speed'), shipHealth: document.getElementById('ship-health'), connectionStatus: document.getElementById('connection-status'), shipPosition: document.getElementById('ship-position') };
const gameContainer = document.getElementById('game-container'); const minimapContainer = document.getElementById('minimap-container');
if (!gameContainer || !minimapContainer) { console.error('Essential containers not found!'); throw new Error("Missing essential DOM elements."); }

// --- Texture Loader ---
const textureLoader = new THREE.TextureLoader();

// --- Three.js Setup ---
const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000); const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(window.innerWidth, window.innerHeight); renderer.setClearColor(0x87CEEB); renderer.shadowMap.enabled = true; gameContainer.appendChild(renderer.domElement);
// --- Minimap Setup ---
const minimapSize = 200; const minimapWorldScale = 400; const minimapScene = new THREE.Scene(); const minimapCamera = new THREE.OrthographicCamera(-minimapWorldScale, minimapWorldScale, minimapWorldScale, -minimapWorldScale, 0.1, 1000); minimapCamera.position.set(0, 100, 0); minimapCamera.lookAt(0, 0, 0); const minimapRenderer = new THREE.WebGLRenderer({ antialias: true }); minimapRenderer.setSize(minimapSize, minimapSize); minimapRenderer.setClearColor(0x001a33, 0.8); minimapContainer.appendChild(minimapRenderer.domElement);

// --- Lighting --- (ADJUSTED INTENSITIES)
const hemiLight = new THREE.HemisphereLight(0xB1E1FF, 0xB97A20, 1.2); // More ambient (Intensity 1.2)
scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 0.8); // Less direct sun (Intensity 0.8)
sunLight.position.set(100, 150, 100); sunLight.castShadow = true; /* Shadow map settings */ scene.add(sunLight);

// --- Ocean --- (Texture Animation Slowed)
const waterTexture = textureLoader.load('https://threejs.org/examples/textures/water.jpg'); waterTexture.wrapS = waterTexture.wrapT = THREE.RepeatWrapping; const waterNormalMap = textureLoader.load('https://threejs.org/examples/textures/waternormals.jpg'); waterNormalMap.wrapS = waterNormalMap.wrapT = THREE.RepeatWrapping; const oceanGeometry = new THREE.PlaneGeometry(2000, 2000, 1, 1); const oceanMaterial = new THREE.MeshPhongMaterial({ color: 0x005577, shininess: 100, specular: 0x00aaff, map: waterTexture, normalMap: waterNormalMap, normalScale: new THREE.Vector2(0.3, 0.3), side: THREE.FrontSide }); const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial); ocean.rotation.x = -Math.PI / 2; ocean.receiveShadow = true; scene.add(ocean);
// --- SLOWER SCROLL SPEED by 50% ---
const oceanAnimation = { time: 0, scrollSpeedX: 0.0025, scrollSpeedZ: 0.0015, normalScrollSpeedX: 0.0035, normalScrollSpeedZ: 0.0025 };

// --- Clouds ---
function createCloud() { /* ... (no changes needed from last version) ... */ }
const clouds = []; for (let i = 0; i < CLOUD_COUNT; i++) clouds.push(createCloud());

// --- Player Ship ---
const playerShip = createShip(false); scene.add(playerShip);

// --- Minimap Markers --- (LARGER PLAYER MARKER)
const playerMarker = createMinimapMarker(0x00ff00, 40); // Size increased to 40
playerMarker.position.y = 1; minimapScene.add(playerMarker);

// --- Splash Particle Shared Resources --- (Using Start Size)
const splashGeometry = new THREE.IcosahedronGeometry(SPLASH_PARTICLE_START_SIZE, 0); // Use start size
const splashMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: SPLASH_BASE_OPACITY, side: THREE.DoubleSide, depthWrite: false });

// --- Island Textures ---
const islandTextureUrl = 'https://threejs.org/examples/textures/terrain/grasslight-big.jpg'; const islandTexture = textureLoader.load(islandTextureUrl); islandTexture.wrapS = islandTexture.wrapT = THREE.RepeatWrapping; islandTexture.repeat.set(4, 4);

// --- Utility Functions ---
function createShip(isNPC = false) { /* ... */ }

function createIsland(x, z, size, scaleX = 1, scaleZ = 1, rotation = 0, isLarge = false) {
    const islandGroup = new THREE.Group(); const islandHeight = isLarge ? 2.5 : 1.5;
    const baseGeo = new THREE.CylinderGeometry(size, size * 1.1, islandHeight, isLarge ? 48 : 32); baseGeo.scale(scaleX, 1, scaleZ); const islandBaseTexture = islandTexture.clone(); islandBaseTexture.needsUpdate = true; islandBaseTexture.repeat.set(Math.max(2, Math.round(size * scaleX * 0.1)), Math.max(2, Math.round(size * scaleZ * 0.1))); const baseMat = new THREE.MeshPhongMaterial({ color: 0x8B4513, map: islandBaseTexture, shininess: 10, specular: 0x111111 });
    const base = new THREE.Mesh(baseGeo, baseMat); base.position.y = islandHeight / 2; base.rotation.y = rotation; base.castShadow = true; base.receiveShadow = true; islandGroup.add(base);

    // Rocks
    const numRocks = isLarge ? Math.floor(Math.random() * 5) + 3 : Math.floor(Math.random() * 3) + 1; for (let i = 0; i < numRocks; i++) { const rockSize = (0.4 + Math.random() * 0.8) * (isLarge ? 1.2 : 0.9); const detailGeo = new THREE.IcosahedronGeometry(rockSize, 0); const detailMat = new THREE.MeshStandardMaterial({ color: 0x777788, roughness: 0.9, flatShading: true }); const detail = new THREE.Mesh(detailGeo, detailMat); const angle = Math.random() * Math.PI * 2; const detailDistX = (Math.random() * size * scaleX * 0.9); const detailDistZ = (Math.random() * size * scaleZ * 0.9); detail.position.set(Math.cos(angle) * detailDistX, islandHeight + rockSize*0.3, Math.sin(angle) * detailDistZ); detail.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI); detail.castShadow = true; detail.position.applyAxisAngle(new THREE.Vector3(0,1,0), rotation); islandGroup.add(detail); }
    // Trees
    const treeCount = isLarge ? Math.floor(size * 0.9) + 6 : (Math.random() < 0.4 ? Math.floor(Math.random() * 2) + 1 : 0); if (treeCount > 0) { for (let i = 0; i < treeCount; i++) { const tree = createPalmTree(); const angle = Math.random() * Math.PI * 2; const treeDistX = (Math.random() * size * scaleX * 0.85); const treeDistZ = (Math.random() * size * scaleZ * 0.85); tree.position.set(Math.cos(angle) * treeDistX, islandHeight, Math.sin(angle) * treeDistZ); tree.rotation.y = Math.random() * Math.PI * 2; tree.position.applyAxisAngle(new THREE.Vector3(0,1,0), rotation); islandGroup.add(tree); } }
    // Huts
    if (isLarge) { const hutCount = Math.floor(size * 0.15) + 1; for (let i = 0; i < hutCount; i++) { const hut = createHut(); const angle = Math.random() * Math.PI * 2; const hutDistX = (Math.random() * size * scaleX * 0.7); const hutDistZ = (Math.random() * size * scaleZ * 0.7); hut.position.set(Math.cos(angle) * hutDistX, islandHeight, Math.sin(angle) * hutDistZ); hut.rotation.y = Math.random() * Math.PI * 2; hut.position.applyAxisAngle(new THREE.Vector3(0,1,0), rotation); islandGroup.add(hut); } }

    // --- ADD SHALLOW WATER PLANE ---
    const shallowWaterSize = size * 1.4; // Make shallow area slightly larger than base radius
    const shallowWaterGeo = new THREE.CylinderGeometry(shallowWaterSize, shallowWaterSize, 0.1, 32); // Very thin cylinder
    shallowWaterGeo.scale(scaleX, 1, scaleZ); // Match island scaling
    const shallowWaterMat = new THREE.MeshBasicMaterial({
        color: SHALLOW_WATER_COLOR,
        transparent: true,
        opacity: SHALLOW_WATER_OPACITY,
        depthWrite: false // Don't obscure things below it as much
    });
    const shallowWaterMesh = new THREE.Mesh(shallowWaterGeo, shallowWaterMat);
    shallowWaterMesh.position.y = SHALLOW_WATER_DEPTH; // Position slightly above ocean floor
    shallowWaterMesh.rotation.y = rotation; // Match island rotation
    // shallowWaterMesh.visible = false; // Start invisible? Or just let it render?
    islandGroup.add(shallowWaterMesh); // Add to the island group so it moves/rotates together

    islandGroup.position.set(x, 0, z); islandGroup.userData = { isIsland: true, center: new THREE.Vector3(x, 0, z), size: size, scaleX: scaleX, scaleZ: scaleZ, rotation: rotation, effectiveRadiusX: size * scaleX, effectiveRadiusZ: size * scaleZ, isLarge: isLarge }; gameState.islands.push(islandGroup); const markerBaseSize = size * 1.5; const islandMarker = createMinimapMarker(0xD2B48C, markerBaseSize, true, scaleX, scaleZ); islandMarker.position.set(x, 0.5, z); islandMarker.rotation.y = rotation; minimapScene.add(islandMarker); gameState.islandMarkers.set(islandGroup.uuid, islandMarker); return islandGroup;
}
// --- ADJUSTED PALM TREE SIZE ---
function createPalmTree() {
    const treeGroup = new THREE.Group();
    const trunkHeight = 5 + Math.random() * 4; // TALLER trunks
    const trunkRadius = 0.3 + Math.random() * 0.1; // Thicker trunks
    const trunkGeo = new THREE.CylinderGeometry(trunkRadius * 0.8, trunkRadius, trunkHeight, 6); const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.8, flatShading: true }); const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.position.y = trunkHeight / 2; trunk.castShadow = true; treeGroup.add(trunk);
    const leafCount = 6 + Math.floor(Math.random() * 3);
    const leafLength = 2.5 + Math.random() * 1.5; // LARGER leaves
    const leafWidth = leafLength * 0.7;
    const leafGeo = new THREE.ConeGeometry(leafWidth / 2 , leafLength, 5); const leafMat = new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.7, flatShading: true }); for (let i = 0; i < leafCount; i++) { const leaf = new THREE.Mesh(leafGeo, leafMat); leaf.position.y = trunkHeight - 0.4; /* Adjust attach point */ const angle = (i / leafCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4; const tilt = Math.PI / 3.5 + (Math.random() - 0.5) * 0.4; leaf.position.x = Math.cos(angle) * 0.5; leaf.position.z = Math.sin(angle) * 0.5; leaf.rotation.x = tilt * Math.sin(angle); leaf.rotation.z = -tilt * Math.cos(angle); leaf.rotation.y = -angle; leaf.castShadow = true; treeGroup.add(leaf); }
    return treeGroup;
}
function createHut() { const hutGroup = new THREE.Group(); const baseScale = 1.8 + Math.random() * 0.6; const baseSize = 1.5 * baseScale; const baseHeight = 1.0 * baseScale; const baseGeo = new THREE.BoxGeometry(baseSize, baseHeight, baseSize * (0.8 + Math.random() * 0.4)); const baseMat = new THREE.MeshStandardMaterial({ color: 0xD2B48C, roughness: 0.8, flatShading: true }); const base = new THREE.Mesh(baseGeo, baseMat); base.position.y = baseHeight / 2; base.castShadow = true; hutGroup.add(base); const roofHeight = (1.0 + Math.random() * 0.5) * baseScale; const roofGeo = new THREE.ConeGeometry(baseSize * 0.8, roofHeight, 4); const roofMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9, flatShading: true }); const roof = new THREE.Mesh(roofGeo, roofMat); roof.position.y = baseHeight + roofHeight / 2 - 0.1 * baseScale; roof.rotation.y = Math.PI / 4; roof.castShadow = true; hutGroup.add(roof); return hutGroup; }

// --- ADJUSTED MINIMAP MARKER SIZE for players ---
function createMinimapMarker(color, size = 6, isIsland = false, scaleX = 1, scaleZ = 1) {
    let markerGeometry; let markerColor = color;
    if (isIsland) { markerGeometry = new THREE.CircleGeometry(size / 2, 16); markerColor = 0xD2B48C; /* Tan */ }
    else { // Player marker - Use the passed size (now larger)
        const shape = new THREE.Shape(); shape.moveTo(0, size / 2); shape.lineTo(-size / 2 * 0.6, -size / 2); shape.lineTo(size / 2 * 0.6, -size / 2); shape.closePath(); markerGeometry = new THREE.ShapeGeometry(shape);
    }
    const markerMaterial = new THREE.MeshBasicMaterial({ color: markerColor, side: THREE.DoubleSide }); const marker = new THREE.Mesh(markerGeometry, markerMaterial); marker.rotation.x = -Math.PI / 2; if (isIsland) { marker.scale.set(scaleX, scaleZ, 1); } marker.position.y = 0.1; return marker;
}

function createBullet(shooterPosition, shooterRotation, shooterId) { /* ... */ }
function createHitEffect(position) { /* ... */ }
function checkIslandCollision(shipPosition, island) { /* ... */ }
function handlePlayerCollisions(newPosition) { /* ... */ }
function handleBulletCollisions(bulletMesh) { /* ... */ }

// Player Management - Adjust marker size on creation
function addOtherPlayer(playerData) { if (!playerData || !playerData.id) return; if (playerData.id === networkManager.playerId) return; if (gameState.otherPlayers.has(playerData.id)) { updateOtherPlayer(playerData); return; } console.log('Adding other player:', playerData.id); const ship = createShip(true); const position = playerData.position || { x: 0, y: 0, z: 0 }; const rotation = playerData.rotation || 0; ship.position.set(position.x, position.y, position.z); ship.rotation.y = rotation; scene.add(ship);
    // --- Use LARGER size for other player markers ---
    const marker = createMinimapMarker(0xff0000, 40); // Size 40, Red
    marker.position.set(position.x, 0.6, position.z); marker.rotation.y = rotation; minimapScene.add(marker); gameState.otherPlayers.set(playerData.id, { ship, marker }); updateStatsDisplay();
}
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
networkManager.on('init', (data) => { /* ... */ });
networkManager.on('playerJoined', (data) => { /* ... */ });
networkManager.on('playerLeft', (data) => { /* ... */ });
networkManager.on('playerMoved', (data) => { /* ... */ });
networkManager.on('playerRotated', (data) => { /* ... */ });
networkManager.on('playerSpeedChanged', (data) => { /* ... */ });
networkManager.on('playerHitEffect', (data) => { /* ... */ });
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
    /* GENERATE SPLASHES */ if (currentSpeed > SPLASH_SPAWN_THRESHOLD_SPEED && gameState.splashes.length < SPLASH_MAX_PARTICLES) { const spawnProbability = speedRatio * deltaTime * SPLASH_SPAWN_RATE_SCALE; const numToSpawn = Math.floor(spawnProbability) + (Math.random() < (spawnProbability % 1) ? 1 : 0); for (let j = 0; j < numToSpawn; j++) { if (gameState.splashes.length >= SPLASH_MAX_PARTICLES) break; const side = (gameState.splashes.length % 2 === 0) ? 1 : -1; const shipForward = new THREE.Vector3(); playerShip.getWorldDirection(shipForward); shipForward.y = 0; shipForward.normalize(); const shipRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), shipForward).normalize(); const spawnPos = playerShip.position.clone().addScaledVector(shipRight, side * SPLASH_SIDE_OFFSET).addScaledVector(shipForward, SPLASH_BACK_OFFSET).add(new THREE.Vector3(0, SPLASH_VERTICAL_OFFSET, 0)); const baseVelSide = SPLASH_INITIAL_VEL_SIDE_MIN + speedRatio * SPLASH_INITIAL_VEL_SIDE_SCALE; const baseVelUp = SPLASH_INITIAL_VEL_UP_MIN + speedRatio * SPLASH_INITIAL_VEL_UP_SCALE; const randX = (Math.random() - 0.5) * 1.0; const randY = (Math.random() - 0.5) * 1.0; const randZ = (Math.random() - 0.5) * 1.0; const initialVelocity = shipRight.clone().multiplyScalar(side * baseVelSide).add(new THREE.Vector3(0, baseVelUp, 0)).add(new THREE.Vector3(randX, randY, randZ)); const particle = new THREE.Mesh(splashGeometry, splashMaterial.clone()); particle.position.copy(spawnPos); const lifetime = SPLASH_BASE_LIFETIME * (0.7 + Math.random() * 0.6); particle.userData = { velocity: initialVelocity, life: 0, maxLife: lifetime, baseOpacity: splashMaterial.opacity * (0.6 + speedRatio * 0.4), startSize: SPLASH_PARTICLE_START_SIZE }; /* Store start size */ scene.add(particle); gameState.splashes.push(particle); } }
    /* Update Minimap */ minimapCamera.position.x = gameState.playerShip.position.x; minimapCamera.position.z = gameState.playerShip.position.z; minimapCamera.lookAt(gameState.playerShip.position.x, 0, gameState.playerShip.position.z); playerMarker.position.set(gameState.playerShip.position.x, playerMarker.position.y, gameState.playerShip.position.z); playerMarker.rotation.y = shipState.rotation;
}

function updateOfflineEffects(deltaTime) { // Handles animations/UI updates
    /* Update Splashes */ for (let i = gameState.splashes.length - 1; i >= 0; i--) { const particle = gameState.splashes[i]; const data = particle.userData; data.life += deltaTime; if (data.life >= data.maxLife) { scene.remove(particle); particle.material.dispose(); gameState.splashes.splice(i, 1); } else { data.velocity.y -= SPLASH_GRAVITY * deltaTime; data.velocity.multiplyScalar(1 - SPLASH_DRAG * deltaTime); particle.position.addScaledVector(data.velocity, deltaTime); particle.rotation.x += (Math.random()-0.5)*0.3; particle.rotation.y += (Math.random()-0.5)*0.3; particle.rotation.z += (Math.random()-0.5)*0.3; /* Tumble */ if (particle.position.y < 0.05) { particle.position.y = 0.05; data.velocity.y *= -0.2; data.velocity.x *= 0.3; data.velocity.z *= 0.3; } const lifeRatio = data.life / data.maxLife;
            // --- Scale animation ---
            const currentScale = data.startSize * (1 + lifeRatio * (SPLASH_PARTICLE_END_SCALE - 1)); // Linear scale from startSize to startSize * END_SCALE
            particle.scale.setScalar(currentScale);
            // --- Opacity fade ---
            particle.material.opacity = data.baseOpacity * (1 - lifeRatio * lifeRatio); // Fade faster at end
        }
    }

    /* Update Ocean Texture Scroll */
    oceanAnimation.time += deltaTime; waterTexture.offset.x = (waterTexture.offset.x + oceanAnimation.scrollSpeedX * deltaTime) % 1; waterTexture.offset.y = (waterTexture.offset.y + oceanAnimation.scrollSpeedZ * deltaTime) % 1; waterNormalMap.offset.x = (waterNormalMap.offset.x + oceanAnimation.normalScrollSpeedX * deltaTime) % 1; waterNormalMap.offset.y = (waterNormalMap.offset.y + oceanAnimation.normalScrollSpeedZ * deltaTime) % 1;

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
console.log("Game script loaded. Connecting..."); if (statsElements.connectionStatus) { statsElements.connectionStatus.textContent = "Connecting..."; statsElements.connectionStatus.style.color = "orange"; }
networkManager.connect(); lastTimestamp = performance.now(); animate();

// --- Event Listeners & Cleanup ---
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
window.addEventListener('beforeunload', () => { if (networkManager.connected) networkManager.ws?.close(); cancelAnimationFrame(animationFrameId); gameState.splashes.forEach(particle => { scene.remove(particle); particle.material?.dispose(); }); console.log("Game cleanup on unload."); });