// Generic State Persistence Utility
// Provides state saving/loading functionality for all screens

class StatePersistence {
  constructor(pageName, defaultState = {}) {
    this.pageName = pageName;
    this.storageKey = `${pageName}State`;
    this.defaultState = defaultState;
    this.state = this.loadState();
    this.setupAutoSave();
  }

  // Load state from localStorage
  loadState() {
    try {
      const savedState = localStorage.getItem(this.storageKey);
      if (!savedState) {
        console.log(`No saved state found for ${this.pageName}, using defaults`);
        return { ...this.defaultState };
      }

      const parsedState = JSON.parse(savedState);
      
      // Check if state is recent (within 7 days)
      const stateAge = Date.now() - (parsedState.timestamp || 0);
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      
      if (stateAge > maxAge) {
        console.log(`Saved state for ${this.pageName} is too old, clearing it`);
        localStorage.removeItem(this.storageKey);
        return { ...this.defaultState };
      }

      console.log(`Loaded saved state for ${this.pageName}`);
      return { ...this.defaultState, ...parsedState };
    } catch (error) {
      console.error(`Error loading state for ${this.pageName}:`, error);
      return { ...this.defaultState };
    }
  }

  // Save state to localStorage
  saveState() {
    try {
      const stateToSave = {
        ...this.state,
        timestamp: Date.now(),
      };
      
      // Convert Sets to arrays for serialization
      const serializedState = this.serializeState(stateToSave);
      
      localStorage.setItem(this.storageKey, JSON.stringify(serializedState));
      console.log(`State saved for ${this.pageName}`);
    } catch (error) {
      console.error(`Error saving state for ${this.pageName}:`, error);
    }
  }

  // Serialize state (convert Sets, Maps, etc. to JSON-serializable formats)
  serializeState(state) {
    const serialized = { ...state };
    
    for (const key in serialized) {
      if (serialized[key] instanceof Set) {
        serialized[key] = Array.from(serialized[key]);
      } else if (serialized[key] instanceof Map) {
        serialized[key] = Array.from(serialized[key].entries());
      } else if (typeof serialized[key] === 'object' && serialized[key] !== null) {
        serialized[key] = this.serializeState(serialized[key]);
      }
    }
    
    return serialized;
  }

  // Deserialize state (convert arrays back to Sets, Maps, etc.)
  deserializeState(state) {
    const deserialized = { ...state };
    
    for (const key in deserialized) {
      if (Array.isArray(deserialized[key]) && this.isSetKey(key)) {
        deserialized[key] = new Set(deserialized[key]);
      } else if (Array.isArray(deserialized[key]) && this.isMapKey(key)) {
        deserialized[key] = new Map(deserialized[key]);
      } else if (typeof deserialized[key] === 'object' && deserialized[key] !== null) {
        deserialized[key] = this.deserializeState(deserialized[key]);
      }
    }
    
    return deserialized;
  }

  // Check if a key should be a Set
  isSetKey(key) {
    return key.includes('selected') || key.includes('Set') || key.includes('Ids');
  }

  // Check if a key should be a Map
  isMapKey(key) {
    return key.includes('Map') || key.includes('cache');
  }

  // Update state and save
  updateState(updates) {
    this.state = { ...this.state, ...updates };
    this.saveState();
  }

  // Get state value
  getState(key) {
    return this.state[key];
  }

  // Set state value and save
  setState(key, value) {
    this.state[key] = value;
    this.saveState();
  }

  // Clear saved state
  clearState() {
    localStorage.removeItem(this.storageKey);
    this.state = { ...this.defaultState };
    console.log(`State cleared for ${this.pageName}`);
  }

  // Setup automatic saving
  setupAutoSave() {
    // Save on window unload
    window.addEventListener("beforeunload", () => {
      this.saveState();
    });

    // Save periodically (every 30 seconds) as backup
    setInterval(() => {
      this.saveState();
    }, 30000);
    
    console.log(`Auto-save enabled for ${this.pageName}`);
  }
}

// Export for use in other files
window.StatePersistence = StatePersistence;

