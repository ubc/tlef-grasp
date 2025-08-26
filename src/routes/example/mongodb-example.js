const express = require("express");
const { getCollection } = require("../../database/mongodb");
const router = express.Router();

// GET - Retrieve all documents from a collection
router.get("/users", async (req, res) => {
  try {
    const collection = getCollection("users");
    const users = await collection.find({}).toArray();
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET - Retrieve a single document by ID
router.get("/users/:id", async (req, res) => {
  try {
    const collection = getCollection("users");
    const user = await collection.findOne({ _id: req.params.id });

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST - Create a new document
router.post("/users", async (req, res) => {
  try {
    const collection = getCollection("users");
    const result = await collection.insertOne(req.body);

    res.status(201).json({
      success: true,
      data: { id: result.insertedId, ...req.body },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT - Update a document
router.put("/users/:id", async (req, res) => {
  try {
    const collection = getCollection("users");
    const result = await collection.updateOne(
      { _id: req.params.id },
      { $set: req.body }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    res.json({ success: true, message: "User updated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE - Remove a document
router.delete("/users/:id", async (req, res) => {
  try {
    const collection = getCollection("users");
    const result = await collection.deleteOne({ _id: req.params.id });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    res.json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST - Create a test user (for demonstration)
router.post("/test-user", async (req, res) => {
  try {
    const collection = getCollection("users");
    const testUser = {
      name: "John Doe",
      email: "john@example.com",
      role: "student",
      createdAt: new Date(),
    };

    const result = await collection.insertOne(testUser);

    res.status(201).json({
      success: true,
      message: "Test user created",
      data: { id: result.insertedId, ...testUser },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
