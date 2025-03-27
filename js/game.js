import * as THREE from 'three';
import networkManager from './network.js';

// --- Game State ---
const gameState = {
    playerShip: {
        position: new THREE.Vector3(0, 0, 0),
        rotation: 0,
        speed: 0,
        turnSpeed: 0.03,
        maxSpeed: 0.6, // Target max speed remains 0.6
        // --- INCREASED ACCELERATION ---
        acceleration: 0.02, // Increased from 0.01
        health: 100,
        canShoot: true,
        shootCooldown: 125
    },
    otherPlayers: new Map(),
    bullets: [],
    keys: { up: false, down: false, left: false, right: false, space: false },
    islands: [],
    islandMarkers: new Map(),
    wakes: []
};

// --- Constants ---
// --- ADJUSTED WAKE CONSTANTS ---
const WAKE_SPAWN_THRESHOLD_SPEED = 0.15;
const WAKE_MAX_PARTICLES = 150;
const WAKE_BASE_LIFETIME = 1.1;         // Increased lifetime (from 0.8)
const WAKE_PARTICLE_SIZE = 0.18;        // Slightly larger (from 0.15)
const WAKE_BASE_OPACITY = 0.75;         // Slightly more opaque (from 0.7)
const WAKE_SPAWN_RATE_SCALE = 9;        // Slightly higher spawn rate
const WAKE_SIDE_OFFSET = 1.1;
const WAKE_VERTICAL_OFFSET = 0.2;       // Higher spawn point (from 0.1)
const WAKE_BACK_OFFSET = -0.5;
const WAKE_INITIAL_VEL_SIDE = 1.9;      // Slightly more outward speed
const WAKE_INITIAL_VEL_UP = 1.7;        // Slightly more upward speed
const WAKE_INITIAL_VEL_BACK = -0.5;
const WAKE_GRAVITY = 2.5;               // Reduced gravity (from 3.0)
const WAKE_DRAG = 0.1;
// --- ADJUSTED PHYSICS DRAG ---
const PHYSICS_DRAG_FACTOR = 0.98;       // Reduced drag (from 0.97 in loop)

// --- DOM Elements ---
const statsElements = {
    playerCount: document.getElementById('player-count'),
    shipSpeed: document.getElementById('ship-speed'),
    shipHealth: document.getElementById('ship-health'),
    connectionStatus: document.getElementById('connection-status'),
    shipPosition: document.getElementById('ship-position')
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
renderer.setClearColor(0x87CEEB);
renderer.shadowMap.enabled = true;
gameContainer.appendChild(renderer.domElement);

// --- Minimap Setup ---
const minimapSize = 200; const minimapWorldScale = 400; const minimapScene = new THREE.Scene();
const minimapCamera = new THREE.OrthographicCamera( -minimapWorldScale, minimapWorldScale, minimapWorldScale, -minimapWorldScale, 0.1, 1000 );
minimapCamera.position.set(0, 100, 0); minimapCamera.lookAt(0, 0, 0);
const minimapRenderer = new THREE.WebGLRenderer({ antialias: true });
minimapRenderer.setSize(minimapSize, minimapSize); minimapRenderer.setClearColor(0x001a33, 0.8); minimapContainer.appendChild(minimapRenderer.domElement);

// --- Lighting ---
const hemiLight = new THREE.HemisphereLight(0xB1E1FF, 0xB97A20, 0.8); scene.add(hemiLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 1.5); sunLight.position.set(100, 150, 100); sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048; sunLight.shadow.mapSize.height = 2048; sunLight.shadow.camera.near = 50; sunLight.shadow.camera.far = 500;
sunLight.shadow.camera.left = -250; sunLight.shadow.camera.right = 250; sunLight.shadow.camera.top = 250; sunLight.shadow.camera.bottom = -250;
scene.add(sunLight);
// scene.add(new THREE.CameraHelper(sunLight.shadow.camera));

// --- Ocean ---
const waterTexture = new THREE.TextureLoader().load('https://threejs.org/examples/textures/water.jpg'); waterTexture.wrapS = waterTexture.wrapT = THREE.RepeatWrapping;
const waterNormalMap = new THREE.TextureLoader().load('https://threejs.org/examples/textures/waternormals.jpg'); waterNormalMap.wrapS = waterNormalMap.wrapT = THREE.RepeatWrapping;
const oceanGeometry = new THREE.PlaneGeometry(2000, 2000, 100, 100);
const oceanMaterial = new THREE.MeshPhongMaterial({ color: 0x007799, shininess: 80, specular: 0x00bbdd, map: waterTexture, normalMap: waterNormalMap, normalScale: new THREE.Vector2(0.15, 0.15), transparent: true, opacity: 0.9 });
const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial); ocean.rotation.x = -Math.PI / 2; ocean.receiveShadow = true; scene.add(ocean);
const oceanAnimation = { time: 0 };

