let currentView = 'biome';
let currentData = null;
let currentLayers = null;
let seeds = [];
let favoriteSeeds = [];
let defaultSize = 80;
let defaultSeed = 'default';

const colors = [
        null,
        {r: 5, g: 15, b: 60},     // Level 1: Deep ocean
        {r: 15, g: 35, b: 90},    // Level 2: Medium ocean
        {r: 30, g: 60, b: 130},   // Level 3: Shallow ocean
        {r: 220, g: 200, b: 160}, // Level 4: Beach
        {r: 150, g: 200, b: 110}, // Level 5: Lowlands
        {r: 120, g: 180, b: 80},  // Level 6: Low plains
        {r: 100, g: 160, b: 70},  // Level 7: Plain
        {r: 90, g: 150, b: 65},   // Level 8: Rolling hills
        {r: 110, g: 140, b: 75},  // Level 9: Lower hills
        {r: 115, g: 130, b: 75},  // Level 10: Hills
        {r: 125, g: 130, b: 80},  // Level 11: Higher hills
        {r: 140, g: 120, b: 80},  // Level 12: Highlands
        {r: 145, g: 125, b: 85},  // Level 13: High highlands
        {r: 150, g: 130, b: 90},  // Level 14: Lower mountains
        {r: 160, g: 140, b: 100}, // Level 15: Mountains
        {r: 170, g: 150, b: 120}, // Level 16: High mountains
        {r: 180, g: 170, b: 150}, // Level 17: Alpine
        {r: 200, g: 200, b: 210}, // Level 18: High peaks
        {r: 220, g: 220, b: 230}, // Level 19: Snow line
        {r: 245, g: 245, b: 255}  // Level 20: Snow peaks
    ];

// Height value remapping for land: Land levels 4-20 mapped to heights
const landHeightMapping = {
    1: 0, 2: 0, 3: 0,   // Ocean depths
    4: 1,               // Beach
    5: 2,               // Lowlands
    6: 3,               // Low plains
    7: 4,               // Plains
    8: 5,              // Rolling hills 
    9: 6,              // Lower hills
    10: 7,             // Hills
    11: 9,             // Higher hills
    12: 11,             // Highlands
    13: 13,             // High highlands
    14: 15,             // Lower mountains
    15: 17,             // Mountains
    16: 20,             // High mountains
    17: 23,             // Alpine
    18: 26,             // High peaks
    19: 30,             // Snow line
    20: 34              // Snow peaks
};

// Worker pool for parallel face generation
let workerPool = [];
let workerBlobURL = null;
let taskCounter = 0;
// Initialize worker pool using Blob URLs so it works on file:// protocol.
// noise.js and terrain-utils.js are loaded as <script> tags in the HTML,
// making Noise, getCubeCoords, generateFace, etc. available as globals.
// We serialize them into the Blob source for the worker.
function initializeWorkers() {
    const workerSource = `
${Noise.toString()}
const rotationAngle = ${rotationAngle};
${getCubeCoords.toString()}
function getBiome(heightLevel, colors) { return colors[heightLevel] || {r: 0, g: 0, b: 0}; }
${generateFace.toString()}

const colors = ${JSON.stringify(colors)};

self.addEventListener('message', function(e) {
    const { face, size, seed, taskId } = e.data;
    try {
        const noise = new Noise(seed);
        const result = generateFace(face, size, noise, colors);
        self.postMessage({ taskId, face, success: true, ...result });
    } catch (error) {
        self.postMessage({ taskId, face, success: false, error: error.message });
    }
});
`;

    workerBlobURL = URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' }));

    for (let i = 0; i < 6; i++) {
        const worker = new Worker(workerBlobURL);
        workerPool.push(worker);
    }
}

// Clean up workers
function terminateWorkers() {
    workerPool.forEach(worker => worker.terminate());
    workerPool = [];
    if (workerBlobURL) {
        URL.revokeObjectURL(workerBlobURL);
        workerBlobURL = null;
    }
}

