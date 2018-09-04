const fs = require('fs');

const testEndpoint = (req, res) => {
    try {
        const { file_data: fileData, file_name: fileName } = req.body;
        const buf = new Buffer(fileData, 'base64');
        fs.writeFileSync(`./files/resent/${fileName}`, fileData);
        return res.json({ error: false, message: 'OK' })
    } catch (err) {
        return res.status(500).json({ error: true, message: err.message });
    }

};

module.exports = {
    testEndpoint
};