// --- Player Ship ---
const playerShip = createShip(false); scene.add(playerShip);

// --- Minimap Markers ---
const playerMarker = createMinimapMarker(0x00ff00, 30); playerMarker.position.y = 1; minimapScene.add(playerMarker);

// --- Wake Particle Shared Resources ---
const wakeGeometry = new THREE.PlaneGeometry(WAKE_PARTICLE_SIZE, WAKE_PARTICLE_SIZE);
const wakeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: WAKE_BASE_OPACITY, side: THREE.DoubleSide });

// --- Utility Functions ---
function createShip(isNPC = false) { /* ... (same as before) ... */
    const shipGroup = new THREE.Group(); const mainColor = isNPC ? 0xcc0000 : 0x8B4513; const sailColor = isNPC ? 0xaaaaaa : 0xFFFFFF;
    const hullGeo = new THREE.BoxGeometry(2, 1, 4); const hullMat = new THREE.MeshPhongMaterial({ color: mainColor }); const hull = new THREE.Mesh(hullGeo, hullMat); hull.position.y = 0.5; hull.castShadow = true; hull.receiveShadow = true; shipGroup.add(hull);
    const mastGeo = new THREE.CylinderGeometry(0.1, 0.1, 3, 8); const mastMat = new THREE.MeshPhongMaterial({ color: 0x5a3a22 }); const mast = new THREE.Mesh(mastGeo, mastMat); mast.position.y = 2; mast.castShadow = true; shipGroup.add(mast);
    const sailGeo = new THREE.PlaneGeometry(1.5, 2); const sailMat = new THREE.MeshPhongMaterial({ color: sailColor, side: THREE.DoubleSide }); const sail = new THREE.Mesh(sailGeo, sailMat); sail.position.set(0, 2.5, -0.1); sail.castShadow = true; shipGroup.add(sail);
    shipGroup.userData.isShip = true; shipGroup.userData.isNPC = isNPC; return shipGroup;
}
function createIsland(x, z, size, scaleX = 1, scaleZ = 1, rotation = 0) { /* ... (same as before) ... */
    const islandGroup = new THREE.Group(); const islandHeight = 1.5; const baseGeo = new THREE.CylinderGeometry(size, size * 1.1, islandHeight, 32); baseGeo.scale(scaleX, 1, scaleZ); const baseMat = new THREE.MeshPhongMaterial({ color: 0xb8860b, flatShading: true }); const base = new THREE.Mesh(baseGeo, baseMat); base.position.y = islandHeight / 2; base.rotation.y = rotation; base.castShadow = true; base.receiveShadow = true; islandGroup.add(base);
    const numDetails = Math.floor(Math.random() * 4) + 2; for (let i = 0; i < numDetails; i++) { const detailSize = Math.random() * size * 0.2 + size * 0.1; const detailGeo = new THREE.DodecahedronGeometry(detailSize, 0); const detailMat = new THREE.MeshPhongMaterial({ color: 0x888888, flatShading: true }); const detail = new THREE.Mesh(detailGeo, detailMat); const angle = Math.random() * Math.PI * 2; const detailDistX = (Math.random() * size * scaleX * 0.8); const detailDistZ = (Math.random() * size * scaleZ * 0.8); detail.position.set(Math.cos(angle) * detailDistX, islandHeight, Math.sin(angle) * detailDistZ); detail.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI); detail.castShadow = true; detail.position.applyAxisAngle(new THREE.Vector3(0,1,0), rotation); islandGroup.add(detail); }
    islandGroup.position.set(x, 0, z); islandGroup.userData = { isIsland: true, center: new THREE.Vector3(x, 0, z), size: size, scaleX: scaleX, scaleZ: scaleZ, rotation: rotation, effectiveRadiusX: size * scaleX, effectiveRadiusZ: size * scaleZ }; gameState.islands.push(islandGroup);
    const markerBaseSize = size * 1.5; const islandMarker = createMinimapMarker(0xb8860b, markerBaseSize, true, scaleX, scaleZ); islandMarker.position.set(x, 0.5, z); islandMarker.rotation.y = rotation; minimapScene.add(islandMarker); gameState.islandMarkers.set(islandGroup.uuid, islandMarker); return islandGroup;
}
function createMinimapMarker(color, size = 6, isIsland = false, scaleX = 1, scaleZ = 1) { /* ... (same as before) ... */
    let markerGeometry; if (isIsland) { markerGeometry = new THREE.CircleGeometry(size / 2, 16); } else { const shape = new THREE.Shape(); shape.moveTo(0, size / 2); shape.lineTo(-size / 2 * 0.6, -size / 2); shape.lineTo(size / 2 * 0.6, -size / 2); shape.closePath(); markerGeometry = new THREE.ShapeGeometry(shape); } const markerMaterial = new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide }); const marker = new THREE.Mesh(markerGeometry, markerMaterial); marker.rotation.x = -Math.PI / 2; if (isIsland) { marker.scale.set(scaleX, scaleZ, 1); } marker.position.y = 0.1; return marker;
}
function createBullet(shooterPosition, shooterRotation, shooterId) { /* ... (same as before) ... */
    const bulletGeo = new THREE.SphereGeometry(0.25, 8, 6); const bulletMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 }); const bulletMesh = new THREE.Mesh(bulletGeo, bulletMat); bulletMesh.userData = { shooterId: shooterId, rotation: shooterRotation, speed: 1.5, distanceTraveled: 0, maxDistance: 80, damage: 10, creationTime: Date.now() }; const forwardOffset = 2.5; const verticalOffset = 0.7; bulletMesh.position.set( shooterPosition.x - Math.sin(shooterRotation) * forwardOffset, shooterPosition.y + verticalOffset, shooterPosition.z - Math.cos(shooterRotation) * forwardOffset ); scene.add(bulletMesh); gameState.bullets.push(bulletMesh);
}
function createHitEffect(position) { /* ... (same as before) ... */
    if (!position || !(position instanceof THREE.Vector3)) { position = new THREE.Vector3(0, 0.5, 0); } const effectPosition = position.clone(); effectPosition.y = Math.max(0.5, position.y); const sphereGeo = new THREE.SphereGeometry(0.5, 16, 8); const sphereMat = new THREE.MeshBasicMaterial({ color: 0xff4500, transparent: true, opacity: 0.8 }); const sphereEffect = new THREE.Mesh(sphereGeo, sphereMat); sphereEffect.position.copy(effectPosition); scene.add(sphereEffect); const ringGeo = new THREE.RingGeometry(0.1, 0.5, 32); const ringMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, side: THREE.DoubleSide, transparent: true, opacity: 0.7 }); const ringEffect = new THREE.Mesh(ringGeo, ringMat); ringEffect.position.copy(effectPosition); ringEffect.rotation.x = -Math.PI / 2; scene.add(ringEffect); const duration = 500; const startTime = Date.now(); function animateHit() { const elapsed = Date.now() - startTime; const progress = Math.min(1, elapsed / duration); if (progress < 1) { const easeOutQuart = 1 - Math.pow(1 - progress, 4); sphereEffect.scale.setScalar(1 + easeOutQuart * 4); sphereEffect.material.opacity = 0.8 * (1 - progress); ringEffect.scale.setScalar(1 + easeOutQuart * 6); ringEffect.material.opacity = 0.7 * (1 - progress * progress); requestAnimationFrame(animateHit); } else { scene.remove(sphereEffect); sphereEffect.geometry.dispose(); sphereEffect.material.dispose(); scene.remove(ringEffect); ringEffect.geometry.dispose(); ringEffect.material.dispose(); } } animateHit();
}

