let currentView = 'biome';
let currentData = null;
let currentLayers = null;
let seeds = [];
let favoriteSeeds = [];
let defaultSize = 80;
let defaultSeed = 'default';
const rotationAngle = 1.27409; // 73 degrees in radians

class Noise {
    constructor(seed) {
        this.seed = this.hashSeed(seed || Math.random().toString());
    }
    
    hashSeed(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }
        // Ensure seed has strong impact by using multiple hash iterations
        h = h * 1013904223 + 1664525;
        h = h * 1664525 + 1013904223;
        return Math.abs(h) / 2147483648;
    }
    
    hash(x, y, z) {
        // Strong hash function that amplifies seed differences
        let h = this.seed * 999999999 + x * 374761393 + y * 668265263 + z * 1274126177;
        h = (h ^ (h >>> 13)) * 1274126177;
        h = (h ^ (h >>> 16)) * 1974126343;
        h = (h ^ (h >>> 7)) * 1374761393;
        return (h ^ (h >>> 14)) / 4294967296 + 0.5;
    }
    
    smoothstep(t) { return t * t * (3 - 2 * t); }
    
    noise3D(x, y, z) {
        const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
        const fx = x - ix, fy = y - iy, fz = z - iz;
        const sx = this.smoothstep(fx), sy = this.smoothstep(fy), sz = this.smoothstep(fz);
        
        // Get hash values for cube corners
        const c000 = this.hash(ix, iy, iz);
        const c001 = this.hash(ix, iy, iz+1);
        const c010 = this.hash(ix, iy+1, iz);
        const c011 = this.hash(ix, iy+1, iz+1);
        const c100 = this.hash(ix+1, iy, iz);
        const c101 = this.hash(ix+1, iy, iz+1);
        const c110 = this.hash(ix+1, iy+1, iz);
        const c111 = this.hash(ix+1, iy+1, iz+1);
        
        // Trilinear interpolation
        const c00 = c000*(1-sx) + c100*sx;
        const c01 = c001*(1-sx) + c101*sx;
        const c10 = c010*(1-sx) + c110*sx;
        const c11 = c011*(1-sx) + c111*sx;
        
        const c0 = c00*(1-sy) + c10*sy;
        const c1 = c01*(1-sy) + c11*sy;
        
        return c0*(1-sz) + c1*sz;
    }
    
    fbm(x, y, z, octaves = 6) {
        let value = 0, amp = 1, freq = 1, maxValue = 0;
        for (let i = 0; i < octaves; i++) {
            value += this.noise3D(x * freq, y * freq, z * freq) * amp;
            maxValue += amp;
            amp *= 0.5;
            freq *= 2;
        }
        return value / maxValue;
    }
}

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

