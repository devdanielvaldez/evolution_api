const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const { config } = require('dotenv');
const cors = require('cors');
config();

const app = express();
app.use(cors());
const PORT = process.env.PORT;
const CSV_FILE_PATH = 'data.csv';
const JSON_FILE_PATH = 'data.json';

app.use(express.json());

const validateIBOs = (numeroIBO, liderIBO) => {
    return new Promise((resolve, reject) => {
        let foundNumeroIBO = false;
        let foundLiderIBO = false;

        fs.createReadStream(CSV_FILE_PATH)
            .pipe(csv())
            .on('data', (row) => {
                if (row.NumeroIBO === numeroIBO) foundNumeroIBO = true;
                if (row.LiderIBO === liderIBO) foundLiderIBO = true;
            })
            .on('end', () => {
                resolve(foundNumeroIBO && foundLiderIBO);
            })
            .on('error', (err) => reject(err));
    });
};

app.post('/validate', async (req, res) => {
    const { numeroIBO, liderIBO, email, auspi } = req.body;
    if (!numeroIBO || !liderIBO || !email) {
        return res.status(400).json({ error: 'Faltan parámetros' });
    }

    try {
        const isValid = await validateIBOs(numeroIBO, liderIBO);
        if (!isValid) {
            return res.json({ found: false });
        }

        let data = [];
        if (fs.existsSync(JSON_FILE_PATH)) {
            const fileContent = fs.readFileSync(JSON_FILE_PATH);
            data = JSON.parse(fileContent);
        }

        data.push({ numeroIBO, liderIBO, email, auspiciador: auspi, isActive: false });
        fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(data, null, 2));

        res.json({ found: true });
    } catch (error) {
        res.status(500).json({ error: 'Error procesando la solicitud', details: error.message });
    }
});

app.get('/get-info/:email', (req, res) => {
    const email = req.params.email;
    if (!fs.existsSync(JSON_FILE_PATH)) {
        return res.status(404).json({ error: 'No hay datos almacenados' });
    }

    const data = JSON.parse(fs.readFileSync(JSON_FILE_PATH));
    const entry = data.find(item => item.email === email);
    if (!entry) {
        return res.status(404).json({ error: 'Email no encontrado' });
    }

    let nombreLider = null;
    fs.createReadStream(CSV_FILE_PATH)
        .pipe(csv())
        .on('data', (row) => {
            if (row.NumeroIBO === entry.numeroIBO && row.LiderIBO === entry.liderIBO) {
                nombreLider = row.NombreLider;
            }
        })
        .on('end', () => {
            if (nombreLider) {
                res.json({ numeroIBO: entry.numeroIBO, liderIBO: entry.liderIBO, nombreLider, auspiciador: entry.auspiciador });
            } else {
                res.status(404).json({ error: 'NombreLider no encontrado en el CSV' });
            }
        })
        .on('error', (err) => {
            res.status(500).json({ error: 'Error leyendo el archivo CSV', details: err.message });
        });
});

app.post('/activate', (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Falta el parámetro email' });
    }

    if (!fs.existsSync(JSON_FILE_PATH)) {
        return res.status(404).json({ error: 'No hay datos almacenados' });
    }

    try {
        const data = JSON.parse(fs.readFileSync(JSON_FILE_PATH));
        const userIndex = data.findIndex(item => item.email === email);
        
        if (userIndex === -1) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        // Actualizar el estado del usuario a activo
        data[userIndex].isActive = true;
        fs.writeFileSync(JSON_FILE_PATH, JSON.stringify(data, null, 2));

        res.json({ success: true, message: 'Usuario activado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error procesando la solicitud', details: error.message });
    }
});

app.get('/is-active/:email', (req, res) => {
    const email = req.params.email;
    
    if (!fs.existsSync(JSON_FILE_PATH)) {
        return res.status(404).json({ error: 'No hay datos almacenados' });
    }

    try {
        const data = JSON.parse(fs.readFileSync(JSON_FILE_PATH));
        const user = data.find(item => item.email === email);
        
        if (!user) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.json({ isActive: user.isActive });
    } catch (error) {
        res.status(500).json({ error: 'Error procesando la solicitud', details: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});