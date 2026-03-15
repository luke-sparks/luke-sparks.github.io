// Ocean Depth Worker - Handles ocean depth enhancement for individual cube faces
// This worker runs in a separate thread for parallel processing

function enhanceOceanDepthsForSingleFace(faceData, size, distanceFromLandMap) {
    const { waterData, isWater } = faceData;
    const shallowWaterMinDistance = 2;
    const shallowWaterMaxDistance = 15;

    // Apply depth levels based on distance from land
    for (let pixelIndex = 0; pixelIndex < size * size; pixelIndex++) {
        if (isWater[pixelIndex]) {
            const distanceFromNearestLand = distanceFromLandMap[pixelIndex];
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

    return { waterData };
}

// Worker message handler
self.addEventListener('message', function(e) {
    const { face, faceData, size, distanceFromLandMap, taskId } = e.data;

    try {
        // Process ocean depths for this face
        const result = enhanceOceanDepthsForSingleFace(faceData, size, distanceFromLandMap);

        // Send result back to main thread
        self.postMessage({
            taskId,
            face,
            success: true,
            waterData: result.waterData
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