// --- Collision Detection ---
function checkIslandCollision(shipPosition, island) { /* ... (same as before) ... */
    const islandData = island.userData; const islandPos = islandData.center; const localShipPos = shipPosition.clone().sub(islandPos); localShipPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), -islandData.rotation); const shipRadiusApproximation = 1.5; const effectiveRadiusX = islandData.effectiveRadiusX + shipRadiusApproximation; const effectiveRadiusZ = islandData.effectiveRadiusZ + shipRadiusApproximation; const dx = localShipPos.x / effectiveRadiusX; const dz = localShipPos.z / effectiveRadiusZ; return (dx * dx + dz * dz) <= 1;
}
function handlePlayerCollisions(newPosition) { /* ... (same as before) ... */
    for (const island of gameState.islands) { if (checkIslandCollision(newPosition, island)) return true; } return false;
}
function handleBulletCollisions(bulletMesh) { /* ... (same as before) ... */
    const bulletData = bulletMesh.userData; /* Islands */ for (const island of gameState.islands) { const islandData = island.userData; const distSq = bulletMesh.position.distanceToSquared(islandData.center); const maxIslandRadiusSq = Math.pow(Math.max(islandData.effectiveRadiusX, islandData.effectiveRadiusZ) + 0.5, 2); if (distSq < maxIslandRadiusSq && checkIslandCollision(bulletMesh.position, island)) { createHitEffect(bulletMesh.position.clone()); return true; } } /* Other Players */ const approxShipRadius = 2.0; for (const [playerId, playerData] of gameState.otherPlayers) { if (playerId === bulletData.shooterId) continue; const ship = playerData.ship; if (!ship) continue; const distance = bulletMesh.position.distanceTo(ship.position); if (distance < approxShipRadius) { networkManager.sendPlayerHit(playerId, bulletData.damage, bulletMesh.position.clone()); return true; } } /* Local Player */ if (networkManager.playerId && bulletData.shooterId !== networkManager.playerId) { const distance = bulletMesh.position.distanceTo(playerShip.position); if (distance < approxShipRadius) { networkManager.sendPlayerHit(networkManager.playerId, bulletData.damage, bulletMesh.position.clone()); return true; } } return false;
}

