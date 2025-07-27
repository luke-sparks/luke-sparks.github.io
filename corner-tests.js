// Corner testing functionality for ocean depth debugging

function generateCornerTests() {
    const container = document.getElementById('cornerTestsContainer');
    const grid = document.getElementById('cornerTestsGrid');
    
    // Show the container and clear previous tests
    container.style.display = 'block';
    grid.innerHTML = '';
    
    const faces = ['front', 'back', 'left', 'right', 'top', 'bottom'];
    const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    // generateSingleCornerTest('back', 'top-left', grid);
    // generateSingleCornerTest('top', 'top-left', grid);
    // generateSingleCornerTest('top', 'top-right', grid);

    analyzeCornerTest('back', 'top-left');
    analyzeCornerTest('top', 'top-left');
    analyzeCornerTest('top', 'top-right');
    
    console.log('Generating 24 corner tests...');
    
    // Generate a test for each corner of each face
    faces.forEach(face => {
        corners.forEach(corner => {
            generateSingleCornerTest(face, corner, grid);
        });
    });
}

function generateSingleCornerTest(face, corner, container) {
    const size = 20; // Normal size, not 3x
    
    // Create container for this test
    const testContainer = document.createElement('div');
    testContainer.style.border = '1px solid #ccc';
    testContainer.style.padding = '10px';
    testContainer.style.textAlign = 'center';
    
    // Add title
    const title = document.createElement('h4');
    title.textContent = `${face} ${corner}`;
    title.style.margin = '0 0 10px 0';
    testContainer.appendChild(title);
    
    // Create cube grid for this test
    const cubeGrid = document.createElement('div');
    cubeGrid.className = 'cube-grid';
    cubeGrid.style.display = 'grid';
    cubeGrid.style.gridTemplateColumns = 'repeat(4, 60px)';
    cubeGrid.style.gridTemplateRows = 'repeat(3, 60px)';
    cubeGrid.style.gap = '0px';
    cubeGrid.style.margin = '0 auto';
    
    // Create canvases for each face
    const faceOrder = [
        [null, 'top', null, null],
        ['left', 'front', 'right', 'back'], 
        [null, 'bottom', null, null]
    ];
    
    const canvases = {};
    
    faceOrder.forEach(row => {
        row.forEach(faceName => {
            const div = document.createElement('div');
            if (faceName) {
                div.className = 'face';
                const canvas = document.createElement('canvas');
                canvas.id = `${face}-${corner}-${faceName}`;
                canvas.width = size;
                canvas.height = size;
                canvas.style.width = '60px';
                canvas.style.height = '60px';
                canvas.style.imageRendering = 'pixelated';
                canvas.style.display = 'block';
                div.appendChild(canvas);
                canvases[faceName] = canvas;
            }
            cubeGrid.appendChild(div);
        });
    });
    
    testContainer.appendChild(cubeGrid);
    container.appendChild(testContainer);
    
    // Generate the test data
    const allFaceData = generateCornerTestData(face, corner, size);
    
    // Render each face
    Object.keys(canvases).forEach(faceName => {
        const canvas = canvases[faceName];
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(size, size);
        const data = imageData.data;
        
        const faceData = allFaceData[faceName];
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const idx = y * size + x;
                const pixelIdx = idx * 4;
                
                let r, g, b;
                
                if (!faceData.isWater[idx]) {
                    // Land pixel - show as brown
                    r = 139; g = 69; b = 19;
                } else {
                    // Water pixel - color by depth
                    const depth = faceData.waterData[idx];
                    if (depth === 3) {
                        // Shallow water - light blue
                        r = 173; g = 216; b = 230;
                    } else if (depth === 2) {
                        // Medium water - medium blue  
                        r = 100; g = 149; b = 237;
                    } else {
                        // Deep water - dark blue
                        r = 25; g = 25; b = 112;
                    }
                }
                
                data[pixelIdx] = r;
                data[pixelIdx + 1] = g; 
                data[pixelIdx + 2] = b;
                data[pixelIdx + 3] = 255; // Alpha
            }
        }
        
        ctx.putImageData(imageData, 0, 0);
    });
}

