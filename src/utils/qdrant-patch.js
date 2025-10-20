// Float32Array fix for Qdrant client
// This module patches the Qdrant client to convert Float32Array to Array before sending to Qdrant

const { QdrantClient } = require("@qdrant/js-client-rest");

// Store the original upsert method
const originalUpsert = QdrantClient.prototype.upsert;

// Override the upsert method to convert Float32Array to Array
QdrantClient.prototype.upsert = function (collectionName, pointsData, options) {
  // Convert Float32Array to Array in points
  if (pointsData && pointsData.points) {
    pointsData.points = pointsData.points.map((point) => {
      if (point.vector && point.vector instanceof Float32Array) {
        return {
          ...point,
          vector: Array.from(point.vector),
        };
      }
      return point;
    });
  }

  // Call the original upsert method
  return originalUpsert.call(this, collectionName, pointsData, options);
};

// Store the original search method
const originalSearch = QdrantClient.prototype.search;

// Override the search method to convert Float32Array to Array
QdrantClient.prototype.search = function (collectionName, searchData, options) {
  // Convert Float32Array to Array in search vector
  if (
    searchData &&
    searchData.vector &&
    searchData.vector instanceof Float32Array
  ) {
    searchData = {
      ...searchData,
      vector: Array.from(searchData.vector),
    };
  }

  // Call the original search method
  return originalSearch.call(this, collectionName, searchData, options);
};

console.log("✅ Qdrant client patched to handle Float32Array conversion");