// --- Player Management ---
function addOtherPlayer(playerData) { /* ... (same as before) ... */
    if (!playerData || !playerData.id) return; if (playerData.id === networkManager.playerId) return; if (gameState.otherPlayers.has(playerData.id)) { updateOtherPlayer(playerData); return; } console.log('Adding other player:', playerData.id); const ship = createShip(true); const position = playerData.position || { x: 0, y: 0, z: 0 }; const rotation = playerData.rotation || 0; ship.position.set(position.x, position.y, position.z); ship.rotation.y = rotation; scene.add(ship); const marker = createMinimapMarker(0xff0000, 30); marker.position.set(position.x, 0.6, position.z); marker.rotation.y = rotation; minimapScene.add(marker); gameState.otherPlayers.set(playerData.id, { ship, marker }); updateStatsDisplay();
}
function removeOtherPlayer(playerId) { /* ... (same as before, includes disposal) ... */
    if (playerId === networkManager.playerId) return; const playerData = gameState.otherPlayers.get(playerId); if (playerData) { console.log('Removing other player:', playerId); if (playerData.ship) { scene.remove(playerData.ship); playerData.ship.traverse(child => { if (child.isMesh) { child.geometry?.dispose(); if (child.material) { if (Array.isArray(child.material)) child.material.forEach(mat => mat?.dispose()); else child.material?.dispose(); }}}); } if (playerData.marker) { minimapScene.remove(playerData.marker); playerData.marker.geometry?.dispose(); playerData.marker.material?.dispose(); } gameState.otherPlayers.delete(playerId); updateStatsDisplay(); } else { console.warn('Attempted to remove non-existent player:', playerId); }
}
function updateOtherPlayer(playerData) { /* ... (same as before, includes logging checks) ... */
    if (!playerData || !playerData.id || playerData.id === networkManager.playerId) return; const clientIdStr = networkManager.playerId?.substring(0,4) ?? '???'; const rcvdIdStr = playerData.id.substring(0,4); const posStr = playerData.position ? `(${playerData.position.x.toFixed(1)}, ${playerData.position.z.toFixed(1)})` : 'N/A'; const rotStr = typeof playerData.rotation === 'number' ? playerData.rotation.toFixed(2) : 'N/A'; /* console.log(`[Client ${clientIdStr}] Received update for Player ${rcvdIdStr}: Pos=${posStr}, Rot=${rotStr}`); */ const existingPlayerData = gameState.otherPlayers.get(playerData.id); if (existingPlayerData) { if (existingPlayerData.ship) { if (playerData.position) { /* console.log(`   -> Applying Pos to Ship ${rcvdIdStr}`); */ existingPlayerData.ship.position.set(playerData.position.x, playerData.position.y, playerData.position.z); } if (typeof playerData.rotation === 'number') { existingPlayerData.ship.rotation.y = playerData.rotation; } } else { console.warn(`Ship missing for player ${playerData.id} during update.`); removeOtherPlayer(playerData.id); addOtherPlayer(playerData); return; } if (existingPlayerData.marker) { if (playerData.position) { /* console.log(`   -> Applying Pos to Marker ${rcvdIdStr}`); */ existingPlayerData.marker.position.set(playerData.position.x, existingPlayerData.marker.position.y, playerData.position.z); } if (typeof playerData.rotation === 'number') { existingPlayerData.marker.rotation.y = playerData.rotation; } } else { console.warn(`Marker missing for player ${playerData.id} during update.`); } } else { /* console.log(`[Client ${clientIdStr}] Update called for non-existent player ${rcvdIdStr}, adding.`); */ addOtherPlayer(playerData); }
}

