// Corner testing functionality for ocean depth debugging

function generateCornerTests() {
    const container = document.getElementById('cornerTestsContainer');
    const grid = document.getElementById('cornerTestsGrid');
    
    // Show the container and clear previous tests
    container.style.display = 'block';
    grid.innerHTML = '';
    
    const faces = ['front', 'back', 'left', 'right', 'top', 'bottom'];
    const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    
    // Generate a test for each corner of each face
    console.log('Generating 24 corner tests...');
    faces.forEach(face => {
        corners.forEach(corner => {
            generateSingleCornerTest(face, corner, grid);
        });
    });
}

async function generateSingleCornerTest(face, corner, container) {
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
                canvas.style.border = '1px solid #ccc';
                div.appendChild(canvas);
                canvases[faceName] = canvas;
            }
            cubeGrid.appendChild(div);
        });
    });
    
    testContainer.appendChild(cubeGrid);
    container.appendChild(testContainer);

    // Generate the test data
    let allFaceData = await generateCornerTestData(face, corner, size);
    
    
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

async function generateCornerTestData(targetFace, targetCorner, size) {
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
            waterData[i] = 1; // Start as shallow water
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
    await enhanceOceanDepths(allFaceData, size);
    
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