// Generate face using web worker
function generateFaceWithWorker(face, size, seed) {
    return new Promise((resolve, reject) => {
        const taskId = ++taskCounter;
        const workerIndex = ['front', 'back', 'left', 'right', 'top', 'bottom'].indexOf(face);
        const worker = workerPool[workerIndex];
        
        // Set up message handler for this task
        const messageHandler = (e) => {
            const { taskId: responseTaskId, success, face: responseFace, error, ...result } = e.data;
            
            // Check if this response is for our task
            if (responseTaskId === taskId && responseFace === face) {
                worker.removeEventListener('message', messageHandler);
                
                if (success) {
                    resolve(result);
                } else {
                    reject(new Error(error));
                }
            }
        };
        
        worker.addEventListener('message', messageHandler);
        
        // Send task to worker
        worker.postMessage({ face, size, seed, taskId });
        
        // Set up timeout to prevent hanging
        setTimeout(() => {
            worker.removeEventListener('message', messageHandler);
            reject(new Error(`Worker timeout for face: ${face}`));
        }, 30000); // 30 second timeout
    });
}

// Pre-computed neighbor offsets with distances (avoids Math.sqrt per neighbor per pixel)
const SQRT2 = Math.sqrt(2);
const NEIGHBOR_OFFSETS = [
    {dx: -1, dy: -1, dist: SQRT2}, {dx: 0, dy: -1, dist: 1}, {dx: 1, dy: -1, dist: SQRT2},
    {dx: -1, dy:  0, dist: 1},                                 {dx: 1, dy:  0, dist: 1},
    {dx: -1, dy:  1, dist: SQRT2}, {dx: 0, dy:  1, dist: 1}, {dx: 1, dy:  1, dist: SQRT2}
];

// Cross-face BFS distance calculation - runs in main thread for coordination
function calculateDistanceFromLand(allFaceData, size) {
    const faceAdjacency = FACE_ADJACENCY;
    const shallowWaterMaxDistance = 15;
    const maximumSearchRadius = Math.min(shallowWaterMaxDistance + 5, size / 4);

    // Create global distance maps and BFS queue for all faces
    const distanceFromLandMap = {};
    const breadthFirstSearchQueue = [];

    // Initialize distance maps and seed BFS with only boundary land pixels
    // (land pixels adjacent to water). Interior land pixels can never update
    // a water pixel's distance, so seeding them wastes time.
    Object.keys(allFaceData).forEach(currentFace => {
        const { isWater } = allFaceData[currentFace];
        distanceFromLandMap[currentFace] = new Float32Array(size * size);

        for (let pixelRow = 0; pixelRow < size; pixelRow++) {
            for (let pixelColumn = 0; pixelColumn < size; pixelColumn++) {
                const pixelIndex = pixelRow * size + pixelColumn;

                if (isWater[pixelIndex]) {
                    distanceFromLandMap[currentFace][pixelIndex] = Infinity;
                } else {
                    // Land pixel - only seed if it borders water
                    distanceFromLandMap[currentFace][pixelIndex] = 0;
                    let bordersWater = false;
                    for (let n = 0; n < NEIGHBOR_OFFSETS.length; n++) {
                        const nx = pixelColumn + NEIGHBOR_OFFSETS[n].dx;
                        const ny = pixelRow + NEIGHBOR_OFFSETS[n].dy;
                        if (nx >= 0 && nx < size && ny >= 0 && ny < size) {
                            if (isWater[ny * size + nx]) {
                                bordersWater = true;
                                break;
                            }
                        } else {
                            // Edge pixel - could border water on adjacent face, seed it to be safe
                            bordersWater = true;
                            break;
                        }
                    }
                    if (bordersWater) {
                        breadthFirstSearchQueue.push({face: currentFace, x: pixelColumn, y: pixelRow, dist: 0});
                    }
                }
            }
        }
    });

    if (breadthFirstSearchQueue.length === 0) return distanceFromLandMap;

    // Cross-face breadth-first search for distance calculation
    let currentQueuePosition = 0;
    while (currentQueuePosition < breadthFirstSearchQueue.length) {
        const {face: currentFace, x: currentPixelX, y: currentPixelY, dist: currentDistance} = breadthFirstSearchQueue[currentQueuePosition++];

        // Check 8-connected neighbors (including cross-face)
        for (let n = 0; n < NEIGHBOR_OFFSETS.length; n++) {
            const columnOffset = NEIGHBOR_OFFSETS[n].dx;
            const rowOffset = NEIGHBOR_OFFSETS[n].dy;
            const neighborX = currentPixelX + columnOffset;
            const neighborY = currentPixelY + rowOffset;
            const newDistanceToLand = currentDistance + NEIGHBOR_OFFSETS[n].dist;

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
                // Handle cross-face neighbors - only allow cardinal directions
                const isCardinalDirection = (columnOffset === 0) !== (rowOffset === 0);

                if (isCardinalDirection) {
                    let crossFaceAdjacentFace = null;
                    let sourceEdgeIndex = -1;

                    if (neighborX < 0) {
                        crossFaceAdjacentFace = faceAdjacency[currentFace].left[0];
                        sourceEdgeIndex = 3;
                    } else if (neighborX >= size) {
                        crossFaceAdjacentFace = faceAdjacency[currentFace].right[0];
                        sourceEdgeIndex = 1;
                    } else if (neighborY < 0) {
                        crossFaceAdjacentFace = faceAdjacency[currentFace].top[0];
                        sourceEdgeIndex = 0;
                    } else if (neighborY >= size) {
                        crossFaceAdjacentFace = faceAdjacency[currentFace].bottom[0];
                        sourceEdgeIndex = 2;
                    }

                    const {x: crossFaceAdjacentX, y: crossFaceAdjacentY} = transformPixelForCrossFace(neighborX, neighborY, size, currentFace, sourceEdgeIndex);

                    const adjacentPixelIndex = crossFaceAdjacentY * size + crossFaceAdjacentX;
                    const adjacentFaceData = allFaceData[crossFaceAdjacentFace];

                    if (adjacentFaceData.isWater[adjacentPixelIndex] && newDistanceToLand < distanceFromLandMap[crossFaceAdjacentFace][adjacentPixelIndex]) {
                        distanceFromLandMap[crossFaceAdjacentFace][adjacentPixelIndex] = newDistanceToLand;
                        if (newDistanceToLand <= maximumSearchRadius) {
                            breadthFirstSearchQueue.push({face: crossFaceAdjacentFace, x: crossFaceAdjacentX, y: crossFaceAdjacentY, dist: newDistanceToLand});
                        }
                    }
                }
            }
        }
    }

    return distanceFromLandMap;
}