// --- Stats & UI Updates ---
function updateStatsDisplay() { /* ... (same as before) ... */
    if (statsElements.playerCount) statsElements.playerCount.textContent = gameState.otherPlayers.size + 1; if (statsElements.shipSpeed) statsElements.shipSpeed.textContent = Math.abs(gameState.playerShip.speed).toFixed(2);
}
function updateHealthDisplay(newHealth, oldHealth, damage) { /* ... (same as before) ... */
    const currentHealth = Math.max(0, Math.min(100, Math.round(newHealth))); gameState.playerShip.health = currentHealth; if (!statsElements.shipHealth) return; const healthElement = statsElements.shipHealth; healthElement.textContent = currentHealth.toString(); let healthColor = '#4CAF50'; if (currentHealth <= 30) healthColor = '#ff0000'; else if (currentHealth <= 60) healthColor = '#ffa500'; healthElement.style.color = healthColor; healthElement.style.fontWeight = currentHealth <= 30 ? 'bold' : 'normal'; if (damage && damage > 0 && oldHealth !== null && currentHealth < oldHealth) { const damageText = document.createElement('div'); damageText.textContent = `-${damage}`; damageText.style.position = 'absolute'; damageText.style.color = '#ff0000'; damageText.style.fontWeight = 'bold'; damageText.style.fontSize = '20px'; damageText.style.left = '50%'; damageText.style.top = '-10px'; damageText.style.transform = 'translateX(-50%)'; damageText.style.pointerEvents = 'none'; damageText.style.transition = 'transform 1s ease-out, opacity 1s ease-out'; healthElement.parentElement.style.position = 'relative'; healthElement.parentElement.appendChild(damageText); requestAnimationFrame(() => { damageText.style.transform = 'translate(-50%, -40px)'; damageText.style.opacity = '0'; }); setTimeout(() => { damageText.parentNode?.removeChild(damageText); }, 1000); shakeScreen(0.4, 150); }
}
function shakeScreen(intensity = 0.5, duration = 200) { /* ... (same as before) ... */
    const startTime = Date.now(); const baseCameraY = camera.position.y; function animateShake() { const elapsed = Date.now() - startTime; const progress = elapsed / duration; if (progress < 1) { const shakeAmount = intensity * Math.sin(progress * Math.PI * 4) * (1 - progress); camera.position.y = baseCameraY + shakeAmount; requestAnimationFrame(animateShake); } else { camera.position.y = baseCameraY; } } animateShake();
}

// --- Input Handling ---
function handleKeyDown(event) { /* ... (same as before) ... */
    switch (event.key) { case 'ArrowUp': case 'w': gameState.keys.up = true; break; case 'ArrowDown': case 's': gameState.keys.down = true; break; case 'ArrowLeft': case 'a': gameState.keys.left = true; break; case 'ArrowRight': case 'd': gameState.keys.right = true; break; case ' ': gameState.keys.space = true; break; }
}
function handleKeyUp(event) { /* ... (same as before) ... */
    switch (event.key) { case 'ArrowUp': case 'w': gameState.keys.up = false; break; case 'ArrowDown': case 's': gameState.keys.down = false; break; case 'ArrowLeft': case 'a': gameState.keys.left = false; break; case 'ArrowRight': case 'd': gameState.keys.right = false; break; case ' ': gameState.keys.space = false; break; }
}
window.addEventListener('keydown', handleKeyDown); window.addEventListener('keyup', handleKeyUp);

