const rotationAngle = 0.85;

function getCubeCoords(face, u, v) {
    // Convert texture coordinates [0,1] to cube coordinates
    // Using standard cube mapping with perfect edge continuity
    const s = u * 2 - 1;  // [-1, 1]
    const t = v * 2 - 1;  // [-1, 1]

    let x, y, z;

    // Standard OpenGL cube mapping convention for perfect edge alignment
    switch(face) {
        case 'front':  // +Z face
            x = s; y = -t; z = 1;
            break;
        case 'back':   // -Z face
            x = -s; y = -t; z = -1;
            break;
        case 'right':  // +X face
            x = 1; y = -t; z = -s;
            break;
        case 'left':   // -X face
            x = -1; y = -t; z = s;
            break;
        case 'top':    // +Y face
            x = s; y = 1; z = t;
            break;
        case 'bottom': // -Y face
            x = s; y = -1; z = -t;
            break;
    }

    // Normalize to unit sphere for seamless noise sampling across edges
    const len = Math.sqrt(x*x + y*y + z*z);
    return { x: x/len, y: y/len, z: z/len };
}

function getBiome(heightLevel, colors) {
    return colors[heightLevel] || {r: 0, g: 0, b: 0};
}

// Function to rotate 3D coordinates by given angle around Z axis
function rotateCoordinates(x, y, z, angleRadians) {
    const cos = Math.cos(angleRadians);
    const sin = Math.sin(angleRadians);
    return {
        x: x * cos - y * sin,
        y: x * sin + y * cos,
        z: z
    };
}

