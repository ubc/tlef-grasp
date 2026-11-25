// Make a page grantable to TAs for the length of one test, as adding its key
// to TA_GRANTABLE_PERMISSION_KEYS in utils/ta-permissions.js would. Returns a
// function that puts the list back; call it in a finally block.
function grantTaPage(key) {
  const { TA_GRANTABLE_PERMISSION_KEYS } = require('../../src/utils/ta-permissions');
  if (TA_GRANTABLE_PERMISSION_KEYS.includes(key)) return () => {};
  TA_GRANTABLE_PERMISSION_KEYS.push(key);
  return () => {
    const index = TA_GRANTABLE_PERMISSION_KEYS.indexOf(key);
    if (index !== -1) TA_GRANTABLE_PERMISSION_KEYS.splice(index, 1);
  };
}

module.exports = { grantTaPage };