// --- Network Event Handlers ---
networkManager.on('init', (data) => { /* ... (same cleanup/setup as before) ... */
    console.log('Network Init:', data); if (!data.playerId || !data.gameState) { console.error("Invalid init data received!"); return; }
    /* Clear state */ gameState.otherPlayers.forEach((_, playerId) => removeOtherPlayer(playerId)); gameState.otherPlayers.clear(); gameState.islands.forEach(islandMesh => { scene.remove(islandMesh); islandMesh.traverse(child => { if (child.isMesh) { child.geometry?.dispose(); if (child.material) { if (Array.isArray(child.material)) child.material.forEach(mat => mat?.dispose()); else child.material?.dispose(); }}}); const marker = gameState.islandMarkers.get(islandMesh.uuid); if (marker) { minimapScene.remove(marker); marker.geometry?.dispose(); marker.material?.dispose(); } }); gameState.islands = []; gameState.islandMarkers.clear(); gameState.bullets.forEach(bulletMesh => { scene.remove(bulletMesh); bulletMesh.geometry?.dispose(); bulletMesh.material?.dispose(); }); gameState.bullets = []; gameState.wakes.forEach(particle => { scene.remove(particle); particle.material?.dispose(); }); gameState.wakes = [];
    /* Set new state */ if (data.gameState.world?.islands) { data.gameState.world.islands.forEach(islandData => { scene.add(createIsland(islandData.x, islandData.z, islandData.size, islandData.scaleX, islandData.scaleZ, islandData.rotation)); }); } if (data.gameState.players) { data.gameState.players.forEach(playerData => addOtherPlayer(playerData)); } const selfData = data.gameState.players?.find(p => p.id === networkManager.playerId); if (selfData) { gameState.playerShip.health = selfData.health ?? 100; if (selfData.position && (selfData.position.x !== 0 || selfData.position.z !== 0)) { gameState.playerShip.position.set(selfData.position.x, selfData.position.y, selfData.position.z); playerShip.position.copy(gameState.playerShip.position); console.log("Set initial player position from server:", gameState.playerShip.position.toArray()); } else { playerShip.position.copy(gameState.playerShip.position); } if (typeof selfData.rotation === 'number') { gameState.playerShip.rotation = selfData.rotation; playerShip.rotation.y = selfData.rotation; if (selfData.rotation !== 0) console.log("Set initial player rotation from server:", selfData.rotation); } else { playerShip.rotation.y = gameState.playerShip.rotation; } } else { playerShip.position.copy(gameState.playerShip.position); playerShip.rotation.y = gameState.playerShip.rotation; console.warn("Server did not provide initial state for local player."); }
    updateHealthDisplay(gameState.playerShip.health, null, 0); updateStatsDisplay(); if (statsElements.connectionStatus) { statsElements.connectionStatus.textContent = "Connected"; statsElements.connectionStatus.style.color = "#4CAF50"; }
});
networkManager.on('playerJoined', (data) => { /* ... (same as before) ... */ if (data.player) addOtherPlayer(data.player); });
networkManager.on('playerLeft', (data) => { /* ... (same as before) ... */ if (data.playerId) removeOtherPlayer(data.playerId); });
networkManager.on('playerMoved', (data) => { /* ... (same as before) ... */ updateOtherPlayer(data); });
networkManager.on('playerRotated', (data) => { /* ... (same as before) ... */ updateOtherPlayer(data); });
networkManager.on('playerSpeedChanged', (data) => { /* ... (same as before) ... */ });
networkManager.on('playerHitEffect', (data) => { /* ... (same as before) ... */ if (data.position) createHitEffect(new THREE.Vector3(data.position.x, data.position.y, data.position.z)); });
networkManager.on('updateHealth', (data) => { /* ... (same as before) ... */ if (typeof data.health === 'number') updateHealthDisplay(data.health, data.oldHealth, data.damage); else console.warn("Invalid health update:", data); });
networkManager.on('playerDefeated', (data) => { /* ... (same as before) ... */ console.log(`Player ${data.playerId} defeated by ${data.killerId}`); });
networkManager.on('playerRespawned', (data) => { /* ... (same as before) ... */ console.log('Network Player Respawned:', data); if (data.player) { if (data.player.id === networkManager.playerId) { console.log("Local player respawned!"); gameState.playerShip.health = data.player.health; gameState.playerShip.position.set(data.player.position.x, data.player.position.y, data.player.position.z); playerShip.position.copy(gameState.playerShip.position); gameState.playerShip.rotation = data.player.rotation; playerShip.rotation.y = data.player.rotation; gameState.playerShip.speed = 0; gameState.keys = { up: false, down: false, left: false, right: false, space: false }; updateHealthDisplay(gameState.playerShip.health, 0, 0); updateStatsDisplay(); } else { updateOtherPlayer(data.player); } } });
networkManager.on('disconnected', (data) => { /* ... (same as before) ... */ console.error(`Disconnected: ${data.reason}.`); if (statsElements.connectionStatus) { statsElements.connectionStatus.textContent = "Disconnected"; statsElements.connectionStatus.style.color = "#ff4500"; } });

// --- Game Loop ---
let animationFrameId = null;

