// Helper to decode HTML entities if the SMILES string was escaped
function decodeHTMLEntities(text) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

// Global counter to ensure unique IDs across multiple calls
let smilesGlobalIndex = 0;

window.parseSmilesTags = function(text) {
  if (!text) return text;
  console.log("Parsing text for SMILES tags...");
  // Replaces [SMILES] CC=O [/SMILES] with <canvas id="..." ...></canvas>
  return text.replace(/\[SMILES\]\s*(.*?)\s*\[\/SMILES\]/gi, (match, smiles) => {
    const id = `smiles-canvas-${Date.now()}-${smilesGlobalIndex++}-${Math.floor(Math.random() * 1000)}`;
    console.log("Matched SMILES:", smiles.trim(), "Assigning ID:", id);
    return `<canvas id="${id}" data-smiles="${smiles.trim()}" width="200" height="200" style="display: inline-block; vertical-align: middle; border: 1px dashed #ccc;"></canvas>`;
  });
};

window.renderSmiles = function() {
  console.log("DEBUG: renderSmiles called");
  const canvases = document.querySelectorAll('canvas[data-smiles]');
  console.log("DEBUG: Found " + canvases.length + " SMILES canvases");
  
  if (canvases.length === 0) return;

  const options = {
    width: 200,
    height: 200,
    bondThickness: 1.0,
    bondLength: 15,
    shortBondLength: 0.85,
    fontSizeLarge: 10,
    fontSizeSmall: 7,
    padding: 10
  };

  const drawerLib = (typeof SmilesDrawer !== 'undefined' ? SmilesDrawer : (typeof SmiDrawer !== 'undefined' ? SmiDrawer : null));
  
  if (!drawerLib) {
    console.error("DEBUG: SmilesDrawer library NOT FOUND on window object");
    return;
  }

  if (drawerLib.Drawer && drawerLib.parse) {
    console.log("DEBUG: Attempting manual draw...");
    const instance = new drawerLib.Drawer(options);
    
    canvases.forEach(canvas => {
      // If already drawn, we might want to skip or clear, but draw() usually handles it
      let smiles = canvas.getAttribute('data-smiles');
      if (!smiles) return;
      
      // CRITICAL: SMILES might contain '=' which is often escaped to &#x3D; by other UI logic
      smiles = decodeHTMLEntities(smiles);
      
      const target = canvas.id;
      if (!target) return;

      console.log("DEBUG: Drawing decoded SMILES:", smiles, "on target ID:", target);
      try {
        drawerLib.parse(smiles, (tree) => {
          instance.draw(tree, target, 'light', false);
          console.log("DEBUG: Successfully rendered:", smiles);
          // Remove the debug border once successfully rendered
          canvas.style.border = "none";
        }, (err) => {
          console.error("DEBUG: Manual parse error for " + smiles + ":", err);
          // Show error message on canvas
          const ctx = canvas.getContext('2d');
          ctx.font = "10px Arial";
          ctx.fillStyle = "red";
          ctx.fillText("SMILES Error", 10, 20);
        });
      } catch (e) {
        console.error("DEBUG: Draw error for ID " + target + ":", e);
      }
    });
  }
};