function generateCornerTestData(targetFace, targetCorner, size) {
    const faces = ['front', 'back', 'left', 'right', 'top', 'bottom'];
    const allFaceData = {};
    
    // Create basic terrain data for all faces
    faces.forEach(face => {
        const waterData = new Float32Array(size * size);
        const landData = new Float32Array(size * size);
        const isWater = new Uint8Array(size * size);
        
        // Fill everything with water first
        for (let i = 0; i < size * size; i++) {
            isWater[i] = 1;
            waterData[i] = 3; // Start as shallow water
            landData[i] = 0;
        }
        
        allFaceData[face] = {
            waterData,
            landData, 
            isWater
        };
    });
    
    // Add single land pixel at the specified corner
    const cornerCoords = getCornerPixelCoordinates(targetCorner, size);
    const faceData = allFaceData[targetFace];
    const cornerIdx = cornerCoords.y * size + cornerCoords.x;
    
    faceData.isWater[cornerIdx] = 0;
    faceData.waterData[cornerIdx] = 0;
    faceData.landData[cornerIdx] = 5; // Lowland elevation
    
    // Apply ocean depth enhancement with simplified cross-face BFS
    enhanceOceanDepths(allFaceData, size);
    
    return allFaceData;
}

function getCornerPixelCoordinates(corner, size) {
    // Place land pixel 2 miles (2 pixels) away from the edges
    const offset = 2;
    
    switch (corner) {
        case 'top-left':
            return {x: offset, y: offset}; // 2 pixels from left and top edges
        case 'top-right': 
            return {x: size-1-offset, y: offset}; // 2 pixels from right and top edges
        case 'bottom-left':
            return {x: offset, y: size-1-offset}; // 2 pixels from left and bottom edges
        case 'bottom-right':
            return {x: size-1-offset, y: size-1-offset}; // 2 pixels from right and bottom edges
        default:
            return {x: offset, y: offset};
    }
}

