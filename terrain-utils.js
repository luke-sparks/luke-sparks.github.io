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

    // Pre-compute all rotation cos/sin values outside the loop
    const cos1 = Math.cos(rotationAngle);
    const sin1 = Math.sin(rotationAngle);
    const cos2 = Math.cos(rotationAngle * 2);
    const sin2 = Math.sin(rotationAngle * 2);
    const cos3 = Math.cos(rotationAngle * 3);
    const sin3 = Math.sin(rotationAngle * 3);
    const cos4 = Math.cos(rotationAngle * 4);
    const sin4 = Math.sin(rotationAngle * 4);
    const cos5 = Math.cos(rotationAngle * 5);
    const sin5 = Math.sin(rotationAngle * 5);
    const cos6 = Math.cos(rotationAngle * 6);
    const sin6 = Math.sin(rotationAngle * 6);
    const cos7 = Math.cos(rotationAngle * 7);
    const sin7 = Math.sin(rotationAngle * 7);
    const cos8 = Math.cos(rotationAngle * 8);
    const sin8 = Math.sin(rotationAngle * 8);
    const cos9 = Math.cos(rotationAngle * 9);
    const sin9 = Math.sin(rotationAngle * 9);

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
            const cx = coords[idx].x;
            const cy = coords[idx].y;
            const cz = coords[idx].z;

            // Continents layer - no rotation (base layer)
            const continents = noise.fbm(cx * continentScale, cy * continentScale, cz * continentScale, 3) * 0.7;
            continentsLayer[idx] = Math.max(0, Math.min(1, continents + 0.5));

            // Islands layer - inline rotation 1
            const irx = cx * cos1 - cy * sin1;
            const iry = cx * sin1 + cy * cos1;
            const islands = noise.fbm(irx * islandScale + 100, iry * islandScale + 100, cz * islandScale + 100, 4) * 0.4;
            islandsLayer[idx] = Math.max(0, Math.min(1, islands + 0.5));

            // Mountains layer - inline rotation 2
            const mrx = cx * cos2 - cy * sin2;
            const mry = cx * sin2 + cy * cos2;
            const mountains = noise.fbm(mrx * mountainScale + 200, mry * mountainScale + 200, cz * mountainScale + 200, 3) * 0.5;
            mountainsLayer[idx] = Math.max(0, Math.min(1, mountains + 0.5));

            // Rivers layer - inline rotation 3
            const rrx = cx * cos3 - cy * sin3;
            const rry = cx * sin3 + cy * cos3;
            const rivers = noise.fbm(rrx * riverScale + 300, rry * riverScale + 300, cz * riverScale + 300, 2);
            riversLayer[idx] = Math.max(0, Math.min(1, Math.abs(rivers)));

            // Hills layer - inline rotation 4
            const hrx = cx * cos4 - cy * sin4;
            const hry = cx * sin4 + cy * cos4;
            const hills = noise.fbm(hrx * hillScale + 400, hry * hillScale + 400, cz * hillScale + 400, 4) * 0.2;
            hillsLayer[idx] = Math.max(0, Math.min(1, hills + 0.5));

            // Details layer - inline rotation 5
            const drx = cx * cos5 - cy * sin5;
            const dry = cx * sin5 + cy * cos5;
            const details = noise.fbm(drx * detailScale + 500, dry * detailScale + 500, cz * detailScale + 500, 3) * 0.1;
            detailsLayer[idx] = Math.max(0, Math.min(1, details + 0.5));

            // Tectonics layer - inline rotation 6
            const trx = cx * cos6 - cy * sin6;
            const try_ = cx * sin6 + cy * cos6;
            const tectonics = noise.fbm(trx * tectonicScale + 700, try_ * tectonicScale + 700, cz * tectonicScale + 700, 2);
            tectonicsLayer[idx] = Math.max(0, Math.min(1, tectonics + 0.5));

            // Lakes layer - inline rotation 7
            const lrx = cx * cos7 - cy * sin7;
            const lry = cx * sin7 + cy * cos7;
            const lakes = noise.fbm(lrx * lakeScale + 600, lry * lakeScale + 600, cz * lakeScale + 600, 3);
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

            // Mountain ridge enhancement - inline rotation 8
            const ridgerx = cx * cos8 - cy * sin8;
            const ridgery = cx * sin8 + cy * cos8;
            const ridges = noise.fbm(ridgerx * ridgeScale + 1100, ridgery * ridgeScale + 1100, cz * ridgeScale + 1100, 2);
            if (ridges > 0.6 && landHeight > 0.5) {
                landHeight += (ridges - 0.6) * 1.2;
            }

            // Coastal erosion and beaches - inline rotation 9
            if (size >= 20) {
                const coastrx = cx * cos9 - cy * sin9;
                const coastry = cx * sin9 + cy * cos9;
                const coastal = noise.fbm(coastrx * coastalScale + 800, coastry * coastalScale + 800, cz * coastalScale + 800, 2) * 0.05;
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