function generateFace(face, size, noise, colors) {
    const heightData = new Float32Array(size * size);
    const biomeData = new Uint8ClampedArray(size * size * 4);

    // Separate water and land data
    const waterData = new Float32Array(size * size);
    const landData = new Float32Array(size * size);
    const isWater = new Uint8Array(size * size);

    // Store individual layers for debugging/visualization
    const layers = {};

    // Calculate feature scales based on desired real-world sizes
    const continentScale = size / 80;
    const islandScale = size / 20;
    const mountainScale = size / 40;
    const riverScale = size / 4;
    const hillScale = size / 8;
    const detailScale = size / 2;
    const tectonicScale = size / 60;
    const ridgeScale = size / 30;
    const coastalScale = size / 6;
    const climateScale = size / 100;
    const precipScale = size / 80;
    const lakeScale = size / 15;

    // Pre-allocate all layers
    const continentsLayer = new Float32Array(size * size);
    const islandsLayer = new Float32Array(size * size);
    const mountainsLayer = new Float32Array(size * size);
    const riversLayer = new Float32Array(size * size);
    const hillsLayer = new Float32Array(size * size);
    const detailsLayer = new Float32Array(size * size);
    const tectonicsLayer = new Float32Array(size * size);
    const lakesLayer = new Float32Array(size * size);

    // Pre-calculate coordinates and noise in single pass
    const coords = new Array(size * size);
    const checkRadius = Math.floor(size);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = y * size + x;
            const u = x / (size - 1);
            const v = y / (size - 1);

            // Get 3D coordinates ensuring perfect edge continuity
            coords[idx] = getCubeCoords(face, u, v);
            const coord = coords[idx];

            // Continents layer - no rotation (base layer)
            const continents = noise.fbm(coord.x * continentScale, coord.y * continentScale, coord.z * continentScale, 3) * 0.7;
            continentsLayer[idx] = Math.max(0, Math.min(1, continents + 0.5));

            // Islands layer - 30 degree rotation
            const islandsRotated = rotateCoordinates(coord.x, coord.y, coord.z, rotationAngle);
            const islands = noise.fbm(islandsRotated.x * islandScale + 100, islandsRotated.y * islandScale + 100, islandsRotated.z * islandScale + 100, 4) * 0.4;
            islandsLayer[idx] = Math.max(0, Math.min(1, islands + 0.5));

            // Mountains layer - 60 degree rotation
            const mountainsRotated = rotateCoordinates(coord.x, coord.y, coord.z, rotationAngle * 2);
            const mountains = noise.fbm(mountainsRotated.x * mountainScale + 200, mountainsRotated.y * mountainScale + 200, mountainsRotated.z * mountainScale + 200, 3) * 0.5;
            mountainsLayer[idx] = Math.max(0, Math.min(1, mountains + 0.5));

            // Rivers layer - 90 degree rotation
            const riversRotated = rotateCoordinates(coord.x, coord.y, coord.z, rotationAngle * 3);
            const rivers = noise.fbm(riversRotated.x * riverScale + 300, riversRotated.y * riverScale + 300, riversRotated.z * riverScale + 300, 2);
            riversLayer[idx] = Math.max(0, Math.min(1, Math.abs(rivers)));

            // Hills layer - 120 degree rotation
            const hillsRotated = rotateCoordinates(coord.x, coord.y, coord.z, rotationAngle * 4);
            const hills = noise.fbm(hillsRotated.x * hillScale + 400, hillsRotated.y * hillScale + 400, hillsRotated.z * hillScale + 400, 4) * 0.2;
            hillsLayer[idx] = Math.max(0, Math.min(1, hills + 0.5));

            // Details layer - 150 degree rotation
            const detailsRotated = rotateCoordinates(coord.x, coord.y, coord.z, rotationAngle * 5);
            const details = noise.fbm(detailsRotated.x * detailScale + 500, detailsRotated.y * detailScale + 500, detailsRotated.z * detailScale + 500, 3) * 0.1;
            detailsLayer[idx] = Math.max(0, Math.min(1, details + 0.5));

            // Tectonics layer - 180 degree rotation
            const tectonicsRotated = rotateCoordinates(coord.x, coord.y, coord.z, rotationAngle * 6);
            const tectonics = noise.fbm(tectonicsRotated.x * tectonicScale + 700, tectonicsRotated.y * tectonicScale + 700, tectonicsRotated.z * tectonicScale + 700, 2);
            tectonicsLayer[idx] = Math.max(0, Math.min(1, tectonics + 0.5));

            // Lakes layer - 210 degree rotation
            const lakesRotated = rotateCoordinates(coord.x, coord.y, coord.z, rotationAngle * 7);
            const lakes = noise.fbm(lakesRotated.x * lakeScale + 600, lakesRotated.y * lakeScale + 600, lakesRotated.z * lakeScale + 600, 3);
            lakesLayer[idx] = Math.max(0, Math.min(1, lakes + 0.5));

            // Generate land height first
            let landHeight = continents * 0.35 + islands * 0.2 + mountains * 0.3 + hills * 0.1 + details * 0.05;

            // Enhanced mountain building for land
            if (tectonics > 0.5 && landHeight > 0.25) {
                const mountainBoost = (tectonics - 0.5) * 1.5;
                landHeight += mountainBoost;
            }

            if (tectonics > 0.75 && landHeight > 0.4) {
                const superPeaks = (tectonics - 0.75) * 2.0;
                landHeight += superPeaks;
            }

            // Mountain ridge enhancement - 240 degree rotation
            const ridgesRotated = rotateCoordinates(coord.x, coord.y, coord.z, rotationAngle * 8);
            const ridges = noise.fbm(ridgesRotated.x * ridgeScale + 1100, ridgesRotated.y * ridgeScale + 1100, ridgesRotated.z * ridgeScale + 1100, 2);
            if (ridges > 0.6 && landHeight > 0.5) {
                landHeight += (ridges - 0.6) * 1.2;
            }

            // Coastal erosion and beaches - 270 degree rotation
            if (size >= 20) {
                const coastalRotated = rotateCoordinates(coord.x, coord.y, coord.z, rotationAngle * 9);
                const coastal = noise.fbm(coastalRotated.x * coastalScale + 800, coastalRotated.y * coastalScale + 800, coastalRotated.z * coastalScale + 800, 2) * 0.05;
                if (landHeight > 0.15 && landHeight < 0.4) {
                    landHeight += coastal;
                }
            }

            landHeight = Math.max(0, Math.min(1, landHeight));

            // Determine if this is water or land
            let isWaterPixel = landHeight <= 0.3;

            // Add lake generation for enclosed areas
            if (!isWaterPixel && landHeight > 0.4 && lakes > 0.7) {
                isWaterPixel = true;
            }

            // River carving (creates water)
            if (!isWaterPixel && landHeight > 0.25 && size >= 10) {
                const riverCarving = Math.abs(rivers);
                if (riverCarving < 0.1) {
                    isWaterPixel = true;
                }
            }

            isWater[idx] = isWaterPixel ? 1 : 0;

            if (isWaterPixel) {
                // Generate water depths (simplified to single level)
                waterData[idx] = 1;
                landData[idx] = 0;
            } else {
                // Quantize land height to discrete levels (4-20)
                let quantizedHeight = Math.floor(((landHeight - 0.27) / 0.7) * 17) + 4;
                quantizedHeight = Math.max(4, Math.min(20, quantizedHeight));

                waterData[idx] = 0;
                landData[idx] = quantizedHeight;
            }
        }
    }

    // Combine water and land data into final height data
    for (let i = 0; i < size * size; i++) {
        if (isWater[i]) {
            heightData[i] = waterData[i] / 10;
        } else {
            heightData[i] = landData[i] / 10;
        }
    }

    // Generate biomes in final pass
    for (let i = 0; i < size * size; i++) {
        if (isWater[i]) {
            // Water biome - always use water colors (1-3) regardless of actual height
            const actualWaterHeight = Math.round(waterData[i]);
            let waterColorLevel;

            // Map water heights to water color levels (1-3 only)
            if (actualWaterHeight <= 3) {
                waterColorLevel = actualWaterHeight; // Use as-is for ocean depths
            } else {
                // For lakes at higher elevations, use shallow water color
                waterColorLevel = 3;
            }

            const biome = getBiome(waterColorLevel, colors);

            const biomeIdx = i * 4;
            biomeData[biomeIdx] = biome.r;
            biomeData[biomeIdx + 1] = biome.g;
            biomeData[biomeIdx + 2] = biome.b;
            biomeData[biomeIdx + 3] = 255;
        } else {
            const biome = getBiome(Math.round(heightData[i] * 10), colors);

            const biomeIdx = i * 4;
            biomeData[biomeIdx] = biome.r;
            biomeData[biomeIdx + 1] = biome.g;
            biomeData[biomeIdx + 2] = biome.b;
            biomeData[biomeIdx + 3] = 255;
        }
    }

    // Store layers
    layers.continents = continentsLayer;
    layers.islands = islandsLayer;
    layers.mountains = mountainsLayer;
    layers.rivers = riversLayer;
    layers.hills = hillsLayer;
    layers.details = detailsLayer;
    layers.tectonics = tectonicsLayer;
    layers.lakes = lakesLayer;
    layers.water = waterData;
    layers.land = landData;
    layers.isWater = isWater;

    return { heightData, biomeData, layers };
}

// For module environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getCubeCoords, getBiome, rotateCoordinates, generateFace, rotationAngle };
}