function analyzeCornerTest(targetFace, targetCorner, testSize = 20) {
    console.log(`\n=== CORNER TEST ANALYSIS: ${targetFace.toUpperCase()} ${targetCorner.toUpperCase()} ===`);
    console.log(`Test size: ${testSize}x${testSize} pixels per face`);
    
    // Generate the test data
    const allFaceData = generateCornerTestData(targetFace, targetCorner, testSize);
    
    // Get the land pixel coordinates
    const landCoords = getCornerPixelCoordinates(targetCorner, testSize);
    const landPixelIndex = landCoords.y * testSize + landCoords.x;
    
    console.log(`\nLand pixel placed at: ${targetFace}(${landCoords.x},${landCoords.y}) = index ${landPixelIndex}`);
    
    // Analyze each face
    const faces = ['front', 'back', 'left', 'right', 'top', 'bottom'];
    faces.forEach(faceName => {
        const faceData = allFaceData[faceName];
        console.log(`\n--- ${faceName.toUpperCase()} FACE ---`);
        
        // Count pixels by type
        let landCount = 0;
        let shallowWaterCount = 0; // depth 3
        let mediumWaterCount = 0;  // depth 2  
        let deepWaterCount = 0;    // depth 1
        
        for (let i = 0; i < testSize * testSize; i++) {
            if (!faceData.isWater[i]) {
                landCount++;
            } else {
                const depth = faceData.waterData[i];
                if (depth === 3) shallowWaterCount++;
                else if (depth === 2) mediumWaterCount++;
                else if (depth === 1) deepWaterCount++;
            }
        }
        
        console.log(`Land pixels: ${landCount}`);
        console.log(`Shallow water (depth 3): ${shallowWaterCount}`);
        console.log(`Medium water (depth 2): ${mediumWaterCount}`);
        console.log(`Deep water (depth 1): ${deepWaterCount}`);
        
        // Show a visual map for the target face
        if (faceName === targetFace) {
            console.log(`\nVisual map of ${targetFace.toUpperCase()} face:`);
            console.log('L=Land, 3=Shallow, 2=Medium, 1=Deep water');
            
            let visualMap = '';
            for (let y = 0; y < testSize; y++) {
                let row = '';
                for (let x = 0; x < testSize; x++) {
                    const idx = y * testSize + x;
                    if (!faceData.isWater[idx]) {
                        row += 'L ';
                    } else {
                        row += faceData.waterData[idx] + ' ';
                    }
                }
                visualMap += row + '\n';
            }
            console.log(visualMap);
        }
        
        // Check for cross-face depth propagation near edges
        const edgeDepths = {
            top: [],
            right: [],
            bottom: [],
            left: []
        };
        
        // Sample edge pixels
        for (let i = 0; i < testSize; i++) {
            // Top edge (y=0)
            const topIdx = 0 * testSize + i;
            edgeDepths.top.push(faceData.isWater[topIdx] ? faceData.waterData[topIdx] : 'L');
            
            // Bottom edge (y=testSize-1)
            const bottomIdx = (testSize-1) * testSize + i;
            edgeDepths.bottom.push(faceData.isWater[bottomIdx] ? faceData.waterData[bottomIdx] : 'L');
            
            // Left edge (x=0)
            const leftIdx = i * testSize + 0;
            edgeDepths.left.push(faceData.isWater[leftIdx] ? faceData.waterData[leftIdx] : 'L');
            
            // Right edge (x=testSize-1)
            const rightIdx = i * testSize + (testSize-1);
            edgeDepths.right.push(faceData.isWater[rightIdx] ? faceData.waterData[rightIdx] : 'L');
        }
        
        console.log(`Edge depths - Top: [${edgeDepths.top.slice(0, 8).join(',')}...]`);
        console.log(`Edge depths - Right: [${edgeDepths.right.slice(0, 8).join(',')}...]`);
        console.log(`Edge depths - Bottom: [${edgeDepths.bottom.slice(0, 8).join(',')}...]`);
        console.log(`Edge depths - Left: [${edgeDepths.left.slice(0, 8).join(',')}...]`);
    });
    
    // Check for cross-face continuity
    console.log(`\n--- CROSS-FACE CONTINUITY CHECK ---`);
    const adjacency = getCubeFaceAdjacency();
    
    if (adjacency[targetFace]) {
        Object.keys(adjacency[targetFace]).forEach(direction => {
            const [adjacentFace, adjacentEdge] = adjacency[targetFace][direction];
            console.log(`${targetFace} ${direction} connects to ${adjacentFace} edge ${adjacentEdge}`);
            
            // Sample a few edge pixels to verify continuity
            const sampleIndices = [2, testSize/2, testSize-3].map(i => Math.floor(i));
            sampleIndices.forEach(sampleIdx => {
                if (sampleIdx >= 0 && sampleIdx < testSize) {
                    let sourcePixel, targetPixel;
                    
                    // Get source pixel from target face edge
                    if (direction === 'top') {
                        sourcePixel = allFaceData[targetFace].waterData[0 * testSize + sampleIdx];
                    } else if (direction === 'right') {
                        sourcePixel = allFaceData[targetFace].waterData[sampleIdx * testSize + (testSize-1)];
                    } else if (direction === 'bottom') {
                        sourcePixel = allFaceData[targetFace].waterData[(testSize-1) * testSize + sampleIdx];
                    } else if (direction === 'left') {
                        sourcePixel = allFaceData[targetFace].waterData[sampleIdx * testSize + 0];
                    }
                    
                    console.log(`  Sample ${sampleIdx}: ${targetFace} edge has depth ${sourcePixel}`);
                }
            });
        });
    }
    
    console.log(`\n=== END ANALYSIS ===\n`);
}