function enhanceOceanDepths(allFaceData, size) {
    const faceAdjacency = getCubeFaceAdjacency();
    const shallowWaterMinDistance = 2;
    const shallowWaterMaxDistance = 15;
    const maximumSearchRadius = Math.min(shallowWaterMaxDistance + 5, size / 4);
    
    // Create global distance maps and BFS queue for all faces
    const distanceFromLandMap = {};
    const breadthFirstSearchQueue = [];
    
    // Initialize distance maps for all faces and find land pixels as starting points
    Object.keys(allFaceData).forEach(currentFace => {
        const { isWater } = allFaceData[currentFace];
        distanceFromLandMap[currentFace] = new Float32Array(size * size);
        
        for (let pixelRow = 0; pixelRow < size; pixelRow++) {
            for (let pixelColumn = 0; pixelColumn < size; pixelColumn++) {
                const pixelIndex = pixelRow * size + pixelColumn;
                
                if (isWater[pixelIndex]) {
                    distanceFromLandMap[currentFace][pixelIndex] = Infinity;
                } else {
                    // Land pixels start with distance 0
                    distanceFromLandMap[currentFace][pixelIndex] = 0;
                    breadthFirstSearchQueue.push({face: currentFace, x: pixelColumn, y: pixelRow, dist: 0});
                }
            }
        }
    });
    
    if (breadthFirstSearchQueue.length === 0) return;
    
    // Cross-face breadth-first search for distance calculation
    let currentQueuePosition = 0;
    while (currentQueuePosition < breadthFirstSearchQueue.length) {
        const {face: currentFace, x: currentPixelX, y: currentPixelY, dist: currentDistance} = breadthFirstSearchQueue[currentQueuePosition++];
        
        // Check 8-connected neighbors (including cross-face)
        for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
            for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
                if (columnOffset === 0 && rowOffset === 0) continue;
                
                const neighborX = currentPixelX + columnOffset;
                const neighborY = currentPixelY + rowOffset;
                const newDistanceToLand = currentDistance + Math.sqrt(columnOffset * columnOffset + rowOffset * rowOffset);
                
                // Handle within-face neighbors
                if (neighborX >= 0 && neighborX < size && neighborY >= 0 && neighborY < size) {
                    const neighborPixelIndex = neighborY * size + neighborX;
                    
                    if (allFaceData[currentFace].isWater[neighborPixelIndex] && newDistanceToLand < distanceFromLandMap[currentFace][neighborPixelIndex]) {
                        distanceFromLandMap[currentFace][neighborPixelIndex] = newDistanceToLand;
                        if (newDistanceToLand <= maximumSearchRadius) {
                            breadthFirstSearchQueue.push({face: currentFace, x: neighborX, y: neighborY, dist: newDistanceToLand});
                        }
                    }
                } else {
                    // Handle cross-face neighbors - only allow cardinal directions (no diagonals across edges)
                    let crossFaceAdjacentFace = null;
                    let crossFaceAdjacentX = -1, crossFaceAdjacentY = -1;
                    let sourceEdgeIndex = -1, targetEdgeIndex = -1;
                    
                    // Only process cardinal directions (columnOffset=0 OR rowOffset=0, not both non-zero)
                    const isCardinalDirection = (columnOffset === 0) !== (rowOffset === 0); // XOR: exactly one is zero

                    if (isCardinalDirection) {
                        if (neighborX < 0) {
                            const [adjacentFaceName, adjacentFaceEdgeIndex] = faceAdjacency[currentFace].left;
                            crossFaceAdjacentFace = adjacentFaceName;
                            sourceEdgeIndex = 3;
                            targetEdgeIndex = adjacentFaceEdgeIndex;
                        } else if (neighborX >= size) {
                            const [adjacentFaceName, adjacentFaceEdgeIndex] = faceAdjacency[currentFace].right;
                            crossFaceAdjacentFace = adjacentFaceName;
                            sourceEdgeIndex = 1;
                            targetEdgeIndex = adjacentFaceEdgeIndex;
                        } else if (neighborY < 0) {
                            const [adjacentFaceName, adjacentFaceEdgeIndex] = faceAdjacency[currentFace].top;
                            crossFaceAdjacentFace = adjacentFaceName;
                            sourceEdgeIndex = 0;
                            targetEdgeIndex = adjacentFaceEdgeIndex;
                        } else if (neighborY >= size) {
                            const [adjacentFaceName, adjacentFaceEdgeIndex] = faceAdjacency[currentFace].bottom;
                            crossFaceAdjacentFace = adjacentFaceName;
                            sourceEdgeIndex = 2;
                            targetEdgeIndex = adjacentFaceEdgeIndex;
                        } else {
                            console.log("shouldn't ever get here");
                            continue;
                        }

                        crossFaceAdjacentX = transformPixelForCrossFace(neighborX, neighborY, size, currentFace, sourceEdgeIndex).x;
                        crossFaceAdjacentY = transformPixelForCrossFace(neighborX, neighborY, size, currentFace, sourceEdgeIndex).y;
                        
                        const adjacentPixelIndex = crossFaceAdjacentY * size + crossFaceAdjacentX;
                        const adjacentFaceData = allFaceData[crossFaceAdjacentFace];
                        
                        if (adjacentFaceData.isWater[adjacentPixelIndex] && newDistanceToLand < distanceFromLandMap[crossFaceAdjacentFace][adjacentPixelIndex]) {
                            distanceFromLandMap[crossFaceAdjacentFace][adjacentPixelIndex] = newDistanceToLand;
                            if (newDistanceToLand <= maximumSearchRadius) {
                                breadthFirstSearchQueue.push({face: crossFaceAdjacentFace, x: crossFaceAdjacentX, y: crossFaceAdjacentY, dist: newDistanceToLand});
                            }
                        }
                    }
                    // Diagonal movements that would cross face boundaries are ignored
                }
            }
        }
    }
    
    // Apply depth levels for each face based on calculated distances
    Object.keys(allFaceData).forEach(currentFace => {
        const { waterData, isWater } = allFaceData[currentFace];
        const faceDistanceMap = distanceFromLandMap[currentFace];
        
        for (let pixelIndex = 0; pixelIndex < size * size; pixelIndex++) {
            if (isWater[pixelIndex]) {
                const distanceFromNearestLand = faceDistanceMap[pixelIndex];
                let oceanDepthLevel;
                
                if (distanceFromNearestLand <= shallowWaterMinDistance) {
                    oceanDepthLevel = 3; // Shallow water near shore
                } else if (distanceFromNearestLand <= shallowWaterMaxDistance) {
                    const distanceRatio = (distanceFromNearestLand - shallowWaterMinDistance) / (shallowWaterMaxDistance - shallowWaterMinDistance);
                    oceanDepthLevel = distanceRatio < 0.5 ? 3 : 2; // Transitional depth
                } else {
                    oceanDepthLevel = 1; // Deep ocean water
                }
                
                waterData[pixelIndex] = oceanDepthLevel;
            }
        }
    });
}

function getCubeFaceAdjacency() {
    // Define how cube faces connect to each other
    // Each edge is defined as [face, edge] where edge is 0=top, 1=right, 2=bottom, 3=left
    const topEdge = 0;
    const rightEdge = 1;
    const bottomEdge = 2;
    const leftEdge = 3
    return {
        'front': {
            top: ['top', bottomEdge],      // Front top -> Top bottom
            right: ['right', leftEdge],  // Front right -> Right left  
            bottom: ['bottom', topEdge], // Front bottom -> Bottom top
            left: ['left', rightEdge]     // Front left -> Left right
        },
        'back': {
            top: ['top', topEdge],      // Back top -> Top top
            right: ['left', leftEdge],   // Back right -> Left left
            bottom: ['bottom', bottomEdge], // Back bottom -> Bottom bottom  
            left: ['right', rightEdge]    // Back left -> Right right
        },
        'right': {
            top: ['top', rightEdge],      // Right top -> Top right
            right: ['back', leftEdge],   // Right right -> Back left
            bottom: ['bottom', rightEdge], // Right bottom -> Bottom right
            left: ['front', rightEdge]    // Right left -> Front right
        },
        'left': {
            top: ['top', leftEdge],      // Left top -> Top left
            right: ['front', leftEdge],  // Left right -> Front left
            bottom: ['bottom', leftEdge], // Left bottom -> Bottom left
            left: ['back', rightEdge]     // Left left -> Back right
        },
        'top': {
            top: ['back', topEdge],     // Top top -> Back top
            right: ['right', topEdge],  // Top right -> Right top
            bottom: ['front', topEdge], // Top bottom -> Front top
            left: ['left', topEdge]     // Top left -> Left top
        },
        'bottom': {
            top: ['front', bottomEdge],    // Bottom top -> Front bottom
            right: ['right', bottomEdge],  // Bottom right -> Right bottom
            bottom: ['back', bottomEdge],  // Bottom bottom -> Back bottom
            left: ['left', bottomEdge]     // Bottom left -> Left bottom
        }
    };
}