function updateGame(deltaTime) {
    const shipState = gameState.playerShip; const keys = gameState.keys;
    const currentSpeed = Math.abs(shipState.speed); const speedRatio = Math.min(1, currentSpeed / shipState.maxSpeed);
    let speedChanged = false; let rotationChanged = false; let positionChanged = false;

    // --- Physics & Input ---
    // Drag - USE PHYSICS_DRAG_FACTOR CONSTANT
    if (currentSpeed > 0.001) { shipState.speed *= Math.pow(PHYSICS_DRAG_FACTOR, deltaTime * 60); if (Math.abs(shipState.speed) < 0.001) shipState.speed = 0; speedChanged = true; } else if (shipState.speed !== 0) { shipState.speed = 0; speedChanged = true;}
    // Accel/Decel
    if (keys.up) { const newSpeed = Math.min(shipState.speed + shipState.acceleration * deltaTime * 60, shipState.maxSpeed); if(newSpeed !== shipState.speed) {shipState.speed = newSpeed; speedChanged = true;} } else if (keys.down) { const newSpeed = Math.max(shipState.speed - shipState.acceleration * deltaTime * 60 * 0.7, -shipState.maxSpeed / 2); if(newSpeed !== shipState.speed) { shipState.speed = newSpeed; speedChanged = true;} }
    // Rotation
    if (keys.left) { shipState.rotation += shipState.turnSpeed * deltaTime * 60; rotationChanged = true; } if (keys.right) { shipState.rotation -= shipState.turnSpeed * deltaTime * 60; rotationChanged = true; }
    // Movement & Collision
    let deltaX = 0; let deltaZ = 0; if (currentSpeed > 0) { const moveDistance = shipState.speed * deltaTime * 60; deltaX = -Math.sin(shipState.rotation) * moveDistance; deltaZ = -Math.cos(shipState.rotation) * moveDistance; }
    if (deltaX !== 0 || deltaZ !== 0) {
        const currentPosition = gameState.playerShip.position; const tentativePosition = currentPosition.clone().add(new THREE.Vector3(deltaX, 0, deltaZ)); const collision = handlePlayerCollisions(tentativePosition);
        if (!collision) { gameState.playerShip.position.copy(tentativePosition); playerShip.position.copy(gameState.playerShip.position); positionChanged = true; }
        else { if (shipState.speed !== 0) { shipState.speed = 0; speedChanged = true; }}
    }
    playerShip.rotation.y = shipState.rotation; // Sync mesh rotation

    // --- Send Network Updates ---
    if (positionChanged) { networkManager.updatePosition(gameState.playerShip.position); }
    if (rotationChanged) { networkManager.updateRotation(shipState.rotation); }
    if (speedChanged) { networkManager.updateSpeed(shipState.speed); updateStatsDisplay(); }

    // --- Camera ---
    const cameraDistance = 15; const cameraHeight = 10; const targetCameraPos = new THREE.Vector3( playerShip.position.x + Math.sin(shipState.rotation) * cameraDistance, playerShip.position.y + cameraHeight, playerShip.position.z + Math.cos(shipState.rotation) * cameraDistance ); camera.position.lerp(targetCameraPos, 0.05); camera.lookAt(playerShip.position.x, playerShip.position.y + 1.0, playerShip.position.z);

    // --- Shooting ---
    if (keys.space && shipState.canShoot && networkManager.playerId && gameState.playerShip.health > 0) { createBullet(playerShip.position, shipState.rotation, networkManager.playerId); shipState.canShoot = false; setTimeout(() => { shipState.canShoot = true; }, shipState.shootCooldown); }

    // --- Update Bullets ---
    for (let i = gameState.bullets.length - 1; i >= 0; i--) { const bulletMesh = gameState.bullets[i]; const bulletData = bulletMesh.userData; const moveStep = bulletData.speed * deltaTime * 60; bulletMesh.position.x -= Math.sin(bulletData.rotation) * moveStep; bulletMesh.position.z -= Math.cos(bulletData.rotation) * moveStep; bulletData.distanceTraveled += moveStep; let hit = false; if (moveStep > 0) hit = handleBulletCollisions(bulletMesh); if (hit || bulletData.distanceTraveled >= bulletData.maxDistance) { scene.remove(bulletMesh); bulletMesh.geometry?.dispose(); bulletMesh.material?.dispose(); gameState.bullets.splice(i, 1); } }

    // --- GENERATE WAKES (SIDE SPRAY) ---
    if (currentSpeed > WAKE_SPAWN_THRESHOLD_SPEED && gameState.wakes.length < WAKE_MAX_PARTICLES) {
        const spawnProbability = speedRatio * deltaTime * WAKE_SPAWN_RATE_SCALE; const numToSpawn = Math.floor(spawnProbability) + (Math.random() < (spawnProbability % 1) ? 1 : 0);
        for (let j = 0; j < numToSpawn; j++) {
            if (gameState.wakes.length >= WAKE_MAX_PARTICLES) break;
            const side = (gameState.wakes.length % 2 === 0) ? 1 : -1; const shipForward = new THREE.Vector3(); playerShip.getWorldDirection(shipForward); shipForward.y = 0; shipForward.normalize(); const shipRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), shipForward).normalize();
            const spawnPos = playerShip.position.clone().addScaledVector(shipRight, side * WAKE_SIDE_OFFSET).addScaledVector(shipForward, WAKE_BACK_OFFSET).add(new THREE.Vector3(0, WAKE_VERTICAL_OFFSET, 0)); // Use adjusted offset
            const baseVelSide = WAKE_INITIAL_VEL_SIDE * (1 + speedRatio * 0.5); const baseVelUp = WAKE_INITIAL_VEL_UP * (1 + speedRatio * 0.3); const baseVelBack = WAKE_INITIAL_VEL_BACK * speedRatio; const randX = (Math.random() - 0.5) * 0.5; const randY = (Math.random() - 0.5) * 0.5; const randZ = (Math.random() - 0.5) * 0.5;
            const initialVelocity = shipRight.clone().multiplyScalar(side * baseVelSide).add(new THREE.Vector3(0, baseVelUp, 0)).addScaledVector(shipForward, baseVelBack).add(new THREE.Vector3(randX, randY, randZ));
            const particle = new THREE.Mesh(wakeGeometry, wakeMaterial.clone()); particle.position.copy(spawnPos); particle.rotation.x = -Math.PI / 2;
            const lifetime = WAKE_BASE_LIFETIME * (0.8 + Math.random() * 0.4); // Use adjusted lifetime
            particle.userData = { velocity: initialVelocity, life: 0, maxLife: lifetime, baseOpacity: wakeMaterial.opacity * (0.7 + speedRatio * 0.3) }; // Use adjusted opacity
            scene.add(particle); gameState.wakes.push(particle);
        }
    }

    // --- Update Minimap ---
    minimapCamera.position.x = gameState.playerShip.position.x; minimapCamera.position.z = gameState.playerShip.position.z; minimapCamera.lookAt(gameState.playerShip.position.x, 0, gameState.playerShip.position.z);
    playerMarker.position.set(gameState.playerShip.position.x, playerMarker.position.y, gameState.playerShip.position.z); playerMarker.rotation.y = shipState.rotation;
}

