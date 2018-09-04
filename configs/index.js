let config;
try {
    config = require('./local.config');
} catch (err) {
    console.error('Local config not found');
}

module.exports = {
    config
}