function transformPixelForCrossFace(sourcePixelX, sourcePixelY, size, sourceFaceName, sourceEdgeIndex) {
    // Transform pixel location when crossing edges
    // This accounts for the different orientations of cube faces
    
    // Create a key to identify the specific face transition
    const faceTransitionKey = `${sourceFaceName}-${sourceEdgeIndex}`;

    const sizeAdjusted = size - 1;
    
    // Define transformations for specific face transitions based on cube topology
    switch (faceTransitionKey) {
        // Front face transitions
        case 'front-0':     // front top -> top bottom
            return {x: sourcePixelX, y: sizeAdjusted};
        case 'front-1':   // front right -> right left  
            return {x: 0, y: sourcePixelY};
        case 'front-2':  // front bottom -> bottom top
            return {x: sourcePixelX, y: 0};
        case 'front-3':    // front left -> left right
            return {x: sizeAdjusted, y: sourcePixelY};
            
        // Right face transitions  
        case 'right-0':     // right top -> top right
            return {x: sizeAdjusted, y: size - sourcePixelX};
        case 'right-1':    // right right -> back left
            return {x: 0, y: sourcePixelY};
        case 'right-2':  // right bottom -> bottom right  
            return {x: sizeAdjusted, y: sourcePixelX};
        case 'right-3':   // right left -> front right
            return {x: sizeAdjusted, y: sourcePixelY};
            
        // Back face transitions
        case 'back-0':      // back top -> top top
            return {x: size - sourcePixelX, y: 0};
        case 'back-1':     // back right -> left left
            return {x: 0, y: sourcePixelY};
        case 'back-2':   // back bottom -> bottom bottom
            return {x: size - sourcePixelX, y: sizeAdjusted};
        case 'back-3':    // back left -> right right
            return {x: sizeAdjusted, y: sourcePixelY};
            
        // Left face transitions
        case 'left-0':      // left top -> top left
            return {x: 0, y: sourcePixelX};
        case 'left-1':    // left right -> front left
            return {x: 0, y: sourcePixelY};  
        case 'left-2':   // left bottom -> bottom left
            return {x: 0, y: size - sourcePixelX};
        case 'left-3':     // left left -> back right
            return {x: sizeAdjusted, y: sourcePixelY};
            
        // Top face transitions
        case 'top-0':      // top top -> back top
            return {x: size - sourcePixelX, y: 0};
        case 'top-1':     // top right -> right top
            return {x: size - sourcePixelY, y: 0};
        case 'top-2':     // top bottom -> front top
            return {x: sourcePixelX, y: 0};
        case 'top-3':      // top left -> left top
            return {x: sourcePixelY, y: 0};
            
        // Bottom face transitions
        case 'bottom-0':  // bottom top -> front bottom
            return {x: sourcePixelX, y: sizeAdjusted};
        case 'bottom-1':  // bottom right -> right bottom  
            return {x: sourcePixelY, y: sizeAdjusted};
        case 'bottom-2':   // bottom bottom -> back bottom
            return {x: size - sourcePixelX, y: sizeAdjusted};
        case 'bottom-3':   // bottom left -> left bottom
            return {x: size - sourcePixelY, y: sizeAdjusted};
            
        default:
            // If we don't have a specific transformation, return original direction
            // This should not happen in a proper cube topology
            console.warn(`No direction transformation defined for ${faceTransitionKey}`);
            return {x: columnOffset, y: rowOffset};
    }
}

function getEdgePixels(faceSize, edgeIndex) {
    // Get pixel coordinates for each edge of a face
    const edgePixelCoordinates = [];
    switch(edgeIndex) {
        case 0: // top edge
            for (let columnIndex = 0; columnIndex < faceSize; columnIndex++) {
                edgePixelCoordinates.push({x: columnIndex, y: 0});
            }
            break;
        case 1: // right edge  
            for (let rowIndex = 0; rowIndex < faceSize; rowIndex++) {
                edgePixelCoordinates.push({x: faceSize-1, y: rowIndex});
            }
            break;
        case 2: // bottom edge
            for (let columnIndex = 0; columnIndex < faceSize; columnIndex++) {
                edgePixelCoordinates.push({x: columnIndex, y: faceSize-1});
            }
            break;
        case 3: // left edge
            for (let rowIndex = 0; rowIndex < faceSize; rowIndex++) {
                edgePixelCoordinates.push({x: 0, y: rowIndex});
            }
            break;
    }
    return edgePixelCoordinates;
}