// Ocean depth enhancement - inlined since the per-face work is trivial
// (simple if/else per pixel) and worker serialization overhead dominates
function enhanceOceanDepths(allFaceData, size) {
    console.log('Calculating cross-face distance maps...');
    const distanceFromLandMap = calculateDistanceFromLand(allFaceData, size);

    console.log('Processing ocean depths...');
    const shallowWaterMinDistance = 2;
    const shallowWaterMaxDistance = 15;
    const distanceRange = shallowWaterMaxDistance - shallowWaterMinDistance;

    const faces = Object.keys(allFaceData);
    for (let f = 0; f < faces.length; f++) {
        const face = faces[f];
        const { waterData, isWater } = allFaceData[face];
        const faceDist = distanceFromLandMap[face];
        const totalPixels = size * size;

        for (let i = 0; i < totalPixels; i++) {
            if (isWater[i]) {
                const dist = faceDist[i];
                if (dist <= shallowWaterMinDistance) {
                    waterData[i] = 3;
                } else if (dist <= shallowWaterMaxDistance) {
                    waterData[i] = ((dist - shallowWaterMinDistance) / distanceRange) < 0.5 ? 3 : 2;
                } else {
                    waterData[i] = 1;
                }
            }
        }
    }
}

// Cube face adjacency - computed once since topology never changes
// Each edge is defined as [face, edge] where edge is 0=top, 1=right, 2=bottom, 3=left
const FACE_ADJACENCY = {
    'front': {
        top: ['top', 2],      // Front top -> Top bottom
        right: ['right', 3],  // Front right -> Right left
        bottom: ['bottom', 0], // Front bottom -> Bottom top
        left: ['left', 1]     // Front left -> Left right
    },
    'back': {
        top: ['top', 0],      // Back top -> Top top
        right: ['left', 3],   // Back right -> Left left
        bottom: ['bottom', 2], // Back bottom -> Bottom bottom
        left: ['right', 1]    // Back left -> Right right
    },
    'right': {
        top: ['top', 1],      // Right top -> Top right
        right: ['back', 3],   // Right right -> Back left
        bottom: ['bottom', 1], // Right bottom -> Bottom right
        left: ['front', 1]    // Right left -> Front right
    },
    'left': {
        top: ['top', 3],      // Left top -> Top left
        right: ['front', 3],  // Left right -> Front left
        bottom: ['bottom', 3], // Left bottom -> Bottom left
        left: ['back', 1]     // Left left -> Back right
    },
    'top': {
        top: ['back', 0],     // Top top -> Back top
        right: ['right', 0],  // Top right -> Right top
        bottom: ['front', 0], // Top bottom -> Front top
        left: ['left', 0]     // Top left -> Left top
    },
    'bottom': {
        top: ['front', 2],    // Bottom top -> Front bottom
        right: ['right', 2],  // Bottom right -> Right bottom
        bottom: ['back', 2],  // Bottom bottom -> Back bottom
        left: ['left', 2]     // Bottom left -> Left bottom
    }
};

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
            return {x: sizeAdjusted, y: sizeAdjusted - sourcePixelX};
        case 'right-1':    // right right -> back left
            return {x: 0, y: sourcePixelY};
        case 'right-2':  // right bottom -> bottom right  
            return {x: sizeAdjusted, y: sourcePixelX};
        case 'right-3':   // right left -> front right
            return {x: sizeAdjusted, y: sourcePixelY};
            
        // Back face transitions
        case 'back-0':      // back top -> top top
            return {x: sizeAdjusted - sourcePixelX, y: 0};
        case 'back-1':     // back right -> left left
            return {x: 0, y: sourcePixelY};
        case 'back-2':   // back bottom -> bottom bottom
            return {x: sizeAdjusted - sourcePixelX, y: sizeAdjusted};
        case 'back-3':    // back left -> right right
            return {x: sizeAdjusted, y: sourcePixelY};
            
        // Left face transitions
        case 'left-0':      // left top -> top left
            return {x: 0, y: sourcePixelX};
        case 'left-1':    // left right -> front left
            return {x: 0, y: sourcePixelY};  
        case 'left-2':   // left bottom -> bottom left
            return {x: 0, y: sizeAdjusted - sourcePixelX};
        case 'left-3':     // left left -> back right
            return {x: sizeAdjusted, y: sourcePixelY};
            
        // Top face transitions
        case 'top-0':      // top top -> back top
            return {x: sizeAdjusted - sourcePixelX, y: 0};
        case 'top-1':     // top right -> right top
            return {x: sizeAdjusted - sourcePixelY, y: 0};
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
            return {x: sizeAdjusted - sourcePixelX, y: sizeAdjusted};
        case 'bottom-3':   // bottom left -> left bottom
            return {x: sizeAdjusted - sourcePixelY, y: sizeAdjusted};
            
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

