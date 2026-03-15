// Face Worker - Handles terrain generation for individual cube faces
// This worker runs in a separate thread for true parallelization

// Import dependencies
importScripts('noise.js');
importScripts('terrain-utils.js');

// Colors array (matches the main application)
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

// Worker message handler
self.addEventListener('message', function(e) {
    const { face, size, seed, taskId } = e.data;

    try {
        // Create noise generator with the provided seed
        const noise = new Noise(seed);

        // Generate the face
        const result = generateFace(face, size, noise, colors);

        // Send result back to main thread
        self.postMessage({
            taskId,
            face,
            success: true,
            ...result
        });

    } catch (error) {
        // Send error back to main thread
        self.postMessage({
            taskId,
            face,
            success: false,
            error: error.message
        });
    }
});