function adjustLakeHeights(allFaceData, size) {
    const adjacency = getCubeFaceAdjacency();
    const maxLakeSize = Math.max(20, size * size * 0.1);
    const minLakeSize = 5; // Always remove water bodies with 5 or fewer pixels
    const globalVisited = {};
    const waterBodies = [];
    
    // Initialize global visited tracking
    Object.keys(allFaceData).forEach(face => {
        globalVisited[face] = new Uint8Array(size * size);
    });
    
    // Find all connected water bodies across faces
    for (const startFace of Object.keys(allFaceData)) {
        const { isWater } = allFaceData[startFace];
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = y * size + x;
                
                if (isWater[idx] && !globalVisited[startFace][idx]) {
                    const waterBody = [];
                    const queue = [{face: startFace, x, y}];
                    
                    // Cross-face flood fill
                    while (queue.length > 0) {
                        const {face, x: cx, y: cy} = queue.shift();
                        const cidx = cy * size + cx;
                        
                        if (globalVisited[face][cidx]) continue;
                        globalVisited[face][cidx] = 1;
                        waterBody.push({face, x: cx, y: cy, idx: cidx});
                        
                        const faceData = allFaceData[face];
                        
                        // Check neighbors within same face
                        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                            const nx = cx + dx;
                            const ny = cy + dy;
                            
                            if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
                                const nidx = ny * size + nx;
                                if (faceData.isWater[nidx] && !globalVisited[face][nidx]) {
                                    queue.push({face, x: nx, y: ny});
                                }
                            } else {
                                // Check cross-face connections
                                let adjacentFace = null;
                                let adjacentX = -1, adjacentY = -1;
                                
                                if (nx < 0 && adjacency[face].left) {
                                    const [adjFace, adjEdge] = adjacency[face].left;
                                    const adjPixels = getEdgePixels(size, adjEdge);
                                    if (cy < adjPixels.length) {
                                        adjacentFace = adjFace;
                                        adjacentX = adjPixels[cy].x;
                                        adjacentY = adjPixels[cy].y;
                                    }
                                } else if (nx >= size && adjacency[face].right) {
                                    const [adjFace, adjEdge] = adjacency[face].right;
                                    const adjPixels = getEdgePixels(size, adjEdge);
                                    if (cy < adjPixels.length) {
                                        adjacentFace = adjFace;
                                        adjacentX = adjPixels[cy].x;
                                        adjacentY = adjPixels[cy].y;
                                    }
                                } else if (ny < 0 && adjacency[face].top) {
                                    const [adjFace, adjEdge] = adjacency[face].top;
                                    const adjPixels = getEdgePixels(size, adjEdge);
                                    if (cx < adjPixels.length) {
                                        adjacentFace = adjFace;
                                        adjacentX = adjPixels[cx].x;
                                        adjacentY = adjPixels[cx].y;
                                    }
                                } else if (ny >= size && adjacency[face].bottom) {
                                    const [adjFace, adjEdge] = adjacency[face].bottom;
                                    const adjPixels = getEdgePixels(size, adjEdge);
                                    if (cx < adjPixels.length) {
                                        adjacentFace = adjFace;
                                        adjacentX = adjPixels[cx].x;
                                        adjacentY = adjPixels[cx].y;
                                    }
                                }
                                
                                if (adjacentFace && allFaceData[adjacentFace]) {
                                    const adjIdx = adjacentY * size + adjacentX;
                                    if (allFaceData[adjacentFace].isWater[adjIdx] && !globalVisited[adjacentFace][adjIdx]) {
                                        queue.push({face: adjacentFace, x: adjacentX, y: adjacentY});
                                    }
                                }
                            }
                        }
                    }
                    
                    waterBodies.push({waterBody, size: waterBody.length});
                }
            }
        }
    }
    
    // Process water bodies: remove tiny ones, adjust lake heights, leave oceans
    for (const {waterBody, size: bodySize} of waterBodies) {
        if (bodySize <= minLakeSize) {
            // Remove really small water bodies by converting to land
            for (const {face, x, y, idx} of waterBody) {
                const faceData = allFaceData[face];
                
                // Find average surrounding land height (8-connected for better sampling)
                let landHeights = [];
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        
                        const nx = x + dx;
                        const ny = y + dy;
                        
                        if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
                            const nidx = ny * size + nx;
                            if (!faceData.isWater[nidx]) {
                                landHeights.push(faceData.landData[nidx]);
                            }
                        }
                    }
                }
                
                if (landHeights.length > 0) {
                    const avgHeight = Math.round(landHeights.reduce((a, b) => a + b, 0) / landHeights.length);
                    
                    // Convert water pixel to land
                    faceData.isWater[idx] = 0;
                    faceData.waterData[idx] = 0;
                    faceData.landData[idx] = avgHeight;
                }
            }
        } else if (bodySize <= maxLakeSize) {
            // Adjust lake heights for medium-sized water bodies
            let minSurroundingHeight = 11;
            
            for (const {face, x, y} of waterBody) {
                const faceData = allFaceData[face];
                
                // Check only 4-connected neighbors for shore height
                for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                    const nx = x + dx;
                    const ny = y + dy;
                    
                    if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
                        const nidx = ny * size + nx;
                        if (!faceData.isWater[nidx]) {
                            minSurroundingHeight = Math.min(minSurroundingHeight, faceData.landData[nidx]);
                        }
                    } else {
                        // Handle cross-face neighbors
                        let adjacentFace = null;
                        let adjacentX = -1, adjacentY = -1;
                        
                        if (nx < 0 && adjacency[face].left) {
                            const [adjFace, adjEdge] = adjacency[face].left;
                            const adjPixels = getEdgePixels(size, adjEdge);
                            if (y < adjPixels.length) {
                                adjacentFace = adjFace;
                                adjacentX = adjPixels[y].x;
                                adjacentY = adjPixels[y].y;
                            }
                        } else if (nx >= size && adjacency[face].right) {
                            const [adjFace, adjEdge] = adjacency[face].right;
                            const adjPixels = getEdgePixels(size, adjEdge);
                            if (y < adjPixels.length) {
                                adjacentFace = adjFace;
                                adjacentX = adjPixels[y].x;
                                adjacentY = adjPixels[y].y;
                            }
                        } else if (ny < 0 && adjacency[face].top) {
                            const [adjFace, adjEdge] = adjacency[face].top;
                            const adjPixels = getEdgePixels(size, adjEdge);
                            if (x < adjPixels.length) {
                                adjacentFace = adjFace;
                                adjacentX = adjPixels[x].x;
                                adjacentY = adjPixels[x].y;
                            }
                        } else if (ny >= size && adjacency[face].bottom) {
                            const [adjFace, adjEdge] = adjacency[face].bottom;
                            const adjPixels = getEdgePixels(size, adjEdge);
                            if (x < adjPixels.length) {
                                adjacentFace = adjFace;
                                adjacentX = adjPixels[x].x;
                                adjacentY = adjPixels[x].y;
                            }
                        }
                        
                        if (adjacentFace && allFaceData[adjacentFace]) {
                            const adjIdx = adjacentY * size + adjacentX;
                            if (!allFaceData[adjacentFace].isWater[adjIdx]) {
                                minSurroundingHeight = Math.min(minSurroundingHeight, allFaceData[adjacentFace].landData[adjIdx]);
                            }
                        }
                    }
                }
            }
            
            if (minSurroundingHeight < 11) {
                const lakeHeight = Math.max(4, minSurroundingHeight);
                for (const {face, idx} of waterBody) {
                    allFaceData[face].waterData[idx] = lakeHeight;
                }
            }
        }
        // Large water bodies (oceans) are left unchanged
    }
}