// Parallel lake height adjustment using cross-face coordination
function adjustLakeHeights(allFaceData, size) {
    console.log('Finding connected water bodies across faces...');
    
    // Step 1: Find all connected water bodies using cross-face flood fill in main thread
    const adjacency = FACE_ADJACENCY;
    const maxLakeSize = Math.max(20, size * size * 0.1);
    const minLakeSize = 5;
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
                    let queuePos = 0;

                    // Cross-face flood fill
                    while (queuePos < queue.length) {
                        const {face, x: cx, y: cy} = queue[queuePos++];
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
                                let crossFaceAdjacentFace = null;
                                let sourceEdgeIndex = -1, targetEdgeIndex = -1;

                                if (nx < 0) {
                                    const [adjacentFaceName, adjacentFaceEdgeIndex] = adjacency[face].left;
                                    crossFaceAdjacentFace = adjacentFaceName;
                                    sourceEdgeIndex = 3;
                                    targetEdgeIndex = adjacentFaceEdgeIndex;
                                } else if (nx >= size) {
                                    const [adjacentFaceName, adjacentFaceEdgeIndex] = adjacency[face].right;
                                    crossFaceAdjacentFace = adjacentFaceName;
                                    sourceEdgeIndex = 1;
                                    targetEdgeIndex = adjacentFaceEdgeIndex;
                                } else if (ny < 0) {
                                    const [adjacentFaceName, adjacentFaceEdgeIndex] = adjacency[face].top;
                                    crossFaceAdjacentFace = adjacentFaceName;
                                    sourceEdgeIndex = 0;
                                    targetEdgeIndex = adjacentFaceEdgeIndex;
                                } else if (ny >= size) {
                                    const [adjacentFaceName, adjacentFaceEdgeIndex] = adjacency[face].bottom;
                                    crossFaceAdjacentFace = adjacentFaceName;
                                    sourceEdgeIndex = 2;
                                    targetEdgeIndex = adjacentFaceEdgeIndex;
                                } else {
                                    console.log("shouldn't ever get here");
                                    continue;
                                }

                                let {x: crossFaceAdjacentX, y: crossFaceAdjacentY} = transformPixelForCrossFace(nx, ny, size, face, sourceEdgeIndex);
                                
                                if (crossFaceAdjacentFace && allFaceData[crossFaceAdjacentFace]) {
                                    const adjIdx = crossFaceAdjacentY * size + crossFaceAdjacentX;
                                    if (allFaceData[crossFaceAdjacentFace].isWater[adjIdx] && !globalVisited[crossFaceAdjacentFace][adjIdx]) {
                                        queue.push({face: crossFaceAdjacentFace, x: crossFaceAdjacentX, y: crossFaceAdjacentY});
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
    
    console.log(`Found ${waterBodies.length} water bodies, applying adjustments...`);
    
    // Step 2: Process water bodies with cross-face coordination in main thread
    // (This requires cross-face neighbor checking which is complex to parallelize)
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
            let minSurroundingHeight = 999;
            
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
            
            if (minSurroundingHeight < 999) {
                const lakeHeight = Math.max(4, minSurroundingHeight);
                for (const {face, idx} of waterBody) {
                    allFaceData[face].waterData[idx] = lakeHeight;
                }
            }
        }
        // Large water bodies (oceans) are left unchanged
    }
}

function getBiome(heightLevel) {
    // Return the exact color for this height level
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

function convertToMappedHeight(colorMultiplier, heightData, waterData, isWater) {
    // Convert quantized height (0.1-2.0) back to discrete levels
    const heightLevel = Math.round(heightData * 10);
    
    let remappedValue;
    if (isWater) {
        const waterHeight = Math.round(waterData);
        if (waterHeight <= 3) {
            // Oceans map to 0
            remappedValue = 0;
        } else {
            // Lakes: lakes should be 1 height less than surrounding land
            // unless that would make them negative
            remappedValue = landHeightMapping[waterHeight] - 1 <= 0 ? 0 : landHeightMapping[waterHeight] - 1;
        }
    } else {
        // Use normal height mapping for land
        remappedValue = landHeightMapping[heightLevel] || 0;
    }
    
    // Height value * 8 for RGB
    return remappedValue * colorMultiplier;
}

function render(canvas, heightData, biomeData, size, view, isWater, waterData) {
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;
    
    if (view === 'heightmap') {
        for (let i = 0; i < heightData.length; i++) {
            const colorValue = convertToMappedHeight(4, heightData[i], waterData[i], isWater[i]);
            
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

async function generate() {
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
    
    const faces = ['front', 'back', 'left', 'right', 'top', 'bottom'];
    currentData = {};
    const allFaceData = {};
    
    try {
        // Initialize workers if not already done
        if (workerPool.length === 0) {
            initializeWorkers();
        }
        
        // First pass: Generate face terrain data and render each face as it completes
        console.log('Starting parallel face generation...');
        
        // Create promises for each face and handle them individually as they complete
        const facePromises = faces.map(async (face) => {
            try {
                console.log(`Starting generation for ${face}...`);
                const result = await generateFaceWithWorker(face, size, seed);
                
                // Process and render this face immediately
                currentData[face] = result;
                
                // Store face data for cross-face lake detection
                allFaceData[face] = {
                    waterData: result.layers.water,
                    landData: result.layers.land,
                    isWater: result.layers.isWater
                };
                
                // Store layers from front face for layer visualization
                if (face === 'front') {
                    currentLayers = result.layers;
                }
                
                // Render initial terrain (before ocean enhancement)
                const canvas = document.getElementById(face);
                render(canvas, result.heightData, result.biomeData, size, currentView, result.layers.isWater, result.layers.water);
                console.log(`Generation and initial render complete for ${face}`);
                
                return { face, result };
            } catch (error) {
                console.error(`Error generating ${face}:`, error);
                throw error;
            }
        });
        
        // Wait for all faces to complete
        await Promise.all(facePromises);
        console.log('All face generation completed');
        
        // Force browser to render the initial state before starting enhancement
        await new Promise(resolve => setTimeout(resolve, 50));
        
        console.log('Starting parallel ocean and lake processing...');
        
        // Second pass: Run ocean depths and lake heights
        enhanceOceanDepths(allFaceData, size);
        
        console.log('Ocean enhancement completed');

        adjustLakeHeights(allFaceData, size)
        
        // Third pass: Update final heightData and render with enhanced ocean depths
        console.log('Starting final rendering with enhanced ocean depths...');
        for (let i = 0; i < faces.length; i++) {
            const face = faces[i];
            const data = currentData[face];
            const faceData = allFaceData[face];
            
            console.log(`Processing final render for ${face}...`);
            
            // Update final height data with enhanced ocean depths and adjusted lake heights
            for (let j = 0; j < size * size; j++) {
                if (faceData.isWater[j]) {
                    data.heightData[j] = faceData.waterData[j] / 10;
                } else {
                    data.heightData[j] = faceData.landData[j] / 10;
                }
            }
            
            // Update layers with enhanced data
            data.layers.water = faceData.waterData;
            data.layers.land = faceData.landData;
            data.layers.isWater = faceData.isWater;
            
            // Regenerate biome data with enhanced ocean depths and correct lake classifications
            const biomeData = new Uint8ClampedArray(size * size * 4);

            for (let j = 0; j < size * size; j++) {
                if (faceData.isWater[j]) {
                    const actualWaterHeight = Math.round(faceData.waterData[j]);
                    let waterColorLevel;
                    
                    if (actualWaterHeight <= 3) {
                        waterColorLevel = actualWaterHeight;
                    } else {
                        waterColorLevel = 3;
                    }
                    
                    const biome = getBiome(waterColorLevel);
                    
                    const biomeIdx = j * 4;
                    biomeData[biomeIdx] = biome.r;
                    biomeData[biomeIdx + 1] = biome.g;
                    biomeData[biomeIdx + 2] = biome.b;
                    biomeData[biomeIdx + 3] = 255;
                } else {
                    const biome = getBiome(Math.round(faceData.landData[j]));
                    
                    const biomeIdx = j * 4;
                    biomeData[biomeIdx] = biome.r;
                    biomeData[biomeIdx + 1] = biome.g;
                    biomeData[biomeIdx + 2] = biome.b;
                    biomeData[biomeIdx + 3] = 255;
                }
            }
            
            data.biomeData = biomeData;
            
            // Final render with enhanced ocean depths
            const canvas = document.getElementById(face);
            render(canvas, data.heightData, data.biomeData, size, currentView, faceData.isWater, faceData.waterData);
            console.log(`Final render complete for ${face} with enhanced ocean depths`);
        }
        
        console.log('Generation completed successfully!');
        
    } catch (error) {
        console.error('Error during generation:', error);
        alert('Error during generation: ' + error.message);
    }
}

function downloadCubeNet() {
    if (!currentData) {
        alert('Please generate a map first!');
        return;
    }
    
    const size = parseInt(document.getElementById('size').value) || 128;
    const seedValue = document.getElementById('seed').value || 'random';
    const sizeValue = document.getElementById('size').value || '128';
    const reduceBy = 4;
    const smallerSize = Math.floor(size / reduceBy);

    // Pre-build color lookup map for O(1) color-to-index matching
    const colorToIndex = new Map();
    colors.forEach((c, i) => {
        if (c) colorToIndex.set(`${c.r},${c.g},${c.b}`, i);
    });

    function binCubeNet(biomeData, heightData, originalSize, isWater, waterData, isColorMap) {
        const binSize = Math.floor(originalSize / reduceBy);
        const binnedData = new Uint8ClampedArray(binSize * binSize * reduceBy);

        for (let y = 0; y < binSize; y++) {
            for (let x = 0; x < binSize; x++) {
                const sourceX = x * reduceBy;
                const sourceY = y * reduceBy;

                const heightCounts = new Map();
                const colorCounts = new Map();
                const lakeHeights = new Map();
                let oceanCount = 0;
                let lakeCount = 0;

                for (let dy = 0; dy < reduceBy; dy++) {
                    for (let dx = 0; dx < reduceBy; dx++) {
                        const srcX = Math.min(sourceX + dx, originalSize - 1);
                        const srcY = Math.min(sourceY + dy, originalSize - 1);
                        const srcIdxHeight = srcY * originalSize + srcX;
                        const srcIdxColor = srcIdxHeight * 4;

                        const height = convertToMappedHeight(1, heightData[srcIdxHeight], waterData[srcIdxHeight], isWater[srcIdxHeight]);
                        const r = biomeData[srcIdxColor];
                        const g = biomeData[srcIdxColor + 1];
                        const b = biomeData[srcIdxColor + 2];
                        const color = {r: r, g: g, b: b};
                        
                        let mappedLevel;
                        if (height < landHeightMapping[4]) {
                            mappedLevel = 0;
                        } else if (height < landHeightMapping[6]) {
                            mappedLevel = 1;
                        } else if (height < landHeightMapping[9]) {
                            mappedLevel = 2;
                        } else if (height < landHeightMapping[12]) {
                            mappedLevel = 3;
                        } else if (height < landHeightMapping[15]) {
                            mappedLevel = 4;
                        } else if (height < landHeightMapping[18]) {
                            mappedLevel = 5;
                        } else if (height < landHeightMapping[20]) {
                            mappedLevel = 6;
                        } else {
                            mappedLevel = 7;
                        }

                        if (mappedLevel === 0) {
                            oceanCount++;
                        } else if (isWater[srcIdxHeight]) {
                            lakeCount++;
                            lakeHeights.set(mappedLevel, (lakeHeights.get(mappedLevel) || 0) + 1);
                        }

                        const colorIndex = colorToIndex.get(`${color.r},${color.g},${color.b}`) ?? -1;

                        heightCounts.set(mappedLevel, (heightCounts.get(mappedLevel) || 0) + 1);
                        colorCounts.set(colorIndex, (colorCounts.get(colorIndex) || 0) + 1)
                    }
                }

                const heightCountsArray = Array.from(heightCounts).sort((a, b) => {
                    const count = b[1] - a[1];
                    return count == 0 ? a[0] - b[0] : count;
                });

                const colorCountsArray = Array.from(colorCounts).sort((a, b) => {
                    const count = b[1] - a[1];
                    return count == 0 ? a[0] - b[0] : count;
                });

                const lakehHeightsArray = Array.from(lakeHeights).sort((a, b) => {
                    const count = b[1] - a[1];
                    return count == 0 ? a[0] - b[0] : count;
                });

                let colorValue;
                let heightValue;

                if (oceanCount > reduceBy * reduceBy / 2) {
                    colorValue = colorCountsArray[0][0];
                    heightValue = heightCountsArray[0][0];
                } else {
                    if (oceanCount > 1) {
                        colorValue = colorCountsArray[0][0];
                        if (colorValue <= 3) {
                            colorValue = colorCountsArray[1][0];
                        }
                        heightValue = heightCountsArray[0][0];
                        if (heightValue == 0) {
                            heightValue = heightCountsArray[1][0];
                        }
                    } else {
                        colorValue = colorCountsArray[0][0];
                        if (colorValue <= 3) {
                            heightValue = lakehHeightsArray[0][0];
                        } else {
                            heightValue = heightCountsArray[0][0];
                        }
                    }
                }

                const destIdx = (y * binSize + x) * 4;
                if (isColorMap) {
                    binnedData[destIdx] = colors[colorValue].r;
                    binnedData[destIdx + 1] = colors[colorValue].g;
                    binnedData[destIdx + 2] = colors[colorValue].b;
                    binnedData[destIdx + 3] = 255;
                } else {
                    binnedData[destIdx] = heightValue;
                    binnedData[destIdx + 1] = heightValue;
                    binnedData[destIdx + 2] = heightValue;
                    binnedData[destIdx + 3] = 255;
                }
            }
        }
        return binnedData;
    }
    
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
        
        
        // Draw transparent grid lines
        ctx.strokeStyle = 'rgba(0, 0, 0, 0)';
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
    
    // Helper function to create smaller cube net with binning
    function createSmallCubeNetCanvas(isBinnedColormap = false) {
        const combinedCanvas = document.createElement('canvas');
        const borderWidth = 1;
        const faceSize = smallerSize;
        const totalWidth = (faceSize + borderWidth) * 4 + borderWidth;
        const totalHeight = (faceSize + borderWidth) * 3 + borderWidth;
        
        combinedCanvas.width = totalWidth;
        combinedCanvas.height = totalHeight;
        const ctx = combinedCanvas.getContext('2d');
        
        // Draw transparent grid lines
        ctx.strokeStyle = 'rgba(0, 0, 0, 0)';
        ctx.lineWidth = borderWidth;
        
        // Define face positions in the cube net (4x3 grid)
        const facePositions = {
            'top': { x: 1, y: 0 },
            'left': { x: 0, y: 1 },
            'front': { x: 1, y: 1 },
            'right': { x: 2, y: 1 },
            'back': { x: 3, y: 1 },
            'bottom': { x: 1, y: 2 }
        };
        
        // Create temporary canvases for each face
        Object.keys(facePositions).forEach(face => {
            const data = currentData[face];
            const faceData = data.layers;
            
            // Create smaller canvas for binned data
            const smallCanvas = document.createElement('canvas');
            smallCanvas.width = smallerSize;
            smallCanvas.height = smallerSize;
            const smallCtx = smallCanvas.getContext('2d');
            const smallImageData = smallCtx.createImageData(smallerSize, smallerSize);
            
            const binnedData = binCubeNet(data.biomeData, data.heightData, size, faceData.isWater, faceData.water, isBinnedColormap);
            
            smallImageData.data.set(binnedData);
            smallCtx.putImageData(smallImageData, 0, 0);
            
            // Draw to combined canvas
            const pos = facePositions[face];
            const x = pos.x * (faceSize + borderWidth) + borderWidth;
            const y = pos.y * (faceSize + borderWidth) + borderWidth;
            
            ctx.drawImage(smallCanvas, x, y, faceSize, faceSize);
        });
        
        return combinedCanvas;
    }
    
    // Create and download both heightmap and biome versions
    try {
        // Create heightmap version
        const heightmapCanvas = createCubeNetCanvas('heightmap');
        const heightmapLink = document.createElement('a');
        heightmapLink.style.display = 'none';
        heightmapLink.download = `heightmap_${sizeValue}_${seedValue}.png`;
        heightmapLink.href = heightmapCanvas.toDataURL();
        heightmapLink.click();
        
        // Create biome version
        setTimeout(() => {
            const biomeCanvas = createCubeNetCanvas('biome');
            const biomeLink = document.createElement('a');
            biomeLink.style.display = 'none';
            biomeLink.download = `colormap_${sizeValue}_${seedValue}.png`;
            biomeLink.href = biomeCanvas.toDataURL();
            biomeLink.click();
        }, 100);
        
        // Create small colormap version
        setTimeout(() => {
            const smallColormapCanvas = createSmallCubeNetCanvas(true);
            const smallColormapLink = document.createElement('a');
            smallColormapLink.style.display = 'none';
            smallColormapLink.download = `colormap_small_${smallerSize}_${seedValue}.png`;
            smallColormapLink.href = smallColormapCanvas.toDataURL();
            smallColormapLink.click();
        }, 200);
        
        // Create small heightmap version
        setTimeout(() => {
            const smallHeightmapCanvas = createSmallCubeNetCanvas(false);
            const smallHeightmapLink = document.createElement('a');
            smallHeightmapLink.style.display = 'none';
            smallHeightmapLink.download = `heightmap_small_${smallerSize}_${seedValue}.png`;
            smallHeightmapLink.href = smallHeightmapCanvas.toDataURL();
            smallHeightmapLink.click();
        }, 300);
        
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

// Clean up workers when page unloads
window.addEventListener('beforeunload', function() {
    terminateWorkers();
});