function updateOfflineEffects(deltaTime) {
    // --- Update Wakes ---
     for (let i = gameState.wakes.length - 1; i >= 0; i--) {
        const particle = gameState.wakes[i]; const data = particle.userData; data.life += deltaTime;
        if (data.life >= data.maxLife) { scene.remove(particle); particle.material.dispose(); gameState.wakes.splice(i, 1); }
        else {
            data.velocity.y -= WAKE_GRAVITY * deltaTime; // Use adjusted gravity
            data.velocity.multiplyScalar(1 - WAKE_DRAG * deltaTime);
            particle.position.addScaledVector(data.velocity, deltaTime);
            // Check slightly higher water level for effect consistency
            if (particle.position.y < 0.05) {
                 particle.position.y = 0.05;
                 data.velocity.y *= 0.1; // Dampen on "hit"
            }
            const lifeRatio = data.life / data.maxLife; particle.material.opacity = data.baseOpacity * (1 - lifeRatio);
        }
    }
    // --- Update Ocean ---
    oceanAnimation.time += deltaTime * 0.5; waterTexture.offset.x = Math.sin(oceanAnimation.time * 0.2) * 0.02; waterTexture.offset.y = Math.cos(oceanAnimation.time * 0.15) * 0.02; waterNormalMap.offset.x = Math.sin(oceanAnimation.time * 0.15) * 0.03; waterNormalMap.offset.y = Math.cos(oceanAnimation.time * 0.1) * 0.03;
    // --- Update UI ---
     if (statsElements.shipPosition) { statsElements.shipPosition.textContent = `Pos: (${gameState.playerShip.position.x.toFixed(1)}, ${gameState.playerShip.position.y.toFixed(1)}, ${gameState.playerShip.position.z.toFixed(1)})`; }
    if (statsElements.shipSpeed) { statsElements.shipSpeed.textContent = Math.abs(gameState.playerShip.speed).toFixed(2); }
}

// --- Animation Loop ---
let lastTimestamp = 0;
function animate(timestamp) {
    animationFrameId = requestAnimationFrame(animate); const delta = timestamp - lastTimestamp; const deltaTime = Math.max(0, Math.min(delta / 1000, 0.1)); lastTimestamp = timestamp;
    if (deltaTime > 0) { if (networkManager.connected) { updateGame(deltaTime); } updateOfflineEffects(deltaTime); }
    renderer.render(scene, camera); minimapRenderer.render(minimapScene, minimapCamera);
}

// --- Initialization ---
console.log("Game script loaded. Connecting..."); if (statsElements.connectionStatus) { statsElements.connectionStatus.textContent = "Connecting..."; statsElements.connectionStatus.style.color = "orange"; }
networkManager.connect(); lastTimestamp = performance.now(); animate();

// --- Event Listeners & Cleanup ---
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
window.addEventListener('beforeunload', () => { if (networkManager.connected) { networkManager.ws?.close(); } cancelAnimationFrame(animationFrameId); gameState.wakes.forEach(particle => { scene.remove(particle); particle.material?.dispose(); }); console.log("Game cleanup on unload."); });