function getBiome(heightLevel, temperature, moisture) {
    // Exactly 10 colors based on height levels 1-10
    // Enhanced ocean depths: Level 1 (deep), Level 2 (medium), Level 3 (shallow)
    
    const colors = [
        null, // Index 0 unused
        [5, 15, 60],    // Level 1: Deep ocean (very dark blue)
        [15, 35, 90],   // Level 2: Medium ocean (medium blue)
        [30, 60, 130],  // Level 3: Shallow ocean (lighter blue)
        [220, 200, 160], // Level 4: Beach/coastal (sandy)
        [120, 180, 80],  // Level 5: Lowlands/plains (green)
        [100, 150, 70],  // Level 6: Hills (darker green)
        [140, 120, 80],  // Level 7: Highlands (brown-green)
        [160, 140, 100], // Level 8: Mountains (brown)
        [180, 160, 140], // Level 9: High mountains (gray-brown)
        [240, 240, 250]  // Level 10: Snow peaks (white)
    ];
    
    // Return the exact color for this height level
    return colors[heightLevel] || [0, 0, 0];
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

function generateFace(face, size, noise) {
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
    const checkRadius = Math.max(1, Math.floor(size / 100));
    
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
                // Generate water depths (will be adjusted later for lakes)
                waterData[idx] = landHeight <= 0.1 ? 1 : (landHeight <= 0.2 ? 2 : 3);
                landData[idx] = 0;
            } else {
                // Quantize land height to discrete levels (4-10)
                let quantizedHeight = Math.floor(((landHeight - 0.3) / 0.7) * 7) + 4;
                quantizedHeight = Math.max(4, Math.min(10, quantizedHeight));
                
                // Minimize large sand areas - optimized coastal check
                if (quantizedHeight === 4) {
                    let nearWater = false;
                    
                    // Efficient spiral search pattern
                    for (let r = 1; r <= checkRadius && !nearWater; r++) {
                        for (let angle = 0; angle < 8 && !nearWater; angle++) {
                            const dx = Math.round(r * Math.cos(angle * Math.PI / 4));
                            const dy = Math.round(r * Math.sin(angle * Math.PI / 4));
                            
                            const checkX = Math.max(0, Math.min(size-1, x + dx));
                            const checkY = Math.max(0, Math.min(size-1, y + dy));
                            
                            if (checkX !== x || checkY !== y) {
                                const checkU = checkX / (size - 1);
                                const checkV = checkY / (size - 1);
                                const checkCoords = getCubeCoords(face, checkU, checkV);
                                
                                // Quick height estimation using fewer octaves
                                const checkContinents = noise.fbm(checkCoords.x * continentScale, checkCoords.y * continentScale, checkCoords.z * continentScale, 2) * 0.7;
                                const checkIslands = noise.fbm(checkCoords.x * islandScale + 100, checkCoords.y * islandScale + 100, checkCoords.z * islandScale + 100, 2) * 0.4;
                                
                                let checkHeight = checkContinents * 0.6 + checkIslands * 0.4;
                                checkHeight = Math.max(0, Math.min(1, checkHeight));
                                
                                if (checkHeight <= 0.3) {
                                    nearWater = true;
                                }
                            }
                        }
                    }
                    
                    if (!nearWater) {
                        quantizedHeight = 5;
                    }
                }
                
                waterData[idx] = 0;
                landData[idx] = quantizedHeight;
            }
        }
    }
    
    // Post-process ocean for more dramatic depth variation
    // Note: Ocean depth enhancement is now done as a separate pass after all faces are generated
    
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
        const coord = coords[i];
        const finalHeight = Math.round(heightData[i] * 10);
        
        // Use isWater array to determine biome type, not just height
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
            
            const biome = getBiome(waterColorLevel, 0, 1);
            
            const biomeIdx = i * 4;
            biomeData[biomeIdx] = biome[0];
            biomeData[biomeIdx + 1] = biome[1];
            biomeData[biomeIdx + 2] = biome[2];
            biomeData[biomeIdx + 3] = 255;
        } else {
            // Land biome - generate climate for land
            let latitude = Math.abs(coord.y);
            let baseTemp = 1.0 - latitude * 0.8;
            const elevationCooling = Math.max(0, (finalHeight/10) - 0.3) * 1.0;
            
            // Climate noise - 300 degree rotation
            const climateRotated = rotateCoordinates(coord.x, coord.y, coord.z, rotationAngle * 10);
            const tempNoise = noise.fbm(climateRotated.x * climateScale + 900, climateRotated.y * climateScale + 900, climateRotated.z * climateScale + 900, 3) * 0.3;
            const temperature = Math.max(0, Math.min(1, baseTemp - elevationCooling + tempNoise));
            
            // Precipitation noise - 330 degree rotation
            const precipRotated = rotateCoordinates(coord.x, coord.y, coord.z, rotationAngle * 11);
            const precipitation = noise.fbm(precipRotated.x * precipScale + 1000, precipRotated.y * precipScale + 1000, precipRotated.z * precipScale + 1000, 3);
            const oceanInfluence = Math.max(0, 0.5 - Math.max(0, (finalHeight/10) - 0.2) * 2);
            const moisture = Math.max(0, Math.min(1, precipitation * 0.6 + oceanInfluence * 0.3));
            
            const biome = getBiome(finalHeight, temperature, moisture);
            
            const biomeIdx = i * 4;
            biomeData[biomeIdx] = biome[0];
            biomeData[biomeIdx + 1] = biome[1];
            biomeData[biomeIdx + 2] = biome[2];
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

function render(canvas, heightData, biomeData, size, view, isWater, waterData) {
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;
    
    if (view === 'heightmap') {
        // Height value remapping for land: 1-3→0, 4→1, 5→2, 6→3, 7→5, 8→8, 9→11, 10→15
        const landHeightMapping = {
            1: 0, 2: 0, 3: 0,  // Ocean depths → 0
            4: 1,              // Beach → 1
            5: 2,              // Lowlands → 2
            6: 3,              // Hills → 3
            7: 5,              // Highlands → 5
            8: 8,              // Mountains → 8
            9: 11,             // High mountains → 11
            10: 15             // Snow peaks → 15
        };
        
        // Separate height mapping for lakes: 4→0, 5→1, 6→2, 7→4, 8→7, 9→10, 10→14
        const lakeHeightMapping = {
            1: 0, 2: 0, 3: 0,  // Ocean depths → 0 (shouldn't be used for lakes)
            4: 0,              // Lake at beach level → 0
            5: 1,              // Lake at lowland level → 1
            6: 2,              // Lake at hill level → 2
            7: 4,              // Lake at highland level → 4
            8: 7,              // Lake at mountain level → 7
            9: 10,             // Lake at high mountain level → 10
            10: 14             // Lake at snow peak level → 14
        };
        
        for (let i = 0; i < heightData.length; i++) {
            // Convert quantized height (0.1-1.0) back to discrete levels
            const heightLevel = Math.round(heightData[i] * 10);
            
            let remappedValue;
            if (isWater && isWater[i]) {
                const waterHeight = Math.round(waterData[i]);
                if (waterHeight <= 3) {
                    // Ocean/rivers: map to 0
                    remappedValue = 0;
                } else {
                    // Lakes: use lake-specific height mapping
                    remappedValue = lakeHeightMapping[waterHeight] || 0;
                }
            } else {
                // Use normal height mapping for land
                remappedValue = landHeightMapping[heightLevel] || 0;
            }
            
            const colorValue = remappedValue * 8; // Height value * 8 for RGB
            
            data[i * 4] = colorValue;     // R
            data[i * 4 + 1] = colorValue; // G
            data[i * 4 + 2] = colorValue; // B
            data[i * 4 + 3] = 255;       // A
        }
    } else {
        data.set(biomeData);
    }
    
    ctx.putImageData(imageData, 0, 0);
}

function randomSeed() {
    const seed = Math.random().toString(36).substr(2, 9);
    document.getElementById('seed').value = seed;
    generate();
}

function addToRecentSeeds(seed, size) {
    const data = {seed, size};
    
    // Find if this seed/size combination already exists
    const existingIndex = seeds.findIndex(s => s.seed === seed && s.size === size);
    
    if (existingIndex !== -1) {
        // Remove the existing entry
        seeds.splice(existingIndex, 1);
    }
    
    // Add to the beginning of the list
    seeds.unshift(data);
    
    // Keep only the most recent 15 entries
    if (seeds.length > 15) {
        seeds = seeds.slice(0, 15);
    }
    
    updateRecentSeedsDisplay();
}

function loadFavoriteSeeds() {
    try {
        const saved = localStorage.getItem('favoriteSeeds');
        if (saved) {
            favoriteSeeds = JSON.parse(saved);
        }
    } catch (error) {
        console.error('Failed to load favorite seeds:', error);
        favoriteSeeds = [];
    }
}

function saveFavoriteSeeds() {
    try {
        localStorage.setItem('favoriteSeeds', JSON.stringify(favoriteSeeds));
    } catch (error) {
        console.error('Failed to save favorite seeds:', error);
    }
}

function addToFavorites() {
    const seed = document.getElementById('seed').value.trim();
    const size = parseInt(document.getElementById('size').value);
    
    if (!seed) {
        alert('Please enter a seed to favorite');
        return;
    }
    
    const favoriteData = { seed, size };
    
    // Check if already favorited
    const existingIndex = favoriteSeeds.findIndex(fav => fav.seed === seed && fav.size === size);
    if (existingIndex !== -1) {
        // Flash the existing favorite button green
        flashFavoriteButton(existingIndex);
        return;
    }
    
    favoriteSeeds.push(favoriteData);
    saveFavoriteSeeds();
    updateFavoriteSeedsDisplay();
}

function flashFavoriteButton(index) {
    const container = document.getElementById('favoriteSeedsList');
    if (!container) return;
    
    const favoriteItems = container.children;
    if (index >= 0 && index < favoriteItems.length) {
        const button = favoriteItems[index].querySelector('.seed-button');
        if (button) {
            // Store original styles
            const originalBackground = button.style.backgroundColor;
            const originalBorder = button.style.borderColor;
            
            // Flash green
            button.style.backgroundColor = '#4caf50';
            button.style.borderColor = '#45a049';
            button.style.transition = 'all 0.2s ease';
            
            // Reset after animation
            setTimeout(() => {
                button.style.backgroundColor = originalBackground;
                button.style.borderColor = originalBorder;
                setTimeout(() => {
                    button.style.transition = '';
                }, 200);
            }, 300);
        }
    }
}

function removeFromFavorites(index) {
    favoriteSeeds.splice(index, 1);
    saveFavoriteSeeds();
    updateFavoriteSeedsDisplay();
}

function updateFavoriteSeedsDisplay() {
    const container = document.getElementById('favoriteSeedsList');
    if (!container) return;
    
    container.innerHTML = '';
    favoriteSeeds.forEach((data, index) => {
        const listItem = document.createElement('div');
        listItem.className = 'item';
        
        const seedButton = document.createElement('button');
        seedButton.className = 'seed-button';
        seedButton.textContent = data.seed + ' - ' + data.size;
        seedButton.onclick = () => {
            document.getElementById('seed').value = data.seed;
            document.getElementById('size').value = data.size;
            generate();
        };
        
        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-button';
        deleteButton.innerHTML = '🗑️';
        deleteButton.title = 'Remove from favorites';
        deleteButton.onclick = (e) => {
            e.stopPropagation();
            removeFromFavorites(index);
        };
        
        listItem.appendChild(seedButton);
        listItem.appendChild(deleteButton);
        container.appendChild(listItem);
    });
}

function updateRecentSeedsDisplay() {
    const container = document.getElementById('recentSeedsList');
    if (!container) return;
    
    container.innerHTML = '';
    seeds.forEach(data => {
        const listItem = document.createElement('div');
        listItem.className = 'item';

        const seedButton = document.createElement('button');
        const seed = data.seed;
        const size = data.size;

        seedButton.className = 'seed-button';
        seedButton.textContent = seed + ' - ' + size;
        seedButton.onclick = () => {
            document.getElementById('seed').value = seed;
            document.getElementById('size').value = size;
            generate();
        };
        
        listItem.appendChild(seedButton);
        container.appendChild(listItem);
    });
}

function generate() {
    let size = parseInt(document.getElementById('size').value);
    
    if (isNaN(size) || size < 1) {
        size = 64;
        document.getElementById('size').value = size;
    }
    
    const seedInput = document.getElementById('seed').value.trim();
    const seed = seedInput || Math.random().toString(36).substr(2, 9);
    
    // Update URL with current seed and size
    updateQueryParams(seed, size);
    
    addToRecentSeeds(seed, size);
    const noise = new Noise(seed);
    
    const faces = ['front', 'back', 'left', 'right', 'top', 'bottom'];
    currentData = {};
    const allFaceData = {};
    
    // First pass: Generate all face terrain data
    faces.forEach(face => {
        const data = generateFace(face, size, noise);
        currentData[face] = data;
        
        // Store face data for cross-face lake detection
        allFaceData[face] = {
            waterData: data.layers.water,
            landData: data.layers.land,
            isWater: data.layers.isWater
        };
        
        // Store layers from front face for layer visualization
        if (face === 'front') {
            currentLayers = data.layers;
        }
    });
    
    // Second pass: Enhance ocean depths across all faces, then adjust lake heights
    enhanceOceanDepths(allFaceData, size);
    adjustLakeHeights(allFaceData, size);
    
    // Third pass: Update final heightData and render
    faces.forEach(face => {
        const data = currentData[face];
        const faceData = allFaceData[face];
        
        // Update final height data with adjusted lake heights
        for (let i = 0; i < size * size; i++) {
            if (faceData.isWater[i]) {
                data.heightData[i] = faceData.waterData[i] / 10;
            } else {
                data.heightData[i] = faceData.landData[i] / 10;
            }
        }
        
        // Update layers with adjusted data
        data.layers.water = faceData.waterData;
        data.layers.land = faceData.landData;
        data.layers.isWater = faceData.isWater;
        
        // Regenerate biome data with correct lake classifications
        const biomeData = new Uint8ClampedArray(size * size * 4);
        
        // Calculate feature scales for biome generation
        const climateScale = size / 100;
        const precipScale = size / 80;
        
        for (let i = 0; i < size * size; i++) {
            if (faceData.isWater[i]) {
                const actualWaterHeight = Math.round(faceData.waterData[i]);
                let waterColorLevel;
                
                if (actualWaterHeight <= 3) {
                    waterColorLevel = actualWaterHeight;
                } else {
                    waterColorLevel = 3;
                }
                
                const biome = getBiome(waterColorLevel, 0, 1);
                
                const biomeIdx = i * 4;
                biomeData[biomeIdx] = biome[0];
                biomeData[biomeIdx + 1] = biome[1];
                biomeData[biomeIdx + 2] = biome[2];
                biomeData[biomeIdx + 3] = 255;
            } else {
                // For land pixels (including converted small water bodies), regenerate biome
                const y = Math.floor(i / size);
                const x = i % size;
                const u = x / (size - 1);
                const v = y / (size - 1);
                const coord = getCubeCoords(face, u, v);
                const finalHeight = Math.round(faceData.landData[i]);
                
                // Generate climate for land biome
                let latitude = Math.abs(coord.y);
                let baseTemp = 1.0 - latitude * 0.8;
                const elevationCooling = Math.max(0, (finalHeight/10) - 0.3) * 1.0;
                
                // Climate noise - 300 degree rotation
                const climateRotated = rotateCoordinates(coord.x, coord.y, coord.z, rotationAngle * 10);
                const tempNoise = noise.fbm(climateRotated.x * climateScale + 900, climateRotated.y * climateScale + 900, climateRotated.z * climateScale + 900, 3) * 0.3;
                const temperature = Math.max(0, Math.min(1, baseTemp - elevationCooling + tempNoise));
                
                // Precipitation noise - 330 degree rotation
                const precipRotated = rotateCoordinates(coord.x, coord.y, coord.z, rotationAngle * 11);
                const precipitation = noise.fbm(precipRotated.x * precipScale + 1000, precipRotated.y * precipScale + 1000, precipRotated.z * precipScale + 1000, 3);
                const oceanInfluence = Math.max(0, 0.5 - Math.max(0, (finalHeight/10) - 0.2) * 2);
                const moisture = Math.max(0, Math.min(1, precipitation * 0.6 + oceanInfluence * 0.3));
                
                const biome = getBiome(finalHeight, temperature, moisture);
                
                const biomeIdx = i * 4;
                biomeData[biomeIdx] = biome[0];
                biomeData[biomeIdx + 1] = biome[1];
                biomeData[biomeIdx + 2] = biome[2];
                biomeData[biomeIdx + 3] = 255;
            }
        }
        
        data.biomeData = biomeData;
        
        const canvas = document.getElementById(face);
        render(canvas, data.heightData, data.biomeData, size, currentView, faceData.isWater, faceData.waterData);
    });
}

function downloadCubeNet() {
    if (!currentData) {
        alert('Please generate a map first!');
        return;
    }
    
    const size = parseInt(document.getElementById('size').value) || 128;
    const timestamp = new Date().toISOString().slice(0, 16).replace(/[:-]/g, '');
    const seedValue = document.getElementById('seed').value || 'random';
    const sizeValue = document.getElementById('size').value || '128';
    
    // Helper function to create cube net for a specific view
    function createCubeNetCanvas(viewType) {
        const combinedCanvas = document.createElement('canvas');
        const borderWidth = 2;
        const faceSize = size;
        const totalWidth = (faceSize + borderWidth) * 4 + borderWidth;
        const totalHeight = (faceSize + borderWidth) * 3 + borderWidth;
        
        combinedCanvas.width = totalWidth;
        combinedCanvas.height = totalHeight;
        const ctx = combinedCanvas.getContext('2d');
        
        // Fill background with black
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, totalWidth, totalHeight);
        
        // Draw red grid lines
        ctx.strokeStyle = 'red';
        ctx.lineWidth = borderWidth;
        
        // Vertical lines
        for (let i = 0; i <= 4; i++) {
            const x = i * (faceSize + borderWidth) + borderWidth / 2;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, totalHeight);
            ctx.stroke();
        }
        
        // Horizontal lines
        for (let i = 0; i <= 3; i++) {
            const y = i * (faceSize + borderWidth) + borderWidth / 2;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(totalWidth, y);
            ctx.stroke();
        }
        
        // Define face positions in the cube net (4x3 grid)
        const facePositions = {
            'top': { x: 1, y: 0 },
            'left': { x: 0, y: 1 },
            'front': { x: 1, y: 1 },
            'right': { x: 2, y: 1 },
            'back': { x: 3, y: 1 },
            'bottom': { x: 1, y: 2 }
        };
        
        // Create temporary canvases for each face in the specified view
        Object.keys(facePositions).forEach(face => {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = size;
            tempCanvas.height = size;
            
            const data = currentData[face];
            const faceData = data.layers;
            
            // Render face in the specified view
            render(tempCanvas, data.heightData, data.biomeData, size, viewType, faceData.isWater, faceData.water);
            
            // Draw to combined canvas
            const pos = facePositions[face];
            const x = pos.x * (faceSize + borderWidth) + borderWidth;
            const y = pos.y * (faceSize + borderWidth) + borderWidth;
            
            ctx.drawImage(tempCanvas, x, y, faceSize, faceSize);
        });
        
        return combinedCanvas;
    }
    
    // Create and download both heightmap and biome versions
    try {
        // Create heightmap version
        const heightmapCanvas = createCubeNetCanvas('heightmap');
        const heightmapLink = document.createElement('a');
        heightmapLink.style.display = 'none';
        heightmapLink.download = `cubenet_heightmap_${sizeValue}mi_${seedValue}_${timestamp}.png`;
        heightmapLink.href = heightmapCanvas.toDataURL();
        heightmapLink.click();
        
        // Create biome version
        setTimeout(() => {
            const biomeCanvas = createCubeNetCanvas('biome');
            const biomeLink = document.createElement('a');
            biomeLink.style.display = 'none';
            biomeLink.download = `cubenet_biome_${sizeValue}mi_${seedValue}_${timestamp}.png`;
            biomeLink.href = biomeCanvas.toDataURL();
            biomeLink.click();
        }, 100); // Small delay to prevent browser blocking multiple downloads
        
    } catch (error) {
        console.error('Failed to download cube nets:', error);
    }
}

// Parse query parameters from URL
function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        seed: params.get('seed'),
        size: params.get('size')
    };
}

// Update URL query parameters
function updateQueryParams(seed, size) {
    const url = new URL(window.location);
    url.searchParams.set('seed', seed);
    url.searchParams.set('size', size);
    
    // Update URL without triggering a page reload
    window.history.replaceState({}, '', url);
}

// Generate initial map with test seed to verify edge continuity  
document.addEventListener('DOMContentLoaded', function() {
    loadFavoriteSeeds();
    updateFavoriteSeedsDisplay();
    
    // Check for query parameters
    const queryParams = getQueryParams();
    
    // Set size (with validation)
    let initialSize = defaultSize;
    if (queryParams.size) {
        const parsedSize = parseInt(queryParams.size);
        if (!isNaN(parsedSize) && parsedSize >= 1 && parsedSize <= 1024) {
            initialSize = parsedSize;
        }
    }
    document.getElementById('size').value = initialSize;
    
    // Set seed
    let initialSeed = defaultSeed;
    if (queryParams.seed && queryParams.seed.trim()) {
        initialSeed = queryParams.seed.trim();
    }
    document.getElementById('seed').value = initialSeed;
    
    generate();
});
